#!/bin/sh
# Disables every workflow in the fork except the fork's own (files named fork-*.yml) and the reusable release-desktop.yml,
# re-enables any fork-*.yml workflow that is not active, and cancels upstream workflow runs that slipped through.
# Upstream workflows stay in the tree unchanged, so merges never conflict on them,
# but they need Blacksmith runners and upstream secrets, so they must not run here.
# New upstream workflows arrive enabled and run on the push that adds them, so the upstream
# merge (.github/fork/merge-upstream.md) runs this right after every push to main.
#   usage: disable-upstream-workflows.sh <owner/repo>
set -eu
repo="$1"
gh workflow list --repo "$repo" --all --limit 200 --json path,state --jq '.[] | "\(.state) \(.path)"' |
  while read -r state path; do
    case "$path" in
      .github/workflows/fork-*)
        if [ "$state" != "active" ]; then
          echo "::warning::$path was $state; re-enabling it."
          gh workflow enable --repo "$repo" "$(basename "$path")"
        fi
        ;;
      # release-desktop.yml is only a reusable workflow (workflow_call) that fork-release.yml calls.
      .github/workflows/release-desktop.yml) ;;
      *)
        if [ "$state" = "active" ]; then
          echo "disabling $path"
          gh workflow disable --repo "$repo" "$(basename "$path")"
        fi
        ;;
    esac
  done
for status in queued in_progress waiting; do
  gh api "repos/$repo/actions/runs?status=$status&per_page=100" \
    --jq '.workflow_runs[] | select(.path | startswith(".github/workflows/fork-") | not) | .id' |
    while read -r id; do
      echo "cancelling upstream workflow run $id"
      gh run cancel --repo "$repo" "$id" || true
    done
done
