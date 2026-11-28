import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { MessageId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { StarIcon } from "lucide-react";
import { T, useGT } from "gt-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { serverEnvironment } from "~/state/server";
import { useSupportsTurnStars } from "~/state/turnStars";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { SharedTooltipTrigger } from "../ui/shared-tooltip";
import { stackedThreadToast, toastManager } from "../ui/toast";

/** Stars or unstars a response by hand. Filled while starred, so it is also the star's mark. */
export function AssistantStarButton({
  threadRef,
  threadId,
  messageId,
  starred,
}: {
  readonly threadRef: ScopedThreadRef;
  /** The message's own thread, which a forked thread's earlier turns differ from. */
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly starred: boolean;
}) {
  const gt = useGT();
  const environmentId = threadRef.environmentId;
  const supported = useSupportsTurnStars(environmentId);
  const canStar = useAtomValue(serverEnvironment.setTurnStar.permissionAtom(environmentId));
  const setStar = useAtomCommand(serverEnvironment.setTurnStar, { label: "star message" });
  const [busy, setBusy] = useState(false);
  if (!supported) return null;

  const toggle = async () => {
    setBusy(true);
    const result = await setStar({
      environmentId,
      input: { threadId, messageId, starred: !starred },
    });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Could not update the star"),
          description: String(squashAtomCommandFailure(result)),
        }),
      );
    }
  };
  const label = starred ? gt("Remove star") : gt("Star this response");

  return (
    <SharedTooltipTrigger
      render={
        <Button
          type="button"
          size="xs"
          variant="ghost-muted"
          disabled={busy || !canStar}
          onClick={() => void toggle()}
          aria-label={label}
          aria-pressed={starred}
          data-testid="assistant-star-button"
        />
      }
      label={starred ? <T>Starred. Click to remove the star</T> : <T>Star this response</T>}
    >
      <StarIcon className={cn("size-3", starred && "fill-warning text-warning")} />
    </SharedTooltipTrigger>
  );
}
