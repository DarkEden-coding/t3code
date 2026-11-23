import { describe, expect, it } from "vite-plus/test";

import {
  buildThreadActionMenuItems,
  threadCompactionUpdateForAction,
  type ThreadActionMenuState,
  type ThreadCompactionMenuState,
} from "./threadActionMenu.logic";

const baseState: ThreadActionMenuState = {
  canOperate: true,
  branch: null,
  projectFilter: null,
  isPinned: false,
  isSettled: false,
  autoSettleEnabled: true,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  isRunning: false,
  supports: {
    settlement: true,
    autoSettleOptOut: true,
    snooze: true,
    pinning: true,
    titleRegeneration: true,
  },
  snoozePresets: [
    { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: "2026-08-07T15:00:00Z" },
  ],
};

describe("buildThreadActionMenuItems", () => {
  it.each([false, true])(
    "disables both lifecycle directions without permission (reversed: %s)",
    (reversed) => {
      const items = buildThreadActionMenuItems({
        ...baseState,
        canOperate: false,
        isPinned: reversed,
        isSettled: reversed,
        isSnoozed: reversed,
      });
      const expected = reversed
        ? [
            "unpin",
            "unsettle",
            "unsnooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ]
        : [
            "pin",
            "settle",
            "snooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ];
      expect(items.filter((item) => item.disabled).map((item) => item.id)).toEqual(expected);
      expect(
        items.find((item) => item.id === "snooze")?.children?.every((child) => child.disabled) ??
          true,
      ).toBe(true);
    },
  );

  it("disables archive and turning into a project while the thread is running", () => {
    const items = buildThreadActionMenuItems({
      ...baseState,
      isRunning: true,
      canTurnIntoProject: true,
    });
    expect(items.find((item) => item.id === "archive")?.disabled).toBe(true);
    expect(items.find((item) => item.id === "turn-into-project")?.disabled).toBe(true);
  });

  it("disables only rename where no inline title editor exists", () => {
    const items = buildThreadActionMenuItems({ ...baseState, canRename: false });
    expect(items.filter((item) => item.disabled).map((item) => item.id)).toEqual(["rename"]);
  });
});

describe("thread compaction menu", () => {
  const compactionItem = (compaction: ThreadCompactionMenuState | null) =>
    buildThreadActionMenuItems({ ...baseState, compaction }).find(
      (item) => item.id === "compaction",
    );

  it("shows the effective default and marks the override", () => {
    const item = compactionItem({
      overrides: { autoCompactWindow: 350_000 },
      defaultIdleCompaction: "beforeCacheExpires",
      defaultAutoCompactWindow: "",
    });
    const [idle, window] = item?.children ?? [];
    expect(idle?.detail).toBe("Before the cache expires (beta)");
    expect(idle?.children?.find((child) => child.checked)?.id).toBe("compaction:idle:default");
    expect(window?.children?.[0]).toMatchObject({ detail: "Claude's default", checked: false });
    // An override set elsewhere, such as over MCP, still shows as the checked choice.
    expect(window?.children?.find((child) => child.checked)?.id).toBe("compaction:window:350000");
    expect(compactionItem(null)).toBeUndefined();
  });

  it.each([
    ["compaction:idle:off", { idleCompaction: "off" }],
    ["compaction:idle:default", { idleCompaction: null }],
    ["compaction:window:300000", { autoCompactWindow: 300_000 }],
    ["compaction:window:off", { autoCompactWindow: "off" }],
    ["compaction:window:default", { autoCompactWindow: null }],
    ["compaction:window:note", null],
    ["compaction:window:50000", null],
    ["rename", null],
  ] as const)("maps %s to its override", (action, expected) => {
    expect(threadCompactionUpdateForAction(action)).toEqual(expected);
  });
});
