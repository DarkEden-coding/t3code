import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { starRevealNavigation, starRevealRequest } from "./starReveal";

const environmentId = EnvironmentId.make("environment-1");
const threadId = ThreadId.make("thread:project:1");
const messageId = MessageId.make("message:provider:turn:1:assistant:1");

const hrefFor = (star: { threadId: ThreadId; messageId: MessageId }) => {
  const navigation = starRevealNavigation({ environmentId, ...star });
  return `http://localhost/${environmentId}/${navigation.params.threadId}#${navigation.hash}`;
};

describe("starReveal", () => {
  it("reveals the starred message on its own thread without quoting text", () => {
    const request = starRevealRequest(
      hrefFor({ threadId, messageId }),
      "key",
      environmentId,
      threadId,
    );
    expect(request).toMatchObject({
      key: "key",
      revealOnly: true,
      citation: { environmentId, threadId, messageId },
    });
  });

  it("ignores the hash while the previous thread is still rendered", () => {
    const href = hrefFor({ threadId, messageId });
    expect(starRevealRequest(href, "key", environmentId, ThreadId.make("thread:other"))).toBeNull();
  });

  it("ignores other hashes and malformed stars", () => {
    expect(starRevealRequest("http://localhost/a/b", "key", environmentId, threadId)).toBeNull();
    expect(
      starRevealRequest("http://localhost/a/b#starred-message=", "key", environmentId, threadId),
    ).toBeNull();
    expect(
      starRevealRequest(
        "http://localhost/a/b#assistant-citation=x",
        "key",
        environmentId,
        threadId,
      ),
    ).toBeNull();
  });
});
