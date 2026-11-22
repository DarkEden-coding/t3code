import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  MAX_FILTER_PATTERN_LENGTH,
  MAX_WATCH_TIMEOUT_MS,
  MIN_SCHEDULED_TASK_INTERVAL_MS,
  ScheduledTaskSchedule,
  ScheduledTaskUpsertSchedule,
} from "./scheduledTask.ts";

const decodeSchedule = Schema.decodeUnknownSync(ScheduledTaskSchedule);
const decodeUpsertSchedule = Schema.decodeUnknownSync(ScheduledTaskUpsertSchedule);

describe("ScheduledTaskSchedule", () => {
  it("keeps legacy sub-minute persisted schedules readable", () => {
    expect(
      decodeSchedule({
        type: "interval",
        everyMs: MIN_SCHEDULED_TASK_INTERVAL_MS - 1,
      }),
    ).toEqual({
      type: "interval",
      everyMs: MIN_SCHEDULED_TASK_INTERVAL_MS - 1,
    });
  });

  it("accepts a one-time run only with an offset", () => {
    for (const runAt of ["2026-11-03T09:00Z", "2026-11-03T09:00:00.000-08:00"]) {
      expect(decodeUpsertSchedule({ type: "once", runAt })).toEqual({ type: "once", runAt });
    }
    for (const runAt of [
      "2026-11-03T09:00",
      "2026-13-03T09:00Z",
      "2026-02-30T09:00Z",
      "9999-12-31T23:30-01:00",
      "0000-01-01T00:00+00:01",
      "tomorrow",
    ]) {
      expect(() => decodeUpsertSchedule({ type: "once", runAt })).toThrow();
    }
  });
});

it.each(["literal", " ", "\t\n", "{{body.bad", "{{unknown.field}}"])(
  "rejects invalid dedupe template %s",
  (replayKey) => {
    expect(() => decodeUpsertSchedule({ type: "webhook", dedupe: { replayKey } })).toThrow();
    expect(() =>
      decodeUpsertSchedule({ type: "webhook", dedupe: { coalesceKey: replayKey } }),
    ).toThrow();
  },
);
describe("webhook filters", () => {
  const accepts = (filters: unknown) => {
    try {
      decodeUpsertSchedule({ type: "webhook", filters });
      return true;
    } catch {
      return false;
    }
  };

  it("rejects empty or unknown paths, unknown ops, and values that do not fit the op", () => {
    expect(accepts([{ path: "", op: "exists" }])).toBe(false);
    expect(accepts([{ path: "  ", op: "exists" }])).toBe(false);
    expect(accepts([{ path: "request", op: "exists" }])).toBe(false);
    expect(accepts([{ path: "header.x-github-event", op: "exists" }])).toBe(false);
    expect(accepts([{ path: "body.action", op: "in", value: "opened" }])).toBe(false);
    expect(accepts([{ path: "body.action", op: "in", value: [] }])).toBe(false);
    for (const value of ["", " opened", "opened ", "a,b"]) {
      expect(accepts([{ path: "body.action", op: "in", value: [value] }])).toBe(false);
    }
    expect(accepts([{ path: "body.label.name", op: "in", value: ["needs review"] }])).toBe(true);
    expect(accepts([{ path: "body.action", op: "equals" }])).toBe(false);
    expect(accepts([{ path: "body.action", op: "contains", value: "opened" }])).toBe(false);
  });

  it("accepts a regex only when it compiles and fits the length cap", () => {
    expect(accepts([{ path: "body.action", op: "matches", value: "^opened$" }])).toBe(true);
    expect(accepts([{ path: "body.action", op: "matches", value: "(" }])).toBe(false);
    expect(accepts([{ path: "body.action", op: "matches", value: "" }])).toBe(false);
    expect(
      accepts([
        { path: "body.action", op: "matches", value: "a".repeat(MAX_FILTER_PATTERN_LENGTH + 1) },
      ]),
    ).toBe(false);
  });
});

describe("watch schedules", () => {
  const watch = { type: "watch", everyMs: 60_000, command: "./list.sh", mode: "items" };
  const accepts = (schedule: object) => {
    try {
      decodeUpsertSchedule({ ...watch, ...schedule });
      return true;
    } catch {
      return false;
    }
  };

  it("checks the poll interval, timeout and filters", () => {
    expect(accepts({})).toBe(true);
    expect(accepts({ everyMs: 59_999 })).toBe(false);
    expect(accepts({ timeoutMs: MAX_WATCH_TIMEOUT_MS + 1 })).toBe(false);
    expect(accepts({ mode: "lines" })).toBe(false);
    expect(accepts({ filters: [{ path: "user", op: "equals", value: "U1" }] })).toBe(true);
    expect(accepts({ filters: [{ path: ".", op: "matches", value: "[" }] })).toBe(false);
  });

  it("takes each env variable once, as a value, a secret ref, a reference or a kept value", () => {
    expect(
      accepts({
        env: [
          { name: "TOKEN", secretRef: "ref-1" },
          { name: "CHANNEL", value: "C1" },
          { name: "OP_TOKEN", reference: { provider: "1password", reference: "op://v/i/f" } },
          { name: "KEPT", secret: true },
        ],
      }),
    ).toBe(true);
    expect(accepts({ env: [{ name: "A" }, { name: "A", value: "x" }] })).toBe(false);
    expect(accepts({ env: [{ name: "1BAD", value: "x" }] })).toBe(false);
  });
});
