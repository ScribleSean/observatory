# Repository state

Assessed on 2026-10-12 from `main` at `93b856b` on the Windows PC. This is a read-only assessment. Nothing was merged, pushed, deleted or installed. A documentation change is not a new build or a verification result.

That assessment is historical. The sections marked "historical" below describe `main` at `93b856b` and are kept as assessed. "What the app does today" was rewritten on 2026-10-14 for build 41, and "Current status" was rewritten again on 2026-10-17 for builds 42 and 43. The dated install records keep their original dates and wording.

## Current status

Updated on 2026-10-17 from the Mac for L1 (issue 113), by reading `main`, GitHub, the issue comments, the orchestrator's session log and the install records below. The PC was offline while this was written, so this update does not describe its state after 2026-10-16. The sections below keep their original dates and wording.

| Topic | State |
| --- | --- |
| `main` | Version 0.3.14 build 43 at `02555e8` (pull request 232). Pull request 233 later replaced the two README images at `8470ab2`, a documentation change only. |
| Installed on Windows | Build 42 from `a5a1d3c`, installed on 2026-10-16. Build 43 is packaged but not installed on the PC. See "Build 42 install sitting (L1)" and "Build 43". |
| Installed on Mac | Build 43 from `02555e8`, installed on 2026-10-17, with build 42 retained for rollback. See "Build 43". |
| Shared viewer | The default and only viewer in build 42 on both devices. Both installed apps refuse `--legacy-dashboard` and `--native-viewer` with exit 64, and each installed Web folder holds only `assets`, `dashboard.html` and `panel.html`. These checks were run on build 42, not repeated on build 43. |
| Pairing | Still the SSH pairing from 2026-10-13. Its saved Windows paths were updated to the renamed folders on 2026-10-16, and records were read in both directions afterwards. Tailscale pairing between the installed apps (P1-6) has not been done. |
| Plan | [The build plan](BUILD-PLAN.md), corrected on 2026-10-14, and [the execution plan](EXECUTION-PLAN.md) approved that day. |
| Open pull requests | 150, a draft outside the plan. |
| Open issues | Workstream issues 80, 83, 84, 103 and 105 to 113. From the install sittings and their fixes: 212 to 216, 222, 228 and 229. Also 58, 60, 174, 189, 192 and 199. |
| Script suite | Run `38949215984` on `a5a1d3c` and run `38994239128` on `02555e8` succeeded on the hosted runners. Their test counts are not copied into this record. |

Work left for L1, as of 2026-10-17:

1. Install build 43 on the PC. The package run's artifacts had expired by 2026-10-18 (see "Build 43"), so a new Clean Windows package run on `02555e8` comes first.
2. P1-6, Tailscale pairing between the installed apps, from step T-3 on, with the owner present.
3. The Finish half of O1-3 on both devices, and its first half on the Mac.
4. The done-item checks that were not exercised on an installed build (listed under "Not exercised on build 42" and "Build 43").

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
- Next-collection rule, approved by the coordinator on 2026-10-16: in the product a dropped exchange is retried at the next collection (see below), so within each exchange step of the harness a side may make at most one further record or allowance exchange after one that failed to deliver, standing for the next collection. A consent change, such as disabling sharing, never gets a further request. The step passes only if that one delivers. A further exchange is allowed only when the first one's connection did not complete: it stopped at the TCP connect or TLS stage, or ended with a network error code at any stage (for example `ECONNRESET` at the response stage). A reply that arrived without an error code but was wrong, and the hosting side's own allowance exchange after it disabled sharing, both stop the run. Every use is printed with the first failure's side, stage, code and seconds when the worker reports them, and the run prints how many were used. The stop rule applies to everything else.
- Mac hosting (fixture 6a0e929, controller 4499dd5, the rule active on the record exchange steps and the first allowance exchange): every step through the first allowance exchange passed, including the three record exchange steps and the restart, with no further exchange used. The repeated allowance exchange then failed (status unavailable). The rule had not been applied to that step, which it covers since 90412c6.
- With the rule on every exchange step (fixture 90412c6 on both devices, controller 160f41c, the same options): Mac hosting passed every step through revocation with one further exchange used, PC hosting with repaired runtimes passed every step through revocation with none, and Mac hosting with repaired runtimes passed every step through revocation with none. The one further exchange followed the PC's first record exchange to the Mac's newly started sync listener, which failed at the TCP connect stage with `ETIMEDOUT` after 26 seconds.
- Together with the first PC-hosting run, the full sequence has passed once in each of the four combinations: both hosting directions, with and without repaired runtimes.
- Dropped connections so far: 4 record or allowance exchanges did not complete across the Mac-hosting runs (two first record exchanges, one repeat record exchange, one repeated allowance exchange), plus the first probe of the earliest PC-hosting attempt. This does not count the first allowance exchange of the c4606d3 run, which failed near the worker's 5 minute deadline and was most likely that deadline, not a dropped connection. The three later runs with the rule needed one further exchange in total.
- Mac firewall (read only): the firewall is on with stealth mode, and it automatically allows built-in and downloaded signed software. The test worker's Developer ID signed `node` was allowed that way. The installed app's bundled `node` is ad hoc signed and not in the firewall's app list, so on such a Mac its first incoming sync connection would wait until the person allows it when macOS asks. This is worked out from the signature and the firewall settings. The app was not run. The Mac guide's pairing steps need to say so (P1-6).
- An earlier PC-hosting attempt without the pause stopped at the probe: the first TCP connection to the PC's setup listener right after it started failed within 5 seconds. From the code, the listener was bound before the probe started.

The connection failures on 43128 came at different points: three first connections after a run started (two record exchanges and one probe), one repeat record exchange and one repeated allowance exchange. After a service restart the exchange passed with no pause. Both devices report a direct Tailscale path. The cause is still open (see issue 110). In the product, record exchanges run once per collection, every 300 seconds on both platforms, and the sync service only listens, so a dropped exchange is retried at the next collection, and the other device's collection can deliver records sooner. A product-faithful acceptance therefore asks for delivery within about two collections, not within one exchange. This is synthetic two-device evidence from a test harness, not an installed-app pairing (P1-6).

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

## Build 42 install sitting (L1)

Recorded on 2026-10-17 from the Mac, from the orchestrator's session log, the reports of the "Observatory Windows" session and the comments on issues 107, 108, 113 and 215. The sitting ran on 2026-10-16 from about 19:24 to 21:03 UTC (15:24 to 17:03 local time on both devices). Times are UTC unless marked local. No usage value, title, prompt, invitation or credential is recorded here.

### Release revision and packages

- `REV` is `a5a1d3ce6eddc72d16ba26e09257f44886792d59`, the merge of pull request 191 (issue 189 part B). It comes after pull request 203, which raised the build number to 42 and recorded that build 42 keeps the SSH path. `native/Release.props` at `REV` says build 42.
- Script suite run `38949215984`, a push run on `REV`, succeeded.
- Clean Windows package run `38954719132` on `REV` succeeded. The installer artifact `verified-windows-installer-build42-<REV>-38954719132-1` has digest `sha256:d203be779b6562ca1b0c56cf7dadb2449de3627a76390866450d21f4f5682adf`, and the package artifact has digest `sha256:e291de8c27abe4b2fa0ef9826af0b71f284bdddb869027518f98353f6dd7195a`. On the PC, `Observatory-0.3.14-windows-x64-setup.exe` was 100,850,592 bytes with SHA-256 `80e4cbe17094f3a00bc2ab69d4cb67ea957ea74939ebfce1414a62cd127bb503`, matching its sidecar. `installer-build.json` records 0.3.14 build 42, source `REV`, `testIdentity` false and a clean tree.
- Mac: the runtime was prepared with `prepare-runtime.py` from the cached pinned archives. This Mac's `tar` cannot read Zstandard, so a decompress-only Python shim in a temporary folder was put on `PATH` for that step. Nothing was installed outside the session's temporary folders. `native/build.mjs` at `REV` with `SDKROOT` set to the macOS 26.5 SDK exited 0, and every native check it runs passed. `node native/mac/package.mjs --zip-only` verified the ZIP. `Observatory-0.3.14-macos-arm64.zip` is 66,389,373 bytes with SHA-256 `101083a037de2d31a1e52be0061c5cb5dd383655e659d66ce5a040a1ec810d2a`. Its manifest lists 1,797 files and 191,611,442 bytes unpacked. It is ad hoc signed and not notarized.

### Mac install

- Before the install: build 41 from `3f70771` at `~/Applications/Workspace Observatory.app`. Strict signature verification failed with "a sealed resource is missing or invalid", because test runs earlier that day had written `__pycache__` folders into its bundled Python (issue 213). Those folders were moved to the Trash with Finder, and the signature then verified.
- Backup: `~/Library/Application Support/Observatory Backups` was created with mode 700, and the existing build 41 backup was renamed into it as `build41-from-build40`. Build 41 was quit at 19:31:09, with no status line bridge running. The data folder and the preferences file were copied to `Observatory Backups/build42-from-build41-20261016T193112Z`, and the copy matched the original by SHA-256 (73 files, about 49 MB).
- Data copy (N1): `node native/mac/migrate-data.mjs status` reported the earlier folder present, the new folder missing, 73 files and nothing refused. `copy --confirm-app-quit` reported `migrated` with 16 folders, 73 files and 51,417,464 bytes. Afterwards the earlier folder still matched the backup's checksum list.
- Replacement: `native/mac/replace-app.mjs` in rename mode refused before changing anything, because it checks the build 41 bundle against build 42's required files (`Contents/Resources/Web/dashboard.html`). This is issue 212. The orchestrator did the same rename by hand. Build 41 was moved to `~/Applications/.observatory-update-manual-20261016T193200Z/previous`, and the candidate, extracted from the verified ZIP and signature-checked, was moved to `~/Applications/Observatory.app`. The installed bundle then matched the build 42 manifest. This replacement has no transaction journal.
- Installed target: `build-info.json` records 0.3.14 build 42, source `REV` and `sourceDirty` false. Strict signature verification passed. `--self-test`, `--test-collector` and `--test-web` each returned 0. The bundle holds no `price-refresh.mjs`, no `peer-live-controller.mjs`, no test files and no `__pycache__` folder.
- Launch line, used for every start on the Mac: `env -i HOME="$HOME" USER="$USER" PATH=/usr/bin:/bin:/usr/sbin:/sbin /usr/bin/open -n -g "$HOME/Applications/Observatory.app"`. The process environment had no `CLAUDE*` or `ANTHROPIC*` variable.
- First collection that finished after launch, at about 19:38: `snapshot-status.mjs` read activity, tokens, settings and dictation as `ok` for Mac and Windows. The Windows rows were the PC's records already saved on the Mac. Codex limits read `ok`. Claude Code limits read `ok` with the `five_hour` and `seven_day` windows, while the usage command reported `timed-out`. The Mac's Claude Code token source read `unavailable` (issue 223). The combined token total read `unverified`. The collector's own state line for this collection was not recorded.
- The Mac app was quit again at 19:38 and kept quit until 19:54:37, so that SSH exchanges could not write into the PC's earlier folder while the PC copied it. Downtime on 2026-10-16 was 19:31:09 to about 19:32:27 and 19:38 to 19:54:37.

### PC install

Every step that started the app or read or wrote the data folders, the backups, the installer or the uninstaller ran outside a Claude desktop session through `Win32_Process.Create` (parent `WmiPrvSE.exe`). Scripts and logs were kept in the PC clone's ignored `.runtime\l1` folder, and the clone was at `REV`.

- R2-5, before any change: `snapshot-status.mjs --file` on build 41's snapshot listed only Mac and Windows hosts in every row. The file still held a top-level `localModel` entry with host Ubuntu, written by build 41. Build 42's first snapshot no longer has that entry.
- Rollback: the verified build 41 installer is on the PC outside the Claude package store. Its artifact and setup checksums match the build 41 record above.
- Backups: `%LOCALAPPDATA%\Observatory Backups` was created outside the package store. The newest package-store backup was copied to `build41-from-build40` (332 files, 59,511,600 bytes, every file equal by SHA-256), and then all four package-store backups went to the Recycle Bin. Issue 107 lists each path. The live data folder was copied to `build42-from-build41-20261016T192729Z` with the app running (331 files, 61,179,673 bytes, every file equal by SHA-256), with `registry.reg`, an export of `HKCU\Software\Observatory`. This corrects the build 40 and build 41 Windows records above. Their backups under `%LOCALAPPDATA%\WorkspaceObservatoryBackups` existed only inside the Claude desktop package store.
- Before the install: file version 0.3.14.41, and `installer-owner.ini` recorded revision `06e73c2`.
- Download: the installer artifact matched the digest the run publishes, the setup file matched its sidecar, and the setup file had no mark of the web.
- Installer refusal: setup `/S` with build 41 still running returned exit 10, not the expected 14, and changed nothing. In `installer.nsi`, the running-app check (exit 10) comes before the existing-install check (exit 14). Build 41 was quit at 15:38:19 local, and a second run then returned 14 and changed nothing.
- Data copy (N1): `migrate-data.ps1 -Action status` first refused with "Unknown private folder at relative path: .runtime\private-repair" (issue 214). That folder held the two Ubuntu and WSL retirement files from 2026-10-07. With the owner's confirmation in the Windows session, `.runtime` was moved to `Observatory Backups\retired-runtime-private-repair-20261016`, and both files were equal by hash before and after. `status` then reported 329 files and 60,845,992 bytes, and `copy` reported `migrated` with the saved SSH paths updated to the new install and data folders. The copy removed the Start at login value, and the install restored it later.
- The Windows session corrected its own report for the two steps above. Its tree comparison there was not valid, because PowerShell's `diff` alias shadowed its helper. It re-established from write times that nothing in the old install or the old data folder was written after the quit. The fixed helper was used from the uninstall on.
- Uninstall: a copy of build 41's uninstaller, run with `/S _?=` and the old install folder, returned 0. The old install folder, its registration and both Start menu entries were gone. Both data folders were unchanged by hash.
- Install: the setup file was hashed again and matched, and `/S` returned 0. `Programs\Observatory` holds 3,092 files. The registration keeps the key `WorkspaceObservatorySetup`, now with the display name Observatory 0.3.14. The Start menu entry is `Observatory\Observatory.lnk`.
- Installed target: file version 0.3.14.42, and `installer-owner.ini` records revision `REV`. The package manifest matched `installer-build.json`, and the manifest check passed on 3,089 package files plus `Uninstall.exe` and `installer-owner.ini`. `--self-test` (ending "Shared viewer is the only viewer.") and `--test-launch-isolation` returned 0 with no error output. `price-refresh.mjs` is absent.
- Launch line: `"%LOCALAPPDATA%\Programs\Observatory\WorkspaceObservatory.exe" --background`, started through `Win32_Process.Create` with parent `WmiPrvSE.exe`. The PC app was closed for 11.1 minutes (15:38:19 to 15:49:25 local).
- First collection: `ok`, 6 of 6 sources, about 18 seconds after the start. Every row lists only Mac and Windows. Codex limits read `ok`, Claude Code limits read `not-connected` because the status line bridge was not installed yet, and the combined token total read `unavailable`. Start at login points at the new install folder.

### SSH path update and R2-5

- Both apps were quit (the PC at 15:54:13 local). `scripts/peer-transport-rename.mjs --runtime <Mac data folder>`, run from the release worktree with the shell's own runtimes, failed with "Private path access-control verification failed". The runbook says to stop and record a private-path refusal on the Mac. The orchestrator instead ran the same script from the installed bundle with its bundled Node, and it reported `{"state":"updated"}`. The cause of the first refusal was not investigated.
- The PC app started again at 15:54:39 local (closed for 0.4 minutes), and the Mac app at 19:54:37.
- The PC's next collection read `ok`, 6 of 6. Its Mac rows read `ok` and were under one minute old.
- The Mac's collection at about 19:59 read activity, tokens, settings and dictation `ok` for both devices, with the Windows activity row about five minutes old. Claude Code limits read `ok` with the usage command `read`. The Mac's Claude Code token source still read `unavailable`.
- The combined token total read `unverified` on the Mac and `unavailable` on the PC. The runbook expected `ok`, so that part of R2-5 did not pass. The cause was not examined.

### Status line bridge (H1-b, H1-c, N1-4)

- Mac: with the bundled Node, `claude-statusline-install.mjs status` reported the entry installed and limits consent given through the status line. `install --runtime <new data folder> --bridge <bridge inside Observatory.app> --consent` returned 0, and the entry names `Observatory.app` and the new data folder, not the earlier ones. `uninstall` returned 0 and left no status line, which matches the state before Observatory's entry. A second `install` returned 0 and put the bridge entry back. The prompt from a clean-environment Claude Code session (runbook step M-13) was not run.
- PC, after the owner approved it in the Windows session: `install --runtime ... --bridge ... --consent` returned 0, replaced no other status line and kept the 9 other top-level settings keys. The written command uses forward slashes and no `&` call operator, so it runs from `cmd` and Git Bash, and Windows PowerShell 5.1 would need `&` in front. `docs/DESIGN.md:313` was not updated with this result. After the owner ran one Claude Code session in a terminal, the collection at 20:24:59 read Claude Code limits `ok` with `five_hour` and `seven_day` through the status line, with the session cost present.
- PC usage command (issue 215): the installed collector found `claude.exe` in `~\.local\bin`, and the command exited 0 within its limit, but its output was not recognised (`usageCommand` `unrecognized`). A later outside-session run recorded the output shape without values. Claude Code 2.1.292 writes reset times in the comma form, which pull request 225 accepts. That fix is in build 43 and has not run on the PC.

### Owner checks and done items on build 42

- Light appearance: on the Mac, with the system set to Light and the app's Appearance set to System, the app turned light. The owner reported the same check as good on the PC. The Mac app's Appearance was left on System.
- PC tray panel (W1-4): the owner clicked the tray icon and then another window, and reported it as good.
- Grey secondary text (S8): the owner judged Almanac, Instrument and Amber CRT acceptable in light and in dark.
- Item 1: the Mac main window lists Limits, Activity, Tokens, Dictation, Sources and Settings, read through the accessibility tree. The orchestrator also saw Claude Code and Codex side by side in Limits, with Unknown where a value was missing. On the PC, the `--background --panel-timing` harness ran on the installed app with nothing clicked. The panel was ready in Inter Tight with 4 buttons and 4 limit rows, the dashboard page was ready in Inter Tight, and its PNG shows the six section names. This build's facts lines carry no `sections=` or skin field, so the section count is a visual check. The first panel open took 356.8 ms and warm opens 4 to 9 ms. The harness pressed refresh, check-updates, open-settings and open-dashboard, and each was accepted. W1-3: the dashboard opened in about 358 ms, and closing it released its two processes. The panel footer read "10 of 11 sources read" while the PC's collector read 6 of 6. The cause was not established on the PC.
- Item 2: Claude Code and Codex limits both read `ok` on each device, on the Mac through the usage command and on the PC through the status line.
- Item 5, on `REV` and the installed Mac app: the tag `archive/pre-viewer-removal` is an ancestor of `REV`. `git grep` for the removed viewer names outside `docs` finds hits only in `native/main.swift` (3), `native/verify-preview-guard.mjs` (1), `native/windows/LaunchIsolationTests.cs` (4), `scripts/audit-repairs.test.mjs` (1) and `scripts/documentation.test.mjs` (1), which are lists of refused options and tests that check the removal. `nm` finds no `NativeDashboard` symbol in the Mac binary. Both apps exit 64 for `--legacy-dashboard` and `--native-viewer`, and both Web folders hold only `assets`, `dashboard.html` and `panel.html`.

### Tailscale pairing between the installed apps (P1-6)

- T-1, Mac: the app was quit briefly, the data folder was copied to `Observatory Backups/p16-before-pairing-20261016T202349Z` and matched by SHA-256, and the app was started again. `build41-from-build40` then went to the Trash.
- T-1, PC: the app was closed for 0.1 minutes. `p16-before-pairing-20261016T202536Z` holds 347 data files (103,103,856 bytes, every file equal by SHA-256) and `registry.reg`. `build41-from-build40` then went to the Recycle Bin.
- T-2: the installed `tailscale-status.mjs` reported `running` on both devices. On the Mac it was run from a shell, not through the app. `tailscale ping` used a direct path both ways (5 ms from the Mac, 6 ms from the PC).
- The sitting stopped before T-3. On the Mac, Check Tailscale in Settings reported Tailscale as unavailable (issue 217), and the Settings page read Unknown again (issue 216). The owner chose to keep SSH and pair on build 43. Pairing repair was not prepared on either device, and the only retired pairing folder on the Mac is the one from 2026-10-13.
- Not verified: everything from T-3 on, including the invitation, the macOS and Windows firewall prompts, the listener on the Tailscale address, record exchange over Tailscale, restart, sleep and Tailscale toggling, and the rollback. P1-7 (SSH removal) waits for P1-6.

### Fresh-folder run (O1-3)

- PC: the installed build 42 was started outside a Claude desktop session with `--runtime <new empty folder in the clone's .runtime>`. The window opened and `setup-state.json` recorded `completed` false, so the first-run wizard was pending. The owner declined computer control, so nothing was clicked. Ticking ActivityWatch, Finish, the working app after it and the restart were not exercised. The test folder went to the Recycle Bin on the second attempt, 5 seconds after the first failed.
- Mac: not run.

### Earlier data folders and backups

- Mac: after the SSH path update and one collection each way, the `Workspace Observatory` data folder was moved to the Trash with Finder at 20:00:36. `lsof` found no open file in it first, and its backup had matched.
- PC: at 16:02 local, after the owner confirmed in the Windows session, `%LOCALAPPDATA%\Workspace Observatory` (329 files) went to the Recycle Bin. No process from the old install or naming the folder was running, `collection.lock` opened exclusively, and the folder differed from its backup by 8 known files: the 2 moved retirement files and 6 files that build 41's last collection rewrote before the quit. The next collection read `ok`, 6 of 6.
- At the end of the sitting the Mac kept `build42-from-build41-20261016T193112Z` and `p16-before-pairing-20261016T202349Z`. The PC kept `build42-from-build41-20261016T192729Z` and `p16-before-pairing-20261016T202536Z`, plus `retired-runtime-private-repair-20261016`, kept as data.

### Private-path check at `REV`

`REV` contains pull request 191, so on the Mac the private-path check no longer refuses on entry churn above a private folder. One private-path refusal was seen on the Mac during the sitting, at the first SSH path update attempt described above. Separately, the diagnosis on issue 216 traced the Settings failures to the check refusing a private folder that changes while it is inspected. That is the private folder itself, which pull request 191 left under the full check.

### Bugs found

| Issue | What | State on 2026-10-17 |
| --- | --- | --- |
| 212 | `replace-app.mjs` rename mode cannot upgrade from build 41. | Open. |
| 213 | Tests that used the installed app's Python wrote `__pycache__` into the signed bundle. | Open. The lead briefs now point tests at a separate prepared runtime. |
| 214 | The Windows data copy refuses the Ubuntu retirement checkpoint folder. | Open. |
| 215 | The PC's Claude Code usage command output is not recognised. | Open. Pull request 225 is in build 43, and the issue stays open until the PC reads `usageCommand` `read`. |
| 216 | The Mac Settings page read every value as Unknown until the app restarted, seen at about 20:07 and 20:32. | Open. Pull requests 219, 220 and 221 are in build 43. |
| 217 | Check Tailscale always read unavailable on the Mac, because the bridge environment has no `TERM`. | Closed by pull request 218, in build 43. |
| 222 | Windows status reports placeholder sharing and consent values as Off before its first read. Found in review of pull request 219. | Open. |
| 223 | The Mac Claude Code token source read unavailable at the reader's 128 MiB history limit. | Closed by pull request 224, in build 43. |
| 226 | The peer lock sometimes refused its own journal under concurrency on macOS CI. | Closed by pull request 227, in build 43. |
| 229 | `peer-tls-client` tests time out on slow Windows CI runners. | Open. Pull request 230 is merged, and the issue stays open until more slow-runner passes on `main`. |

### Not exercised on build 42

- On the Mac: the Start at login switch (the Settings page lists it, but its state was not read), login startup, sleep and wake, the clean-environment Claude Code prompt (M-13), `--panel-timing`, the skin facts lines and `build-strings.mjs --check`.
- On both devices: Refresh from the panel with `finishedAt` advancing within 60 seconds, P1-6 from T-3 on, the Finish half of O1-3, and done items 6 and 7.

## Build 43

Recorded on 2026-10-17 from the Mac. Build 43 carries the fixes for issues 210, 216, 217, 223, 226 and 229 and the usage command change for issue 215 (pull requests 211, 218, 219, 220, 221, 224, 225, 227, 230 and 231), plus pull request 232, which raised the build number.

### Release revision and packages

- `REV43` is `02555e82e04a57636ae33ae24237ff4631533bb9` (pull request 232). `native/Release.props` there says build 43.
- Script suite run `38994239128`, dispatched on `REV43`, succeeded.
- Clean Windows package run `38996117293` on `REV43` succeeded. Its log reports the installer artifact digest `sha256:fc2363e20f52a00111d0c67ffdc5c2b0fba0faba33ba2d654156c0ade3e0fce1` and the package artifact digest `sha256:7909a83ed653ccf6c8bc9340ed3df7d426e4730ed3e9b8ebfbb88a8736565584`. The setup file's own SHA-256 is not recorded, because the artifact was not downloaded. A listing of the run's artifacts at about 03:40 on 2026-10-18 returned none, which fits the one-day retention.
- Mac: `native/build.mjs` at `REV43` with the macOS 26.5 SDK exited 0 on its second attempt. The first was stopped when the Claude app closed. `package.mjs --zip-only` verified the ZIP. `Observatory-0.3.14-macos-arm64.zip` is 66,394,917 bytes with SHA-256 `d792b69a7feb7c5bbff84b981ad4b7ceb5033c9180790fb9ff18a3adddf3f37e`. Its manifest lists 1,797 files and 191,634,573 bytes unpacked.

### Mac install

- Build 42 was quit at 04:02:12 on 2026-10-17 (00:02 local). With the app quit, the data folder was copied to `Observatory Backups/build43-from-build42-20261017T040212Z`, and the copy matched by SHA-256. `build42-from-build41-20261016T193112Z` then went to the Trash. The Mac now keeps `build43-from-build42-20261017T040212Z` and `p16-before-pairing-20261016T202349Z`.
- The candidate was extracted from the verified ZIP and passed strict signature verification. `replace-app.mjs` ran in normal mode, because the installed app was already named `Observatory.app`. The previous receipt was build 42's `app-manifest.json` from its package step, and the candidate receipt was build 43's. The journal in `~/Applications/.observatory-update-ZV2cAX` records `prepared`, `previous-retained`, `candidate-promoted` and `payload-verified`, and build 42 is retained in its `previous` folder. The build 41 copy from 2026-10-16 is still in `.observatory-update-manual-20261016T193200Z`.
- Installed target: `build-info.json` records 0.3.14 build 43, source `REV43` and `sourceDirty` false. Strict signature verification passed and `--self-test` returned 0. `--test-web` and `--test-collector` were not run on the installed build 43.
- The app was started with the Mac launch line above. It was closed for under half a minute.
- Tailscale: the installed `tailscale-status.mjs`, run with the bundled Node and only `HOME`, `USER`, `PATH=/usr/bin:/bin`, `LANG` and `TMPDIR` set (no `TERM`, as in the bridge's environment), reported `running`. The Check Tailscale button in Settings was not pressed.
- Status read while writing this record, at about 03:43 on 2026-10-18: the last collection finished at 03:34:23 with state `ok` and 10 of 10 sources. `snapshot-status.mjs`, run with the bundled Node, read every activity, tokens, settings and dictation row as `ok` for both devices, and the Mac's Claude Code token source as `ok`. Codex limits read `ok`. Claude Code limits read `ok` with the `seven_day` window only and the usage command `read`. The combined token total read `unavailable`. The Windows rows were last checked at 21:11 on 2026-10-17, about six and a half hours before the read, while the PC was offline. The bundle held no `__pycache__` folder.

### PC

Build 43 is not installed on the PC. The upgrade steps were sent to the Windows session at 02:51 on 2026-10-17, and no report has come back. The PC has been offline since then, so its last recorded state is build 42 from the sitting above.

### What is verified on an installed build

| Check | Mac | PC |
| --- | --- | --- |
| Build 42 identity, signature or manifest, and self-tests | Verified on 2026-10-16 | Verified on 2026-10-16 |
| Data copy to the Observatory folders, earlier folder kept until the checks passed | Verified on build 42 | Verified on build 42 |
| SSH path update and one collection each way | Verified on build 42 | Verified on build 42 |
| Combined token total `ok` | Not verified (`unverified` on build 42, `unavailable` on build 43) | Not verified (`unavailable` on build 42) |
| Claude Code and Codex limits both read | Verified on build 42 and build 43 | Verified on build 42, through the status line only |
| Light appearance, grey text and tray panel (owner) | Verified on build 42 | Verified on build 42 |
| Old viewers gone (item 5) | Verified on build 42 | Verified on build 42 |
| Build 43 identity, signature and self-test | Verified on 2026-10-17 | Not installed |
| Tailscale status script without `TERM` | Verified on build 43 | Not affected (issue 217) |
| Tailscale pairing between the installed apps (P1-6) | Not verified, stopped after T-2 | Not verified, stopped after T-2 |
| First-run wizard opens on a fresh folder (O1-3, first half) | Not run | Verified on build 42 |
| O1-3 Finish with ActivityWatch and the working app after it | Not exercised | Not exercised |

## Next decisions

Updated on 2026-10-13.

1. Resolved. The permission entry on the Windows `AppData` folder was no longer present when read on 2026-10-13. Later that day the entry was found to be visible only to processes started from a Claude desktop session. See "Build 40 install on Windows" and issue 58.
2. Done. Windows and Mac were re-paired on 2026-10-13.
3. Decided. The design direction lists local benchmarks for removal from both apps ("Removals"). The saved records are kept, since removal from the interface does not authorize deleting them. Recorded on 2026-10-14.
4. Done. Build 40 was installed on Windows on 2026-10-13 from CI run `38443842036`.
5. Open. Decide what to do about issue 58: document how to start the Windows app, report the situation in Source health, or review the ancestry check.
