import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import { EnvironmentAuthorizationError } from "./auth.ts";
import { IsoDateTime, MessageId, NonNegativeInt, RunId, ThreadId } from "./baseSchemas.ts";

/** Stars kept per environment; starring past it drops the oldest. */
export const TURN_STAR_LIMIT = 200;
export const TurnStarNote = Schema.String.check(Schema.isMaxLength(120));

/** A starred assistant message. An agent's star appears once its turn has a final message. */
export const TurnStar = Schema.Struct({
  messageId: MessageId,
  threadId: ThreadId,
  runId: Schema.NullOr(RunId),
  /** The thread's title when the list was read; clients prefer the live one. */
  threadTitle: Schema.String,
  note: Schema.NullOr(Schema.String),
  /** The message's first line, for an item without a note. */
  preview: Schema.String,
  starredBy: Schema.Literals(["agent", "user"]),
  starredAt: IsoDateTime,
});
export type TurnStar = typeof TurnStar.Type;

/** Newest first. */
export const TurnStarListResult = Schema.Struct({ stars: Schema.Array(TurnStar) });
export type TurnStarListResult = typeof TurnStarListResult.Type;

export const TurnStarSubscribeInput = Schema.Struct({});
export const TurnStarSetInput = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  starred: Schema.Boolean,
});
export type TurnStarSetInput = typeof TurnStarSetInput.Type;
export const TurnStarClearAllInput = Schema.Struct({});
export const TurnStarClearAllResult = Schema.Struct({ cleared: NonNegativeInt });

export class TurnStarError extends Schema.TaggedError<TurnStarError>()("TurnStarError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export const TURN_STAR_WS_METHODS = {
  turnStarsSubscribe: "turnStars.subscribe",
  turnStarsSet: "turnStars.set",
  turnStarsClearAll: "turnStars.clearAll",
} as const;

const error = Schema.Union([TurnStarError, EnvironmentAuthorizationError]);
export const TurnStarRpcs = [
  Rpc.make(TURN_STAR_WS_METHODS.turnStarsSubscribe, {
    payload: TurnStarSubscribeInput,
    success: TurnStarListResult,
    error,
    stream: true,
  }),
  Rpc.make(TURN_STAR_WS_METHODS.turnStarsSet, { payload: TurnStarSetInput, error }),
  Rpc.make(TURN_STAR_WS_METHODS.turnStarsClearAll, {
    payload: TurnStarClearAllInput,
    success: TurnStarClearAllResult,
    error,
  }),
] as const;
