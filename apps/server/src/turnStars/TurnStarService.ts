import {
  MessageId,
  type OrchestrationV2ConversationMessage,
  RunId,
  ThreadId,
  TURN_STAR_LIMIT,
  type TurnStar,
  TurnStarError,
  type TurnStarListResult,
  type TurnStarSetInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";

const PREVIEW_MAX_LENGTH = 160;

/**
 * Created at startup instead of by a numbered migration: this fork merges upstream nightly, and a
 * fork migration id would collide with upstream's next one. A row without `message_id` is an
 * agent's star waiting for its turn's final message; its key is `run:<runId>`.
 */
const ensureTurnStarTable = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS turn_stars (
      star_key TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      run_id TEXT,
      message_id TEXT,
      note TEXT,
      preview TEXT NOT NULL DEFAULT '',
      starred_by TEXT NOT NULL,
      starred_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS turn_stars_starred_at_idx ON turn_stars(starred_at)`;
});

interface TurnStarRow {
  readonly thread_id: string;
  readonly run_id: string | null;
  readonly message_id: string;
  readonly note: string | null;
  readonly preview: string;
  readonly starred_by: string;
  readonly starred_at: string;
}

const messageKey = (messageId: MessageId) => `message:${messageId}`;
const runKey = (runId: RunId) => `run:${runId}`;

/** The first line with text, without markdown block markers. */
export function starPreview(text: string): string {
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)*/, "").trim();
    if (line.length === 0 || line.startsWith("```")) continue;
    return line.length > PREVIEW_MAX_LENGTH ? `${line.slice(0, PREVIEW_MAX_LENGTH - 1)}…` : line;
  }
  return "";
}

const starError = (message: string) => (cause: unknown) => new TurnStarError({ message, cause });

export interface TurnStarServiceShape {
  /** Stars the run's final assistant message once the run ends. Calling again replaces the note. */
  readonly starRun: (input: {
    readonly threadId: ThreadId;
    readonly runId: RunId;
    readonly note: string | undefined;
  }) => Effect.Effect<void, TurnStarError>;
  readonly set: (input: TurnStarSetInput) => Effect.Effect<void, TurnStarError>;
  readonly clearAll: () => Effect.Effect<{ readonly cleared: number }, TurnStarError>;
  readonly list: () => Effect.Effect<TurnStarListResult, TurnStarError>;
  readonly subscribe: () => Stream.Stream<TurnStarListResult, TurnStarError>;
}

const unavailable = new TurnStarError({ message: "Stars are unavailable." });
/**
 * A reference so upstream's test harnesses for the ws and MCP layers need no fork mock; the
 * production runtime provides `layer`.
 */
export class TurnStarService extends Context.Reference<TurnStarServiceShape>(
  "t3/turnStars/TurnStarService",
  {
    defaultValue: () => ({
      starRun: () => Effect.fail(unavailable),
      set: () => Effect.fail(unavailable),
      clearAll: () => Effect.fail(unavailable),
      list: () => Effect.fail(unavailable),
      subscribe: () => Stream.fail(unavailable),
    }),
  },
) {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const threads = yield* ThreadManagement.ThreadManagementService;
  yield* ensureTurnStarTable;
  // Every change re-emits the whole list, so a slow subscriber needs only the newest signal.
  const changes = yield* PubSub.sliding<void>(1);
  const notify = PubSub.publish(changes, undefined).pipe(Effect.asVoid);
  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const prune = sql`
    DELETE FROM turn_stars
    WHERE message_id IS NOT NULL AND star_key NOT IN (
      SELECT star_key FROM turn_stars WHERE message_id IS NOT NULL
      ORDER BY starred_at DESC, star_key DESC LIMIT ${TURN_STAR_LIMIT}
    )
  `;

  const insertMessageStar = (input: {
    readonly message: OrchestrationV2ConversationMessage;
    readonly note: string | null;
    readonly starredBy: TurnStar["starredBy"];
    readonly starredAt: string;
  }) => sql`
    INSERT INTO turn_stars (
      star_key, thread_id, run_id, message_id, note, preview, starred_by, starred_at
    ) VALUES (
      ${messageKey(input.message.id)}, ${input.message.threadId}, ${input.message.runId},
      ${input.message.id}, ${input.note}, ${starPreview(input.message.text)}, ${input.starredBy},
      ${input.starredAt}
    )
    ON CONFLICT (star_key) DO UPDATE SET note = coalesce(excluded.note, turn_stars.note)
  `;

  const finalAssistantMessage = Effect.fn("TurnStarService.finalAssistantMessage")(function* (
    threadId: ThreadId,
    runId: RunId,
  ) {
    const records = yield* threads.getThreadRecords(threadId, ["runs", "messages"], {
      runIds: [runId],
      messageRunIds: [runId],
      messageRoles: ["assistant"],
    });
    const run = records.runs.find((candidate) => candidate.id === runId);
    if (run !== undefined && !ThreadManagement.isTerminalRunStatus(run.status)) return "running";
    let last: OrchestrationV2ConversationMessage | undefined;
    for (const message of records.messages) {
      if (message.runId !== runId || message.role !== "assistant") continue;
      if (
        last === undefined ||
        DateTime.toEpochMillis(message.createdAt) >= DateTime.toEpochMillis(last.createdAt)
      )
        last = message;
    }
    return last ?? "none";
  });

  /** Moves a waiting star onto its run's final message once the run has ended. */
  const attach = Effect.fn("TurnStarService.attach")(function* (runId: RunId) {
    const [pending] = yield* sql<{ readonly thread_id: string; readonly note: string | null }>`
      SELECT thread_id, note FROM turn_stars WHERE star_key = ${runKey(runId)}
    `;
    if (pending === undefined) return;
    const message = yield* finalAssistantMessage(ThreadId.make(pending.thread_id), runId);
    if (message === "running") return;
    const starredAt = yield* nowIso;
    yield* Effect.gen(function* () {
      // A turn that ended without a reply has nothing to show.
      if (message !== "none")
        yield* insertMessageStar({ message, note: pending.note, starredBy: "agent", starredAt });
      yield* sql`DELETE FROM turn_stars WHERE star_key = ${runKey(runId)}`;
      yield* prune;
    }).pipe(sql.withTransaction);
    yield* notify;
  });

  const starRun: TurnStarServiceShape["starRun"] = Effect.fn("TurnStarService.starRun")(
    function* (input) {
      const note = input.note?.trim() || null;
      yield* sql`
        INSERT INTO turn_stars (star_key, thread_id, run_id, note, starred_by, starred_at)
        VALUES (${runKey(input.runId)}, ${input.threadId}, ${input.runId}, ${note}, 'agent',
          ${yield* nowIso})
        ON CONFLICT (star_key) DO UPDATE SET note = excluded.note
      `;
      // The run normally is still going; this covers one that ended before the insert.
      yield* attach(input.runId);
    },
    Effect.mapError(starError("Could not star the turn.")),
  );

  const set: TurnStarServiceShape["set"] = Effect.fn("TurnStarService.set")(
    function* (input) {
      if (!input.starred) {
        yield* sql`DELETE FROM turn_stars WHERE star_key = ${messageKey(input.messageId)}`;
        return yield* notify;
      }
      const messages = yield* threads.getMessagesById(input.threadId, [input.messageId]);
      const message = messages.get(input.messageId);
      if (message === undefined || message.role !== "assistant")
        return yield* new TurnStarError({ message: "Only an assistant message can be starred." });
      const starredAt = yield* nowIso;
      yield* Effect.gen(function* () {
        yield* insertMessageStar({ message, note: null, starredBy: "user", starredAt });
        yield* prune;
      }).pipe(sql.withTransaction);
      yield* notify;
    },
    Effect.mapError((error) =>
      error._tag === "TurnStarError" ? error : starError("Could not update the star.")(error),
    ),
  );

  const clearAll: TurnStarServiceShape["clearAll"] = Effect.fn("TurnStarService.clearAll")(
    function* () {
      const rows = yield* sql<{ readonly star_key: string }>`
        DELETE FROM turn_stars WHERE message_id IS NOT NULL RETURNING star_key
      `;
      yield* notify;
      return { cleared: rows.length };
    },
    Effect.mapError(starError("Could not clear the stars.")),
  );

  const list: TurnStarServiceShape["list"] = Effect.fn("TurnStarService.list")(
    function* () {
      const rows = yield* sql<TurnStarRow>`
        SELECT thread_id, run_id, message_id, note, preview, starred_by, starred_at
        FROM turn_stars WHERE message_id IS NOT NULL
        ORDER BY starred_at DESC, star_key DESC LIMIT ${TURN_STAR_LIMIT}
      `;
      const threadIds = [...new Set(rows.map((row) => ThreadId.make(row.thread_id)))];
      const titles = yield* threads.getThreadTitles(threadIds);
      // Archived and settled threads keep their stars; a deleted thread's go with it.
      const gone = threadIds.filter((threadId) => titles[threadId] === undefined);
      if (gone.length > 0) yield* sql`DELETE FROM turn_stars WHERE thread_id IN ${sql.in(gone)}`;
      const stars = rows.flatMap((row): ReadonlyArray<TurnStar> => {
        const threadTitle = titles[ThreadId.make(row.thread_id)];
        if (threadTitle === undefined) return [];
        return [
          {
            messageId: MessageId.make(row.message_id),
            threadId: ThreadId.make(row.thread_id),
            runId: row.run_id === null ? null : RunId.make(row.run_id),
            threadTitle,
            note: row.note,
            preview: row.preview,
            starredBy: row.starred_by === "agent" ? "agent" : "user",
            starredAt: row.starred_at,
          },
        ];
      });
      return { stars };
    },
    Effect.mapError(starError("Could not read the stars.")),
  );

  const subscribe: TurnStarServiceShape["subscribe"] = () =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Subscribe before reading so a change during the read still arrives.
        const subscription = yield* PubSub.subscribe(changes);
        return Stream.concat(
          Stream.fromEffect(list()),
          Stream.fromSubscription(subscription).pipe(Stream.mapEffect(() => list())),
        );
      }),
    );

  const attachLogged = (runId: RunId) =>
    attach(runId).pipe(Effect.catchCause((cause) => Effect.logWarning("turn star", { cause })));
  // Runs that ended while the server was down.
  const waiting = yield* sql<{ readonly run_id: string }>`
    SELECT run_id FROM turn_stars WHERE message_id IS NULL AND run_id IS NOT NULL
  `.pipe(Effect.orElseSucceed(() => []));
  yield* forkParked(
    Effect.forEach(waiting, (row) => attachLogged(RunId.make(row.run_id)), { discard: true }),
  );
  yield* forkParked(
    Stream.runForEach(threads.streamDomainEvents, (event) =>
      event.type === "run.updated" && ThreadManagement.isTerminalRunStatus(event.payload.status)
        ? attachLogged(event.payload.id)
        : Effect.void,
    ),
  );

  return { starRun, set, clearAll, list, subscribe } satisfies TurnStarServiceShape;
});

export const layer = Layer.effect(TurnStarService, make);
