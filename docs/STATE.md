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

## Next decisions

1. Decide what to do about the permission entry on `AppData` that blocks Codex tokens, account limits and pairing on this PC.
2. Approve the one-time re-pair of Windows and Mac described above.
3. Decide whether the saved local-model benchmark view stays. It only ever showed records from the Ubuntu source.
