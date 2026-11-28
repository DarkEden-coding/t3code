import { assert, it } from "@effect/vitest";
import {
  MessageId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2DomainEvent,
  RunId,
  ThreadId,
  TURN_STAR_LIMIT,
  type TurnStarError,
  type TurnStarListResult,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as TurnStarService from "./TurnStarService.ts";

const THREAD = ThreadId.make("thread-star");
const RUN = RunId.make("run-star");

interface World {
  readonly runs: Map<RunId, string>;
  readonly messages: Array<OrchestrationV2ConversationMessage>;
  readonly titles: Map<ThreadId, string>;
}

const message = (
  id: string,
  input: { runId?: RunId; role?: "user" | "assistant"; text?: string; at?: number } = {},
): OrchestrationV2ConversationMessage => ({
  id: MessageId.make(id),
  threadId: THREAD,
  runId: input.runId ?? RUN,
  nodeId: null,
  role: input.role ?? "assistant",
  text: input.text ?? `Reply ${id}`,
  attachments: [],
  streaming: false,
  createdAt: DateTime.makeUnsafe(input.at ?? 0),
  updatedAt: DateTime.makeUnsafe(input.at ?? 0),
  createdBy: "agent",
  creationSource: "server",
});

const threadsLayer = (world: World, events: Queue.Queue<OrchestrationV2DomainEvent>) =>
  Layer.mock(ThreadManagement.ThreadManagementService)({
    getThreadRecords: (_threadId, _fields, filter) =>
      Effect.sync(() => ({
        runs: [...world.runs]
          .filter(([id]) => filter?.runIds?.includes(id) ?? true)
          .map(([id, status]) => ({ id, status })),
        messages: world.messages.filter(
          (candidate) =>
            candidate.runId !== null && (filter?.messageRunIds?.includes(candidate.runId) ?? true),
        ),
      })) as never,
    getMessagesById: (_threadId, ids) =>
      Effect.sync(
        () =>
          new Map(
            world.messages
              .filter((candidate) => ids.includes(candidate.id))
              .map((candidate) => [candidate.id, candidate]),
          ),
      ),
    getThreadTitles: (ids) =>
      Effect.sync(() => {
        const titles: Record<ThreadId, string> = {};
        for (const id of ids) {
          const title = world.titles.get(id);
          if (title !== undefined) titles[id] = title;
        }
        return titles;
      }),
    streamDomainEvents: Stream.fromQueue(events),
  });

const runEnded = (runId: RunId, status = "completed") =>
  ({ type: "run.updated", threadId: THREAD, payload: { id: runId, status } }) as never;

/** Runs `body` against a fresh service; `until` waits for the list to match. */
const withStars = <A, E, R>(
  world: World,
  body: (input: {
    readonly stars: TurnStarService.TurnStarServiceShape;
    readonly events: Queue.Queue<OrchestrationV2DomainEvent>;
    readonly until: (
      matches: (list: TurnStarListResult) => boolean,
    ) => Effect.Effect<TurnStarListResult, TurnStarError>;
  }) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
    return yield* Effect.gen(function* () {
      const stars = yield* TurnStarService.TurnStarService;
      const until = (matches: (list: TurnStarListResult) => boolean) =>
        stars
          .subscribe()
          .pipe(
            Stream.filter(matches),
            Stream.runHead,
            Effect.map(Option.getOrElse((): TurnStarListResult => ({ stars: [] }))),
          );
      return yield* body({ stars, events, until });
    }).pipe(Effect.provide(TurnStarService.layer.pipe(Layer.provide(threadsLayer(world, events)))));
  }).pipe(Effect.scoped);

const newWorld = (): World => ({
  runs: new Map([[RUN, "running"]]),
  messages: [],
  titles: new Map([[THREAD, "Fix the build"]]),
});

it.effect("an agent's star waits for the turn and lands on its final message", () => {
  const world = newWorld();
  return withStars(world, ({ stars, events, until }) =>
    Effect.gen(function* () {
      yield* stars.starRun({ threadId: THREAD, runId: RUN, note: "first" });
      yield* stars.starRun({ threadId: THREAD, runId: RUN, note: "Needs your review" });
      assert.deepEqual((yield* stars.list()).stars, []);

      world.messages.push(message("early", { at: 1 }), message("final", { at: 2 }));
      world.runs.set(RUN, "completed");
      yield* Queue.offer(events, runEnded(RUN));
      const { stars: listed } = yield* until((list) => list.stars.length > 0);
      assert.deepEqual(
        listed.map(({ messageId, note, threadTitle, starredBy, preview }) => ({
          messageId,
          note,
          threadTitle,
          starredBy,
          preview,
        })),
        [
          {
            messageId: MessageId.make("final"),
            note: "Needs your review",
            threadTitle: "Fix the build",
            starredBy: "agent",
            preview: "Reply final",
          },
        ],
      );
    }),
  ).pipe(Effect.provide(SqlitePersistence.layerMemory));
});

it.effect("a turn that ends without a reply drops its star", () => {
  const world = newWorld();
  return withStars(world, ({ stars, events, until }) =>
    Effect.gen(function* () {
      yield* stars.starRun({ threadId: THREAD, runId: RUN, note: undefined });
      world.runs.set(RUN, "failed");
      yield* Queue.offer(events, runEnded(RUN, "failed"));
      // Events run in order, so once a later turn's star lands the failed one was handled.
      world.runs.set(RunId.make("run-probe"), "running");
      yield* stars.starRun({ threadId: THREAD, runId: RunId.make("run-probe"), note: undefined });
      world.runs.set(RunId.make("run-probe"), "completed");
      world.messages.push(message("probe", { runId: RunId.make("run-probe") }));
      yield* Queue.offer(events, runEnded(RunId.make("run-probe")));
      const listed = yield* until((list) => list.stars.length > 0);
      assert.deepEqual(
        listed.stars.map(({ messageId }) => messageId),
        [MessageId.make("probe")],
      );
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ readonly star_key: string }>`SELECT star_key FROM turn_stars`;
      assert.deepEqual(
        rows.map((row) => row.star_key),
        ["message:probe"],
      );
    }),
  ).pipe(Effect.provide(SqlitePersistence.layerMemory));
});

it.effect("stars and unstars a message by hand, but only an assistant's", () => {
  const world = newWorld();
  world.messages.push(
    message("reply", { text: "## Summary\n\nAll green." }),
    message("ask", { role: "user" }),
  );
  return withStars(world, ({ stars }) =>
    Effect.gen(function* () {
      yield* stars.set({ threadId: THREAD, messageId: MessageId.make("reply"), starred: true });
      yield* stars.set({ threadId: THREAD, messageId: MessageId.make("reply"), starred: true });
      const listed = (yield* stars.list()).stars;
      assert.deepEqual(
        listed.map(({ messageId, starredBy, note, preview }) => ({
          messageId,
          starredBy,
          note,
          preview,
        })),
        [{ messageId: MessageId.make("reply"), starredBy: "user", note: null, preview: "Summary" }],
      );

      const refused = yield* Effect.exit(
        stars.set({ threadId: THREAD, messageId: MessageId.make("ask"), starred: true }),
      );
      assert.isTrue(Exit.isFailure(refused));

      yield* stars.set({ threadId: THREAD, messageId: MessageId.make("reply"), starred: false });
      assert.deepEqual((yield* stars.list()).stars, []);
    }),
  ).pipe(Effect.provide(SqlitePersistence.layerMemory));
});

it.effect("clear all removes every star and says how many", () => {
  const world = newWorld();
  world.messages.push(message("a"), message("b"));
  return withStars(world, ({ stars }) =>
    Effect.gen(function* () {
      yield* stars.set({ threadId: THREAD, messageId: MessageId.make("a"), starred: true });
      yield* stars.set({ threadId: THREAD, messageId: MessageId.make("b"), starred: true });
      assert.strictEqual((yield* stars.list()).stars.length, 2);
      assert.deepEqual(yield* stars.clearAll(), { cleared: 2 });
      assert.deepEqual((yield* stars.list()).stars, []);
    }),
  ).pipe(Effect.provide(SqlitePersistence.layerMemory));
});

it.effect("keeps the newest stars past the limit, newest first", () => {
  const world = newWorld();
  for (let index = 0; index <= TURN_STAR_LIMIT; index += 1)
    world.messages.push(message(`m${index}`));
  return withStars(world, ({ stars }) =>
    Effect.gen(function* () {
      for (let index = 0; index <= TURN_STAR_LIMIT; index += 1) {
        yield* stars.set({
          threadId: THREAD,
          messageId: MessageId.make(`m${index}`),
          starred: true,
        });
        yield* TestClock.adjust("1 second");
      }
      const listed = (yield* stars.list()).stars;
      assert.strictEqual(listed.length, TURN_STAR_LIMIT);
      assert.strictEqual(listed[0]?.messageId, MessageId.make(`m${TURN_STAR_LIMIT}`));
      assert.strictEqual(listed.at(-1)?.messageId, MessageId.make("m1"));
    }),
  ).pipe(Effect.provide(SqlitePersistence.layerMemory));
});

it.effect("stars survive a restart, and a turn that ended while down lands its star", () => {
  const world = newWorld();
  world.messages.push(message("kept", { runId: RunId.make("run-old") }));
  return Effect.gen(function* () {
    yield* withStars(world, ({ stars }) =>
      Effect.gen(function* () {
        yield* stars.set({ threadId: THREAD, messageId: MessageId.make("kept"), starred: true });
        yield* stars.starRun({ threadId: THREAD, runId: RUN, note: "Done" });
      }),
    );
    world.messages.push(message("final"));
    world.runs.set(RUN, "completed");
    yield* withStars(world, ({ until }) =>
      Effect.gen(function* () {
        const listed = (yield* until((list) => list.stars.length === 2)).stars;
        assert.deepEqual(listed.map(({ messageId }) => messageId).toSorted(), [
          MessageId.make("final"),
          MessageId.make("kept"),
        ]);
      }),
    );
  }).pipe(Effect.provide(SqlitePersistence.layerMemory));
});

it.effect("a deleted thread's stars leave the list; renamed threads show the new title", () => {
  const world = newWorld();
  const other = ThreadId.make("thread-gone");
  world.titles.set(other, "Gone soon");
  world.messages.push(message("here"), { ...message("there"), threadId: other });
  return withStars(world, ({ stars }) =>
    Effect.gen(function* () {
      yield* stars.set({ threadId: THREAD, messageId: MessageId.make("here"), starred: true });
      yield* stars.set({ threadId: other, messageId: MessageId.make("there"), starred: true });
      world.titles.delete(other);
      world.titles.set(THREAD, "Fix the build (renamed)");
      const listed = (yield* stars.list()).stars;
      assert.deepEqual(
        listed.map(({ messageId, threadTitle }) => ({ messageId, threadTitle })),
        [{ messageId: MessageId.make("here"), threadTitle: "Fix the build (renamed)" }],
      );
    }),
  ).pipe(Effect.provide(SqlitePersistence.layerMemory));
});

it("previews the first line of text without markdown markers", () => {
  assert.strictEqual(TurnStarService.starPreview("\n\n### Done\nmore"), "Done");
  assert.strictEqual(TurnStarService.starPreview("```ts\nconst a = 1;\n```"), "const a = 1;");
  assert.strictEqual(TurnStarService.starPreview("- [x] item"), "[x] item");
  assert.strictEqual(TurnStarService.starPreview("x".repeat(400)).length, 160);
});
