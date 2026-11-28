import { useAtomValue } from "@effect/atom-react";
import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, MessageId, ScopedThreadRef, TurnStar } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

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

/** One thread's stars, newest first, as the server sends them. */
const threadStarsAtom = Atom.family((key: string) =>
  Atom.make((get) => {
    const ref = parseScopedThreadKey(key);
    return ref === null
      ? NO_STARS
      : get(environmentStarsAtom(ref.environmentId)).filter(
          (star) => star.threadId === ref.threadId,
        );
  }).pipe(Atom.withLabel(`turn-stars:thread:${key}`)),
);

export function useThreadTurnStars(thread: ScopedThreadRef): ReadonlyArray<EnvironmentTurnStar> {
  return useAtomValue(threadStarsAtom(scopedThreadKey(thread)));
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

export function useStarredMessageIds(environmentId: EnvironmentId | null): ReadonlySet<MessageId> {
  return useAtomValue(
    environmentId === null ? NO_STARRED_IDS_ATOM : starredMessageIdsAtom(environmentId),
  );
}

export function useSupportsTurnStars(environmentId: EnvironmentId): boolean {
  return useAtomValue(supportsTurnStarsAtom(environmentId));
}
