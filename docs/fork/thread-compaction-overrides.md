# Per-thread compaction overrides

Design note for a fork feature that is small enough to offer upstream.

## Problem

Idle compaction mode and the auto-compact window are set per Claude provider instance, with the idle mode falling back to the environment default. A user who wants before-cache-expiry compaction for most threads but not for one, or a lower window for a single long-running thread, has to change the setting for every thread on that instance.

## Design

A thread stores optional overrides in `compaction` on `OrchestrationV2AppThread`, mirrored on the thread shell:

- `idleCompaction`: `onReturn`, `beforeCacheExpires` or `off`.
- `autoCompactWindow`: 100,000 to 1,000,000 tokens, or `off` to turn automatic compaction off for the thread.

An absent key means "Use default". `thread.metadata.update` takes a `compaction` patch where each key is a value, `null` to clear, or absent to leave as is. The thread is stored as JSON, so no migration is needed. A compaction-only update keeps `updatedAt`, so changing a setting does not move the thread in lists.

Resolution order is thread, then instance, then environment, and lives in the existing resolvers:

- `resolveIdleCompaction(settings, instanceId, thread)` in contracts, used by `IdleCompactionService`, the Claude adapter's resume dialog, web's compact-before-send chip and the shared context-window logic.
- `resolveAutoCompactWindowSetting(instanceWindow, thread)` in contracts, used by `makeClaudeQueryOptions` (which sends `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, or `DISABLE_AUTO_COMPACT=1` for `off`) and the adapter's threshold reporting.

## Applying a new window

Claude Code reads the window when its process starts. The thread's window is part of the Claude live-query policy key, so the next turn after a change reopens the idle query with resume, the same path a workspace or MCP change takes. A running turn is never interrupted. The menu says the window applies from the next turn.

Changing the idle mode to "Before the cache expires" does not start a timer for a thread that is already idle; it applies from the thread's next completed run, the same as changing the instance or environment setting.

## Surfaces

- Web and desktop: a **Compaction** submenu in the thread context menu, in the sidebar and in the chat header menu. It appears for threads on a Claude instance when the server advertises the `threadCompactionOverrides` capability. Each "Use default" row shows what it resolves to.
- MCP: `t3_thread_configure` reads `compaction` and takes a `compaction` patch.
- Mobile: not included.
