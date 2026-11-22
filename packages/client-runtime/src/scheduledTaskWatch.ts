import {
  DEFAULT_WATCH_TIMEOUT_MS,
  MAX_WATCH_TIMEOUT_MS,
  type ScheduledTaskSchedule,
  type ScheduledTaskUpsertSchedule,
  type ScheduledTaskUpsertWatchEnvVar,
  ScheduledTaskWatchFilter,
  type ScheduledTaskWatchSchedule,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

import { parseFilterDrafts, type WebhookFilterDraft } from "./scheduledTaskWebhook.ts";

export const DEFAULT_WATCH_PROMPTS = {
  items: "{{items.length}} new items:\n{{items}}",
  value: "The value changed from {{previous}} to {{value}}.",
} as const;

/** One editable variable. A stored row's value is never sent to clients; leaving it empty keeps it. */
export interface WatchEnvDraft {
  /** Stable row identity for the form; never sent to the server. */
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly secret: boolean;
  readonly stored: boolean;
}

export interface WatchDraft {
  readonly command: string;
  readonly mode: ScheduledTaskWatchSchedule["mode"];
  readonly path: string;
  readonly idPath: string;
  readonly timeoutSeconds: string;
  readonly env: ReadonlyArray<WatchEnvDraft>;
}

let lastWatchEnvDraftId = 0;
const nextWatchEnvDraftId = () => `env-${++lastWatchEnvDraftId}`;

export function emptyWatchEnvDraft(): WatchEnvDraft {
  return { id: nextWatchEnvDraftId(), name: "", value: "", secret: true, stored: false };
}

export function watchDraft(schedule: ScheduledTaskSchedule | undefined): WatchDraft {
  const watch = schedule?.type === "watch" ? schedule : undefined;
  return {
    command: watch?.command ?? "",
    mode: watch?.mode ?? "items",
    path: watch?.path ?? "",
    idPath: watch?.idPath ?? "",
    timeoutSeconds: String((watch?.timeoutMs ?? DEFAULT_WATCH_TIMEOUT_MS) / 1000),
    env: (watch?.env ?? []).map((variable) => ({
      id: nextWatchEnvDraftId(),
      name: variable.name,
      value: "",
      secret: variable.secret,
      stored: true,
    })),
  };
}

const decodeWatchFilter = Schema.decodeUnknownOption(ScheduledTaskWatchFilter);
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The schedule a form saves, checked the way the server checks it. */
export function watchScheduleFromDraft(
  draft: WatchDraft,
  everyMs: number,
  filterDrafts: ReadonlyArray<WebhookFilterDraft>,
  resolve: MFunctionType = mFallback,
):
  | { readonly schedule: Extract<ScheduledTaskUpsertSchedule, { readonly type: "watch" }> }
  | { readonly error: string } {
  const command = draft.command.trim();
  if (command === "") return { error: resolve(msg("Enter a command to watch.")) };
  const timeoutMs = Math.round(Number(draft.timeoutSeconds) * 1000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > MAX_WATCH_TIMEOUT_MS) {
    return {
      error: resolve(
        msg("Enter a timeout from 1 to {max} seconds.", { max: MAX_WATCH_TIMEOUT_MS / 1000 }),
      ),
    };
  }
  const parsed = parseFilterDrafts(
    filterDrafts,
    decodeWatchFilter,
    ({ number, op }) =>
      op === "exists"
        ? resolve(msg("Filter {number} needs a path.", { number }))
        : op === "matches"
          ? resolve(msg("Filter {number} needs a path and a valid regex.", { number }))
          : resolve(msg("Filter {number} needs a path and a value.", { number })),
    resolve,
  );
  if ("error" in parsed) return parsed;
  const env: ScheduledTaskUpsertWatchEnvVar[] = [];
  for (const variable of draft.env) {
    const name = variable.name.trim();
    if (!ENV_NAME.test(name) || env.some((entry) => entry.name === name)) {
      return {
        error: resolve(
          msg("Variable names use letters, digits and underscores, once each: {name}", {
            name: name === "" ? "?" : name,
          }),
        ),
      };
    }
    if (variable.value === "" && !variable.stored) {
      return { error: resolve(msg("Give {name} a value.", { name })) };
    }
    env.push(
      variable.value === "" ? { name } : { name, value: variable.value, secret: variable.secret },
    );
  }
  const path = draft.path.trim();
  const idPath = draft.idPath.trim();
  return {
    schedule: {
      type: "watch",
      everyMs,
      command,
      mode: draft.mode,
      ...(path === "" ? {} : { path }),
      ...(draft.mode === "items" && idPath !== "" ? { idPath } : {}),
      ...(timeoutMs === DEFAULT_WATCH_TIMEOUT_MS ? {} : { timeoutMs }),
      filters: parsed.filters,
      env,
    },
  };
}
