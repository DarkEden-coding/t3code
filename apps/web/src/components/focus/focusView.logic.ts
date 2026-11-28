import { resolveUserMessagePresentation } from "@t3tools/client-runtime/user-message";
import type { EnvironmentId, MessageId, ScheduledTaskId, ThreadId } from "@t3tools/contracts";

import type { ChatMessage } from "../../types";
import type { MessagesTimelineRow } from "../chat/MessagesTimeline.logic";

/** Who sent a message the user did not type, or what woke the agent. */
export type FocusSource =
  | {
      readonly kind: "thread";
      /** Null for a thread in this environment. */
      readonly environmentId: EnvironmentId | null;
      readonly threadId: ThreadId;
      /** The linked sender's title when it was sent; a local thread's title is read live. */
      readonly title: string | null;
    }
  | { readonly kind: "task"; readonly scheduledTaskId: ScheduledTaskId | null }
  | { readonly kind: "t3code" | "agent" | "watch" | "background" };

/** Set on a row focus view shows differently: a dimmed row of an opened run, or a sender label. */
export interface FocusRowMark {
  readonly dimmed: boolean;
  readonly source: FocusSource | null;
}

/** One line standing in for a run of hidden rows, or the header of an opened run. */
export interface FocusHiddenRow {
  readonly kind: "focus-hidden";
  readonly id: string;
  readonly createdAt: string;
  readonly threadKey: string;
  readonly runKey: string;
  /** Messages in the run: what other agents sent and the agent's answers to them. */
  readonly count: number;
  readonly sources: ReadonlyArray<FocusSource>;
  readonly expanded: boolean;
}

export interface FocusTimelineInput {
  readonly threadKey: string;
  readonly starredMessageIds: ReadonlySet<MessageId>;
  readonly expandedRunKeys: ReadonlySet<string>;
}

export interface FocusTimelineResult {
  readonly rows: MessagesTimelineRow[];
  readonly hiddenCount: number;
}

const isSteer = (message: ChatMessage) =>
  message.inputIntent === "steer" || message.inputIntent === "promoted_queued_to_steer";

/** A message a person typed in this chat: the user, or a guest they shared it with. */
export function isOwnMessage(message: ChatMessage): boolean {
  if (message.role !== "user") return false;
  const { attribution } = resolveUserMessagePresentation(message);
  return attribution === null || attribution === "guest";
}

export function focusMessageSource(message: ChatMessage): FocusSource {
  if (message.linkedSender !== undefined) {
    return {
      kind: "thread",
      environmentId: message.linkedSender.environmentId,
      threadId: message.linkedSender.threadId,
      title: message.linkedSender.title,
    };
  }
  if (message.senderThreadId !== undefined) {
    return { kind: "thread", environmentId: null, threadId: message.senderThreadId, title: null };
  }
  const presentation = resolveUserMessagePresentation(message);
  if (presentation.attribution === "automation") {
    return { kind: "task", scheduledTaskId: presentation.scheduledTaskId ?? null };
  }
  return { kind: presentation.attribution === "t3code" ? "t3code" : "agent" };
}

function notificationSource(row: MessagesTimelineRow): FocusSource | null {
  if (row.kind !== "work" || row.groupedEntries.length !== 1) return null;
  const item = row.groupedEntries[0]?.projectedItem?.item;
  if (item?.type !== "notification") return null;
  switch (item.source.kind) {
    case "subagent":
      return item.source.childThreadId === undefined
        ? { kind: "agent" }
        : { kind: "thread", environmentId: null, threadId: item.source.childThreadId, title: null };
    case "monitor":
      return { kind: "watch" };
    default:
      return { kind: "background" };
  }
}

export function focusSourceKey(source: FocusSource): string {
  switch (source.kind) {
    case "thread":
      return `thread:${source.environmentId ?? ""}:${source.threadId}`;
    case "task":
      return `task:${source.scheduledTaskId ?? ""}`;
    default:
      return source.kind;
  }
}

export function focusHiddenRowsEqual(a: FocusHiddenRow, b: FocusHiddenRow): boolean {
  return (
    a.createdAt === b.createdAt &&
    a.threadKey === b.threadKey &&
    a.count === b.count &&
    a.expanded === b.expanded &&
    a.sources.length === b.sources.length &&
    a.sources.every((source, index) => {
      const other = b.sources[index];
      return (
        other !== undefined &&
        focusSourceKey(source) === focusSourceKey(other) &&
        (source.kind !== "thread" || (other.kind === "thread" && source.title === other.title))
      );
    })
  );
}

interface Segment {
  readonly start: number;
  end: number;
  /** What started the response; null for the rows before the first prompt. */
  readonly boundary: { readonly own: boolean; readonly source: FocusSource | null } | null;
}

function segmentBoundary(row: MessagesTimelineRow): Segment["boundary"] {
  if (row.kind === "message" && row.message.role === "user" && !isSteer(row.message)) {
    const own = isOwnMessage(row.message);
    return { own, source: own ? null : focusMessageSource(row.message) };
  }
  const source = notificationSource(row);
  return source === null ? null : { own: false, source };
}

function splitSegments(rows: ReadonlyArray<MessagesTimelineRow>): Segment[] {
  const segments: Segment[] = [];
  let current: Segment = { start: 0, end: 0, boundary: null };
  for (const [index, row] of rows.entries()) {
    const boundary = segmentBoundary(row);
    if (boundary !== null) {
      if (current.end > current.start) segments.push(current);
      current = { start: index, end: index, boundary };
    }
    current.end = index + 1;
  }
  if (current.end > current.start) segments.push(current);
  return segments;
}

const markCache = new WeakMap<MessagesTimelineRow, Map<string, MessagesTimelineRow>>();

/** Keeps a marked row's identity while its source row is unchanged, so memoized rows skip work. */
function markRow(row: MessagesTimelineRow, mark: FocusRowMark): MessagesTimelineRow {
  const key = `${mark.dimmed}:${mark.source === null ? "" : focusSourceKey(mark.source)}`;
  let marked = markCache.get(row);
  if (marked === undefined) {
    marked = new Map();
    markCache.set(row, marked);
  }
  const cached = marked.get(key);
  if (cached !== undefined) return cached;
  const next = { ...row, focus: mark };
  marked.set(key, next);
  return next;
}

/**
 * Focus view: the user's own messages, the agent's final reply to each, and every starred message
 * with the message its turn answered. Responses to other agents, scheduled tasks, watchers and
 * notifications fold into one line per run, which opens in place.
 */
export function deriveFocusTimelineRows(
  rows: ReadonlyArray<MessagesTimelineRow>,
  input: FocusTimelineInput,
): FocusTimelineResult {
  const result: MessagesTimelineRow[] = [];
  let hiddenCount = 0;
  let run: {
    readonly first: MessagesTimelineRow;
    readonly rows: MessagesTimelineRow[];
    readonly boundaryIds: Set<string>;
    readonly sources: Map<string, FocusSource>;
    count: number;
  } | null = null;

  const flushRun = () => {
    if (run === null) return;
    const runKey = run.first.id;
    const expanded = input.expandedRunKeys.has(runKey);
    result.push({
      kind: "focus-hidden",
      id: `focus-hidden:${runKey}`,
      createdAt: run.first.createdAt ?? "",
      threadKey: input.threadKey,
      runKey,
      count: run.count,
      sources: [...run.sources.values()],
      expanded,
    });
    if (expanded) {
      for (const row of run.rows) {
        const source =
          run.boundaryIds.has(row.id) && row.kind === "message" && row.message.role === "user"
            ? focusMessageSource(row.message)
            : null;
        result.push(markRow(row, { dimmed: true, source }));
      }
    }
    hiddenCount += run.count;
    run = null;
  };

  for (const segment of splitSegments(rows)) {
    const segmentRows = rows.slice(segment.start, segment.end);
    if (segment.boundary === null) {
      flushRun();
      result.push(...segmentRows);
      continue;
    }
    const own =
      segment.boundary.own ||
      segmentRows.some(
        (row) => row.kind === "message" && isSteer(row.message) && isOwnMessage(row.message),
      );
    const starred = segmentRows.some(
      (row) => row.kind === "message" && input.starredMessageIds.has(row.message.id),
    );

    if (!own && !starred) {
      if (run === null) {
        const first = segmentRows[0]!;
        run = { first, rows: [], boundaryIds: new Set(), sources: new Map(), count: 0 };
      }
      run.boundaryIds.add(segmentRows[0]!.id);
      if (segment.boundary.source !== null) {
        run.sources.set(focusSourceKey(segment.boundary.source), segment.boundary.source);
      }
      for (const row of segmentRows) {
        run.rows.push(row);
        if (row.kind === "message" && row.message.role !== "system") run.count += 1;
      }
      continue;
    }

    flushRun();
    // An opened "Worked for" fold shows its whole turn, as it does outside focus view.
    const foldOpen = segmentRows.some((row) => row.kind === "turn-fold" && row.expanded);
    const finalReplyIds = new Set<string>();
    const lastByRun = new Map<string, string>();
    for (const row of segmentRows) {
      if (row.kind === "message" && row.message.role === "assistant") {
        lastByRun.set(row.message.runId ?? "", row.message.id);
      }
    }
    for (const id of lastByRun.values()) finalReplyIds.add(id);
    const hiddenMessageIds = new Set<string>();
    for (const [index, row] of segmentRows.entries()) {
      if (
        !foldOpen &&
        row.kind === "message" &&
        row.message.role === "assistant" &&
        !finalReplyIds.has(row.message.id) &&
        !input.starredMessageIds.has(row.message.id)
      ) {
        hiddenMessageIds.add(row.message.id);
        continue;
      }
      if (row.kind === "assistant-meta" && hiddenMessageIds.has(row.message.id)) continue;
      // A star answering another agent keeps the message it answered, labelled with its sender.
      result.push(
        index === 0 && segment.boundary.source !== null && row.kind === "message"
          ? markRow(row, { dimmed: false, source: segment.boundary.source })
          : row,
      );
    }
  }
  flushRun();
  return { rows: result, hiddenCount };
}
