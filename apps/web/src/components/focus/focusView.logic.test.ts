import {
  EnvironmentId,
  GuestMessageId,
  MessageId,
  RunId,
  ScheduledTaskId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { TimelineEntry } from "../../session-logic";
import type { ChatMessage } from "../../types";
import {
  deriveMessagesTimelineRows,
  type MessagesTimelineRow,
} from "../chat/MessagesTimeline.logic";
import {
  deriveFocusTimelineRows,
  focusMessageSource,
  isOwnMessage,
  type FocusHiddenRow,
} from "./focusView.logic";

const THREAD_KEY = "env:thread";
const SENDER = ThreadId.make("sender-thread");
let clock = 0;
const nextAt = () => new Date(Date.UTC(2026, 10, 28, 12, 0, clock++)).toISOString();

function message(
  id: string,
  role: "user" | "assistant",
  runId: string | null,
  extra: Partial<ChatMessage> = {},
): Extract<TimelineEntry, { kind: "message" }> {
  const at = nextAt();
  return {
    kind: "message",
    id,
    createdAt: at,
    message: {
      id: MessageId.make(id),
      role,
      text: id,
      runId: runId === null ? null : RunId.make(runId),
      streaming: false,
      createdAt: at,
      updatedAt: at,
      ...(role === "user" ? { createdBy: "user" as const, creationSource: "web" as const } : {}),
      ...extra,
    },
  };
}

const own = (id: string, runId: string) => message(id, "user", runId);
const fromAgent = (id: string, runId: string) =>
  message(id, "user", runId, {
    createdBy: "agent",
    creationSource: "mcp",
    senderThreadId: SENDER,
  });
const reply = (id: string, runId: string) => message(id, "assistant", runId);

function tool(id: string, runId: string): TimelineEntry {
  const at = nextAt();
  return {
    kind: "work",
    id,
    createdAt: at,
    entry: {
      id,
      runId: RunId.make(runId),
      createdAt: at,
      label: "Ran sed",
      command: "sed",
      tone: "tool",
      toolLifecycleStatus: "completed",
    },
  };
}

function rowsOf(entries: ReadonlyArray<TimelineEntry>, expandedRunIds: ReadonlyArray<string> = []) {
  return deriveMessagesTimelineRows({
    timelineEntries: entries,
    latestRun: null,
    isWorking: false,
    activeTurnStartedAt: null,
    turnDiffSummaries: [],
    supportsConversationRollback: false,
    expandedRunIds: new Set(expandedRunIds.map((id) => RunId.make(id))),
  });
}

function focus(
  rows: ReadonlyArray<MessagesTimelineRow>,
  options: { starred?: ReadonlyArray<string>; expanded?: ReadonlyArray<string> } = {},
) {
  return deriveFocusTimelineRows(rows, {
    threadKey: THREAD_KEY,
    starredMessageIds: new Set((options.starred ?? []).map((id) => MessageId.make(id))),
    expandedRunKeys: new Set(options.expanded ?? []),
  });
}

/** Messages by id and dividers as `hidden:<count>`, in order. */
function shape(rows: ReadonlyArray<MessagesTimelineRow>) {
  return rows.flatMap((row) =>
    row.kind === "message"
      ? [row.focus?.dimmed ? `~${row.message.id}` : row.message.id]
      : row.kind === "focus-hidden"
        ? [`${row.expanded ? "open" : "hidden"}:${row.count}`]
        : [],
  );
}

const dividers = (rows: ReadonlyArray<MessagesTimelineRow>) =>
  rows.filter((row): row is FocusHiddenRow => row.kind === "focus-hidden");

describe("isOwnMessage", () => {
  it("counts what a person typed, not what agents, tasks or T3 Code sent", () => {
    expect(isOwnMessage(own("typed", "r").message)).toBe(true);
    expect(
      isOwnMessage(
        message("guest", "user", "r", {
          context: {
            version: 1,
            records: [],
            guest: { guestMessageId: GuestMessageId.make("g1"), name: "Sam", text: "hi" },
          },
        }).message,
      ),
    ).toBe(true);
    expect(isOwnMessage(fromAgent("sent", "r").message)).toBe(false);
    expect(
      isOwnMessage(
        message("task", "user", "r", {
          createdBy: "system",
          creationSource: "server",
          scheduledTaskId: ScheduledTaskId.make("task-1"),
        }).message,
      ),
    ).toBe(false);
    expect(
      isOwnMessage(
        message("compact", "user", "r", { createdBy: "agent", creationSource: "server" }).message,
      ),
    ).toBe(false);
    expect(isOwnMessage(reply("answer", "r").message)).toBe(false);
  });

  it("names the sender of a message the user did not type", () => {
    expect(focusMessageSource(fromAgent("sent", "r").message)).toEqual({
      kind: "thread",
      environmentId: null,
      threadId: SENDER,
      title: null,
    });
    const linked = message("linked", "user", "r", {
      createdBy: "agent",
      creationSource: "mcp",
      linkedSender: {
        environmentId: EnvironmentId.make("other-env"),
        threadId: ThreadId.make("far-thread"),
        title: "Far thread",
      },
    });
    expect(focusMessageSource(linked.message)).toMatchObject({
      kind: "thread",
      title: "Far thread",
    });
    const scheduled = message("task", "user", "r", {
      createdBy: "system",
      creationSource: "server",
      scheduledTaskId: ScheduledTaskId.make("task-1"),
    });
    expect(focusMessageSource(scheduled.message)).toEqual({
      kind: "task",
      scheduledTaskId: "task-1",
    });
  });
});

describe("deriveFocusTimelineRows", () => {
  it("shows the user's message and the turn's final reply, hiding progress notes", () => {
    // A running turn has no fold yet, so its progress note is its own row.
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [own("ask", "r1"), reply("progress", "r1"), reply("final", "r1")],
      latestRun: null,
      runningRunId: RunId.make("r1"),
      isWorking: true,
      activeTurnStartedAt: null,
      turnDiffSummaries: [],
      supportsConversationRollback: false,
    });
    expect(shape(rows)).toEqual(["ask", "progress", "final"]);
    const result = focus(rows);
    expect(shape(result.rows)).toEqual(["ask", "final"]);
    expect(result.hiddenCount).toBe(0);
  });

  it("keeps the Worked for fold, and shows the whole turn once it is opened", () => {
    const entries = [
      own("ask", "r1"),
      reply("progress", "r1"),
      tool("t1", "r1"),
      reply("final", "r1"),
    ];
    const folded = focus(rowsOf(entries));
    expect(folded.rows.some((row) => row.kind === "turn-fold")).toBe(true);
    expect(shape(folded.rows)).toEqual(["ask", "final"]);
    expect(shape(focus(rowsOf(entries, ["r1"])).rows)).toEqual(["ask", "progress", "final"]);
  });

  it("folds another agent's message and the reply to it into one counted line", () => {
    const rows = rowsOf([
      own("ask", "r1"),
      reply("answer", "r1"),
      fromAgent("nudge", "r2"),
      reply("nudge-reply", "r2"),
      own("next", "r3"),
      reply("next-reply", "r3"),
    ]);
    const result = focus(rows);
    expect(shape(result.rows)).toEqual(["ask", "answer", "hidden:2", "next", "next-reply"]);
    expect(result.hiddenCount).toBe(2);
    expect(dividers(result.rows)[0]).toMatchObject({
      runKey: "nudge",
      threadKey: THREAD_KEY,
      sources: [{ kind: "thread", threadId: SENDER }],
    });
  });

  it("merges back-to-back hidden turns into one run and names each source once", () => {
    const task = message("task", "user", "r3", {
      createdBy: "system",
      creationSource: "server",
      scheduledTaskId: ScheduledTaskId.make("task-1"),
    });
    const result = focus(
      rowsOf([
        fromAgent("a", "r1"),
        reply("a-reply", "r1"),
        fromAgent("b", "r2"),
        reply("b-reply", "r2"),
        task,
        reply("task-reply", "r3"),
        own("ask", "r4"),
        reply("answer", "r4"),
      ]),
    );
    expect(shape(result.rows)).toEqual(["hidden:6", "ask", "answer"]);
    expect(dividers(result.rows)[0]?.sources.map((source) => source.kind)).toEqual([
      "thread",
      "task",
    ]);
  });

  it("opens a run in place, dimmed and labelled with its sender", () => {
    const rows = rowsOf([
      own("ask", "r1"),
      reply("answer", "r1"),
      fromAgent("nudge", "r2"),
      reply("nudge-reply", "r2"),
    ]);
    const result = focus(rows, { expanded: ["nudge"] });
    expect(shape(result.rows)).toEqual(["ask", "answer", "open:2", "~nudge", "~nudge-reply"]);
    const sent = result.rows.find((row) => row.id === "nudge");
    expect(sent?.focus).toEqual({
      dimmed: true,
      source: { kind: "thread", environmentId: null, threadId: SENDER, title: null },
    });
    expect(result.rows.find((row) => row.id === "nudge-reply")?.focus).toEqual({
      dimmed: true,
      source: null,
    });
    // The opened run still counts toward the header's hidden total.
    expect(result.hiddenCount).toBe(2);
  });

  it("shows a starred reply to another agent with the message it answered", () => {
    const rows = rowsOf([
      fromAgent("review", "r1"),
      reply("review-reply", "r1"),
      fromAgent("nudge", "r2"),
      reply("nudge-reply", "r2"),
      own("ask", "r3"),
      reply("answer", "r3"),
    ]);
    const result = focus(rows, { starred: ["review-reply"] });
    expect(shape(result.rows)).toEqual(["review", "review-reply", "hidden:2", "ask", "answer"]);
    expect(result.rows.find((row) => row.id === "review")?.focus).toEqual({
      dimmed: false,
      source: { kind: "thread", environmentId: null, threadId: SENDER, title: null },
    });
    expect(result.hiddenCount).toBe(2);
  });

  it("keeps a starred progress note in the user's own turn", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [own("ask", "r1"), reply("note", "r1"), reply("final", "r1")],
      latestRun: null,
      runningRunId: RunId.make("r1"),
      isWorking: true,
      activeTurnStartedAt: null,
      turnDiffSummaries: [],
      supportsConversationRollback: false,
    });
    expect(shape(focus(rows, { starred: ["note"] }).rows)).toEqual(["ask", "note", "final"]);
  });

  it("shows a turn another agent started once the user steers it", () => {
    const steer = own("steer", "r1");
    const rows = rowsOf([
      fromAgent("nudge", "r1"),
      reply("early", "r1"),
      { ...steer, message: { ...steer.message, inputIntent: "steer" } },
      reply("final", "r1"),
    ]);
    const shown = shape(focus(rows).rows);
    expect(shown).toContain("steer");
    expect(shown).toContain("final");
    expect(shown.some((id) => id.startsWith("hidden"))).toBe(false);
  });

  it("leaves a thread with only the user's turns as it was", () => {
    const rows = rowsOf([own("ask", "r1"), reply("answer", "r1")]);
    const result = focus(rows);
    expect(result.rows).toEqual(rows);
    expect(result.rows.every((row, index) => row === rows[index])).toBe(true);
  });

  it("keeps a marked row's identity across derivations", () => {
    const rows = rowsOf([fromAgent("nudge", "r1"), reply("nudge-reply", "r1")]);
    const first = focus(rows, { expanded: ["nudge"] }).rows;
    const second = focus(rows, { expanded: ["nudge"] }).rows;
    expect(second[1]).toBe(first[1]);
    expect(second[2]).toBe(first[2]);
  });
});
