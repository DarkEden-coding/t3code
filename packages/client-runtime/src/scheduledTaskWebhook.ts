import {
  MAX_WEBHOOK_DELIVERY_AGE_MINUTES,
  MAX_WEBHOOK_FILTERS,
  type ScheduledTaskWatchFilter,
  ScheduledTaskWebhookFilter,
  type ScheduledTaskWebhookFilterOp,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

export const DEFAULT_WEBHOOK_PROMPT = "Handle this webhook:\n{{body}}";

/** Blank means "no limit"; undefined means the input is not a valid limit, which blocks saving. */
export function parseMaxDeliveryAge(value: string): number | null | undefined {
  if (value.trim() === "") return null;
  const minutes = Number(value.trim());
  return Number.isInteger(minutes) && minutes > 0 && minutes <= MAX_WEBHOOK_DELIVERY_AGE_MINUTES
    ? minutes
    : undefined;
}

/**
 * One editable filter row. `in` takes a comma-separated list, which is
 * lossless because list values can't contain commas; `exists` ignores the value.
 */
export interface WebhookFilterDraft {
  /** Stable row identity for the form; never sent to the server. */
  readonly id: string;
  readonly path: string;
  readonly op: ScheduledTaskWebhookFilterOp;
  readonly value: string;
}

export const WEBHOOK_FILTER_OPS: ReadonlyArray<{
  readonly op: ScheduledTaskWebhookFilterOp;
  readonly label: string;
}> = [
  { op: "equals", label: msg("equals") },
  { op: "notEquals", label: msg("does not equal") },
  { op: "in", label: msg("is one of") },
  { op: "startsWith", label: msg("starts with") },
  { op: "matches", label: msg("matches regex") },
  { op: "exists", label: msg("exists") },
];

let lastWebhookFilterDraftId = 0;
const nextWebhookFilterDraftId = () => `filter-${++lastWebhookFilterDraftId}`;

export function emptyWebhookFilterDraft(): WebhookFilterDraft {
  return { id: nextWebhookFilterDraftId(), path: "", op: "equals", value: "" };
}

/** By id, so a removed row's identity never passes to the row after it. */
export function removeWebhookFilterDraft(
  drafts: ReadonlyArray<WebhookFilterDraft>,
  id: string,
): ReadonlyArray<WebhookFilterDraft> {
  return drafts.filter((draft) => draft.id !== id);
}

export function webhookFilterDrafts(
  filters: ReadonlyArray<ScheduledTaskWebhookFilter | ScheduledTaskWatchFilter> | undefined,
): ReadonlyArray<WebhookFilterDraft> {
  return (filters ?? []).map((filter) => ({
    id: nextWebhookFilterDraftId(),
    path: filter.path,
    op: filter.op,
    value:
      filter.op === "exists" ? "" : filter.op === "in" ? filter.value.join(", ") : filter.value,
  }));
}

const decodeWebhookFilter = Schema.decodeUnknownOption(ScheduledTaskWebhookFilter);

function draftToFilterInput(draft: WebhookFilterDraft): unknown {
  const path = draft.path.trim();
  return draft.op === "exists"
    ? { path, op: draft.op }
    : draft.op === "in"
      ? {
          path,
          op: draft.op,
          value: draft.value
            .split(",")
            .map((item) => item.trim())
            .filter((item) => item !== ""),
        }
      : { path, op: draft.op, value: draft.value };
}

/**
 * Checks each row with the server's own schema, so a draft that parses here also saves. The error
 * names the first row that would not. Webhook and watch filters differ only in their paths.
 */
export function parseFilterDrafts<Filter>(
  drafts: ReadonlyArray<WebhookFilterDraft>,
  decode: (input: unknown) => Option.Option<Filter>,
  rowError: (row: { readonly number: number; readonly op: ScheduledTaskWebhookFilterOp }) => string,
  resolve: MFunctionType = mFallback,
): { readonly filters: ReadonlyArray<Filter> } | { readonly error: string } {
  if (drafts.length > MAX_WEBHOOK_FILTERS) {
    return { error: resolve(msg("Use at most {max} filters.", { max: MAX_WEBHOOK_FILTERS })) };
  }
  const filters: Filter[] = [];
  for (const [index, draft] of drafts.entries()) {
    const filter = decode(draftToFilterInput(draft));
    if (Option.isNone(filter)) return { error: rowError({ number: index + 1, op: draft.op }) };
    filters.push(filter.value);
  }
  return { filters };
}

export function parseWebhookFilterDrafts(
  drafts: ReadonlyArray<WebhookFilterDraft>,
  resolve: MFunctionType = mFallback,
): { readonly filters: ReadonlyArray<ScheduledTaskWebhookFilter> } | { readonly error: string } {
  return parseFilterDrafts(
    drafts,
    decodeWebhookFilter,
    ({ number, op }) =>
      op === "exists"
        ? resolve(msg("Filter {number} needs a path under body, headers or query.", { number }))
        : op === "in"
          ? resolve(
              msg(
                "Filter {number} needs a path under body, headers or query, and at least one value.",
                { number },
              ),
            )
          : op === "matches"
            ? resolve(
                msg(
                  "Filter {number} needs a path under body, headers or query, and a valid regex.",
                  { number },
                ),
              )
            : resolve(
                msg("Filter {number} needs a path under body, headers or query, and a value.", {
                  number,
                }),
              ),
    resolve,
  );
}

/**
 * Whether a form's filter rows differ from the ones it opened with. A save
 * leaves `filters` out unless they did, so editing only the title can't
 * overwrite filters another device changed in the meantime.
 */
export function webhookFilterDraftsChanged(
  saved: ReadonlyArray<WebhookFilterDraft>,
  current: ReadonlyArray<WebhookFilterDraft>,
): boolean {
  return (
    saved.length !== current.length ||
    saved.some(
      (filter, index) =>
        filter.path !== current[index]?.path ||
        filter.op !== current[index]?.op ||
        (filter.op !== "exists" && filter.value !== current[index]?.value),
    )
  );
}
