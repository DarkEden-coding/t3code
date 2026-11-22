import {
  MAX_FILTER_MATCH_INPUT_LENGTH,
  type ScheduledTaskWatchFilter,
  type ScheduledTaskWebhookFilter,
} from "@t3tools/contracts";

import { webhookExpressionResolver, type WebhookRequest } from "./webhookTemplate.ts";

/** Webhook and watch filters share their operators; only their paths differ. */
type ScheduledTaskFilter = ScheduledTaskWebhookFilter | ScheduledTaskWatchFilter;

export interface FailedWebhookFilter {
  readonly index: number;
  readonly path: string;
}

function scalarText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function matchesScalar(filter: ScheduledTaskFilter, text: string): boolean {
  switch (filter.op) {
    case "equals":
      return text === filter.value;
    case "notEquals":
      return text !== filter.value;
    case "in":
      return filter.value.includes(text);
    case "startsWith":
      return text.startsWith(filter.value);
    case "matches":
      // Bounds a backtracking pattern's input; the pattern length is capped at save.
      return new RegExp(filter.value, "u").test(text.slice(0, MAX_FILTER_MATCH_INPUT_LENGTH));
    case "exists":
      return true;
  }
}

/**
 * Placeholders render null as missing, so filters treat it the same way. A
 * path with a `[]` wildcard resolves to a list: `equals`, `in` and
 * `startsWith` match when any element does, `notEquals` only when none equals
 * the value, and `exists` when the list has an element.
 */
function matchesFilter(filter: ScheduledTaskFilter, value: unknown): boolean {
  if (Array.isArray(value) && /\[\]/.test(filter.path)) {
    if (filter.op === "exists")
      return value.some((element) => element !== null && element !== undefined);
    const texts = value.map(scalarText).filter((text): text is string => text !== undefined);
    if (filter.op === "notEquals") return texts.every((text) => text !== filter.value);
    return texts.some((text) => matchesScalar(filter, text));
  }
  if (filter.op === "exists") return value !== undefined && value !== null;
  const text = scalarText(value);
  if (text === undefined) return false;
  return matchesScalar(filter, text);
}

/** The first filter the resolved values fail, or null when every filter matches. */
export function findFailedFilter(
  filters: ReadonlyArray<ScheduledTaskFilter>,
  resolve: (path: string) => unknown,
): FailedWebhookFilter | null {
  for (const [index, filter] of filters.entries()) {
    if (!matchesFilter(filter, resolve(filter.path))) return { index, path: filter.path };
  }
  return null;
}

/** The first filter the request fails, or null when every filter matches. */
export function findFailedWebhookFilter(
  filters: ReadonlyArray<ScheduledTaskWebhookFilter>,
  request: WebhookRequest,
): FailedWebhookFilter | null {
  if (filters.length === 0) return null;
  return findFailedFilter(filters, webhookExpressionResolver(request));
}

/** Filters are numbered from 1, in the order the settings form lists them. */
export function describeFailedWebhookFilter(failed: FailedWebhookFilter): string {
  return `Filter ${failed.index + 1} (${failed.path}) did not match.`;
}
