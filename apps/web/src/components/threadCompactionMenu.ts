import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { instanceAutoCompactWindow, resolveIdleCompaction } from "@t3tools/contracts";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { readEnvironmentSupportsCompactionOverrides } from "../state/entities";
import { serverEnvironment } from "../state/server";
import type { ThreadCompactionMenuState } from "./threadActionMenu.logic";

/** The thread's compaction submenu, or null off Claude or on a server without overrides. */
export function readThreadCompactionMenuState(
  thread: Pick<EnvironmentThreadShell, "environmentId" | "providerInstanceId" | "source">,
): ThreadCompactionMenuState | null {
  if (!readEnvironmentSupportsCompactionOverrides(thread.environmentId)) return null;
  const settings = appAtomRegistry.get(serverEnvironment.settingsValueAtom(thread.environmentId));
  if (!settings) return null;
  const instanceId = thread.providerInstanceId;
  const instance = Object.hasOwn(settings.providerInstances, instanceId)
    ? settings.providerInstances[instanceId]
    : undefined;
  if (instance ? instance.driver !== "claudeAgent" : instanceId !== "claudeAgent") return null;
  return {
    overrides: thread.source.compaction,
    defaultIdleCompaction: resolveIdleCompaction(settings, instanceId),
    defaultAutoCompactWindow: instanceAutoCompactWindow(settings, instanceId),
  };
}
