# Repository state

Assessed on 2026-10-12 from `main` at `93b856b` on the Windows PC. This is a read-only assessment. Nothing was merged, pushed, deleted or installed. A documentation change is not a new build or a verification result.

## What the app does today

Observatory is a personal app that shows recorded app activity, Codex tokens, optional Claude Code counters, account allowances, agent receipts and dictation statistics. Collection and daily viewing happen in the native apps. Optional device pairing reuses an existing SSH connection.

| Area | Location | Notes |
| --- | --- | --- |
| Web dashboard | `app/`, `components/ui/`, `native/web/` | React and vinext. Also bundled into the native apps and used for the fictional demo. |
| Windows native | `native/windows/` (116 files) | C# WinForms app and tray, NSIS installer, WinSparkle update code, packaging scripts. |
| Mac native | `native/*.swift`, `native/mac/` | Swift app and menu bar, Sparkle update code, packaging scripts. |
| Shared scripts | `scripts/` (253 files) | Node and Python collectors, pairing, quota and archive code, with their tests. |
| Tests | `scripts/*.test.mjs`, `native/tests/`, native self-tests | `npm test` runs 671 script tests. Native self-tests run inside the compiled apps. |
| CI | `.github/workflows/` (7 workflows) | Windows package, native compilation, private-state contracts, update safety, peer contracts, Mac runtime, manual demo publication. |
| Docs | `docs/` (38 files) | Guides plus dated release and audit records. |

## What works

- CI on `main` passed for `2818295` (pull request 47), including the Clean Windows package run `37600647660`.
- The installed Windows app is 0.3.14 build 37. Its installer came from that same CI run, so the installed build matches `main` except for the later README edit in `93b856b`.
- The installed app was running on 2026-10-12 and wrote to its private folders that day.
- Locally, `npx tsc --noEmit` passed, `native/tests/source-retirement.test.mjs` passed (11 of 11), and the Python packaging tests for Windows (3) and Mac (8, 1 skipped) passed.

## What is broken or unverified

Local `npm test` on `main`: 671 tests, 545 passed, 87 failed, 39 skipped. A second run with temporary files under `%LOCALAPPDATA%` gave 544 passed and 88 failed.

| Cause | Failures | Kind |
| --- | ---: | --- |
| System Node is 22.11.0. The repo requires 22.13.0 or later, and `node:sqlite` is missing. | 39 tests plus their parent files | Local environment |
| Private-directory checks refuse fixture folders. `%TEMP%` grants Modify to `CodexSandboxUsers` and to an unresolved account. `C:\Users\seana\AppData` grants Full Control to an app-container identity that new folders inherit. | 15 direct, more through shared helpers | Local environment, left by sandbox tools |
| `scripts/documentation.test.mjs` expects the README sentence "building in public for his own use". Commit `93b856b` removed it. | 1 | Real defect on `main` |
| `scripts/windows-retention.test.mjs` linked-ancestor case | 1, second run only | Local environment |

Other gaps:

- `npx oxlint` did not run. Its Windows native binding was not installed by `npm ci` under Node 22.11.0.
- The Windows native app was not compiled locally. Only the .NET runtime is installed, not the SDK.
- No CI run exists for `93b856b`. The documentation test would fail there.
- The live `collector.config.json` still contains `wslDistribution` and `quotaWslDistribution` set to Ubuntu. Ubuntu WSL was removed from this PC on 2026-10-12. Current code is tested to ignore these settings.
- Stale references remain in tracked files: Hermes or HAPI in 11 files (including `AGENTS.md`, `README.md` and four docs), WSL in 29 files and Ubuntu in 73 files. Much of the Ubuntu code handles read-only archived history and retirement checkpoints, so removal needs a decision about that saved history.

## Platform differences

| Topic | Windows | Mac |
| --- | --- | --- |
| Verified here | Installed build 37 runs. Source build not attempted. | Nothing verified in this assessment. |
| Build tools | .NET SDK, pinned Node and NSIS downloaded by `native/windows/build.ps1` and `package.ps1` | Xcode Swift toolchain, pinned runtimes |
| Updates | WinSparkle code present. Automatic updates are not available. | Sparkle code present. Automatic updates are not available. |
| Private folders | Windows access-control lists checked by `scripts/private-sync-acl.ps1` | POSIX modes and macOS ACLs checked by `scripts/private-path-acl.py` |

## Branch classification

All 47 non-main branches were compared file by file with `main` and with every earlier version of each file on `main`. Formatting-only differences were ignored. No branch holds work that `main` lacks. There is no "merge" group and no "needs decision" group.

| Group | Branches | What they hold | Classification |
| --- | ---: | --- | --- |
| Committed work already merged | 15 | `fix/archive-retirement-recovery`, `fix/native-history-and-source-controls`, `fix/token-metadata-shape`, `web-peer-quota`, `docs/build29-verification`, `archive/settings-style`, and the build snapshots `mac-collector-followup`, `pace-fddc01f`, `popup-compat-c5b5cda`, `stash-0`, `stash-2`, `style-review-652f1b9`, `verify-build36-cba6872`, `verify-fixture-80a7aa8`, plus `hermes-reconcile-scratch`. Every changed file matches `main` today or an earlier `main` version. | Already in main |
| `build-stash-1` | 1 | One file differs from `main` history by formatting only. | Already in main |
| Hermes snapshots based on `4ad5bbc` (2026-09-28) | 25 | Earlier drafts of the WSL retirement, archive safety, private ACL, test runtime and settings work. `main` holds later and stricter versions from `031855f`, `d24772e`, `f2fcfb9`, `3a5df57`, `c0a61e2` and `6c7d24e`. The only non-draft differences are a `push` trigger on the demo workflow that `031855f` removed on purpose, an "iPhone activity" label for deferred work, and review notes naming internal delegation ids. | Obsolete |
| `hermes-final-web`, `hermes-test-isolation-replay-20261007`, `hermes-windows-test-isolation-20261007` | 3 | Shorter drafts of two tests that `b33f0c1` and `ca440d6` finished. | Obsolete |
| `build-quota-lock-diagnostic-e063283-uncommitted` | 1 | Three temporary `console.error` diagnostic lines. | Obsolete |
| `build32` | 1 | Build 32 release preparation. `main` is at build 37. | Obsolete |
| `integrate-antigravity-stats` | 1 | Dynamic receipt discovery and agent roles from 2026-09-06. `scripts/agent-receipts.mjs` and `app/page.tsx` on `main` have bounded versions of both. | Already in main |

## Next decisions

1. Restore the README sentence or update `scripts/documentation.test.mjs`.
2. Decide whether archived Ubuntu history stays viewable before Ubuntu code is removed.
3. Decide how to get a working local test and build setup: a newer Node, the .NET SDK, and a fixture folder that the sandbox permissions do not reach. The CI installer artifact is an alternative to a local build.
