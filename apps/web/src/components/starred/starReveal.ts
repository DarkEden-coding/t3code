import { type EnvironmentId, MessageId, type ThreadId } from "@t3tools/contracts";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Result from "effect/Result";

import { randomUUID } from "~/lib/utils";
import type { AssistantCitationRequest } from "../chat/AssistantCitationSource";

const STAR_HASH_PREFIX = "starred-message=";

/** Opens the thread at the starred message; a fresh activation reveals it again on every click. */
export function starRevealNavigation(star: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
}) {
  return {
    to: "/$environmentId/$threadId" as const,
    params: { environmentId: star.environmentId, threadId: star.threadId },
    hash: `${STAR_HASH_PREFIX}${Base64Url.encode(star.threadId)}.${Base64Url.encode(star.messageId)}`,
    resetScroll: false,
    state: { assistantCitationActivation: randomUUID() },
  };
}

/** Reuses the citation reveal, which pages history toward the message, without a quote. */
export function starRevealRequest(
  href: string,
  key: string,
  environmentId: EnvironmentId,
  threadId: ThreadId,
): AssistantCitationRequest | null {
  const hashIndex = href.indexOf("#");
  if (hashIndex === -1 || !href.startsWith(STAR_HASH_PREFIX, hashIndex + 1)) return null;
  const [encodedThreadId = "", encodedMessageId = ""] = href
    .slice(hashIndex + 1 + STAR_HASH_PREFIX.length)
    .split(".");
  const decode = (value: string) => Result.getOrElse(Base64Url.decodeString(value), () => "");
  const messageId = decode(encodedMessageId);
  // The route renders the previous thread for a moment after the hash changes.
  if (decode(encodedThreadId) !== threadId || messageId.length === 0) return null;
  return {
    key,
    revealOnly: true,
    citation: {
      version: 1,
      environmentId,
      threadId,
      messageId: MessageId.make(messageId),
      text: "",
      start: 0,
      end: 0,
      prefix: "",
      suffix: "",
    },
  };
}
