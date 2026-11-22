import * as Schema from "effect/Schema";

import {
  CommandId,
  ForwardCompatibleArray,
  IsoDateTime,
  ProjectId,
  ScheduledTaskId,
  SecretRef,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { SecretReference } from "./secretReference.ts";
import {
  OrchestrationV2Actor,
  OrchestrationV2CreationSource,
  OrchestrationV2ThreadLaunchWorkspaceStrategy,
} from "./orchestrationV2.ts";
import { ProviderInteractionMode, RuntimeMode } from "./providerPolicy.ts";

const TimeOfDay = TrimmedNonEmptyString.check(
  Schema.isPattern(/^([01]?\d|2[0-3]):([0-5]\d)$/),
).annotate({ description: "Local time as HH:MM, such as 09:30." });

export const MIN_SCHEDULED_TASK_INTERVAL_MS = 60_000;

const ScheduledTaskIntervalMs = Schema.Int.check(Schema.isGreaterThan(0));

const ScheduledTaskIntervalSchedule = Schema.Struct({
  type: Schema.Literal("interval"),
  everyMs: ScheduledTaskIntervalMs,
});

const ScheduledTaskFixedTimeSchedule = Schema.Struct({
  type: Schema.Literal("fixed_time"),
  timeOfDay: TimeOfDay,
  weekdays: Schema.optional(
    Schema.Array(
      Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 })).annotate({
        description: "Weekday. 0 is Sunday, 6 is Saturday.",
      }),
    ).annotate({
      description: "Default: every day.",
    }),
  ),
});

const ISO_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const YEAR_0000 = Date.parse("0000-01-01T00:00:00Z");
const YEAR_10000 = Date.parse("+010000-01-01T00:00:00Z");

/** Date.parse rolls impossible days like Feb 30 into the next month, so check the day too. */
function isIsoWithOffset(value: string): boolean {
  const match = ISO_WITH_OFFSET.exec(value);
  // The server stores UTC, which must stay a four-digit year to decode again.
  const time = Date.parse(value);
  if (!match || !(time >= YEAR_0000 && time < YEAR_10000)) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return days !== undefined && day >= 1 && day <= days;
}

// Checked by filter, not pattern, to keep the MCP tool schema small.
const ScheduledTaskOnceSchedule = Schema.Struct({
  type: Schema.Literal("once"),
  runAt: TrimmedNonEmptyString.check(
    Schema.makeFilter(
      (value) => isIsoWithOffset(value) || "Expected an ISO date and time with an offset.",
    ),
  ),
});

const ScheduledTaskWebhookSignatureFields = {
  header: TrimmedNonEmptyString.annotate({
    description: "Header with the signature, such as x-hub-signature-256.",
  }),
  encoding: Schema.Literals(["hex", "base64"]),
  prefix: Schema.String.annotate({
    description: "Text before the digest, such as 'sha256='. Empty for none.",
  }),
};

export const ScheduledTaskWebhookSignature = Schema.Struct(
  ScheduledTaskWebhookSignatureFields,
).annotate({ description: "HMAC-SHA256 check on the raw body." });
export type ScheduledTaskWebhookSignature = typeof ScheduledTaskWebhookSignature.Type;

/** Matches how long the relay holds a request for an offline environment. */
export const MAX_WEBHOOK_DELIVERY_AGE_MINUTES = 24 * 60;

const WebhookMaxDeliveryAgeMinutes = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: MAX_WEBHOOK_DELIVERY_AGE_MINUTES }),
).annotate({
  description: "Skip requests held offline over this many minutes. Omit to run all.",
});

export function isWebhookDedupeTemplate(template: string): boolean {
  const placeholders = /\{\{\s*(?:(?:body|headers|query)(?:\.[^{}.\s]+)*|request)\s*\}\}/g;
  const matches = [...template.matchAll(placeholders)];
  const remainder = template.replace(placeholders, "");
  return matches.length > 0 && !remainder.includes("{{") && !remainder.includes("}}");
}

const WebhookDedupeTemplate = Schema.String.check(Schema.makeFilter(isWebhookDedupeTemplate));

const ScheduledTaskWebhookDedupe = Schema.Struct({
  replayKey: Schema.optional(WebhookDedupeTemplate),
  coalesceKey: Schema.optional(WebhookDedupeTemplate),
  coalesceWindowSeconds: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 10, maximum: 3600 })),
  ),
}).annotate({
  description: "Replay and coalesce key templates. Window in seconds, default 120.",
});

export const MAX_WEBHOOK_FILTERS = 16;
/** Regex filters run on server input, so both the pattern and the text it tests are capped. */
export const MAX_FILTER_PATTERN_LENGTH = 200;
export const MAX_FILTER_MATCH_INPUT_LENGTH = 10_000;

/** Filter patterns compile with the `u` flag, the same way the server tests them. */
function isValidFilterPattern(pattern: string): boolean {
  try {
    return new RegExp(pattern, "u") instanceof RegExp;
  } catch {
    return false;
  }
}

/**
 * Forms edit an `in` list as comma-separated text, so a value that has no
 * comma and no surrounding whitespace survives that round trip unchanged.
 */
const FilterListValue = Schema.String.check(Schema.isPattern(/^[^,\s](?:[^,]*[^,\s])?$/)).annotate({
  description: "Non-empty, without commas or surrounding whitespace.",
});

const FilterPattern = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(MAX_FILTER_PATTERN_LENGTH),
  Schema.makeFilter(
    (value) => isValidFilterPattern(value) || "Expected a valid regular expression.",
  ),
).annotate({ description: "JavaScript regex, max 200 chars." });

/** Webhook and watch filters share their operators; only what a path may name differs. */
const makeFilter = <Path extends Schema.Codec<string, string>>(path: Path) =>
  Schema.Union([
    Schema.Struct({
      path,
      op: Schema.Literals(["equals", "notEquals", "startsWith"]),
      value: Schema.String,
    }),
    Schema.Struct({ path, op: Schema.Literal("matches"), value: FilterPattern }),
    Schema.Struct({
      path,
      op: Schema.Literal("in"),
      value: Schema.Array(FilterListValue).check(Schema.isMinLength(1)),
    }),
    Schema.Struct({ path, op: Schema.Literal("exists") }),
  ]);

const WebhookFilterPath = TrimmedNonEmptyString.check(
  Schema.isPattern(/^(body|headers|query)(\.|$)/),
);

export const ScheduledTaskWebhookFilter = makeFilter(WebhookFilterPath).annotate({
  description:
    "Path: `headers.x-event` or `body.action`. String compare. Objects pass only 'exists'. A `[]` segment matches any array item. `notEquals` passes only if no item equals.",
});
export type ScheduledTaskWebhookFilter = typeof ScheduledTaskWebhookFilter.Type;
export type ScheduledTaskWebhookFilterOp = ScheduledTaskWebhookFilter["op"];

const ScheduledTaskWebhookFilters = Schema.Array(ScheduledTaskWebhookFilter)
  .check(Schema.isMaxLength(MAX_WEBHOOK_FILTERS))
  .annotate({
    description: "All must match. Max 16. Omitted: keep stored. [] clears.",
  });

const ScheduledTaskWebhookSchedule = Schema.Struct({
  type: Schema.Literal("webhook"),
  signature: Schema.NullOr(ScheduledTaskWebhookSignature),
  maxDeliveryAgeMinutes: Schema.optional(Schema.NullOr(WebhookMaxDeliveryAgeMinutes)),
  dedupe: Schema.optional(ScheduledTaskWebhookDedupe),
  filters: Schema.optional(ScheduledTaskWebhookFilters),
}).annotate({
  description: "Run on each webhook request.",
});

const ScheduledTaskUpsertWebhookSchedule = Schema.Struct({
  type: Schema.Literal("webhook"),
  signature: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        ...ScheduledTaskWebhookSignatureFields,
        secret: Schema.optional(TrimmedNonEmptyString).annotate({
          description: "Default: stored secret.",
        }),
        secretRef: Schema.optional(SecretRef).annotate({
          description: "From `request_secret`. Instead of `secret`. Spent by this save.",
        }),
      }),
    ),
  ).annotate({
    description: "Omit for URL token only.",
  }),
  maxDeliveryAgeMinutes: Schema.optional(Schema.NullOr(WebhookMaxDeliveryAgeMinutes)),
  dedupe: Schema.optional(ScheduledTaskWebhookDedupe),
  filters: Schema.optional(ScheduledTaskWebhookFilters),
}).annotate({
  description:
    "Run per webhook request. Prompt can use {{body.path}}, {{headers.name}}, {{query.name}}, {{body}}, {{request}}.",
});

export const DEFAULT_WATCH_TIMEOUT_MS = 60_000;
export const MAX_WATCH_TIMEOUT_MS = 300_000;
const MAX_WATCH_ENV_VARS = 32;
const MAX_WATCH_COMMAND_LENGTH = 8_000;

const WatchPath = Schema.String.check(Schema.isMaxLength(500)).annotate({
  description: "Dot path such as `data.messages`; `[]` maps arrays. Empty: the whole output.",
});

const WatchFilterPath = TrimmedNonEmptyString.check(Schema.isMaxLength(500));

/** Paths are relative to each new item, or to the selected value; `.` is the item or value itself. */
export const ScheduledTaskWatchFilter = makeFilter(WatchFilterPath).annotate({
  description:
    "Path inside each item (value mode: the value); `.` is the item itself. All must match.",
});
export type ScheduledTaskWatchFilter = typeof ScheduledTaskWatchFilter.Type;

const ScheduledTaskWatchFilters = Schema.Array(ScheduledTaskWatchFilter).check(
  Schema.isMaxLength(MAX_WEBHOOK_FILTERS),
);

const WatchEnvName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(128),
  Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/),
);

const uniqueEnvNames = Schema.makeFilter(
  (env: ReadonlyArray<{ readonly name: string }>) =>
    new Set(env.map((variable) => variable.name)).size === env.length ||
    "Each variable name can appear once.",
);

/** What a client sees of a variable: its name and whether its value is a secret, never the value. */
export const ScheduledTaskWatchEnvVar = Schema.Struct({
  name: WatchEnvName,
  secret: Schema.Boolean,
});
export type ScheduledTaskWatchEnvVar = typeof ScheduledTaskWatchEnvVar.Type;

const ScheduledTaskWatchFields = {
  everyMs: ScheduledTaskIntervalMs,
  command: TrimmedNonEmptyString.check(Schema.isMaxLength(MAX_WATCH_COMMAND_LENGTH)).annotate({
    description: "Shell command run in the project root. Credentials go in `env`, not here.",
  }),
  timeoutMs: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1_000, maximum: MAX_WATCH_TIMEOUT_MS })),
  ).annotate({ description: "Default 60000, max 300000." }),
  mode: Schema.Literals(["items", "value"]).annotate({
    description:
      "items: stdout is JSON; `path` selects an array and runs fire for unseen ids. value: fire when the value at `path` changes.",
  }),
  path: Schema.optional(WatchPath),
  idPath: Schema.optional(WatchPath).annotate({
    description: "Items mode: id inside each item. Default `id`; `.` is the item itself.",
  }),
  filters: Schema.optional(ScheduledTaskWatchFilters),
};

const ScheduledTaskWatchSchedule = Schema.Struct({
  type: Schema.Literal("watch"),
  ...ScheduledTaskWatchFields,
  env: Schema.optional(Schema.Array(ScheduledTaskWatchEnvVar)),
}).annotate({ description: "Poll a command and run when its output changes." });
export type ScheduledTaskWatchSchedule = typeof ScheduledTaskWatchSchedule.Type;

/** A variable's value on save. Name only keeps the stored value. */
export const ScheduledTaskUpsertWatchEnvVar = Schema.Union([
  Schema.Struct({
    name: WatchEnvName,
    value: Schema.String.check(Schema.isMaxLength(32_768)),
    secret: Schema.optional(Schema.Boolean).annotate({ description: "Hide it in errors." }),
  }),
  Schema.Struct({
    name: WatchEnvName,
    secretRef: SecretRef.annotate({ description: "From `request_secret`. Spent by this save." }),
  }),
  Schema.Struct({
    name: WatchEnvName,
    reference: SecretReference.annotate({ description: "Read from a secret provider per poll." }),
  }),
  Schema.Struct({ name: WatchEnvName, secret: Schema.optional(Schema.Boolean) }),
]);
export type ScheduledTaskUpsertWatchEnvVar = typeof ScheduledTaskUpsertWatchEnvVar.Type;

const ScheduledTaskUpsertWatchSchedule = Schema.Struct({
  type: Schema.Literal("watch"),
  ...ScheduledTaskWatchFields,
  everyMs: ScheduledTaskIntervalMs.check(
    Schema.isGreaterThanOrEqualTo(MIN_SCHEDULED_TASK_INTERVAL_MS),
  ).annotate({ description: "Poll interval. Min 60000." }),
  env: Schema.optional(
    Schema.Array(ScheduledTaskUpsertWatchEnvVar).check(
      Schema.isMaxLength(MAX_WATCH_ENV_VARS),
      uniqueEnvNames,
    ),
  ).annotate({
    description:
      "Env vars for the command: {name,value}, {name,secretRef}, or {name} to keep. Omitted: keep stored.",
  }),
}).annotate({
  description:
    "Poll a command without a model; run the prompt on a change. First poll is a baseline. Prompt can use {{items}}, {{items.length}}, {{value}}, {{previous}}.",
});

/** Accept legacy sub-minute schedules so users can still manage them. */
export const ScheduledTaskSchedule = Schema.Union([
  ScheduledTaskIntervalSchedule,
  ScheduledTaskFixedTimeSchedule,
  ScheduledTaskOnceSchedule,
  ScheduledTaskWebhookSchedule,
  ScheduledTaskWatchSchedule,
]);
export type ScheduledTaskSchedule = typeof ScheduledTaskSchedule.Type;

export const ScheduledTaskUpsertSchedule = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("interval"),
    everyMs: ScheduledTaskIntervalMs.check(
      Schema.isGreaterThanOrEqualTo(MIN_SCHEDULED_TASK_INTERVAL_MS),
    ).annotate({
      description: "Min 60000.",
    }),
  }),
  ScheduledTaskFixedTimeSchedule,
  ScheduledTaskOnceSchedule,
  ScheduledTaskUpsertWebhookSchedule,
  ScheduledTaskUpsertWatchSchedule,
]);
export type ScheduledTaskUpsertSchedule = typeof ScheduledTaskUpsertSchedule.Type;

export const ScheduledTaskRunStatus = Schema.Literals(["never", "running", "succeeded", "failed"]);
export type ScheduledTaskRunStatus = typeof ScheduledTaskRunStatus.Type;

export const ScheduledTaskWebhookEndpoint = Schema.Struct({
  path: TrimmedNonEmptyString,
  url: Schema.NullOr(TrimmedNonEmptyString),
  hasSecret: Schema.Boolean,
});
export type ScheduledTaskWebhookEndpoint = typeof ScheduledTaskWebhookEndpoint.Type;

/** A watch task's poll state. Failures never start runs until the third in a row. */
export const ScheduledTaskWatchStatus = Schema.Struct({
  lastPolledAt: Schema.NullOr(IsoDateTime),
  lastError: Schema.NullOr(Schema.String),
  consecutiveFailures: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type ScheduledTaskWatchStatus = typeof ScheduledTaskWatchStatus.Type;

/**
 * Where runs go. One-thread modes launch their thread on the first run and keep it; `fresh_session`
 * starts each later run in a new provider session there.
 */
export const ScheduledTaskThreadMode = Schema.Literals(["new_thread", "continue", "fresh_session"]);
export type ScheduledTaskThreadMode = typeof ScheduledTaskThreadMode.Type;

/** Servers before thread modes omit it; their bound tasks continue the conversation. */
export function scheduledTaskThreadMode(
  task: Pick<ScheduledTask, "threadId" | "threadMode">,
): ScheduledTaskThreadMode {
  return task.threadMode ?? (task.threadId === null ? "new_thread" : "continue");
}

export const ScheduledTask = Schema.Struct({
  id: ScheduledTaskId,
  title: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
  schedule: ScheduledTaskSchedule,
  projectId: ProjectId,
  threadId: Schema.NullOr(ThreadId),
  threadMode: Schema.optional(ScheduledTaskThreadMode),
  workspaceStrategy: OrchestrationV2ThreadLaunchWorkspaceStrategy,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  createdBy: OrchestrationV2Actor,
  creationSource: OrchestrationV2CreationSource,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  nextRunAt: Schema.NullOr(IsoDateTime),
  lastRunAt: Schema.NullOr(IsoDateTime),
  lastRunStatus: ScheduledTaskRunStatus,
  lastRunError: Schema.NullOr(Schema.String),
  runCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  webhook: Schema.optional(ScheduledTaskWebhookEndpoint),
  watch: Schema.optional(ScheduledTaskWatchStatus),
  /** Why the task cannot run regardless of `enabled`, such as a managed policy refusing webhooks. */
  blockedByPolicy: Schema.optionalKey(Schema.String),
});
export type ScheduledTask = typeof ScheduledTask.Type;

export const ScheduledTaskListInput = Schema.Struct({});
export type ScheduledTaskListInput = typeof ScheduledTaskListInput.Type;

export const ScheduledTaskListResult = Schema.Struct({
  tasks: ForwardCompatibleArray(ScheduledTask),
  /** The server's IANA zone for fixed-time schedules. Absent from older servers. */
  timeZone: Schema.optional(TrimmedNonEmptyString),
});
export type ScheduledTaskListResult = typeof ScheduledTaskListResult.Type;

export const ScheduledTaskUpsertInput = Schema.Struct({
  id: Schema.optional(ScheduledTaskId),
  requireExisting: Schema.optional(Schema.Boolean).annotate({
    description: "Reject the save if the task no longer exists, for edits from a client form.",
  }),
  commandId: Schema.optional(CommandId),
  title: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
  schedule: ScheduledTaskUpsertSchedule,
  projectId: ProjectId,
  /** Omitted or null: keep the stored thread, which a first run may have bound since the form opened. */
  threadId: Schema.optional(Schema.NullOr(ThreadId)),
  /** True with no `threadId`: the user cleared the thread, so the next run starts one. */
  unbindThread: Schema.optional(Schema.Boolean),
  /** Omitted: keep the stored mode, or derive it from `threadId` for a new or rebound task. */
  threadMode: Schema.optional(ScheduledTaskThreadMode),
  workspaceStrategy: OrchestrationV2ThreadLaunchWorkspaceStrategy,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  createdBy: Schema.optional(OrchestrationV2Actor),
  creationSource: Schema.optional(OrchestrationV2CreationSource),
});
export type ScheduledTaskUpsertInput = typeof ScheduledTaskUpsertInput.Type;

export const ScheduledTaskSetEnabledInput = Schema.Struct({
  id: ScheduledTaskId,
  enabled: Schema.Boolean,
});
export type ScheduledTaskSetEnabledInput = typeof ScheduledTaskSetEnabledInput.Type;

export const ScheduledTaskDeleteInput = Schema.Struct({
  id: ScheduledTaskId,
});
export type ScheduledTaskDeleteInput = typeof ScheduledTaskDeleteInput.Type;

export const ScheduledTaskRunNowInput = Schema.Struct({
  id: ScheduledTaskId,
});
export type ScheduledTaskRunNowInput = typeof ScheduledTaskRunNowInput.Type;

export const ScheduledTaskRotateWebhookTokenInput = Schema.Struct({
  id: ScheduledTaskId,
});
export type ScheduledTaskRotateWebhookTokenInput = typeof ScheduledTaskRotateWebhookTokenInput.Type;

export const ScheduledTaskWebhookDeliveryId = TrimmedNonEmptyString.pipe(
  Schema.brand("ScheduledTaskWebhookDeliveryId"),
);
export type ScheduledTaskWebhookDeliveryId = typeof ScheduledTaskWebhookDeliveryId.Type;

export const ScheduledTaskWebhookDeliveryOutcome = Schema.Literals([
  "accepted",
  "dispatch_failed",
  "duplicate",
  "coalesced",
  "rejected_signature",
  "disabled",
  "rate_limited",
  "expired",
  "filtered",
]);
export type ScheduledTaskWebhookDeliveryOutcome = typeof ScheduledTaskWebhookDeliveryOutcome.Type;

export const ScheduledTaskWebhookDeliverySummary = Schema.Struct({
  id: ScheduledTaskWebhookDeliveryId,
  taskId: ScheduledTaskId,
  receivedAt: IsoDateTime,
  method: TrimmedNonEmptyString,
  contentType: Schema.NullOr(Schema.String),
  bodyBytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  // Any string, so an outcome added later doesn't break a client's whole list.
  outcome: Schema.Union([ScheduledTaskWebhookDeliveryOutcome, Schema.String]),
  signatureVerified: Schema.Boolean,
  pendingWindow: Schema.optional(Schema.Boolean),
  missingFields: Schema.Array(Schema.String),
  error: Schema.NullOr(Schema.String),
});
export type ScheduledTaskWebhookDeliverySummary = typeof ScheduledTaskWebhookDeliverySummary.Type;

export const ScheduledTaskWebhookDelivery = Schema.Struct({
  ...ScheduledTaskWebhookDeliverySummary.fields,
  query: Schema.String,
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.String,
  bodyTruncated: Schema.Boolean,
  renderedPrompt: Schema.NullOr(Schema.String),
});
export type ScheduledTaskWebhookDelivery = typeof ScheduledTaskWebhookDelivery.Type;

export const ScheduledTaskListWebhookDeliveriesInput = Schema.Struct({
  id: ScheduledTaskId,
  /**
   * Sent by clients that decode any outcome. Shipped clients decode a closed
   * list and fail on the whole response, so without it the server leaves out
   * rows with outcomes they don't know.
   */
  acceptAnyOutcome: Schema.optional(Schema.Boolean),
});
export type ScheduledTaskListWebhookDeliveriesInput =
  typeof ScheduledTaskListWebhookDeliveriesInput.Type;

export const ScheduledTaskListWebhookDeliveriesResult = Schema.Struct({
  deliveries: Schema.Array(ScheduledTaskWebhookDeliverySummary),
});
export type ScheduledTaskListWebhookDeliveriesResult =
  typeof ScheduledTaskListWebhookDeliveriesResult.Type;

export const ScheduledTaskGetWebhookDeliveryInput = Schema.Struct({
  id: ScheduledTaskId,
  deliveryId: ScheduledTaskWebhookDeliveryId,
  acceptAnyOutcome: Schema.optional(Schema.Boolean),
});
export type ScheduledTaskGetWebhookDeliveryInput = typeof ScheduledTaskGetWebhookDeliveryInput.Type;

export const ScheduledTaskGetWebhookDeliveryResult = Schema.Struct({
  delivery: ScheduledTaskWebhookDelivery,
});
export type ScheduledTaskGetWebhookDeliveryResult =
  typeof ScheduledTaskGetWebhookDeliveryResult.Type;

export const ScheduledTaskMutationResult = Schema.Struct({
  task: ScheduledTask,
});
export type ScheduledTaskMutationResult = typeof ScheduledTaskMutationResult.Type;

export const ScheduledTaskDeleteResult = Schema.Struct({
  id: ScheduledTaskId,
});
export type ScheduledTaskDeleteResult = typeof ScheduledTaskDeleteResult.Type;

export const ScheduledTaskRunNowResult = Schema.Struct({
  task: ScheduledTask,
});
export type ScheduledTaskRunNowResult = typeof ScheduledTaskRunNowResult.Type;

export class ScheduledTaskError extends Schema.TaggedError<ScheduledTaskError>()(
  "ScheduledTaskError",
  {
    message: Schema.String,
    taskId: Schema.optional(ScheduledTaskId),
    cause: Schema.optional(Schema.Defect()),
  },
) {}
