# Repository state

Assessed on 2026-10-12 from `main` at `93b856b` on the Windows PC. This is a read-only assessment. Nothing was merged, pushed, deleted or installed. A documentation change is not a new build or a verification result.

That assessment is historical. The sections marked "historical" below describe `main` at `93b856b` and are kept as assessed. "Current status" and "What the app does today" were rewritten on 2026-10-14 for build 41. The dated install records keep their original dates and wording.

## Current status

Updated on 2026-10-14 from the Mac, by reading `main`, GitHub and the build 41 install records below. Nothing was installed or run on either device for this update. The sections below keep their original dates and wording.

| Topic | State |
| --- | --- |
| `main` | Version 0.3.14 build 41. Since the build 41 installs, pull request 93 bounded the Claude usage command and repaired the Windows menu text, and pull request 95 recorded the execution plan. Neither change is in an installed build. |
| Installed on Windows | Build 41 from `06e73c2`, installed on 2026-10-13 (local time). Started outside a Claude desktop session, its first collection read 6 of 6 sources with state `ok`. See "Build 41 install on Windows". |
| Installed on Mac | Build 41 from `3f70771`, installed on 2026-10-13 (local time). Started with a clean environment, it read 10 of 10 sources with state `ok`. See "Build 41 install on the Mac". |
| Shared viewer | The shared panel is in build 41 on both platforms behind `--web-panel`, and Windows hosts a dashboard window behind `--web-dashboard`. Neither is the default and neither was exercised on an installed build. |
| Pairing | Re-paired on 2026-10-13 without the Ubuntu slot, over SSH. The Mac reads fresh Windows records and the All token total reports `ok`. |
| Plan | [The build plan](BUILD-PLAN.md), corrected on 2026-10-14, and [the execution plan](EXECUTION-PLAN.md) approved that day. |
| Open pull requests | 94, the script suite workflow (Q1-a). Its first run failed on both hosted runners. |
| Open issues | 79 to 84 and 96 to 113, one per workstream (the build plan's "How progress is tracked" lists them). 58, which records that the Windows app loses its private folders when it is started from a Claude desktop session. 60, the same question on the Mac. 39, which R2 is expected to supersede. |
| Script suite on the Mac | 925 tests, 816 passed, 4 failed and 105 skipped on `02b83ac`, run serially with the installed app's Python 3.13. The four failures are named in [the execution plan](EXECUTION-PLAN.md) under "Baselines" and also fail on the hosted macOS runner. |

Work that is ready to pick up, in order (the execution plan, section 2, has the full order):

1. Finish and merge the plan corrections pull request.
2. Done on 2026-10-14. The missing workstream issues are open (96 to 113), and the corrected scope is posted on issues 79 to 84.
3. Unblock pull request 94: Python 3.13 on the Windows runner lacks `tzdata`, and the four failing tests on the Mac need a decision.
4. Send the Windows session the W1 items from the last orchestrator comment on issue 84.
5. Start R1, V1, M1 and the rest of Q1 in parallel. D1 and D2 follow R1. R2 can run at any time, with both apps installed from it together.

## What the app does today

Rewritten on 2026-10-14 for `main` at build 41. Observatory shows recorded app activity, Codex and Claude Code tokens, Codex account limits, Claude Code limits where the limits bridge has consent, and dictation statistics. Agent receipts are still collected until workstream R1 removes them. Collection and daily viewing happen in the native apps. Optional device pairing reuses an existing SSH connection, and a TLS pairing path exists in source but has not completed a two-device test.

| Area | Location | Notes |
| --- | --- | --- |
| Shared viewer | `app/panel.tsx`, `lib/panel-data.mjs`, `lib/skins.mjs`, `native/skins/`, `native/web/panel.*` | React. The panel only, with four skins. Shown behind `--web-panel` on both platforms. |
| Earlier web dashboard | `app/page.tsx` and the other `app/` files, `components/ui/`, `native/web/index.html` | React and vinext. Bundled into the native apps as the legacy fallback and used for the fictional demo. Workstream S1 removes it. |
| Windows native | `native/windows/` (115 files) | C# WinForms app and tray, NSIS installer, WinSparkle update code, packaging scripts. |
| Mac native | `native/*.swift`, `native/mac/` | Swift app and menu bar, Sparkle update code, packaging scripts. |
| Shared scripts | `scripts/` (246 files) | Node and Python collectors, pairing, quota and archive code, with their tests. |
| Tests | `scripts/*.test.mjs`, `native/tests/`, native self-tests | `npm test` runs 925 script tests on the Mac. Native self-tests run inside the compiled apps. |
| CI | `.github/workflows/` (7 workflows) | Windows package, native compilation, private-state contracts, update safety, peer contracts, Mac runtime, manual demo publication. Only native compilation, private-state contracts and update safety run on pull requests, each on a named subset. |
| Docs | `docs/` (23 Markdown files) | Guides, plans, and dated release and audit records. |

## What works (historical, at `93b856b`)

- CI on `main` passed for `2818295` (pull request 47), including the Clean Windows package run `37600647660`.
- The installed Windows app is 0.3.14 build 37. Its installer came from that same CI run, so the installed build matches `main` except for the later README edit in `93b856b`.
- The installed app was running on 2026-10-12 and wrote to its private folders that day.
- Locally, `npx tsc --noEmit` passed, `native/tests/source-retirement.test.mjs` passed (11 of 11), and the Python packaging tests for Windows (3) and Mac (8, 1 skipped) passed.

## What is broken or unverified (historical, at `93b856b`)

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

## Platform differences (historical, at `93b856b`)

| Topic | Windows | Mac |
| --- | --- | --- |
| Verified here | Installed build 37 runs. Source build not attempted. | Nothing verified in this assessment. |
| Build tools | .NET SDK, pinned Node and NSIS downloaded by `native/windows/build.ps1` and `package.ps1` | Xcode Swift toolchain, pinned runtimes |
| Updates | WinSparkle code present. Automatic updates are not available. | Sparkle code present. Automatic updates are not available. |
| Private folders | Windows access-control lists checked by `scripts/private-sync-acl.ps1` | POSIX modes and macOS ACLs checked by `scripts/private-path-acl.py` |

## Branch classification (historical, at `93b856b`)

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

## Two-device TLS pairing test (P1-4)

Run on 2026-10-16 for issue 110 with synthetic fixtures in temporary runtimes on both devices. The installed apps and the real SSH pairing were not touched. The controller and fixture came from `shared/p1-live`. The revisions differ per run and are given in each item below. The owner's tailnet grant allows only TCP 43128 between the two devices, so the run used `--port 43128`. The PC worker was started over the existing SSH alias, so it ran under the Windows SSH service (`node.exe` under `cmd.exe` under `sshd.exe`), outside the Claude desktop app. Its `TEMP` and `TMP` pointed at the ignored `.runtime` folder, because the private-folder check refuses the account's default temp folder, which sits under the `AppData` entry described in "Collection on this PC".

- PC hosting (fixture 2e2c08f on both devices, controller 02d850f), with a 60 second pause after the host step: every step through revocation passed. That covers the invitation claim, confirmation, acknowledgement, the trusted sync service on both devices, record exchange both ways, repeat delivery without duplicates, a service restart, consented allowance exchange, disabling one side and revocation. The controller reported its own cleanup as failed, but no `node.exe` remained on the PC and no fixture folder remained on either device. The same happened in every later run: the controller waited 30 seconds for the PC worker to exit, and the PC worker needed a little longer. The wait for a remote worker is now 120 seconds (ec831f4), not yet run live.
- Mac hosting (same revisions), with the same pause: every step through publishing passed. The first record exchange, from the PC to the Mac's sync listener right after both services started, failed. The run stopped there.
- Mac hosting again (fixture 2e2c08f, controller c4606d3), after a read-only check that the Mac's Application Firewall permits the signed `node` the worker used, with a 20 second pause after the host step and a 30 second pause before the first exchange: both devices saw a direct Tailscale connection (7 ms and 4 ms), and every step through the exchange after the service restart passed. The first allowance exchange failed about 4.5 to 5 minutes into the run. Each fixture worker stops itself after 5 minutes, so that deadline is the likely cause, not confirmed.
- Mac hosting in full (fixture and controller at 11707af, `--worker-lifetime 600`, the same two pauses): every step through the first record exchange passed, then the repeat exchange failed (status merged, transport unavailable). The run stopped there. The same step had passed in the previous Mac-hosting run, so the connection failures on 43128 are intermittent, not only the first connection after a run starts.
- Next-collection rule, approved by the coordinator on 2026-10-16: in the product a dropped exchange is retried at the next collection (see below), so within each exchange step of the harness a side may make at most one further exchange after a failed one, standing for the next collection. The step passes only if that one delivers. Every use is printed with the first failure's side, stage, code and seconds, and the run prints how many were used. The stop rule applies to everything else.
- Mac hosting (fixture 6a0e929, controller 4499dd5, the rule active on the record exchange steps and the first allowance exchange): every step through the first allowance exchange passed, including the three record exchange steps and the restart, with no further exchange used. The repeated allowance exchange then failed (status unavailable). The rule had not been applied to that step, which it covers since 90412c6.
- With the rule on every exchange step (fixture 90412c6 on both devices, controller 160f41c, the same options): Mac hosting passed every step through revocation with one further exchange used, PC hosting with repaired runtimes passed every step through revocation with none, and Mac hosting with repaired runtimes passed every step through revocation with none. The one further exchange followed the PC's first record exchange to the Mac's newly started sync listener, which failed at the TCP connect stage with `ETIMEDOUT` after 26 seconds.
- Together with the first PC-hosting run, the full sequence has passed once in each of the four combinations: both hosting directions, with and without repaired runtimes.
- Dropped connections so far: 4 record or allowance exchanges did not complete across the Mac-hosting runs (two first record exchanges, one repeat record exchange, one repeated allowance exchange), plus the first probe of the earliest PC-hosting attempt. The three later runs with the rule needed one further exchange in total.
- Mac firewall (read only): the firewall is on with stealth mode, and it automatically allows built-in and downloaded signed software. The test worker's Developer ID signed `node` was allowed that way. The installed app's bundled `node` is ad hoc signed and not in the firewall's app list, so on such a Mac its first incoming sync connection would wait until the person allows it when macOS asks. This is worked out from the signature and the firewall settings. The app was not run. The Mac guide's pairing steps need to say so (P1-6).
- An earlier PC-hosting attempt without the pause stopped at the probe: the first TCP connection to the PC's setup listener right after it started failed within 5 seconds. From the code, the listener was bound before the probe started.

The connection failures on 43128 came at different points: the first connection after a run started (twice) and once at a repeat exchange. After a service restart the exchange passed with no pause. Both devices report a direct Tailscale path. The cause is still open (see issue 110). In the product, record exchanges run once per collection, every 300 seconds on both platforms, and the sync service only listens, so a dropped exchange is retried at the next collection, and the other device's collection can deliver records sooner. A product-faithful acceptance therefore asks for delivery within about two collections, not within one exchange. This is synthetic two-device evidence from a test harness, not an installed-app pairing (P1-6).

## Remaining Ubuntu code

Updated 2026-10-14 for R2 (issue 111, pull request 119). R2 removes `includeUbuntu` from the pairing messages in the scripts and in both apps, stops writing the `codexHosts` list (saved files that list only their own device stay readable), and limits token comparison to Mac and Windows. That change is in source only. It is not installed on either device until R2-5. R2-2 (issue 111) then removes the `localModel` slot from every snapshot the scripts write and removes the retirement checkpoint code, which supersedes issue 39. Saved snapshots that still hold `localModel` load, and leftover checkpoint files under `.runtime/private-repair` are left in place, unread. What still names Ubuntu after R2 is the native readers of `localModel` (left to M2 and W2) and the legacy migration plan. The rest of this section is the record from before the 2026-10-13 re-pair.

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

### Build 40 install on the Mac

Recorded on 2026-10-13 from `main` at `ee29f31`.

- `node native/build.mjs` completed on the first attempt with `SDKROOT` set to the macOS 26.5 SDK. `node native/mac/package.mjs --zip-only` verified the bundle and the extracted ZIP, with SHA-256 `ab2ffcd5fc3e3f9ae909e2fa4a01543c3b8240c905a8974c7f8db9c350a1a7ca`.
- Build 39 was quit normally. The data folder (140 files) and preferences were copied to a new recovery folder and matched by SHA-256. `native/mac/replace-app.mjs` reached `payload-verified` and retained build 39 beside the app.
- The first scheduled collection under build 40 reported state `ok` with 10 of 10 sources read. Claude Code on the Mac reported `ok` with 8 recorded days. Mac activity tracked through the current minute. Windows records were about three minutes old, and the All token total and combined settings reported `ok`.

### Build 41 install on the Mac

Recorded on 2026-10-14 UTC from `main` at `3f70771`. Pull request 88 raised the build number because `main` had moved 20 commits past the installed build 40 without a new number, and the replacement helper refuses a build number that does not advance.

- `node native/build.mjs` and `node native/mac/package.mjs --zip-only` passed with `SDKROOT` set to the macOS 26.5 SDK. The ZIP has SHA-256 `eeb37f59533cc358667ead8f8f7eb856bcad7ddb25cbb55040c221bdcb1a7625`.
- Build 40 was quit normally. The data folder (142 files) and preferences were copied to a recovery folder and matched by SHA-256. `native/mac/replace-app.mjs` replaced build 40 and strict deep signature verification passed.
- The first two collections under build 41 failed. Each ran for the full 240 seconds. The collector was waiting on `claude -p /usage --output-format json --no-session-persistence`, which never exited. The app had been started with `open` from a shell inside a Claude desktop session, so the app and that command inherited the session's environment, including `CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_MESSAGING_SOCKET` and `ANTHROPIC_BASE_URL`. The same command run with only `HOME`, `USER` and `PATH` set returned in 1 second.
- The 15 second limit in `scripts/claude-usage-command.mjs` did not end the command. One command from the first failed collection was still running after the collector had given up, and it ignored a normal termination signal. (Added on 2026-10-14: pull request 93 fixed this in source. The command now starts with a small fixed environment, settles within its limit and force-stops the child, and both collectors guard the limits read. The fix is not in an installed build and was not verified on Windows.)
- The app was quit and started again with `env -i` and a minimal environment. The next collection finished in 11 seconds with state `ok` and 10 of 10 sources read. `claudeLimits` reported `stale` with two windows.
- At the owner's request the retained copies of builds 35, 39 and 40 beside the app were deleted. One app bundle remains on the Mac. The data recovery folders were kept.

Not verified: login startup of build 41, the web panel and dashboard flags in the installed build, and why `claudeLimits` reported `stale` straight after a collection that ran the usage command.

### Differences from Windows

| Topic | Windows | Mac |
| --- | --- | --- |
| Installed build | 0.3.14 build 41 from `06e73c2` | 0.3.14 build 41 from `3f70771` |
| Build 39 produced by | CI package run | Local build with the macOS 26.5 SDK |
| Build 40 produced by | CI package run `38443842036` | Local build with the macOS 26.5 SDK |
| Build 41 produced by | CI package run `38493681280` | See "Build 41 install on the Mac" |
| Collection | 6 of 6 sources under build 41 when started outside a Claude desktop session, including Mac records 6 minutes old. Build 40 read 3 of 6 when started from a session. | 10 of 10 sources under build 40, including fresh Windows records |
| Starting the app from a Claude desktop session | The app refuses its private folders. See issue 58. | Not examined |
| Script suite | 883 passed, 4 failed, 62 skipped | 819 passed, 21 failed, 110 skipped. 16 of the failures pass when run serially. |
| TLS pairing tests | 4 fail and are not investigated | Pass when run serially |
| CI coverage | Native compilation, private-state contracts and update safety run on pull requests, each on a named subset. The full suite runs only inside the manually dispatched package workflow (corrected on 2026-10-14). | The full Mac suite and app build run only in the manually dispatched `Clean Mac runtime` workflow. Its last run was 2026-09-27 for build 36. |
| Build tools | Pinned .NET SDK, Node and NSIS are downloaded by the build scripts | The Swift build depends on which Apple SDK is installed. See above. |

### Next steps for the Mac

Rewritten on 2026-10-14 for build 41. The workstream for each step is in [the build plan](BUILD-PLAN.md).

1. Build 40 is installed on Windows and build 41 on both devices. Done.
2. Claude Code beside Codex in Limits and Tokens comes with the shared viewer (V2, V4) and the price table (D2). The SwiftUI screens are not changed for it.
3. Find why `claudeLimits` reported `stale` straight after a collection that ran the usage command (D1).
4. Point the status line entry at the bridge script inside the installed app instead of the source checkout (H1, after D1 adds the installer option).
5. Host the shared dashboard behind `--web-dashboard` and check the web panel's actions, light appearance and the hidden-icon fallback in preview mode (M1).
6. Install a build that carries pull request 93's usage command fix, and check login startup and the web flags on the installed build (L1, or an earlier install under the standing approval).
7. The SDK question is answered in practice: every Mac build sets `SDKROOT` to the macOS 26.5 SDK. Record it in [the Mac guide](MAC.md) (G1).
8. Look into the four failing script tests named in [the execution plan](EXECUTION-PLAN.md), the focus deadline in the popup check, and the two incomplete setup attempts during the re-pair.
9. Remove the legacy pairing shape described under "Remaining Ubuntu code" in one change for both apps (R2).

## Build 40 install on Windows

Recorded on 2026-10-13 on the Windows PC from `main` at `57518b7`. The Mac, the pairing and WSL were not touched. No permission was changed.

### Package and checksum

- The Clean Windows package workflow was dispatched on `main`. Run `38443842036` built `57518b7` and succeeded on its first attempt. The PC was shut down and restarted while the run was in progress, which did not affect the run.
- The installer artifact was downloaded with the GitHub CLI. Its SHA-256 matched the digest the run publishes, `1e55a55fb090b4cdfe0fd9d9c7569864fc6b98c9c103d8290280051f0ca1f9c5`. The setup file inside matched its sidecar, `e64bd09e63ea0ea10115765ceb0e576faac447e4b474d04de31f08d7dc7960ce`. `installer-build.json` records 0.3.14 build 40, source `57518b7` and a clean tree.

### Before the install

- The installed app was 0.3.14.39, read from the version information of the installed executable. `installer-owner.ini` in the install folder recorded revision `3ab7332`.
- The build 39 installer from run `38345695870` was still on disk. Its artifact matched the digest that run publishes and its setup file matched its sidecar, so build 39 can be reinstalled.

### Backup

- The app was not running after the restart. An earlier quit with `--quit-for-update` had returned 0.
- The data folder was copied with permissions to a new folder under `%LOCALAPPDATA%\WorkspaceObservatoryBackups`. All 317 files (59,265,996 bytes) matched the originals by SHA-256, with none missing or extra. The `HKCU\Software\Observatory\Dashboard` key was exported into the same folder.
- The copy was taken without the peer state lock that [the update guide](UPDATES.md#runtime-backup-coordination) describes. The lock could not be taken from the session that ran the install, for the reason recorded under "Starting the app from a Claude desktop session" below. The owner approved a plain copy.

### Replacement

- Build 39 was removed with a copy of its own `Uninstall.exe`, run with `/S _?=` and the install folder. It returned 0, the install folder and the uninstall registration were gone, and the data folder still held 317 files.
- The build 40 setup file was hashed again and run with `/S`. It returned 0.
- No Windows security prompt appeared. The setup file had no mark of the web, because it was downloaded with the GitHub CLI and not with a browser. This does not show how Windows treats the same file when it is downloaded another way.
- `native/windows/replace-payload.mjs` was not used. The update guide describes it as a component that neither installed app invokes.

### Installed target

- File version 0.3.14.40, read from the installed executable. `installer-owner.ini` records revision `57518b7`. The uninstall registration and the Start menu shortcut are present.
- `--self-test` on the installed executable returned 0 with 32 lines of output and no error output.
- All 317 saved files were identical to the backup after the install, and the three dashboard registry values were unchanged.
- The installed `read-claude-usage.py` contains the placeholder handling from pull request 56.

### Collection

- Started from the Claude desktop session that ran the install, build 40 reported `partial` with 3 of 6 sources. Windows activity, Wispr dictation and Claude Code were read. Codex tokens, Codex settings and account limits were `unavailable`, and the Mac was `not-connected`.
- The app was then quit and started through `Win32_Process.Create`, so that it was not a child of the Claude app. Its first scheduled collection, 14 seconds later, reported `ok` with 6 of 6 sources.
- In that snapshot Claude Code on Windows is `ok` with 10 recorded days. The last snapshot written by build 39 had Claude Code `unavailable` with 0 days. That build 39 instance had also been started from the session.
- Mac activity, tokens, settings and dictation are `ok` and 2 minutes old. Account limits are `ok`. The All token total is `ok` and verified, and combined activity and combined settings are `ok`.

### Starting the app from a Claude desktop session

This corrects three earlier statements in this document: the table row under "What is broken or unverified" that attributes the private-directory refusals to entries left by sandbox tools, the fourth point under "Collection on this PC", and the first item under "Next decisions".

- Inside a Claude desktop session, `%USERPROFILE%\AppData` lists a Full Control entry for `S-1-15-3-3557520199-3666692283-3112367039-3524159787-2791857073-3163583606-3692855932`. The AppContainer mappings in the registry hold the same seven numbers under `S-1-15-2-` with the name Claude and the moniker `claude_pzs8sxrjxfjjc`.
- The same listing run outside the session shows no such entry, and `private-sync-acl.ps1` reports `ok` for `private-repair` there. Inside the session it fails at `inspect-ancestry`.
- The entry was therefore never on the real folder. It was not added by a restart and it was not removed before the Mac read the folder over SSH. Processes started from the packaged Claude app see it and others do not.
- The 3 of 6 results recorded above for builds 38 and 39 came from app instances that a session had started. On 2026-10-13 build 39 also read 2 of 6 sources twice after a session restarted it. The zero-filled snapshot described under "Collection on this PC" was a separate and real fault.
- The script tests that fail with "Private sync access-control verification failed" when their temporary folder is under `AppData` are explained by the same view.
- Issue 58 holds the evidence and three possible directions. Nothing was fixed.

### Not exercised

- The Refresh sources button, the tray menu and the dashboard windows of the installed build 40.
- Login startup, sleep and wake, and collection across a restart under build 40.
- Reinstalling build 39. Its installer was verified but not run.
- An install from a setup file that carries a mark of the web.

### Unexplained

- A collection under build 39 at 14:36 local time, before the first restart of the app by the session, reported `partial` with 5 of 6 sources. The source that was not read was not examined.
- Why Windows shows the entry to processes started from the packaged app. File-system virtualization for packaged apps is the likely mechanism. It was not confirmed.

## Build 41 install on Windows

Recorded on 2026-10-13 (local time) on the Windows PC. The Mac was not touched. No permission was changed.

### Package and checksum

- Pull requests 87 and 88 were merged first, so `main` carried build 41 at `3f70771`.
- The Clean Windows package run `38490553711` on `3f70771` failed after about 26 minutes on two test expectations. One read `Program.cs` for a line that pull request 87 had changed. The other expected backslashes in the Claude Code status line command, where the installer writes forward slashes on Windows. Both tests run only in the full suite inside that workflow. Pull request 91 corrected the two expectations and changed no application code.
- Run `38493681280` then built `06e73c2` and succeeded on its first attempt.
- The installer artifact matched the digest the run publishes, `e0a8028f36b6014ae7bc2c4c297473406e31c89758e6d515a002522e1a721726`. The setup file matched its sidecar, `a265243ec619bbad435fdfcfa7bb089b20fe90b5e396d2322cc4c762d261b45c`. `installer-build.json` records 0.3.14 build 41, source `06e73c2` and a clean tree.

### Before the install

- One install was registered and present: 0.3.14.40 from `57518b7`. No other install folder, registration or Start menu entry for the app existed.
- All 3,082 files of that install matched its package manifest by size and SHA-256, and the manifest matched the one recorded with the build 40 installer.

### Replacement

- Build 40 was asked to quit with `--quit-for-update` and returned 0. No process from the install folder remained.
- The data folder was copied with permissions to a new folder under `%LOCALAPPDATA%\WorkspaceObservatoryBackups`. All 331 files (59,511,256 bytes) matched by SHA-256, with none missing or extra. The dashboard registry key was exported beside them. The copy was taken without the peer state lock, as for build 40.
- Build 40 was removed with a copy of its own `Uninstall.exe`, run with `/S _?=` and the install folder. It returned 0 and the folder and registration were gone.
- The build 41 setup file was hashed again and run with `/S`. It returned 0. No Windows security prompt appeared. The file had no mark of the web.
- Build 40 stays recoverable through its verified installer from run `38443842036` and the backup above. Reinstalling it was not exercised.

### Installed target

- File version 0.3.14.41 and revision `06e73c2`, read from the installed executable and `installer-owner.ini`.
- All 3,084 installed files matched the package manifest, and the manifest matched the one recorded with the installer.
- `--self-test` on the installed executable returned 0 with no error output.
- All 331 saved files were identical to the backup after the install.

### Collection

- The app was started through `Win32_Process.Create`, so its parent was `WmiPrvSE.exe`. Its first collection, 12 seconds later, reported `ok` with 6 of 6 sources.
- Windows activity, tokens, settings, dictation and Claude Code were `ok`. Mac activity, tokens, settings and dictation were `ok` and 6 minutes old. Account limits were `ok`. The All token total was `ok` and verified.
- `claudeLimits` was `not-connected`. The Claude Code limits bridge is not installed on this PC.
- The snapshot has no provider allowance rows, which follows the Antigravity removal in pull request 77.

### Not exercised

- The tray menu, the native popup, the dashboard windows and the `--web-panel` and `--web-dashboard` flags on the installed build.
- Login startup, which is off, and sleep and wake.
- Whether the Mac reads this PC's records after the change. Only this PC's view was read.

## Next decisions

Updated on 2026-10-13.

1. Resolved. The permission entry on the Windows `AppData` folder was no longer present when read on 2026-10-13. Later that day the entry was found to be visible only to processes started from a Claude desktop session. See "Build 40 install on Windows" and issue 58.
2. Done. Windows and Mac were re-paired on 2026-10-13.
3. Decided. The design direction lists local benchmarks for removal from both apps ("Removals"). The saved records are kept, since removal from the interface does not authorize deleting them. Recorded on 2026-10-14.
4. Done. Build 40 was installed on Windows on 2026-10-13 from CI run `38443842036`.
5. Open. Decide what to do about issue 58: document how to start the Windows app, report the situation in Source health, or review the ancestry check.
