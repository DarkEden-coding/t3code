import type { ScopedThreadRef } from "@t3tools/contracts";
import { T, useGT } from "gt-react";

import { useQuietThreadShell } from "../../state/entities";
import { SharedTooltipTrigger } from "../ui/shared-tooltip";
import { threadFocusViewOn, useFocusHiddenCount, useSetThreadFocusView } from "./focusViewState";

/** "Focus · N hidden" in the thread header while focus view is on; clicking it shows everything. */
export function FocusViewPill({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const gt = useGT();
  const shell = useQuietThreadShell(threadRef);
  const hidden = useFocusHiddenCount(threadRef);
  const setFocusView = useSetThreadFocusView();
  if (!threadFocusViewOn(shell)) return null;
  return (
    <SharedTooltipTrigger
      render={
        <button
          type="button"
          data-testid="thread-focus-view-pill"
          onClick={() => void setFocusView(threadRef, false)}
          className="shrink-0 cursor-pointer rounded-full border border-primary/60 px-2 py-px text-2xs font-medium text-primary tabular-nums hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        />
      }
      label={<T>Focus view shows your messages, replies and stars. Click to show everything.</T>}
    >
      {gt("Focus · {count} hidden", { count: hidden })}
    </SharedTooltipTrigger>
  );
}
