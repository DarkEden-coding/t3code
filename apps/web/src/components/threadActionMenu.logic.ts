import {
  IdleCompactionMode,
  ThreadAutoCompactWindow,
  type ContextMenuItem,
  type ThreadCompaction,
  type ThreadCompactionUpdate,
} from "@t3tools/contracts";
import type { SnoozePreset } from "@t3tools/client-runtime/state/thread-settled";
import * as Schema from "effect/Schema";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../i18n/messages";
import { formatContextWindowTokens } from "../lib/contextWindow";

export type ThreadActionMenuId =
  | "find"
  | "new-thread-on-branch"
  | "filter-by-project"
  | "turn-into-project"
  | "project-settings"
  | "pin"
  | "unpin"
  | "settle"
  | "unsettle"
  | "auto-settle"
  | "auto-settle:enabled"
  | "auto-settle:disabled"
  | "snooze"
  | `snooze:${string}`
  | "unsnooze"
  | "rename"
  | "regenerate-title"
  | "mark-unread"
  | "share-guest"
  | "copy"
  | "copy-path"
  | "copy-branch"
  | "copy-thread"
  | "copy-thread-id"
  | "compaction"
  | `compaction:${string}`
  | "archive"
  | "delete";

export interface ThreadCompactionMenuState {
  readonly overrides: ThreadCompaction | undefined;
  /** What "Use default" resolves to: the instance's mode, else the environment's. */
  readonly defaultIdleCompaction: IdleCompactionMode;
  /** The instance's window, or "" for Claude's own default. */
  readonly defaultAutoCompactWindow: string;
}

const IDLE_COMPACTION_LABELS: Record<IdleCompactionMode, string> = {
  onReturn: msg("When you return"),
  beforeCacheExpires: msg("Before the cache expires (beta)"),
  off: msg("Never", { $context: "idle thread compaction mode" }),
};

const AUTO_COMPACT_WINDOW_PRESETS = [
  100_000, 200_000, 300_000, 400_000, 500_000, 750_000, 1_000_000,
] as const;

const isIdleCompactionMode = Schema.is(IdleCompactionMode);
const isAutoCompactWindow = Schema.is(ThreadAutoCompactWindow);

/** The override a compaction menu action sets, or null for any other action. */
export function threadCompactionUpdateForAction(
  action: ThreadActionMenuId,
): ThreadCompactionUpdate | null {
  const [prefix, key, value] = action.split(":");
  if (prefix !== "compaction" || value === undefined) return null;
  if (key === "idle") {
    if (value === "default") return { idleCompaction: null };
    return isIdleCompactionMode(value) ? { idleCompaction: value } : null;
  }
  if (key === "window") {
    if (value === "default") return { autoCompactWindow: null };
    const window = value === "off" ? value : Number(value);
    return isAutoCompactWindow(window) ? { autoCompactWindow: window } : null;
  }
  return null;
}

function buildCompactionMenuItem(
  state: ThreadCompactionMenuState,
  resolve: MessageResolver,
): ContextMenuItem<ThreadActionMenuId> {
  const idleOverride = state.overrides?.idleCompaction;
  const windowOverride = state.overrides?.autoCompactWindow;
  const windowLabel = (window: string | number) =>
    window === "off"
      ? resolve(msg("Off", { $context: "automatic context compaction is off" }))
      : window === ""
        ? resolve(msg("Claude's default"))
        : resolve(msg("{used} tokens", { used: formatContextWindowTokens(Number(window)) }));
  const windows: ReadonlyArray<number> =
    typeof windowOverride === "number" &&
    !AUTO_COMPACT_WINDOW_PRESETS.some((preset) => preset === windowOverride)
      ? [...AUTO_COMPACT_WINDOW_PRESETS, windowOverride].toSorted((a, b) => a - b)
      : AUTO_COMPACT_WINDOW_PRESETS;
  const useDefault = resolve(msg("Use default"));
  return {
    id: "compaction",
    label: resolve(msg("Compaction", { $context: "submenu of context compaction settings" })),
    icon: "fold-vertical",
    children: [
      {
        id: "compaction:idle",
        label: resolve(msg("Compact when idle")),
        detail: resolve(IDLE_COMPACTION_LABELS[idleOverride ?? state.defaultIdleCompaction]),
        children: [
          {
            id: "compaction:idle:default",
            label: useDefault,
            detail: resolve(IDLE_COMPACTION_LABELS[state.defaultIdleCompaction]),
            checked: idleOverride === undefined,
          },
          ...IdleCompactionMode.literals.map((mode) => ({
            id: `compaction:idle:${mode}` as const,
            label: resolve(IDLE_COMPACTION_LABELS[mode]),
            checked: idleOverride === mode,
            ...(mode === "onReturn" ? { separatorBefore: true } : {}),
          })),
        ],
      },
      {
        id: "compaction:window",
        label: resolve(msg("Auto-compact after")),
        detail: windowLabel(windowOverride ?? state.defaultAutoCompactWindow),
        children: [
          {
            id: "compaction:window:default",
            label: useDefault,
            detail: windowLabel(state.defaultAutoCompactWindow),
            checked: windowOverride === undefined,
          },
          ...windows.map((window, index) => ({
            id: `compaction:window:${window}` as const,
            label: windowLabel(window),
            checked: windowOverride === window,
            ...(index === 0 ? { separatorBefore: true } : {}),
          })),
          {
            id: "compaction:window:off",
            label: windowLabel("off"),
            checked: windowOverride === "off",
          },
          {
            id: "compaction:window:note",
            label: resolve(msg("Applies from the next turn")),
            disabled: true,
            separatorBefore: true,
          },
        ],
      },
    ],
  };
}

export type DraftActionMenuId =
  | "copy"
  | "copy-path"
  | "copy-branch"
  | "project-settings"
  | "discard";

export function buildDraftActionMenuItems(
  options: {
    readonly hasPath: boolean;
    readonly hasBranch: boolean;
    readonly hasProject: boolean;
  },
  resolve: MessageResolver = m,
): ReadonlyArray<ContextMenuItem<DraftActionMenuId>> {
  return [
    {
      id: "copy",
      label: resolve(msg("Copy", { $context: "submenu of things to copy" })),
      icon: "copy",
      disabled: !options.hasPath && !options.hasBranch,
      children: [
        ...(options.hasPath
          ? [
              {
                id: "copy-path" as const,
                label: resolve(msg("Path", { $context: "copy the file path" })),
                icon: "folder",
              },
            ]
          : []),
        ...(options.hasBranch
          ? [
              {
                id: "copy-branch" as const,
                label: resolve(msg("Branch", { $context: "copy the git branch name" })),
                icon: "git-branch",
              },
            ]
          : []),
      ],
    },
    ...(options.hasProject
      ? [
          {
            id: "project-settings" as const,
            label: resolve(msg("Project settings")),
            icon: "settings",
          },
        ]
      : []),
    {
      id: "discard",
      label: resolve(msg("Discard draft")),
      icon: "trash",
      destructive: true,
      separatorBefore: true,
    },
  ];
}

export interface ThreadActionMenuState {
  readonly canOperate: boolean;
  readonly canFind?: boolean;
  /** False where no inline title editor is rendered, such as sidebar search results. */
  readonly canRename?: boolean;
  readonly branch: string | null;
  readonly projectFilter: {
    readonly label: string;
    readonly isActive: boolean;
  } | null;
  readonly isPinned: boolean;
  readonly isSettled: boolean;
  readonly autoSettleEnabled: boolean;
  readonly isSnoozed: boolean;
  readonly canSnoozeNow: boolean;
  readonly isRegeneratingTitle: boolean;
  /** Archive rejects attached providers, so disable it while running. */
  readonly isRunning: boolean;
  readonly supports: {
    readonly settlement: boolean;
    readonly autoSettleOptOut: boolean;
    readonly snooze: boolean;
    readonly pinning: boolean;
    readonly titleRegeneration: boolean;
  };
  readonly snoozePresets: ReadonlyArray<SnoozePreset>;
  /** Guest links need their own grant, so the caller checks it instead of `canOperate`. */
  readonly canShareWithGuest?: boolean;
  /** A No project thread with its own folder, on a server that can promote it. */
  readonly canTurnIntoProject?: boolean;
  /** Null where the thread is not on Claude or the server keeps no overrides. */
  readonly compaction?: ThreadCompactionMenuState | null;
}

/** Local navigation, read markers, and copying remain available to read-only clients. */
export function threadActionRequiresOperate(action: ThreadActionMenuId): boolean {
  return ![
    "find",
    "new-thread-on-branch",
    "project-settings",
    "mark-unread",
    "share-guest",
    "copy",
    "copy-path",
    "copy-branch",
    "copy-thread",
    "copy-thread-id",
  ].includes(action);
}

export function buildThreadActionMenuItems(
  state: ThreadActionMenuState,
  resolve: MessageResolver = m,
): ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> {
  const items: ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> = [
    ...(state.canFind
      ? [{ id: "find" as const, label: resolve(msg("Find in thread")), icon: "text-search" }]
      : []),
    ...(state.branch
      ? [
          {
            id: "new-thread-on-branch" as const,
            label: resolve(msg("New thread on {branch}", { branch: state.branch })),
            icon: "message-square-plus",
          },
        ]
      : []),
    ...(state.supports.pinning
      ? [
          state.isPinned
            ? { id: "unpin" as const, label: resolve(msg("Unpin thread")), icon: "pin-off" }
            : { id: "pin" as const, label: resolve(msg("Pin thread")), icon: "pin" },
        ]
      : []),
    ...(state.supports.settlement
      ? [
          state.isSettled
            ? {
                id: "unsettle" as const,
                label: resolve(msg("Un-settle thread")),
                icon: "circle-check",
              }
            : { id: "settle" as const, label: resolve(msg("Settle thread")), icon: "circle-check" },
        ]
      : []),
    ...(state.supports.snooze
      ? [
          state.isSnoozed
            ? { id: "unsnooze" as const, label: resolve(msg("Wake thread")), icon: "clock" }
            : {
                id: "snooze" as const,
                label: resolve(msg("Snooze", { $context: "verb, snooze the thread" })),
                icon: "clock",
                disabled: !state.canSnoozeNow,
                children: [
                  ...state.snoozePresets.map((preset) => ({
                    id: `snooze:${preset.id}` as const,
                    label: preset.label,
                    detail: preset.whenLabel,
                  })),
                  {
                    id: "snooze:custom" as const,
                    label: resolve(msg("Custom…")),
                    separatorBefore: state.snoozePresets.length > 0,
                  },
                ],
              },
        ]
      : []),
    {
      id: "rename",
      label: resolve(msg("Rename thread")),
      icon: "pencil",
      disabled: state.canRename === false,
      separatorBefore: true,
    },
    ...(state.supports.titleRegeneration
      ? [
          {
            id: "regenerate-title" as const,
            label: state.isRegeneratingTitle
              ? resolve(msg("Regenerating…"))
              : resolve(msg("Regenerate title")),
            icon: "refresh-cw",
            disabled: state.isRegeneratingTitle,
          },
        ]
      : []),
    { id: "mark-unread", label: resolve(msg("Mark unread")), icon: "mail-open" },
    ...(state.canShareWithGuest
      ? [{ id: "share-guest" as const, label: resolve(msg("Share with guest")), icon: "user-plus" }]
      : []),
    ...(state.projectFilter
      ? [
          {
            id: "filter-by-project" as const,
            label: state.projectFilter.isActive
              ? resolve(msg("Show all projects"))
              : resolve(msg("Filter by {project}", { project: state.projectFilter.label })),
            icon: "folder-tree",
          },
        ]
      : []),
    ...(state.canTurnIntoProject
      ? [
          {
            id: "turn-into-project" as const,
            label: resolve(msg("Turn into project")),
            icon: "folder-plus",
            disabled: state.isRunning,
          },
        ]
      : []),
    ...(state.supports.autoSettleOptOut
      ? [
          {
            id: "auto-settle" as const,
            label: resolve(msg("Auto-settle behavior")),
            icon: "timer",
            children: [
              {
                id: "auto-settle:enabled" as const,
                label: resolve(msg("Follow settings")),
                checked: state.autoSettleEnabled,
              },
              {
                id: "auto-settle:disabled" as const,
                label: resolve(msg("Never", { $context: "auto-settle never" })),
                checked: !state.autoSettleEnabled,
              },
            ],
          },
        ]
      : []),
    ...(state.compaction ? [buildCompactionMenuItem(state.compaction, resolve)] : []),
    {
      id: "copy",
      label: resolve(msg("Copy", { $context: "submenu of things to copy" })),
      icon: "copy",
      separatorBefore: true,
      children: [
        {
          id: "copy-path",
          label: resolve(msg("Path", { $context: "copy the file path" })),
          icon: "folder",
        },
        ...(state.branch
          ? [
              {
                id: "copy-branch" as const,
                label: resolve(msg("Branch", { $context: "copy the git branch name" })),
                icon: "git-branch",
              },
            ]
          : []),
        {
          id: "copy-thread",
          label: resolve(msg("Thread", { $context: "copy the thread contents" })),
          icon: "message-square",
        },
        { id: "copy-thread-id", label: resolve(msg("Thread ID")), icon: "hash" },
      ],
    },
    { id: "project-settings", label: resolve(msg("Project settings")), icon: "settings" },
    {
      id: "archive",
      label: resolve(msg("Archive thread")),
      icon: "archive",
      disabled: state.isRunning,
      separatorBefore: true,
    },
    {
      id: "delete",
      label: resolve(msg("Delete", { $context: "verb, delete the thread" })),
      destructive: true,
      icon: "trash",
    },
  ];
  return state.canOperate
    ? items
    : items.map((item) =>
        threadActionRequiresOperate(item.id)
          ? {
              ...item,
              disabled: true,
              ...(item.children
                ? { children: item.children.map((child) => ({ ...child, disabled: true })) }
                : {}),
            }
          : item,
      );
}
