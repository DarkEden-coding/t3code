import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, MessageId, TurnStar } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import { environmentSummaries } from "./presentation";
import { environmentServerConfigsAtom, serverEnvironment } from "./server";

export interface EnvironmentTurnStar extends TurnStar {
  readonly environmentId: EnvironmentId;
}

const NO_STARS: ReadonlyArray<EnvironmentTurnStar> = [];

/** An older server has no star RPCs, so it is never subscribed. */
const environmentStarsAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): ReadonlyArray<EnvironmentTurnStar> => {
    const config = get(environmentServerConfigsAtom).get(environmentId);
    if (config?.environment.capabilities.turnStars !== true) return NO_STARS;
    const result = get(serverEnvironment.turnStarsLive({ environmentId, input: {} }));
    const stars = AsyncResult.getOrElse(result, () => null)?.stars;
    return stars === undefined ? NO_STARS : stars.map((star) => ({ ...star, environmentId }));
  }).pipe(Atom.withLabel(`turn-stars:${environmentId}`)),
);

const starredMessageIdsAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(
    (get): ReadonlySet<MessageId> =>
      new Set(get(environmentStarsAtom(environmentId)).map((star) => star.messageId)),
  ).pipe(Atom.withLabel(`turn-stars:ids:${environmentId}`)),
);

const supportsTurnStarsAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(
    (get) =>
      get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities.turnStars ===
      true,
  ),
);

/** Every connected environment's stars, newest first. */
const allStarsAtom = Atom.make((get) =>
  get(environmentSummaries.connectedEnvironmentIdsAtom)
    .flatMap((environmentId) => get(environmentStarsAtom(environmentId)))
    .toSorted((left, right) => right.starredAt.localeCompare(left.starredAt)),
).pipe(Atom.withLabel("turn-stars:all"));

export function useAllTurnStars(): ReadonlyArray<EnvironmentTurnStar> {
  return useAtomValue(allStarsAtom);
}

const NO_STARRED_IDS: ReadonlySet<MessageId> = new Set();
const NO_STARRED_IDS_ATOM = Atom.make(NO_STARRED_IDS);

export function useMessageStarred(
  environmentId: EnvironmentId | null,
  messageId: MessageId,
): boolean {
  return useAtomValue(
    environmentId === null ? NO_STARRED_IDS_ATOM : starredMessageIdsAtom(environmentId),
    (ids) => ids.has(messageId),
  );
}

/** Environments whose stars this client may remove. */
const writableStarEnvironmentIdsAtom = Atom.make((get): ReadonlySet<EnvironmentId> => {
  const ids = get(environmentSummaries.connectedEnvironmentIdsAtom).filter((environmentId) =>
    get(serverEnvironment.setTurnStar.permissionAtom(environmentId)),
  );
  return new Set(ids);
}).pipe(Atom.withLabel("turn-stars:writable"));

export function useWritableStarEnvironmentIds(): ReadonlySet<EnvironmentId> {
  return useAtomValue(writableStarEnvironmentIdsAtom);
}

export function useSupportsTurnStars(environmentId: EnvironmentId): boolean {
  return useAtomValue(supportsTurnStarsAtom(environmentId));
}
