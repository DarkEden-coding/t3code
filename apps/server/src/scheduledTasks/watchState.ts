import type { ScheduledTaskId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { EMPTY_WATCH_STATE, type WatchState } from "./watchDetect.ts";

/**
 * Created at startup instead of by a numbered migration: this fork merges upstream nightly, and a
 * fork migration id would collide with upstream's next one, which `assertV2MigrationsCanRun`
 * refuses at startup. Upstreaming this table turns it into a normal migration.
 */
export const ensureWatchStateTable = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS scheduled_task_watch_state (
      task_id TEXT PRIMARY KEY REFERENCES scheduled_tasks(task_id) ON DELETE CASCADE,
      config_key TEXT,
      last_value TEXT,
      seen_ids_json TEXT NOT NULL DEFAULT '[]',
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      failure_notified INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      last_polled_at TEXT
    )
  `;
});

interface WatchStateRow {
  readonly config_key: string | null;
  readonly last_value: string | null;
  readonly seen_ids_json: string;
  readonly consecutive_failures: number;
  readonly failure_notified: number;
  readonly last_error: string | null;
  readonly last_polled_at: string | null;
}

const SeenIdsJson = Schema.fromJsonString(Schema.Array(Schema.String));
const decodeSeenIds = Schema.decodeUnknownOption(SeenIdsJson);
const encodeSeenIds = Schema.encodeSync(SeenIdsJson);

export const loadWatchState = Effect.fn("ScheduledTaskService.loadWatchState")(function* (
  taskId: ScheduledTaskId,
) {
  const sql = yield* SqlClient.SqlClient;
  const [row] = yield* sql<WatchStateRow>`
    SELECT config_key, last_value, seen_ids_json, consecutive_failures, failure_notified,
      last_error, last_polled_at
    FROM scheduled_task_watch_state WHERE task_id = ${taskId}
  `.pipe(NodeSqliteClient.readOnly);
  if (row === undefined) return EMPTY_WATCH_STATE;
  return {
    configKey: row.config_key,
    lastValue: row.last_value,
    seenIds: Option.getOrElse(decodeSeenIds(row.seen_ids_json), () => []),
    consecutiveFailures: row.consecutive_failures,
    failureNotified: row.failure_notified === 1,
    lastError: row.last_error,
    lastPolledAt: row.last_polled_at,
  } satisfies WatchState;
});

/** A task deleted mid-poll has no row to write to; its state went with it. */
export const saveWatchState = Effect.fn("ScheduledTaskService.saveWatchState")(function* (
  taskId: ScheduledTaskId,
  state: WatchState,
) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO scheduled_task_watch_state (
      task_id, config_key, last_value, seen_ids_json, consecutive_failures, failure_notified,
      last_error, last_polled_at
    )
    SELECT ${taskId}, ${state.configKey}, ${state.lastValue}, ${encodeSeenIds(state.seenIds)},
      ${state.consecutiveFailures}, ${state.failureNotified ? 1 : 0}, ${state.lastError},
      ${state.lastPolledAt}
    WHERE EXISTS (SELECT 1 FROM scheduled_tasks WHERE task_id = ${taskId})
    ON CONFLICT (task_id) DO UPDATE SET
      config_key = excluded.config_key,
      last_value = excluded.last_value,
      seen_ids_json = excluded.seen_ids_json,
      consecutive_failures = excluded.consecutive_failures,
      failure_notified = excluded.failure_notified,
      last_error = excluded.last_error,
      last_polled_at = excluded.last_polled_at
  `;
});
