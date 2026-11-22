You are resolving a merge of upstream T3 Code (pingdotgg/t3code `main`) into Elliot's personal fork (`main`).
The merge is in progress in this checkout. `git diff --name-only --diff-filter=U` lists the conflicted files.

Rules:

- Upstream is the base truth. Keep every upstream change unless it directly collides with a fork change.
- Keep the intent of each fork change. Fork changes are the commits in `git log --no-merges upstream/main..HEAD`
  and `.github/fork/FORK_CHANGES.md` describes them. When upstream refactored code a fork
  change touched, re-apply the fork change on top of the new upstream shape instead of reverting the refactor.
- Fork-only files (`.github/workflows/fork-*.yml`, `.github/fork/**`, `apps/desktop/src/fork/**`) always keep the
  fork version.
- For `pnpm-lock.yaml`, take upstream's version, then run `vp install` to regenerate it. Never hand-edit it.
- Do not disable, skip, or delete tests to make things pass. Do not weaken types with `any` or casts.
- Do not touch files that are not conflicted unless a resolution requires it, such as a renamed import.

When every conflict is resolved:

1. Run `node scripts/check-changed.ts upstream/main` and fix what it reports.
2. `git add` the resolved files and run `git commit --no-edit` to finish the merge.
3. Print a short summary: each conflicted file, what you kept from each side, and anything you were unsure about.

If a conflict cannot be resolved without guessing at Elliot's intent, stop without committing, and print
`SYNC-BLOCKED:` followed by the file and the question for Elliot.
