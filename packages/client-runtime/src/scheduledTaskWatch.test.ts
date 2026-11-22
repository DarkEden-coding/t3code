import { describe, expect, it } from "vite-plus/test";

import { emptyWatchEnvDraft, watchDraft, watchScheduleFromDraft } from "./scheduledTaskWatch.ts";

const draft = { ...watchDraft(undefined), command: "./dms.sh" };

describe("watchScheduleFromDraft", () => {
  it("saves a new variable only with a value and a valid, unique name", () => {
    const token = { ...emptyWatchEnvDraft(), name: "TOKEN", value: "xoxp" };
    expect(watchScheduleFromDraft({ ...draft, env: [token] }, 60_000, [])).toMatchObject({
      schedule: { env: [{ name: "TOKEN", value: "xoxp", secret: true }] },
    });
    for (const env of [
      [{ ...token, value: "" }],
      [{ ...token, name: "1TOKEN" }],
      [token, { ...token, id: "other" }],
    ]) {
      expect(watchScheduleFromDraft({ ...draft, env }, 60_000, [])).toHaveProperty("error");
    }
  });

  it("checks the command, timeout and filters", () => {
    expect(watchScheduleFromDraft({ ...draft, command: " " }, 60_000, [])).toHaveProperty("error");
    for (const timeoutSeconds of ["0", "301", "abc"]) {
      expect(watchScheduleFromDraft({ ...draft, timeoutSeconds }, 60_000, [])).toHaveProperty(
        "error",
      );
    }
    expect(
      watchScheduleFromDraft(draft, 60_000, [{ id: "f", path: "user", op: "matches", value: "(" }]),
    ).toHaveProperty("error");
    expect(
      watchScheduleFromDraft(
        { ...draft, mode: "value", idPath: "id", timeoutSeconds: "90" },
        60_000,
        [],
      ),
    ).toEqual({
      schedule: {
        type: "watch",
        everyMs: 60_000,
        command: "./dms.sh",
        mode: "value",
        timeoutMs: 90_000,
        filters: [],
        env: [],
      },
    });
  });
});
