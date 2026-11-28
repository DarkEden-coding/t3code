# Fork changes

The daily upstream merge ([merge-upstream.md](merge-upstream.md)) reads this file. Add one entry per fork
change: what it does, which upstream files it touches, and what must survive a merge. Keep it short.

## Release plumbing (patch 0001)

- `packages/shared/src/cliRelease.ts`: `CLI_RELEASE_REPOSITORY` is `DarkEden-coding/t3code`, so `t3 update`
  and remote service updates read and download the fork's releases. Three tests assert that URL.
- `scripts/install.sh`: default repo is the fork; `T3CODE_RELEASE_REPOSITORY` overrides it.
- Must survive: the fork repo name in both places. If upstream moves the constant, move the fork value with it.

## macOS signing without notarization or passkeys (patch 0002)

- `.github/workflows/release-desktop.yml`: the mac branch signs with `CSC_LINK` + `CSC_KEY_PASSWORD` alone,
  and notarizes without a provisioning profile. Its CLI-archive signing step also accepts an `Apple Development` identity.
- `scripts/build-desktop-artifact.ts`: passkey entitlements only with `T3CODE_MACOS_PROVISIONING_PROFILE`;
  otherwise the hardened-runtime entitlements (`MAC_HARDENED_RUNTIME_ENTITLEMENTS`) are still applied.
- Must survive: a signed mac build with no provisioning profile still succeeds and keeps the camera and mic entitlements.

## Command watchers (`watch` schedule type)

- A scheduled task can poll a shell command and run its prompt only when the output changes.
  Contracts: `packages/contracts/src/scheduledTask.ts` (`ScheduledTaskWatchSchedule`, the shared
  filter union with the `matches` op), `environment.ts` (`commandWatchers` capability), `orchestratorMcp.ts`.
- Server: new `apps/server/src/scheduledTasks/{CommandWatcher,watchDetect,watchState}.ts`; hooks in
  `ScheduledTaskService.ts` (`pollWatch`, `runDueTasks`, upsert, delete, `runNow`), `Schedule.ts`,
  `webhookFilter.ts`, `webhookTemplate.ts` (`renderUntrustedTemplate`), `runtimeLayer.ts`,
  `OrchestratorMcpService.ts` (`requireWatchAccess`), `mcp/toolkits/orchestrator/tools.ts`.
- Clients: `packages/client-runtime/src/scheduledTaskWatch.ts`, web `ScheduledTaskWatchFields.tsx`
  and `ScheduledTasksSettings.tsx`, mobile `ScheduledTaskWatchFields.tsx`, `ScheduledTaskFormRows.tsx`
  and the scheduled tasks screen; i18n in both apps.
- Must survive: `scheduled_task_watch_state` is created at runtime by `ensureWatchStateTable`, not a
  numbered migration, so upstream migrations can't collide with it. Keep that call in the
  `ScheduledTaskService` layer. If upstream adds its own watch type, keep the fork's until they are
  reconciled by hand.

## Per-thread compaction overrides

- A thread's right-click menu › Compaction sets "Compact when idle" and "Auto-compact after" for that
  thread; agents use `t3_thread_configure`'s `compaction` field. Design: `docs/fork/thread-compaction-overrides.md`.
- Touches: `OrchestrationV2AppThread.compaction` and `thread.metadata.update` in contracts, the resolvers
  `resolveIdleCompaction` and `resolveAutoCompactWindowSetting`, the Claude adapter's query options,
  web `Sidebar.tsx`, `useThreadActionMenu.ts` and the thread MCP handlers.
- Must survive: thread over instance over environment resolution, and a compaction-only update keeps `updatedAt`.

## Starred turns

- Agents call `t3_turn_star` (thread toolkit, optional `note`) to star their running turn; the star lands
  on the turn's final assistant message when the run ends. The user stars or unstars a turn's final
  message from its hover bar, and sees every star in a sidebar "Starred" list (count, per-item remove,
  Clear all). No notifications.
- New files: `packages/contracts/src/turnStar.ts` (schemas, `turnStars.*` RPCs, 200-star cap),
  `apps/server/src/turnStars/TurnStarService.ts`, web `components/starred/*` and `state/turnStars.ts`.
- Small hooks in upstream files: contracts `rpc.ts` (spreads `TURN_STAR_WS_METHODS` and `TurnStarRpcs`),
  `index.ts`, `clientRpcPermissions.ts`, `environment.ts` (`turnStars` capability); server `ws.ts`,
  `RpcAuthorization.ts`, `RpcInstrumentation.ts`, `runtimeLayer.ts` (`layerProduction`),
  `ServerEnvironment.ts`, thread `tools.ts`/`handlers.ts`, `ClaudeAdapterV2.ts` read-only list,
  `agentContextBudget.json`; shared `t3McpToolPresentation.ts` and its `Copy`; client-runtime
  `rpc/client.ts`, `state/server.ts`, `work-log/t3ToolSentences.ts`; web `Sidebar.tsx` (one line),
  `TimelineAssistantRows.tsx` (star button), `ChatView.tsx` and `AssistantCitationSource.tsx`
  (`revealOnly` reuses the citation reveal to scroll to a starred message); i18n keys appended.
- Must survive: `turn_stars` is created at runtime by `ensureTurnStarTable`, not a numbered migration.
  `TurnStarService` is a `Context.Reference` so upstream test harnesses need no fork mock; production
  provides `TurnStarService.layer`. Stars outlive settle and archive; a deleted thread's stars go.

## Fork-only files (always keep the fork's version)

- `.github/workflows/fork-*.yml`, `.github/fork/**`, `scripts/disable-upstream-workflows.sh`
