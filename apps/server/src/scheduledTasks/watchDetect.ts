// @effect-diagnostics-next-line nodeBuiltinImport:off -- The baseline key needs a deterministic digest.
import * as NodeCrypto from "node:crypto";
import type { ScheduledTaskWatchSchedule } from "@t3tools/contracts";

import { findFailedFilter } from "./webhookFilter.ts";
import { lookupPath, renderUntrustedTemplate } from "./webhookTemplate.ts";

export const WATCH_MAX_SEEN_IDS = 1_000;
export const WATCH_MAX_PROMPT_ITEMS = 50;
const WATCH_FAILURE_WAKE_THRESHOLD = 3;
const WATCH_ERROR_MAX_CHARS = 2_000;

/** What a watch task remembers between polls. `configKey` is null until a poll records a baseline. */
export interface WatchState {
  readonly configKey: string | null;
  readonly lastValue: string | null;
  readonly seenIds: ReadonlyArray<string>;
  readonly consecutiveFailures: number;
  readonly failureNotified: boolean;
  readonly lastError: string | null;
  readonly lastPolledAt: string | null;
}

export const EMPTY_WATCH_STATE: WatchState = {
  configKey: null,
  lastValue: null,
  seenIds: [],
  consecutiveFailures: 0,
  failureNotified: false,
  lastError: null,
  lastPolledAt: null,
};

export type WatchChange =
  | { readonly mode: "items"; readonly items: ReadonlyArray<unknown> }
  | { readonly mode: "value"; readonly value: unknown; readonly previous: unknown };

export type WatchDetection =
  | { readonly _tag: "Baseline"; readonly state: WatchState }
  | { readonly _tag: "Unchanged"; readonly state: WatchState }
  | { readonly _tag: "Changed"; readonly state: WatchState; readonly change: WatchChange }
  | { readonly _tag: "Invalid"; readonly error: string };

/** Edits to anything that changes what a poll compares reset the baseline; timeout and env do not. */
function watchConfigKey(schedule: ScheduledTaskWatchSchedule): string {
  const key = JSON.stringify([
    schedule.command,
    schedule.mode,
    schedule.path ?? "",
    schedule.mode === "items" ? (schedule.idPath ?? "id") : "",
    schedule.filters ?? [],
  ]);
  return NodeCrypto.createHash("sha256").update(key).digest("hex");
}

/** Sorted keys, so two outputs that differ only in key order compare equal. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : inner,
  );
}

function parseJson(
  text: string,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

function itemId(item: unknown, idPath: string): string {
  const id = lookupPath(item, idPath);
  if (typeof id === "string") return id;
  if (typeof id === "number" || typeof id === "boolean") return String(id);
  // Items without a usable id are identified by their whole content.
  return canonicalJson(item);
}

function passesFilters(schedule: ScheduledTaskWatchSchedule, subject: unknown): boolean {
  const filters = schedule.filters ?? [];
  return (
    filters.length === 0 || findFailedFilter(filters, (path) => lookupPath(subject, path)) === null
  );
}

/**
 * Compares one poll's stdout with the stored state. The first poll for a config records a baseline
 * and never fires. Items mode fires for unseen ids that pass every filter; value mode fires when the
 * selected value changes and the new value passes every filter.
 */
export function detectWatchChange(
  schedule: ScheduledTaskWatchSchedule,
  stdout: string,
  previous: WatchState,
  polledAt: string,
): WatchDetection {
  const configKey = watchConfigKey(schedule);
  const hasBaseline = previous.configKey === configKey;
  const path = schedule.path ?? "";
  const parsed = parseJson(stdout);
  const recovered = {
    ...previous,
    configKey,
    consecutiveFailures: 0,
    failureNotified: false,
    lastError: null,
    lastPolledAt: polledAt,
  };

  if (schedule.mode === "value") {
    // An empty path compares the whole output: as JSON when it parses, else as exact text.
    if (!parsed.ok && path.trim() !== "") {
      return { _tag: "Invalid", error: "The output is not valid JSON." };
    }
    const value = parsed.ok ? (lookupPath(parsed.value, path) ?? null) : stdout;
    const serialized = canonicalJson(value);
    const state: WatchState = { ...recovered, lastValue: serialized, seenIds: [] };
    if (!hasBaseline) return { _tag: "Baseline", state };
    if (previous.lastValue === serialized || !passesFilters(schedule, value)) {
      return { _tag: "Unchanged", state };
    }
    const prior =
      previous.lastValue === null ? { ok: false as const } : parseJson(previous.lastValue);
    return {
      _tag: "Changed",
      state,
      change: { mode: "value", value, previous: prior.ok ? prior.value : null },
    };
  }

  if (!parsed.ok) return { _tag: "Invalid", error: "The output is not valid JSON." };
  const items = lookupPath(parsed.value, path);
  if (!Array.isArray(items)) {
    return {
      _tag: "Invalid",
      error: path.trim() === "" ? "The output is not a JSON array." : `"${path}" is not an array.`,
    };
  }
  const idPath = schedule.idPath ?? "id";
  const ids = items.map((item) => itemId(item, idPath));
  // Ids still in the output come first, so the cap drops ids that already left it.
  const seenIds = [...new Set([...ids, ...previous.seenIds])].slice(0, WATCH_MAX_SEEN_IDS);
  const state: WatchState = { ...recovered, lastValue: null, seenIds };
  if (!hasBaseline) return { _tag: "Baseline", state };
  // Adding each id as it is read also counts an id repeated within one output once.
  const seen = new Set(previous.seenIds);
  const fresh = items.filter((item, index) => {
    const id = ids[index] ?? "";
    if (seen.has(id)) return false;
    seen.add(id);
    return passesFilters(schedule, item);
  });
  return fresh.length === 0
    ? { _tag: "Unchanged", state }
    : { _tag: "Changed", state, change: { mode: "items", items: fresh } };
}

/** A failed poll keeps the baseline; only the third failure in a row asks for a wake. */
export function recordWatchFailure(
  previous: WatchState,
  error: string,
  polledAt: string,
): { readonly state: WatchState; readonly wake: boolean } {
  const consecutiveFailures = previous.consecutiveFailures + 1;
  return {
    state: {
      ...previous,
      consecutiveFailures,
      lastError: error.slice(0, WATCH_ERROR_MAX_CHARS),
      lastPolledAt: polledAt,
    },
    wake: consecutiveFailures === WATCH_FAILURE_WAKE_THRESHOLD,
  };
}

const WATCH_FRAME_SOURCE = "the watched command's output";

/** Fills `{{items}}`, `{{items.length}}`, `{{value}}` and `{{previous}}`, framed as untrusted data. */
export function renderWatchPrompt(template: string, change: WatchChange, frameId: string): string {
  const shown = change.mode === "items" ? change.items.slice(0, WATCH_MAX_PROMPT_ITEMS) : [];
  const resolve = (expression: string): unknown => {
    switch (expression) {
      case "items":
        return change.mode === "items" ? shown : undefined;
      case "items.length":
        return change.mode === "items" ? change.items.length : undefined;
      case "value":
        return change.mode === "value" ? change.value : undefined;
      case "previous":
        return change.mode === "value" ? change.previous : undefined;
      default:
        return undefined;
    }
  };
  const { prompt } = renderUntrustedTemplate(template, resolve, {
    kind: "watch",
    id: frameId,
    source: WATCH_FRAME_SOURCE,
  });
  const omitted = change.mode === "items" ? change.items.length - shown.length : 0;
  return omitted > 0 ? `${prompt}\n\n${omitted} more new items were left out.` : prompt;
}

export function watchFailurePrompt(title: string, error: string, frameId: string): string {
  return renderUntrustedTemplate(
    `The command watcher "${title}" failed ${WATCH_FAILURE_WAKE_THRESHOLD} polls in a row. Last error:\n{{error}}\n\nFix the command or the script it runs. The watcher keeps polling and says when it recovers.`,
    (expression) => (expression === "error" ? error : undefined),
    { kind: "watch", id: frameId, source: WATCH_FRAME_SOURCE },
  ).prompt;
}

export function watchRecoveryNotice(title: string, failures: number): string {
  return `The command watcher "${title}" recovered after ${failures} failed polls.`;
}
