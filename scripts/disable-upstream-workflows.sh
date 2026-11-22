#!/bin/sh
# Disables every workflow in the fork except the fork's own (files named fork-*.yml) and the reusable release-desktop.yml,
# and re-enables any fork-*.yml workflow that is not active.
# Upstream workflows stay in the tree unchanged, so merges never conflict on them,
# but they need Blacksmith runners and upstream secrets, so they must not run here.
# Run once after enabling Actions. fork-sync.yml runs it after every landed sync,
# because new upstream workflows arrive enabled.
#   usage: disable-upstream-workflows.sh <owner/repo>
set -eu
repo="$1"
gh workflow list --repo "$repo" --all --limit 200 --json path,state --jq '.[] | "\(.state) \(.path)"' |
  while read -r state path; do
    case "$path" in
      # Fork workflows must stay on. Something has switched fork-release off by hand twice; turn it back on.
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
