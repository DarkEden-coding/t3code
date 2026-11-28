import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useEffect, useState } from "react";

import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useGT } from "gt-react";

import { useServerConfigs } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { useStarredMessageIds } from "../../state/turnStars";
import type { MessagesTimelineRow } from "../chat/MessagesTimeline.logic";
import {
  deriveFocusTimelineRows,
  focusHiddenRowsEqual,
  type FocusTimelineResult,
} from "./focusView.logic";

const NO_KEYS: ReadonlySet<string> = new Set();
const NO_KEYS_ATOM = Atom.make(NO_KEYS);

/** Hidden runs the user opened, per thread. Not persisted: a run opens for a look, then folds again. */
const expandedRunKeysAtom = Atom.family((threadKey: string) =>
  Atom.make(NO_KEYS).pipe(
    Atom.setIdleTTL(10 * 60_000),
    Atom.withLabel(`focus-view:expanded:${threadKey}`),
  ),
);

/** What the thread's timeline hides, for the header pill. */
const hiddenCountAtom = Atom.family((threadKey: string) =>
  Atom.make(0).pipe(Atom.keepAlive, Atom.withLabel(`focus-view:hidden-count:${threadKey}`)),
);

export function useSupportsFocusView(environmentId: ScopedThreadRef["environmentId"]): boolean {
  return useServerConfigs().get(environmentId)?.environment.capabilities.threadFocusView === true;
}

export function threadFocusViewOn(shell: Pick<EnvironmentThreadShell, "source"> | null): boolean {
  return shell?.source.focusView === true;
}

/** The thread's scoped key while focus view is on for it, else null: a string keeps the memoized timeline still. */
export function focusViewThreadKey(
  threadRef: ScopedThreadRef | null,
  shell: Pick<EnvironmentThreadShell, "source"> | null,
): string | null {
  return threadRef !== null && threadFocusViewOn(shell) ? scopedThreadKey(threadRef) : null;
}

/** Turns the thread's focus view on or off, with a toast when the server refuses. */
export function useSetThreadFocusView() {
  const gt = useGT();
  const updateMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    label: "focus view toggle",
  });
  return async (threadRef: ScopedThreadRef, focusView: boolean) => {
    const result = await updateMetadata({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, focusView },
    });
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: gt("Could not change focus view"),
        description: String(squashAtomCommandFailure(result)),
      }),
    );
  };
}

export function useToggleFocusRun(threadKey: string) {
  const setExpanded = useAtomSet(expandedRunKeysAtom(threadKey));
  return (runKey: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(runKey)) next.add(runKey);
      return next;
    });
}

export function useFocusHiddenCount(threadRef: ScopedThreadRef): number {
  return useAtomValue(hiddenCountAtom(scopedThreadKey(threadRef)));
}

interface FocusRowsState {
  readonly source: ReadonlyArray<MessagesTimelineRow> | null;
  readonly starred: ReadonlySet<string> | null;
  readonly expanded: ReadonlySet<string> | null;
  readonly threadKey: string | null;
  readonly result: FocusTimelineResult;
}

/** The timeline's rows as focus view shows them, keeping unchanged rows' identities. */
export function useFocusTimelineRows(
  rows: MessagesTimelineRow[],
  threadKey: string | null,
): MessagesTimelineRow[] {
  const starred = useStarredMessageIds(
    threadKey === null ? null : (parseScopedThreadKey(threadKey)?.environmentId ?? null),
  );
  const expanded = useAtomValue(threadKey === null ? NO_KEYS_ATOM : expandedRunKeysAtom(threadKey));
  const [state, setState] = useState<FocusRowsState>({
    source: null,
    starred: null,
    expanded: null,
    threadKey: null,
    result: { rows: [], hiddenCount: 0 },
  });
  let result = state.result;
  if (threadKey === null) {
    result = { rows, hiddenCount: 0 };
  } else if (
    state.source !== rows ||
    state.starred !== starred ||
    state.expanded !== expanded ||
    state.threadKey !== threadKey
  ) {
    const next = deriveFocusTimelineRows(rows, {
      threadKey,
      starredMessageIds: starred,
      expandedRunKeys: expanded,
    });
    const previousById = new Map(state.result.rows.map((row) => [row.id, row]));
    const stableRows = next.rows.map((row) => {
      const previous = previousById.get(row.id);
      return previous?.kind === "focus-hidden" &&
        row.kind === "focus-hidden" &&
        focusHiddenRowsEqual(previous, row)
        ? previous
        : row;
    });
    const unchanged =
      stableRows.length === state.result.rows.length &&
      stableRows.every((row, index) => row === state.result.rows[index]);
    result = unchanged
      ? { rows: state.result.rows, hiddenCount: next.hiddenCount }
      : { rows: stableRows, hiddenCount: next.hiddenCount };
    setState({ source: rows, starred, expanded, threadKey, result });
  }
  const setHiddenCount = useAtomSet(hiddenCountAtom(threadKey ?? ""));
  const hiddenCount = result.hiddenCount;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes the count to the thread header, which renders outside the timeline
  useEffect(() => {
    if (threadKey !== null) setHiddenCount(hiddenCount);
  }, [threadKey, hiddenCount, setHiddenCount]);
  return result.rows;
}
