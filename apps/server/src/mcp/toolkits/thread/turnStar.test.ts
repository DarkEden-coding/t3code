import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/ai";

import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ThreadSearch from "../../../orchestration-v2/ThreadSearch.ts";
import * as PeerForwarding from "../../../peer/PeerForwarding.ts";
import * as PeerLinkRequests from "../../../peer/PeerLinkRequests.ts";
import * as PeerLinks from "../../../peer/PeerLinks.ts";
import * as ProviderRegistry from "../../../provider/ProviderRegistry.ts";
import * as ScheduledTaskService from "../../../scheduledTasks/ScheduledTaskService.ts";
import * as TurnStarService from "../../../turnStars/TurnStarService.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccessTestkit from "../../McpToolAccess.testkit.ts";

const threadId = ThreadId.make("turn-star-thread");
const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("turn-star-environment"),
  requestNamespace: "turn-star-session",
  thread: {
    threadId,
    providerSessionId: "turn-star-session",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  issuedAt: 0,
  capabilities: new Set(["orchestration"]),
};
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "turn-star", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "turn-star", version: "1" },
  },
  getClient: Effect.die("unused"),
});

const declaredFailure = (result: McpSchema.CallToolResult) => {
  const text = result.content[0];
  return result.isError === true && text?.type === "text" ? JSON.parse(text.text) : undefined;
};

const withTool = (activeRunId: RunId | null) => {
  const starred: Array<{ threadId: ThreadId; runId: RunId; note: string | undefined }> = [];
  const layer = McpHttpServer.layerThreadToolkit.pipe(
    Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
    Layer.provide(NodeCrypto.layer),
    Layer.provide(
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: (id) =>
          Effect.succeed(McpToolAccessTestkit.liveThreadShell(id, { activeRunId })),
      }),
    ),
    Layer.provide(
      Layer.succeed(TurnStarService.TurnStarService, {
        ...TurnStarService.TurnStarService.defaultValue(),
        starRun: (input) => Effect.sync(() => void starred.push(input)),
      }),
    ),
    Layer.provide(Layer.mock(ThreadSearch.ThreadSearch)({})),
    Layer.provide(Layer.mock(ScheduledTaskService.ScheduledTaskService)({})),
    Layer.provide(Layer.mock(PeerForwarding.PeerForwarding)({})),
    Layer.provide(Layer.mock(PeerLinkRequests.PeerLinkRequests)({})),
    Layer.provide(Layer.mock(PeerLinks.PeerLinks)({})),
    Layer.provide(
      Layer.mock(ProviderRegistry.ProviderRegistry)({ getProviders: Effect.succeed([]) }),
    ),
  );
  const call = (args: Record<string, unknown>) =>
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      return yield* server
        .callTool({ name: "t3_turn_star", arguments: args })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
    });
  return { starred, layer, call };
};

it.effect("stars the caller's running turn, and a second call passes the new note", () => {
  const runId = RunId.make("run:turn-star");
  const { starred, layer, call } = withTool(runId);
  return Effect.gen(function* () {
    const first = yield* call({ note: "Needs review" });
    expect(first.isError).not.toBe(true);
    expect(first.structuredContent).toEqual({ starred: true });
    yield* call({ note: "Ready to merge" });
    expect(starred).toEqual([
      { threadId, runId, note: "Needs review" },
      { threadId, runId, note: "Ready to merge" },
    ]);
  }).pipe(Effect.provide(layer));
});

it.effect("refuses when the thread has no running turn", () => {
  const { starred, layer, call } = withTool(null);
  return Effect.gen(function* () {
    const result = yield* call({});
    expect(declaredFailure(result)).toMatchObject({ code: "parent_not_active" });
    expect(starred).toEqual([]);
  }).pipe(Effect.provide(layer));
});

it.effect("rejects a note longer than the list shows", () => {
  const { starred, layer, call } = withTool(RunId.make("run:turn-star"));
  return Effect.gen(function* () {
    const error = yield* Effect.flip(call({ note: "x".repeat(121) }));
    expect(error).toMatchObject({ _tag: "InvalidParams" });
    expect(starred).toEqual([]);
  }).pipe(Effect.provide(layer));
});
