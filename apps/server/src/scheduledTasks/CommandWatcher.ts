// @effect-diagnostics-next-line nodeBuiltinImport:off -- Secret names need a deterministic digest of the task id.
import * as NodeCrypto from "node:crypto";
import {
  DEFAULT_WATCH_TIMEOUT_MS,
  type ProjectId,
  type ScheduledTaskId,
  type ScheduledTaskWatchEnvVar,
  type ScheduledTaskWatchSchedule,
  SecretReference,
} from "@t3tools/contracts";
import * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ProjectService from "../project/ProjectService.ts";

const MAX_STDOUT_BYTES = 1024 * 1024;
const STDERR_TAIL_CHARS = 1_500;

/** A variable's value as a save resolves it; a `secretRef` is already spent into `value`. */
export type WatchEnvEntry =
  | { readonly name: string; readonly value: string; readonly secret: boolean }
  | { readonly name: string; readonly reference: SecretReference }
  | { readonly name: string; readonly keep: true };

export class WatchEnvMissingError extends Schema.TaggedError<WatchEnvMissingError>()(
  "WatchEnvMissingError",
  { variable: Schema.String },
) {
  override get message(): string {
    return `${this.variable} has no stored value. Give it a value.`;
  }
}

export class WatchEnvStoreError extends Schema.TaggedError<WatchEnvStoreError>()(
  "WatchEnvStoreError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not store the command's environment variables.";
  }
}

/** A poll's output, or why it failed. Failures are recorded on the task, not raised. */
export type WatchRunResult =
  | { readonly _tag: "Output"; readonly stdout: string }
  | { readonly _tag: "Failed"; readonly error: string };

const StoredEnvValue = Schema.Union([
  Schema.Struct({ value: Schema.String, secret: Schema.Boolean }),
  Schema.Struct({ reference: SecretReference }),
]);
const StoredEnv = Schema.fromJsonString(Schema.Record(Schema.String, StoredEnvValue));
type StoredEnv = typeof StoredEnv.Type;
const decodeStoredEnv = Schema.decodeUnknownOption(StoredEnv);
const encodeStoredEnv = Schema.encodeSync(StoredEnv);

function envSecretName(taskId: ScheduledTaskId): string {
  const hash = NodeCrypto.createHash("sha256").update(taskId).digest("hex").slice(0, 32);
  return `scheduled-task-watch-env-${hash}`;
}

function shellInvocation(
  command: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): { readonly command: string; readonly args: string[] } {
  return platform === "win32"
    ? { command: env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", command] }
    : { command: "/bin/sh", args: ["-c", command] };
}

/** Scripts sometimes echo their credentials in an error; keep them out of the stored error. */
function redact(text: string, secrets: ReadonlyArray<string>): string {
  return secrets
    .filter((secret) => secret.length >= 4)
    .reduce((redacted, secret) => redacted.replaceAll(secret, "[redacted]"), text);
}

export class CommandWatcher extends Context.Service<
  CommandWatcher,
  {
    /** Runs the command in the project root with its env, capped at 1 MiB of stdout. */
    readonly run: (task: {
      readonly id: ScheduledTaskId;
      readonly projectId: ProjectId;
      readonly schedule: ScheduledTaskWatchSchedule;
    }) => Effect.Effect<WatchRunResult>;
    /** Stores the task's variable values outside the database and returns what clients may see. */
    readonly saveEnv: (
      taskId: ScheduledTaskId,
      entries: ReadonlyArray<WatchEnvEntry>,
    ) => Effect.Effect<
      ReadonlyArray<ScheduledTaskWatchEnvVar>,
      WatchEnvMissingError | WatchEnvStoreError
    >;
    readonly removeEnv: (taskId: ScheduledTaskId) => Effect.Effect<void>;
  }
>()("t3/scheduledTasks/CommandWatcher") {}

const make = Effect.gen(function* () {
  const secretStore = yield* ServerSecretStore.ServerSecretStore;
  const secretResolver = yield* SecretResolver.SecretResolver;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const projects = yield* ProjectService.ProjectService;

  const readEnv = (taskId: ScheduledTaskId) =>
    secretStore
      .get(envSecretName(taskId))
      .pipe(
        Effect.map((stored) =>
          Option.isNone(stored)
            ? ({} satisfies StoredEnv)
            : Option.getOrElse(decodeStoredEnv(new TextDecoder().decode(stored.value)), () => ({})),
        ),
      );

  const resolveEnv = Effect.fn("CommandWatcher.resolveEnv")(function* (
    taskId: ScheduledTaskId,
    schedule: ScheduledTaskWatchSchedule,
  ) {
    const stored = yield* readEnv(taskId);
    const env: Record<string, string> = {};
    const secrets: string[] = [];
    for (const { name } of schedule.env ?? []) {
      const entry = stored[name];
      if (entry === undefined) return { error: `${name} has no stored value.` } as const;
      if ("value" in entry) {
        env[name] = entry.value;
        if (entry.secret) secrets.push(entry.value);
        continue;
      }
      const [value] = yield* secretResolver.read([entry.reference]);
      if (value === undefined) {
        const label = yield* secretResolver.label(entry.reference.provider);
        return { error: `Could not read ${name} from ${label}.` } as const;
      }
      env[name] = value;
      secrets.push(value);
    }
    return { env, secrets } as const;
  });

  const run: CommandWatcher["Service"]["run"] = Effect.fn("CommandWatcher.run")(
    function* (task) {
      const project = yield* projects.getById(task.projectId);
      if (Option.isNone(project)) {
        return { _tag: "Failed", error: "The task's project no longer exists." } as const;
      }
      const resolved = yield* resolveEnv(task.id, task.schedule);
      if ("error" in resolved) return { _tag: "Failed", error: resolved.error } as const;
      const timeoutMs = task.schedule.timeoutMs ?? DEFAULT_WATCH_TIMEOUT_MS;
      const output = yield* processRunner.run({
        ...shellInvocation(
          task.schedule.command,
          yield* HostProcess.Platform,
          yield* HostProcess.Environment,
        ),
        cwd: project.value.workspaceRoot,
        env: resolved.env,
        timeout: timeoutMs,
        timeoutBehavior: "timedOutResult",
        maxOutputBytes: MAX_STDOUT_BYTES,
        outputMode: "truncate",
      });
      if (output.timedOut) {
        return {
          _tag: "Failed",
          error: `The command timed out after ${Math.round(timeoutMs / 1000)} s.`,
        } as const;
      }
      if (output.stdoutTruncated) {
        return { _tag: "Failed", error: "The command printed more than 1 MiB." } as const;
      }
      if (output.code !== 0) {
        const stderr = redact(output.stderr.trim(), resolved.secrets).slice(-STDERR_TAIL_CHARS);
        return {
          _tag: "Failed",
          error: `The command exited with code ${output.code ?? "unknown"}.${stderr === "" ? "" : `\n${stderr}`}`,
        } as const;
      }
      return { _tag: "Output", stdout: output.stdout } as const;
    },
    // Infrastructure failures are poll failures too; the task records them like a bad exit.
    (effect) =>
      effect.pipe(
        Effect.catch((error) =>
          Effect.succeed({
            _tag: "Failed",
            error: `The command could not run: ${error.message}`,
          } as const),
        ),
      ),
  );

  const saveEnv: CommandWatcher["Service"]["saveEnv"] = Effect.fn("CommandWatcher.saveEnv")(
    function* (taskId, entries) {
      const storeError = (cause: unknown) => new WatchEnvStoreError({ cause });
      const existing = yield* readEnv(taskId).pipe(Effect.mapError(storeError));
      const next: Record<string, StoredEnv[string]> = {};
      for (const entry of entries) {
        if ("keep" in entry) {
          const kept = existing[entry.name];
          if (kept === undefined) {
            return yield* new WatchEnvMissingError({ variable: entry.name });
          }
          next[entry.name] = kept;
        } else {
          next[entry.name] =
            "reference" in entry
              ? { reference: entry.reference }
              : { value: entry.value, secret: entry.secret };
        }
      }
      const name = envSecretName(taskId);
      yield* (
        Object.keys(next).length === 0
          ? secretStore.remove(name)
          : secretStore.set(name, new TextEncoder().encode(encodeStoredEnv(next)))
      ).pipe(Effect.mapError(storeError));
      return Object.entries(next).map(([variable, stored]) => ({
        name: variable,
        secret: "reference" in stored || stored.secret,
      }));
    },
  );

  const removeEnv: CommandWatcher["Service"]["removeEnv"] = Effect.fn("CommandWatcher.removeEnv")(
    function* (taskId) {
      yield* secretStore
        .remove(envSecretName(taskId))
        .pipe(
          Effect.catch((cause) =>
            Effect.logWarning("Could not remove a command watcher's stored env", { cause }),
          ),
        );
    },
  );

  return CommandWatcher.of({ run, saveEnv, removeEnv });
});

export const layer = Layer.effect(CommandWatcher, make);
