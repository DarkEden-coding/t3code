# Daily upstream merge

A T3 Code agent on power-server runs this once a day from a scheduled task. It brings `main` up to
upstream's newest published nightly. A green push to `main` starts `fork-release.yml`, which builds
and publishes the fork nightly. Nothing else in GitHub Actions merges or schedules anything.

Work in a dedicated clone with `origin` = `DarkEden-coding/t3code` and `upstream` = `pingdotgg/t3code`.
`gh` must be signed in as DarkEden-coding.

power-server's Vite+ runs in system-first mode, so `node` is the system's, which is older than the
pinned one. Start every shell that runs `vp` or `node` with this, from the repo root:

```sh
. ~/.config/vite-plus/env
v="$(node -p 'require("./package.json").engines.node')"
vp env install "$v" >/dev/null && export PATH="$HOME/.local/share/vite-plus/js_runtime/node/$v/bin:$PATH"
```

## Steps

1. **Start clean.** `git status --porcelain` must be empty. Then `git fetch origin`, `git checkout main`,
   `git merge --ff-only origin/main`.
2. **Mirror upstream.** `git fetch --no-tags upstream main`, then
   `git push origin refs/remotes/upstream/main:refs/heads/upstream` (never force it).
3. **Pick the target.** The newest published upstream nightly, not upstream `main` HEAD:
   ```sh
   tag="$(git ls-remote --tags --refs upstream 'refs/tags/v*-nightly.*' | awk '{print $2}' | sed 's#^refs/tags/##' | sort -V | tail -n 1)"
   git fetch --no-tags upstream "refs/tags/$tag:refs/upstream-nightly/$tag"
   target="$(git rev-parse "refs/upstream-nightly/$tag^{commit}")"
   ```
   If `git merge-base --is-ancestor "$target" HEAD` succeeds, main is up to date: stop here.
4. **Merge** (never rebase): `git checkout -b "sync/$(date -u +%Y%m%d)"`, then
   `git merge --no-ff --no-edit -m "Merge upstream $tag into main" "$target"`.
5. **Resolve conflicts**, if any:
   - Upstream is the base truth. Keep every upstream change unless it directly collides with a fork change.
   - Keep the intent of each fork change. Fork changes are the commits in `git log --no-merges "$target"..HEAD`,
     and [FORK_CHANGES.md](FORK_CHANGES.md) describes them. When upstream refactored code a fork change touched,
     re-apply the fork change on the new upstream shape instead of reverting the refactor.
   - Fork-only files (`.github/workflows/fork-*.yml`, `.github/fork/**`, `scripts/disable-upstream-workflows.sh`)
     always keep the fork version.
   - For `pnpm-lock.yaml`, take upstream's version, then run `vp install` to regenerate it. Never hand-edit it.
   - Don't touch files that aren't conflicted unless a resolution needs it, such as a renamed import.
   - Finish with `git add` and `git commit --no-edit`.
6. **Validate**, the same checks as `fork-ci.yml`:
   ```sh
   vp install
   vp run --filter @t3tools/desktop ensure:electron
   node scripts/check-changed.ts "$target"
   vp run build:desktop
   ```
   If a check fails because upstream reshaped an API a fork change uses, fix it with the smallest change
   that keeps both sides, commit it as `fork-sync: adapt fork changes to upstream <short sha>`, and rerun
   every check. If the failure is in upstream code the fork doesn't touch, don't fix it: that's an
   upstream breakage, so stop.
7. **Push** only when every check is green:
   - No commit may carry a `Co-Authored-By` or other AI attribution trailer:
     `git log --first-parent --format=%B origin/main..HEAD | grep -i co-authored-by` must print nothing
     (`--first-parent` skips upstream's own commits, many of which have one).
   - `git push origin HEAD:refs/heads/main` (a fast-forward; never force).
   - `sh scripts/disable-upstream-workflows.sh DarkEden-coding/t3code`. New upstream workflows arrive enabled.
   - Check that a `Fork release` run started for the pushed commit:
     `gh run list --repo DarkEden-coding/t3code --workflow fork-release.yml --limit 1`.
   - `git checkout main && git merge --ff-only origin/main`, and delete the local sync branch.

## When it can't finish

Never push `main` unless the merge is clean and every check is green. Never disable, skip, or delete tests,
lint rules, or type checks, and never weaken types with `any` or casts to get there. If a conflict can't
be resolved without guessing at Elliot's intent, or a check stays red, stop. Leave the attempt on its local
`sync/<date>` branch, return the clone to `main` (`git merge --abort` if a merge is still in progress), and
report the tag, the failing step, the conflicted or failing files, and the error.

## Updating the installed apps

Nothing updates T3 automatically. A new nightly shows up in each machine's update check, and Elliot
clicks Update, which restarts T3 on every machine. power-server's old `t3-nightly-update.timer` (it ran
`t3 update --channel nightly --yes`) is disabled but still installed. To turn it back on:
`systemctl --user enable --now t3-nightly-update.timer`.
