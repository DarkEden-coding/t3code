import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { StarIcon, XIcon } from "lucide-react";
import { T, useGT, useMessages } from "gt-react";

import { requestConfirmDialog } from "~/confirmDialog";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useClientSettings } from "~/hooks/useSettings";
import { useQuietThreadShell } from "~/state/entities";
import { serverEnvironment } from "~/state/server";
import {
  type EnvironmentTurnStar,
  useAllTurnStars,
  useWritableStarEnvironmentIds,
} from "~/state/turnStars";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatDayAwareTimestamp } from "~/timestampFormat";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { SharedTooltipTrigger } from "../ui/shared-tooltip";
import { useSidebar } from "../ui/sidebar";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { starRevealNavigation } from "./starReveal";

const EXPANDED_KEY = "t3code:sidebar:starred-expanded";

/** Starred responses across connected environments. Hidden while there are none. */
export function SidebarStarredSection() {
  const gt = useGT();
  const stars = useAllTurnStars();
  const writable = useWritableStarEnvironmentIds();
  const [expanded, setExpanded] = useLocalStorage(EXPANDED_KEY, true, Schema.Boolean);
  const setStar = useAtomCommand(serverEnvironment.setTurnStar, { label: "unstar message" });
  const clearStars = useAtomCommand(serverEnvironment.clearTurnStars, {
    label: "clear starred messages",
  });
  if (stars.length === 0) return null;

  const reportFailure = (result: Awaited<ReturnType<typeof setStar | typeof clearStars>>) => {
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: gt("Could not update the stars"),
        description: String(squashAtomCommandFailure(result)),
      }),
    );
  };
  const remove = async (star: EnvironmentTurnStar) =>
    reportFailure(
      await setStar({
        environmentId: star.environmentId,
        input: { threadId: star.threadId, messageId: star.messageId, starred: false },
      }),
    );
  const clearAll = async () => {
    const message = gt(
      "{count, plural, one {Clear {count} starred message?} other {Clear all {count} starred messages?}}",
      { count: stars.length },
    );
    const confirmed =
      (await requestConfirmDialog(message, { variant: "destructive" })) ?? window.confirm(message);
    if (!confirmed) return;
    const environmentIds = [...new Set(stars.map((star) => star.environmentId))].filter((id) =>
      writable.has(id),
    );
    for (const environmentId of environmentIds)
      reportFailure(await clearStars({ environmentId, input: {} }));
  };

  return (
    <section className="mx-0.5 mb-1" aria-label={gt("Starred")} data-testid="sidebar-starred">
      <div className="group/starred-header flex items-center">
        <div className="min-w-0 flex-1">
          <CollapsibleSectionHeader
            expanded={expanded}
            onClick={() => setExpanded(!expanded)}
            data-testid="sidebar-starred-toggle"
            accessory={
              <span className="font-normal tabular-nums" data-testid="sidebar-starred-count">
                {stars.length}
              </span>
            }
          >
            {gt("Starred", { $context: "sidebar section" })}
          </CollapsibleSectionHeader>
        </div>
        {expanded && stars.some((star) => writable.has(star.environmentId)) ? (
          <button
            type="button"
            className="ms-1 shrink-0 cursor-pointer rounded-md px-1.5 py-0.5 text-2xs text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
            onClick={() => void clearAll()}
            data-testid="sidebar-starred-clear-all"
          >
            <T>Clear all</T>
          </button>
        ) : null}
      </div>
      {expanded ? (
        // About eight rows, then the list scrolls.
        <ul className="max-h-92 overflow-y-auto overscroll-contain">
          {stars.map((star) => (
            <StarredRow
              key={`${star.environmentId}:${star.messageId}`}
              star={star}
              {...(writable.has(star.environmentId) ? { onRemove: () => void remove(star) } : {})}
            />
          ))}
        </ul>
      ) : null}
    </section>
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
  const { isMobile, setOpenMobile } = useSidebar();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const shell = useQuietThreadShell(scopeThreadRef(star.environmentId, star.threadId));
  const title = shell?.title ?? star.threadTitle;
  const detail = star.note ?? (star.preview || gt("(empty response)"));

  const open = () => {
    if (isMobile) setOpenMobile(false);
    void navigate(starRevealNavigation(star));
  };

  return (
    <li className="group/starred-row relative" data-testid="sidebar-starred-item">
      <button
        type="button"
        onClick={open}
        className="flex w-full cursor-pointer items-start gap-2 rounded-md py-1.5 ps-2 pe-7 text-left hover:bg-sidebar-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
      >
        <StarIcon aria-hidden className="mt-0.5 size-3 shrink-0 fill-warning text-warning" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-sidebar-foreground">{title}</span>
            <time
              dateTime={star.starredAt}
              className="shrink-0 text-2xs text-sidebar-muted-foreground tabular-nums"
            >
              {formatDayAwareTimestamp(star.starredAt, timestampFormat, undefined, undefined, m)}
            </time>
          </span>
          <span className="truncate text-2xs text-sidebar-muted-foreground">{detail}</span>
        </span>
      </button>
      {onRemove ? (
        <SharedTooltipTrigger
          render={
            <button
              type="button"
              aria-label={gt("Remove star")}
              onClick={onRemove}
              data-testid="sidebar-starred-remove"
              className="absolute end-1 top-1.5 inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground opacity-0 hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:opacity-100 group-hover/starred-row:opacity-100 pointer-coarse:opacity-100"
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
