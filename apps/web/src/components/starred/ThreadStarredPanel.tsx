import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { EyeIcon, StarIcon, XIcon } from "lucide-react";
import { T, useGT, useMessages } from "gt-react";
import { useState } from "react";

import { requestConfirmDialog } from "~/confirmDialog";
import { useClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { useQuietThreadShell } from "~/state/entities";
import { serverEnvironment } from "~/state/server";
import {
  type EnvironmentTurnStar,
  useSupportsTurnStars,
  useThreadTurnStars,
} from "~/state/turnStars";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatDayAwareTimestamp } from "~/timestampFormat";
import { ThreadDetailsSection } from "../chat/ThreadDetailsSection";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_META_ACTION_CLASS,
  THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS,
} from "../chat/threadDetailsPanelStyles";
import {
  threadFocusViewOn,
  useSetThreadFocusView,
  useSupportsFocusView,
} from "../focus/focusViewState";
import { SharedTooltipTrigger } from "../ui/shared-tooltip";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { starRevealNavigation } from "./starReveal";

/** The thread's starred messages, newest first, and its focus view switch. */
export function ThreadStarredPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const gt = useGT();
  const threadRef = scopeThreadRef(props.environmentId, props.threadId);
  const supportsStars = useSupportsTurnStars(props.environmentId);
  const supportsFocus = useSupportsFocusView(props.environmentId);
  const stars = useThreadTurnStars(threadRef);
  const shell = useQuietThreadShell(threadRef);
  const canRemove = useAtomValue(serverEnvironment.setTurnStar.permissionAtom(props.environmentId));
  const setStar = useAtomCommand(serverEnvironment.setTurnStar, { label: "unstar message" });
  const setFocusView = useSetThreadFocusView();
  const [focusBusy, setFocusBusy] = useState(false);
  if (!supportsStars && !supportsFocus) return null;

  const focusOn = threadFocusViewOn(shell);
  const reportFailure = (title: string, result: Awaited<ReturnType<typeof setStar>>) => {
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title,
        description: String(squashAtomCommandFailure(result)),
      }),
    );
  };
  const unstar = (star: EnvironmentTurnStar) =>
    setStar({
      environmentId: star.environmentId,
      input: { threadId: star.threadId, messageId: star.messageId, starred: false },
    });
  const remove = async (star: EnvironmentTurnStar) =>
    reportFailure(gt("Could not update the stars"), await unstar(star));
  const clearAll = async () => {
    const message = gt(
      "{count, plural, one {Clear {count} starred message in this thread?} other {Clear all {count} starred messages in this thread?}}",
      { count: stars.length },
    );
    const confirmed =
      (await requestConfirmDialog(message, { variant: "destructive" })) ?? window.confirm(message);
    if (!confirmed) return;
    // Per message, so an older server's clear-all can never reach other threads' stars.
    for (const star of stars) reportFailure(gt("Could not update the stars"), await unstar(star));
  };
  const toggleFocus = async (focusView: boolean) => {
    setFocusBusy(true);
    await setFocusView(threadRef, focusView);
    setFocusBusy(false);
  };

  return (
    <ThreadDetailsSection
      headingId="thread-details-starred-heading"
      title={
        stars.length > 0
          ? gt("Starred · {count}", { count: stars.length })
          : gt("Starred", { $context: "thread details section" })
      }
      showHeading={stars.length > 0}
      data-thread-starred-panel
      actions={
        stars.length > 0 && canRemove ? (
          <button
            type="button"
            className={THREAD_DETAILS_PANEL_META_ACTION_CLASS}
            onClick={() => void clearAll()}
            data-testid="thread-starred-clear-all"
          >
            <T>Clear all</T>
          </button>
        ) : null
      }
    >
      <div className="flex flex-col">
        {stars.length > 0 ? (
          // About eight rows, then the list scrolls.
          <ul className="m-0 max-h-92 list-none overflow-y-auto overscroll-contain p-0">
            {stars.map((star) => (
              <StarredRow
                key={star.messageId}
                star={star}
                {...(canRemove ? { onRemove: () => void remove(star) } : {})}
              />
            ))}
          </ul>
        ) : null}
        {supportsFocus ? (
          <label
            className={cn(
              "flex min-h-8 cursor-pointer items-center rounded-lg py-1.5",
              THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS,
            )}
            data-testid="thread-focus-view-toggle"
          >
            <EyeIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium text-foreground/80">
                <T>Focus view</T>
              </span>
              <span className="truncate text-2xs text-muted-foreground">
                <T>Your messages, replies and stars</T>
              </span>
            </span>
            <Switch
              size="sm"
              checked={focusOn}
              disabled={focusBusy}
              onCheckedChange={(checked) => void toggleFocus(checked)}
            />
          </label>
        ) : null}
      </div>
    </ThreadDetailsSection>
  );
}

function StarredRow({
  star,
  onRemove,
}: {
  readonly star: EnvironmentTurnStar;
  readonly onRemove?: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const navigate = useNavigate();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const detail = star.note ?? (star.preview || gt("(empty response)"));

  return (
    <li className="group/starred-row relative" data-testid="thread-starred-item">
      <button
        type="button"
        onClick={() => void navigate(starRevealNavigation(star))}
        className={cn(
          "flex w-full cursor-pointer items-center rounded-lg py-1.5 pe-8 hover:bg-black/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 dark:hover:bg-white/[0.08]",
          THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS,
        )}
      >
        <StarIcon aria-hidden className="size-3.5 shrink-0 fill-warning text-warning" />
        <span className="min-w-0 flex-1 truncate text-sm text-foreground/80">{detail}</span>
        <time
          dateTime={star.starredAt}
          className="shrink-0 text-2xs text-muted-foreground tabular-nums"
        >
          {formatDayAwareTimestamp(star.starredAt, timestampFormat, undefined, undefined, m)}
        </time>
      </button>
      {onRemove ? (
        <SharedTooltipTrigger
          render={
            <button
              type="button"
              aria-label={gt("Remove star")}
              onClick={onRemove}
              data-testid="thread-starred-remove"
              className="absolute end-1.5 top-1/2 inline-flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-black/[0.06] hover:text-foreground focus-visible:opacity-100 group-hover/starred-row:opacity-100 pointer-coarse:opacity-100 dark:hover:bg-white/[0.1]"
            />
          }
          label={<T>Done. Remove from Starred</T>}
        >
          <XIcon className="size-3" />
        </SharedTooltipTrigger>
      ) : null}
    </li>
  );
}
