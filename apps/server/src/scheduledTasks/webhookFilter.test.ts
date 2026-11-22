import { assert, describe, it } from "@effect/vitest";
import { MAX_FILTER_MATCH_INPUT_LENGTH } from "@t3tools/contracts";

import { findFailedWebhookFilter } from "./webhookFilter.ts";
import type { WebhookRequest } from "./webhookTemplate.ts";

const issueComment: WebhookRequest = {
  method: "POST",
  path: "/api/hooks/task-1",
  query: "",
  headers: { "content-type": "application/json", "x-github-event": "issue_comment" },
  bodyText: JSON.stringify({
    action: "created",
    issue: { number: 7, labels: [{ name: "bug" }, { name: "needs more info" }], assignees: [] },
    comment: { user: { login: "reporter", type: "User" } },
  }),
};

describe("findFailedWebhookFilter", () => {
  it("matches exists on wildcard object values", () => {
    assert.isNull(
      findFailedWebhookFilter([{ path: "body.issue.labels[]", op: "exists" }], issueComment),
    );
    assert.isNull(
      findFailedWebhookFilter([{ path: "body.issues[].labels", op: "exists" }], {
        ...issueComment,
        bodyText: JSON.stringify({ issues: [{ labels: [] }] }),
      }),
    );
  });

  it("rejects exists when wildcard values are all null or missing", () => {
    assert.deepEqual(
      findFailedWebhookFilter([{ path: "body.issues[].labels", op: "exists" }], {
        ...issueComment,
        bodyText: JSON.stringify({ issues: [{ labels: null }, {}] }),
      }),
      { index: 0, path: "body.issues[].labels" },
    );
  });

  it("matches a wildcard path when any element matches", () => {
    assert.isNull(
      findFailedWebhookFilter(
        [
          { path: "body.issue.labels[].name", op: "equals", value: "needs more info" },
          { path: "body.issue.labels[].name", op: "in", value: ["needs more info", "triage"] },
          { path: "body.issue.labels[].name", op: "startsWith", value: "needs" },
          { path: "body.issue.labels[].name", op: "matches", value: "^needs\\s+more" },
          { path: "body.issue.labels[].name", op: "exists" },
        ],
        issueComment,
      ),
    );
    assert.deepEqual(
      findFailedWebhookFilter(
        [{ path: "body.issue.labels[].name", op: "equals", value: "wontfix" }],
        issueComment,
      ),
      { index: 0, path: "body.issue.labels[].name" },
    );
  });

  it("fails notEquals on a wildcard path when any element equals the value", () => {
    assert.deepEqual(
      findFailedWebhookFilter(
        [{ path: "body.issue.labels[].name", op: "notEquals", value: "bug" }],
        issueComment,
      ),
      { index: 0, path: "body.issue.labels[].name" },
    );
    assert.isNull(
      findFailedWebhookFilter(
        [{ path: "body.issue.labels[].name", op: "notEquals", value: "wontfix" }],
        issueComment,
      ),
    );
  });

  it("treats an empty or missing wildcard list as nothing to match", () => {
    assert.deepEqual(
      findFailedWebhookFilter(
        [{ path: "body.issue.assignees[].login", op: "exists" }],
        issueComment,
      ),
      { index: 0, path: "body.issue.assignees[].login" },
    );
    assert.isNull(
      findFailedWebhookFilter(
        [{ path: "body.issue.assignees[].login", op: "notEquals", value: "anyone" }],
        issueComment,
      ),
    );
    assert.deepEqual(
      findFailedWebhookFilter([{ path: "body.issue.number[].x", op: "exists" }], issueComment),
      { index: 0, path: "body.issue.number[].x" },
    );
  });

  it("tests a regex against at most the capped input length", () => {
    const longBody = {
      ...issueComment,
      bodyText: JSON.stringify({ text: `${"a".repeat(MAX_FILTER_MATCH_INPUT_LENGTH)}b` }),
    };
    assert.deepEqual(
      findFailedWebhookFilter([{ path: "body.text", op: "matches", value: "b$" }], longBody),
      { index: 0, path: "body.text" },
    );
  });

  it("still compares scalars without a wildcard", () => {
    assert.isNull(
      findFailedWebhookFilter(
        [
          { path: "body.action", op: "equals", value: "created" },
          { path: "body.comment.user.type", op: "notEquals", value: "Bot" },
          { path: "body.issue.number", op: "matches", value: "^\\d+$" },
        ],
        issueComment,
      ),
    );
    assert.deepEqual(
      findFailedWebhookFilter(
        [{ path: "body.comment.user.login", op: "matches", value: "^bot-" }],
        issueComment,
      ),
      { index: 0, path: "body.comment.user.login" },
    );
    // A list without a wildcard in the path only satisfies exists.
    assert.deepEqual(
      findFailedWebhookFilter(
        [{ path: "body.issue.labels", op: "equals", value: "bug" }],
        issueComment,
      ),
      { index: 0, path: "body.issue.labels" },
    );
  });
});
