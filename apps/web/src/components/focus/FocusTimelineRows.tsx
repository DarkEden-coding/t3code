import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { T, useGT, Var } from "gt-react";
import { use } from "react";

import { useQuietThreadShell } from "../../state/entities";
import { useScheduledTaskTitle } from "../chat/TimelineUserMessageRow";
import { TimelineRowCtx } from "../chat/timelineRowContext";
import type { FocusHiddenRow, FocusSource } from "./focusView.logic";
import { focusSourceKey } from "./focusView.logic";
import { useToggleFocusRun } from "./focusViewState";

const SHOWN_SOURCES = 3;

function useFocusSourceTitle(source: FocusSource): string {
  const gt = useGT();
  const ctx = use(TimelineRowCtx);
  const shell = useQuietThreadShell(
    source.kind === "thread"
      ? scopeThreadRef(source.environmentId ?? ctx.activeThreadEnvironmentId, source.threadId)
      : null,
  );
  const taskTitle = useScheduledTaskTitle(
    ctx.activeThreadEnvironmentId,
    source.kind === "task" ? (source.scheduledTaskId ?? undefined) : undefined,
  );
  switch (source.kind) {
    case "thread":
      return (
        shell?.title.trim() ||
        source.title?.trim() ||
        gt("Agent", { $context: "sender of a message from another agent" })
      );
    case "task":
      return taskTitle ?? gt("Scheduled task");
    case "watch":
      return gt("Watcher", { $context: "focus view: what woke the agent" });
    case "background":
      return gt("Background task", { $context: "focus view: what woke the agent" });
    case "t3code":
      return "T3 Code";
    case "agent":
      return gt("Agent", { $context: "sender of a message from another agent" });
  }
}

function FocusSourceTitle({ source }: { readonly source: FocusSource }) {
  return <>{useFocusSourceTitle(source)}</>;
}

function FocusSourceList({ sources }: { readonly sources: ReadonlyArray<FocusSource> }) {
  const gt = useGT();
  const shown = sources.slice(0, SHOWN_SOURCES);
  const more = sources.length - shown.length;
  return (
    <>
      {shown.map((source, index) => (
        <span key={focusSourceKey(source)}>
          {index > 0 ? ", " : null}
          <FocusSourceTitle source={source} />
        </span>
      ))}
      {more > 0 ? ` ${gt("+{count} more", { count: more })}` : null}
    </>
  );
}

/** "from <thread> → this thread" above a message another agent sent here. */
export function FocusSenderLabel({ source }: { readonly source: FocusSource }) {
  return (
    <p
      className="me-1 mb-0.5 truncate text-end text-2xs font-medium text-info-foreground"
      data-focus-sender
    >
      <T>
        from <Var>{<FocusSourceTitle source={source} />}</Var> → this thread
      </T>
    </p>
  );
}

/** One line for a run of hidden rows; opened, it heads the run's dimmed rows with a Collapse. */
export function FocusHiddenTimelineRow({ row }: { readonly row: FocusHiddenRow }) {
  const gt = useGT();
  const toggle = useToggleFocusRun(row.threadKey);
  const label = row.expanded
    ? row.count === 0
      ? gt("Agent activity", { $context: "focus view: an opened run with no messages" })
      : gt("{count, plural, one {{count} agent message} other {{count} agent messages}}", {
          count: row.count,
        })
    : row.count === 0
      ? gt("Agent activity hidden")
      : gt(
          "{count, plural, one {{count} agent message hidden} other {{count} agent messages hidden}}",
          {
            count: row.count,
          },
        );
  if (row.expanded) {
    return (
      <div
        className="flex items-center gap-2 border-s border-dashed border-border ps-3 pt-1 text-xs text-muted-foreground"
        data-focus-hidden-run="expanded"
      >
        <ChevronDownIcon aria-hidden className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {label}
          {row.sources.length > 0 ? (
            <>
              {" · "}
              <FocusSourceList sources={row.sources} />
            </>
          ) : null}
        </span>
        <button
          type="button"
          data-scroll-anchor-ignore
          onClick={() => toggle(row.runKey)}
          className="shrink-0 cursor-pointer rounded-md px-1.5 py-0.5 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
        >
          <T>Collapse</T>
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-expanded={false}
      data-scroll-anchor-ignore
      data-focus-hidden-run="collapsed"
      onClick={() => toggle(row.runKey)}
      className="flex w-full cursor-pointer items-center gap-2 rounded-md py-1 text-xs text-muted-foreground before:flex-1 before:border-t before:border-dashed before:border-border after:flex-1 after:border-t after:border-dashed after:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
    >
      <span className="flex min-w-0 max-w-[80%] items-center gap-1">
        <ChevronRightIcon aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">
          {label}
          {row.sources.length > 0 ? (
            <>
              {" · "}
              <FocusSourceList sources={row.sources} />
            </>
          ) : null}
        </span>
      </span>
    </button>
  );
}
