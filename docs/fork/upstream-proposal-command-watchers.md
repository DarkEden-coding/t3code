# Idea: command watchers, a `watch` trigger for scheduled tasks

Draft for a T3 Code Ideas discussion. Not posted.

## Problem

Agents often need to wake when something changes outside T3 Code: a new DM, a CI run going red, a new file in a folder, a new row in a queue. Today there are two options. A webhook needs a service that can call T3, and usually a public URL. An interval task spends a model turn on every check, even when nothing changed, which costs money and fills the thread with "nothing new" runs.

## Proposal

Add a fifth scheduled-task trigger, `watch`. T3 runs a shell command in the project folder every N minutes (1 minute minimum) with no model. The task's prompt runs only when the output changes.

- **New items:** read a JSON array, at a path or the whole output, and run for ids not seen before.
- **A changed value:** compare a value at a path, or the whole output: JSON by content, other text exactly.
- The first poll only records a baseline.
- Filters reuse the webhook filter rules, plus a `matches` regex test.
- `{{items}}`, `{{value}}` and `{{previous}}` reach the agent framed as untrusted data, like webhook values. One run gets at most 50 items.
- Tokens go in per-task env vars, not the command: a literal value, a `request_secret` ref stored in the server secret store, or a secret-provider reference read at each poll. Deleting the task deletes them.
- A failing command never counts as a change. The thread hears once at the 3rd failure in a row and once when it recovers.
- Over MCP, only full-access agents can create watchers, since a watcher runs a command unattended. People can create them in Settings on web, desktop and mobile.

It reuses scheduled task storage, the scheduler tick and the normal run path. Quiet polls push nothing to clients.

## Open questions

- Should watcher state live in a numbered migration upstream? The fork creates its table at startup to avoid colliding with upstream migration ids.
- Is full access the right bar for MCP-created watchers, or should it follow the caller's runtime mode?

Working implementation in a fork, with tests, evals, docs and both clients: https://github.com/DarkEden-coding/t3code/pull/1
