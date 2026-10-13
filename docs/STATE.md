# Repository state

Assessed on 2026-10-12 from `main` at `93b856b` on the Windows PC. This is a read-only assessment. Nothing was merged, pushed, deleted or installed. A documentation change is not a new build or a verification result.

## Current status

Updated on 2026-10-13 from the Mac. This summary is the starting point. The sections below keep their original dates and wording.

| Topic | State |
| --- | --- |
| `main` | `367dc32`, version 0.3.14 build 39 |
| Installed on Windows | Build 39 from `3ab7332` |
| Installed on Mac | Build 39 from `367dc32`. The only difference is the Mac popup fix from pull request 55. |
| Pairing | Re-paired on 2026-10-13 without the Ubuntu slot. The Mac reads fresh Windows records and the All token total reports `ok`. |
| Open pull requests | 56 fixes Claude Code and Mac activity collection in shared scripts and prepares build 40. CI passed. 54 adds this summary and the Mac section. |
| Open issues | 39, which stays open for installed verification of the quota-refresh fix |
| Not installed anywhere | Build 40 |

Work that is ready to pick up, in order:

1. Merge pull request 56. Package build 40 for Windows in CI, build it on the Mac, and install it on both devices.
2. Give Claude Code the same place in Tokens and Allowances that Codex has. Both screens show Codex only. The owner wants Claude Code and ChatGPT (Codex) presented with equal weight. Muse and Grok Bot come later. Other providers are not a priority.
3. Remove the legacy pairing shape, the Ubuntu fields and the checkpoint code in one change for both apps. The re-pair that had to come first is done.
4. Mac build environment: decide whether the build requires full Xcode or pins an SDK, and make the popup check independent of window focus.
5. Unexplained results to look into: three script tests on the Mac, four TLS pairing tests on Windows, and two incomplete setup attempts during the re-pair.

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

## Changes since the assessment

Recorded on 2026-10-12 and 2026-10-13. The sections above describe `main` at `93b856b` and are kept as assessed.

- Pull request 48 (`eb96249`) removed Hermes, HAPI and request-routing wording and aligned the documentation test with the README. The test passes again.
- All 47 other branches were deleted from GitHub after the classification above. A local bundle of their commits is kept outside version control.
- Pull request 49 removed the Archived Ubuntu history device and the WSL source settings from both apps. Account limits on Windows now follow their own switch and read the Codex account signed in on Windows.
- Build 38 was packaged by CI from `468a3c1` (run `38341644364`) and installed on this PC on 2026-10-13, replacing build 37. Its installer checksum matched, its self-test passed, and saved data was backed up first and left in place by the uninstaller.
- Pull request 51 raised two test deadlines after the package run failed three times on a slower test step. The cause of the slower run was not investigated.
- Build 39 carries the snapshot fix below. It was packaged by CI from `3ab7332` (run `38345695870`) and installed on this PC on 2026-10-13, replacing build 38. Its installer checksum matched and its self-test passed. Its first scheduled collection wrote a snapshot with the same 3 of 6 sources read. Recovery from a zero-filled snapshot was exercised by the synthetic test only, not on the installed app.
- Local Windows checks now work with the repo's pinned Node 24.21.0, .NET SDK 10.0.401 in the build cache, and temporary files under the ignored `.runtime` folder. On that setup the script suite gives 883 passed, 4 failed and 62 skipped. The 4 failures are TLS pairing tests that also fail on `main` on this PC and have not been investigated.

## Collection on this PC

The assessment above says the installed app was running. That was true, but it was not collecting. This section corrects it.

- The saved snapshot `public/local/usage.json` consisted only of zero bytes, with a write time of 2026-10-09 23:22:52. An interrupted write leaves a file like that. The collector refuses to replace a snapshot it cannot read, so every collection from then on reported `failed`, under build 37 and under build 38.
- The zero-filled file was renamed aside on 2026-10-13. The next scheduled collection wrote a new snapshot with 3 of 6 sources read: Windows activity, Wispr dictation and Claude Code request counts.
- Activity history that existed only in the lost snapshot is not recoverable on this PC.
- Codex tokens, Codex account limits and Mac pairing are still unavailable here. `C:\Users\seana\AppData` has a Full Control permission entry for an app-container identity that could not be matched to a program. The app checks every parent folder of `private-codex`, `private-quota` and `private-sync`, and it refuses all three while that entry exists. The entry was not changed. Removing it, or deciding that the app should accept it, is the owner's decision.
- The fix in this revision flushes snapshot bytes to disk before publishing them, and treats a snapshot of zero bytes only as a first collection. Any other unreadable snapshot still stops collection.

## Remaining Ubuntu code

The pairing messages (`includeUbuntu`), the pairing file's `codexHosts` list, three-host token comparison, the `localModel` snapshot slot, the retirement checkpoint code and the legacy migration plan still name Ubuntu.

This PC's saved pairing lists Windows with an Ubuntu slot. With that pairing, the combined All token total stays unverified by design, because the Ubuntu comparison evidence can no longer be supplied. Stored exchange records are validated against the same shape. Removing the legacy shape in code would therefore break the existing pairing.

The safe order is:

1. Install matching builds on Windows and Mac.
2. Re-pair the two devices once. New pairings are already Mac and Windows only, and a verified All token total becomes possible again.
3. Remove the legacy pairing shape, the Ubuntu fields and the checkpoint code in one change for both apps.

## What the Mac session needs to verify

None of this has been run. The Mac changes in pull request 49 were written on Windows and checked only by the macOS CI job, which compiles the app and runs its self-tests.

1. Pull `main` and confirm the revision matches the one used for the installed Windows candidate.
2. Build the Mac app from that revision by following [the Mac guide](MAC.md), and run `--self-test` on the built binary.
3. Back up the Mac app's data folder before replacing the installed app.
4. Install the build and open the dashboard. In Activity and Tokens, the Device filter must offer All, Mac and Windows only.
5. Open a saved snapshot that contains Ubuntu rows, if one exists. No Ubuntu device or Ubuntu row may appear, and the file's bytes must be unchanged afterward.
6. In Source health, each device list must show Mac and Windows rows only. The Local benchmarks row must be labeled Saved.
7. Run one collection and confirm Mac activity, Codex tokens and any enabled optional sources still report a status.
8. Check whether the Mac's own `public/local/usage.json` is readable JSON. The Windows copy was zero-filled.
9. Pairing with Windows cannot be confirmed until the permission entry on the Windows `AppData` folder is resolved. After that, confirm the existing pairing still exchanges records. The All token total is expected to stay unverified until the devices are re-paired.
10. Report any step that fails with the exact revision and the visible message.

Status on 2026-10-13: steps 1 to 4 and 6 to 9 are done and recorded in the Mac section below. Step 5 is still open. Step 1 differs in one way. The Mac build comes from `367dc32`, which adds the Mac popup fix to the Windows revision.

## Mac

Recorded on 2026-10-13 on the Mac (Apple Silicon, macOS 27.0.1) from `main` at `b9dc3e6`, version 0.3.14 build 39. This is the same revision recorded for the Windows build 39 install. The first three subsections describe the Mac at that revision, before the popup fix and before any install. The later install is recorded under "Build 39 install on the Mac". The Windows PC was not touched from the Mac.

### State before any change

- One working checkout existed, on `main` at `93b856b`, clean and six commits behind GitHub. It was fast-forwarded to `b9dc3e6`.
- Four local branches (`web-peer-quota`, `fix/token-metadata-shape`, `docs/build29-verification`, `archive/settings-style`) hold seven commits whose GitHub branches were deleted. `git cherry` reports all seven as patch-equivalent to commits on `main`, which agrees with the classification above. The local branches were left in place.
- The installed app is 0.3.13 build 35 from `ced6698`, ad hoc signed. It was running and collecting. Its `public/local/usage.json` was written on 2026-10-13 and is readable JSON, unlike the zero-filled Windows copy.

### What works

- Runtime preparation: the `test_prepare_*.py` tests passed (8 run, 1 skipped). The three pinned runtime archives and the pinned Sparkle archive matched their checksums, and `prepare-runtime.py` produced a runtime archive with 14 dependency notices.
- The Swift sources compile without changes when `SDKROOT` points at the macOS 26.5 SDK from Apple's Command Line Tools.
- On the bundle staged by `native/build.mjs`, these checks passed: `--self-test`, `--test-quota-archive`, `--test-trusted-sync-owner`, `--test-shutdown`, `--test-collector`, strict signature verification, `--test-web`, `--test-lifecycle`, `--test-lifecycle --legacy-dashboard` and `--test-popup --legacy-dashboard`. The last two were run by hand because the builder had already stopped.
- The staged bundle's `build-info.json` records 0.3.14 build 39, source `b9dc3e6` and a clean tree.

### What is broken or unverified

At `b9dc3e6`, `node native/build.mjs` did not complete on this Mac.

- With the default macOS 27.0 SDK, compilation fails because `SwiftUIMacros.StateMacro` cannot be found. The Command Line Tools do not include that compiler plugin and full Xcode is not installed. With the macOS 15.5 SDK, compilation fails because `glassEffect` does not exist there. Only the 26.5 SDK compiles.
- `--test-popup` fails in native dashboard mode with "reopening usage raised the hidden dashboard". The step passed once and failed eight times across nine executions, with and without `--force-offscreen-popup`. The same check passes with `--legacy-dashboard`. Pull request 55 found and fixed the cause. See below.

Local `npm test` with the prepared Python 3.13 runtime selected: 950 tests, 819 passed, 21 failed, 110 skipped.

| Cause | Failures | Kind |
| --- | ---: | --- |
| Slow under parallel load. All pass when the affected files run with `--test-concurrency=1`. Most report "Private path access-control verification failed", whose helper has a 15 second limit. | 16 | Local environment |
| `scripts/collect-antigravity-allowance.test.mjs` uses the temporary folder path under `/var`, which is a symlink to `/private/var`. It passes when `TMPDIR` is the canonical path. | 1 | Test setup on Mac |
| `scripts/run-collector.test.mjs` runs `python3` from `PATH`, which is the system Python 3.9.6. It passes with Python 3.13 first on `PATH`. | 1 | Local environment |
| `scripts/cached-settings.test.mjs` "legacy cache refuses a linked cache directory" and `scripts/peer-revocation.test.mjs` "linked revocation marker is never followed or overwritten". The linked path is still refused, but with a different message than the test expects. | 2 | Unexplained |
| `scripts/peer-pairing.test.mjs` "initial publish, privacy and merge" reads a null peer state. The test selects `/usr/bin/python3` on Mac. | 1 | Unexplained |

### Build 39 install on the Mac

Recorded on 2026-10-13 from `main` at `367dc32`, which is `b9dc3e6` plus pull request 55.

- Pull request 55 fixed the popup failure. `openDashboard` asked AppKit to restore the dashboard from the Dock on every open. On macOS 27.0.1 the window manager answers that request later, and the answer brought back a dashboard that had been hidden in the meantime. The app now asks only when the window is minimized. After the change, the three `--test-popup` variants each passed 6 of 6.
- `node native/build.mjs` completed at `367dc32` with `SDKROOT` set to the macOS 26.5 SDK, and every native check passed. `node native/mac/package.mjs --zip-only` verified the bundle and the extracted ZIP. The ZIP is 67,511,299 bytes with SHA-256 `75ba1eaebe3d385b7151cdada039d7e75e5aebe4bba004938ad10c6920e292ae`. It is ad hoc signed, not notarized and not published.
- Build 35 was quit normally and stopped within about 10 seconds. The app's data folder (132 files) and its preferences file were copied to a new recovery folder, and the copy matched the original by SHA-256.
- `native/mac/replace-app.mjs` replaced build 35 with the candidate extracted from the verified ZIP. The journal reached `payload-verified` and build 35 is retained in the recovery folder beside the app. The previous manifest was generated from the installed build 35 bundle on this Mac, not from an independent receipt.
- The installed `build-info.json` records 0.3.14 build 39, source `367dc32` and a clean tree. Strict deep signature verification passed.
- After launch, the allowance collector reported `ok`. Two scheduled full collections ran five minutes apart and each reported `partial` with 9 of 12 sources read. Build 35 had reported 9 of 13.
- The new snapshot is readable JSON. Mac and Windows rows report `ok` for activity, tokens, settings and dictation. The Ubuntu rows that build 35 wrote under tokens and settings are no longer present. The Windows rows were less than one minute old, so the existing pairing still exchanges records. The All token total is `unverified`, as expected until the devices are re-paired.
- Compared with the backup, no saved file was removed. Six files changed (three databases under `private-quota` and `private-sync`, and the three status and snapshot files under `public/local`), and two retirement files were added under `.runtime/private-repair`.
- Source health showed "2/2 native device records read" for Codex.

Not verified on the Mac: opening a saved snapshot that contains Ubuntu rows, collection with the main window closed, login startup, and sleep and wake.

The builder's popup check also failed twice with "dashboard activation deadline exceeded" while the Mac was in use. The check needs the test app to receive focus within 2 seconds. This is a limitation of the check and was not changed.

### After the install

Recorded later on 2026-10-13 with build 39 from `367dc32` installed.

- In the installed app, the Device filter in Activity and Tokens offers All, Mac and Windows only. Source health lists Mac and Windows rows only, and the Local benchmarks row is labeled Saved.
- Antigravity account limits and configured agent receipts were turned off in Settings. Antigravity is no longer installed on this Mac and the configured receipt folder does not exist.
- Claude Code on the Mac reported Unknown because `scripts/read-claude-usage.py` withheld the whole source over 8 placeholder records that Claude Code writes with model `<synthetic>`, zero usage and no request identity. Pull request 56 skips those records. With the change, the reader returns 8 recorded days from the same logs.
- Mac activity showed 0 minutes with "tracking is not current". The ActivityWatch window watcher and idle watcher on this Mac register under different host names, and the collector paired buckets only within one name. Pull request 56 reads every verified local window bucket against every verified local idle bucket. With the change, tracking reads through the current minute. Pull request 56 is not installed yet. It prepares build 40.
- The permission entry on the Windows `AppData` folder described under "Collection on this PC" was not found when read from the Mac over SSH. `AppData` now carries a read and execute entry for `CodexSandboxUsers`, and the app's private folders have protected entries for the owner, administrators and the system only.
- The one-time re-pair was done with the bundled tools. `peer-repair.mjs` reported `prepared` on Windows and on the Mac, and each device retained its old pairing in a `private-sync-retired-*` folder. The Windows step was run over the existing SSH route with the owner's approval, not from the Windows tray menu. `peer-setup.mjs` with `includeUbuntu` false then reported `paired`. Its first two attempts reported "Pairing setup incomplete" and left the Mac pending. The cause was not found. A third attempt succeeded in 3 seconds after the Windows side had been initialized with the same request.
- The first collection after the re-pair reported Windows as unavailable. The next one, five minutes later, read 9 of 10 sources with fresh Windows records, and the All token total and combined settings reported `ok`. The one source not read was Claude Code on the Mac.

### Differences from Windows

| Topic | Windows | Mac |
| --- | --- | --- |
| Installed build | 0.3.14 build 39 from `3ab7332` | 0.3.14 build 39 from `367dc32`, which adds the Mac popup fix |
| Build 39 produced by | CI package run | Local build with the macOS 26.5 SDK |
| Collection | 3 of 6 sources after the zero-filled snapshot was moved aside | 9 of 12 sources under build 39, including fresh Windows records |
| Script suite | 883 passed, 4 failed, 62 skipped | 819 passed, 21 failed, 110 skipped. 16 of the failures pass when run serially. |
| TLS pairing tests | 4 fail and are not investigated | Pass when run serially |
| CI coverage | Package and contract workflows run on pull requests | The full Mac suite and app build run only in the manually dispatched `Clean Mac runtime` workflow. Its last run was 2026-09-27 for build 36. |
| Build tools | Pinned .NET SDK, Node and NSIS are downloaded by the build scripts | The Swift build depends on which Apple SDK is installed. See above. |

### Next steps for the Mac

1. Merge pull request 56, build and install build 40 on both devices, and confirm Claude Code and Mac activity in the installed apps.
2. Give Claude Code the same place in Tokens and Allowances that Codex has. Today both screens show Codex only.
3. Check the items listed as not verified above.
4. Decide whether the Mac build should require full Xcode or pin an SDK, and record the choice in [the Mac guide](MAC.md).
5. Look into the three unexplained script test failures, the focus deadline in the popup check, and the two incomplete setup attempts during the re-pair.
6. The devices are re-paired without the Ubuntu slot, so the legacy pairing shape described under "Remaining Ubuntu code" can now be removed in one change for both apps.

## Next decisions

Updated on 2026-10-13.

1. Resolved. The permission entry on the Windows `AppData` folder was no longer present when read on 2026-10-13.
2. Done. Windows and Mac were re-paired on 2026-10-13.
3. Open. Decide whether the saved local-model benchmark view stays. It only ever showed records from the Ubuntu source.
4. Open. Decide who installs build 40 on Windows and how.
