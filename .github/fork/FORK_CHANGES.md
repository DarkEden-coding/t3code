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

## Fork-only files (always keep the fork's version)

- `.github/workflows/fork-*.yml`, `.github/fork/**`, `scripts/disable-upstream-workflows.sh`
