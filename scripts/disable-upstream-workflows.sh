#!/bin/sh
# Disables every workflow in the fork except the fork's own (files named fork-*.yml) and the reusable release-desktop.yml.
# Upstream workflows stay in the tree unchanged, so merges never conflict on them,
# but they need Blacksmith runners and upstream secrets, so they must not run here.
# Run once after enabling Actions. fork-sync.yml runs it after every landed sync,
# because new upstream workflows arrive enabled.
#   usage: disable-upstream-workflows.sh <owner/repo>
set -eu
repo="$1"
gh workflow list --repo "$repo" --all --limit 200 --json path,state --jq '.[] | select(.state == "active") | .path' |
  while read -r path; do
    case "$path" in
      # release-desktop.yml is only a reusable workflow (workflow_call) that fork-release.yml calls.
      .github/workflows/fork-* | .github/workflows/release-desktop.yml) ;;
      *) echo "disabling $path"; gh workflow disable --repo "$repo" "$(basename "$path")" ;;
    esac
  done
