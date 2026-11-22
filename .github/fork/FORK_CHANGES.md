# Fork changes

The conflict-resolution bot reads this file. Add one entry per fork change: what it does,
which upstream files it touches, and what must survive a merge. Keep it short.

## Release plumbing (patch 0001)
- `packages/shared/src/cliRelease.ts`: `CLI_RELEASE_REPOSITORY` is `DarkEden-coding/t3code`, so `t3 update`
  and remote service updates read and download the fork's releases. Three tests assert that URL.
- `scripts/install.sh`: default repo is the fork; `T3CODE_RELEASE_REPOSITORY` overrides it.
- Must survive: the fork repo name in both places. If upstream moves the constant, move the fork value with it.

## macOS signing without notarization or passkeys (patch 0002)
- `.github/workflows/release-desktop.yml`: the mac branch signs with `CSC_LINK` + `CSC_KEY_PASSWORD` alone,
  and notarizes without a provisioning profile. Its CLI-archive signing step also accepts an `Apple Development` identity.
- `scripts/build-desktop-artifact.ts`: passkey entitlements only with `T3CODE_MACOS_PROVISIONING_PROFILE`;
  otherwise the hardened-runtime entitlements (`MAC_HARDENED_RUNTIME_ENTITLEMENTS`) are still applied.
- Must survive: a signed mac build with no provisioning profile still succeeds and keeps the camera and mic entitlements.

## Fork-only files (always keep the fork's version)
- `.github/workflows/fork-*.yml`, `.github/fork/**`, `scripts/disable-upstream-workflows.sh`
