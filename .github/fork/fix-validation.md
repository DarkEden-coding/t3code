The upstream merge into Elliot's T3 Code fork is committed, but validation failed.
Validation is `node scripts/check-changed.ts upstream/main` followed by `vp run build:desktop`.
The log tail path is given below.

Fix the failures with the smallest change that keeps both upstream's change and the fork's intent
(see `.github/fork/FORK_CHANGES.md`). Usually upstream renamed or reshaped an API that a fork change uses.

Rules:
- Do not disable, skip, or delete tests, lint rules, or type checks.
- Do not modify upstream code beyond what is needed to keep a fork change compiling.
- Commit the fix as `fork-sync: adapt fork changes to upstream <short sha>`.

If the failure is in upstream code that the fork does not touch (an upstream breakage), do not fix it.
Print `UPSTREAM-BROKEN:` and the failing check, and stop.
