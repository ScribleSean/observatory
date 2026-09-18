# Observatory 0.3.13 candidate

Status: development build 25 is installed on Mac and build 26 on Windows. Neither is published as a production release.

## Refreshed Windows build 26, September 18 UTC

Clean source `b6ad17cf1f9f57bb02c220590691632318d51b37` adds Source health naming
and the responsive saved-history card repair to the earlier build-26 candidate.
The full Windows build reported 522 test passes, 46 platform skips and no failures
across its four test groups. Packaged native contracts, isolated sharing/archive
bridges, sync-owner lifecycle, Python/Node runtime checks, privacy inspection and
all 3,067 manifest entries passed. The package is 262,303,205 bytes unpacked;
its independently retained manifest SHA-256 is
`c1021d6658d0e31fb72b34deda0a9502bdb0426748af368f85083c2a2bc29cf2`.
The exact packaged dashboard and popup fixtures passed on the development desktop.

The separate unsigned TEST installer is 98,712,832 bytes, SHA-256
`5b57c3f233a783fa91df207873d83da1755d5c8c922a56d5980a14c3edb71660`.
Its integration checks passed installation and payload hashes, running-app and
overwrite refusal, linked-path rejection, saved-data preservation, uninstall and
reinstall. An outer invocation incorrectly checked an unset native-process exit
variable after the PowerShell script had completed successfully. Independent
checks confirmed removal of the test installation, shortcut, uninstall and startup
registrations. The ordinary application remains build 25.

This refreshed candidate is unpublished. Its development installation is recorded below. The normal update-startup
check was explicitly skipped on the personal device; the hosted replacement check
below covers its named earlier source.

The ordinary unsigned installer was compiled separately from a clean checkout at
the exact package revision. Its metadata confirms build 26 and the manifest hash
above. It is 98,712,850 bytes, SHA-256
`d414f4abd693dcedc1e63b3e68c01efc5445defab4138de1795c27f212ec0c71`.
The generated checksum was independently checked. The ordinary development upgrade
below is separate from the earlier TEST-installer lifecycle evidence.
The retained Mac candidate remains at `660073c`; this Windows candidate does not
establish current Mac package acceptance or production updates.

## Windows build 26 development upgrade, September 18 UTC

The ordinary `b6ad17c` installer was applied after build 25 handled its normal quit
request. The previous installed payload was checked against its independently
retained manifest before replacement. A private recovery directory retains all
3,070 previous application files, saved data, shortcuts and registration metadata.

All 306 saved-data files matched their pre-upgrade hashes after installation and
before relaunch. The installed payload matched the new candidate manifest; startup
registration and the Start menu shortcut were checked. The app acknowledged normal
dashboard readiness in the interactive session as version `0.3.13.26`. The one-time
upgrade launcher was removed. Its first collection finished at 00:19:49 UTC with
all seven configured sources read successfully.

This installs the Windows popup recovery, Source health labels and narrow history
card repair. It does not prove every tray interaction, keyboard/accessibility path,
clean-machine installation or automatic update transaction. Mac remains build 25.

## Clean Windows verification, September 17

The [clean Windows run](https://github.com/ScribleSean/observatory/actions/runs/35287676897)
passed at source `647be4466cb2693e2649bd6dd07bfaa3434f0fa2`. The earlier attempt
failed a TLS acknowledgement deadline during parallel permission-heavy tests.
The affected fixture passed independently and now runs in the existing separate
test group, with authentication checks and production timeouts unchanged.
The corrected full package workflow passed.

All 29 signed-archive regressions passed without skips. The isolated installer
passed installation, payload hashes, ownership and overwrite guards, linked-path
rejection, uninstall, reinstall and data-preservation checks. On the disposable
runner, the ordinary installation then passed signed archive extraction and
staging, wrong-signer rejection, replacement through the verified external helper,
recovery retention, normal dashboard readiness and graceful quit. The installed
receipt retained the exact authenticated envelope. The ordinary installation was
removed after verification.

The update fixture used a synthetic signer and one payload with advancing receipt
metadata. It does not prove migration between distinct release builds, production
key/feed delivery or the user-facing update action. The retained candidate hashes
below and the installed development applications remain unchanged. Later Mac
routing and Source health label changes need their own packaged acceptance.

## Clean Mac verification, September 17

The [clean Mac run](https://github.com/ScribleSean/observatory/actions/runs/35288576766)
passed at source `74ae01ec42197fa629c05b4b64967d21bfcb7194`. Its JavaScript suite
reported 554 passes, 14 skips and no failures. The complete app build passed
native self-tests, archive and collector bridges, sync-owner and shutdown checks,
renderer and lifecycle checks, and all three popup variants. The popup fixture
now waits for actual AppKit activation before hiding the dashboard instead of
assuming a fixed delay is sufficient. The assertion that reopening the popup
keeps that dashboard hidden remains unchanged.

The bundled Sparkle integration smoke test and ZIP verification passed, including
privacy and manifest inspection, nested signatures, extraction and relocated
collector, renderer and lifecycle checks. The runner produced a 66,062,487-byte
ZIP and a 188,092,365-byte unpacked app. These temporary CI outputs were not
retained as release downloads and do not replace the candidate hashes below.
This source also includes the later Mac web-fallback navigation correction.

The app remains ad-hoc signed, with no production update trust or notarization.
This verifies a clean build and synthetic package behavior, not an installed
upgrade, complete native accessibility or production update delivery.

## Build 26 candidates, September 17

Clean source `660073c957bc38f0107dc5ad46262c128da76edd` was packaged for both
platforms. Build 26 includes the later Windows popup failure/retry repair and the
web Agents view. Installed development applications remain build 25.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| macOS arm64 ZIP | 65,251,313 | `ff57da67f0189c5204f3d4f06c801ec228f54cf62241541023f0f9b17cd3d5da` |
| Windows x64 setup EXE | 98,712,660 | `adfbd42e67c3e521452d26d248f2af41d49bcfe33a8359f22e499e13e1dffbff` |

The Mac candidate passed native build checks, full package and privacy inspection,
nested signatures, ZIP extraction, relocated collector and renderer checks, and
window lifecycle checks. Its unpacked size is 187,241,469 bytes. The ZIP has an
independent manifest, checksum and verification receipt. No DMG was requested.

The Windows candidate passed native/runtime, sharing, archive, sync-owner and
update-verifier checks. Full inventory verification covered 3,067 files and
262,302,169 bytes. Its packaged popup ran in the signed-in desktop session with
fictional records and passed failure, successful retry, concurrent-refresh
exclusion, host changes during refresh and on-screen placement checks. The
rendered failure state was inspected and the one-time test launcher removed.
Normal update startup was explicitly skipped because it requires a disposable
hosted runner.

A separate TEST-identity installer made from this exact candidate passed per-user
installation, all payload hashes, native self-tests, shortcut and registration
checks, running-app and overwrite refusal, and linked-directory rejection.
Uninstall preserved a synthetic saved-data file and unrelated files and registry
values. Reinstall and preservation of another startup owner also passed. The test
installation, shortcuts and saved-data canary were removed afterward. The ordinary
build-25 installation remained unchanged.

The ordinary Windows installer was compiled and checksummed, not installed.
The isolated TEST identity does not establish ordinary build-26 upgrade behavior,
clean-machine compatibility or installed dashboard acceptance.

Source `660073c` also passed hosted [Mac and Windows native checks](https://github.com/ScribleSean/observatory/actions/runs/35286024550),
[update safety on both platforms](https://github.com/ScribleSean/observatory/actions/runs/35286024506)
and the [complete demo workflow](https://github.com/ScribleSean/observatory/actions/runs/35286024433).
These candidates remain ad-hoc signed on Mac and unsigned on Windows, without
production update trust. They are retained development artifacts, not public
release downloads. Earlier build-25 installation and data-preservation evidence
below does not establish build-26 upgrade behavior.

## Build 25 development upgrade, September 17

Source `53fa934` was built, packaged and installed on both development devices.
The shared reader now includes all retained session and archive dates for tokens,
while keeping settings and tool details within their recent window. It reuses
its private sanitized-event cache, including on Ubuntu. Cold-cache totals remain
unavailable until the selected history is complete. Recorded turn identities
and matching counters prevent inherited fork events from being counted twice.
See [source coverage](SOURCE-COVERAGE.md) for the limits of this evidence.

The Mac ZIP passed independent manifest, privacy, strict deep signature,
extraction, relocated collector, renderer and lifecycle checks. Its SHA-256 is
`2512c46726b69da9ef61229956e9111fcef200b929b07d1e594a792c39810387`.
The ZIP is 65,251,268 bytes and the unpacked app is 187,241,222 bytes.
The Windows candidate passed native and bundled-runtime checks and full inventory
verification for 3,067 files totaling 262,298,338 bytes. Its installer SHA-256 is
`73b4c275c93d3d4808bd2e132fff3327d5aea81b861cfe6db761dc5d739743ec`.

Both upgrades followed normal application quit and retained the previous payloads
for recovery. Seven checked Mac configuration, snapshot and allowance files and
all 306 Windows saved-data files were unchanged before relaunch. Both installed
apps ran again. Their collectors subsequently reported matching retained totals
across Mac, Windows and Ubuntu, with verified disjoint cross-device inventories.
The one-time Windows installer launcher was removed after completion.

This is development-device verification, not a public release. The Mac app is
ad-hoc signed and the Windows installer is unsigned. The Mac Documents permission
prompt recurred after the new build, and the user allowed it. A subsequent locked
refresh read all 13 configured sources. Stable signing, permission continuity,
clean-machine compatibility and production update delivery remain unresolved.
The unavailable UI-control connection also limits interactive acceptance claims.

## Hosted verification, September 16

Source `b2515f63cfc0ac63d1c1f04114a05258c0d462d9` passed the
[complete clean Windows workflow](https://github.com/ScribleSean/observatory/actions/runs/35109329651)
in 17 minutes 20 seconds. This is newer source verification, not a replacement
for the prepared candidate artifacts listed below.

The run built the self-contained package and passed all 29 signed-archive
regressions without skips. It verified normal startup, graceful quit, installer
ownership and overwrite guards, linked-directory rejection, and preservation of
saved data and unrelated registry and startup entries during uninstall.

On the disposable runner, the ordinary installation then passed signed archive
extraction and staging, wrong-signer rejection, replacement through the verified
external helper, recovery retention, normal dashboard relaunch and graceful quit.
The installed receipt matched the candidate envelope byte for byte and passed
signature verification. Setup state remained unchanged, no unexpected data files
were present, and the ordinary installation was removed after verification.

The fixture used an ephemeral synthetic signer and the same application payload
with an advancing receipt. It does not prove an upgrade between distinct release
builds, production key or feed delivery, or the user-facing Check for updates
flow. No production release was signed or published. The existing development
installations and the candidate artifact hashes below were not changed by this run.

The same source passed [Mac and Windows native checks](https://github.com/ScribleSean/observatory/actions/runs/35109300055),
including Windows updater script integration, and [update safety and official
signer interoperability](https://github.com/ScribleSean/observatory/actions/runs/35109300040).
The regression work corrected Windows temporary-path normalization in the test
fixture and required the installed receipt in the final data inventory. It did
not relax the application's path, signature or inventory validation.

### Disposable Mac signed replacement

On September 16, Sparkle 2.10.0's upstream CLI was compiled against the pinned
framework and used with a loopback feed and ephemeral Ed25519 key. Two disposable
copies of the `9f9cec8` candidate used a unique test bundle identifier and synthetic
bundle versions 24 and 25. A bad archive signature failed with Sparkle error 4005
and left version 24 intact. The valid signature completed replacement with exit 0
and version 25. All 1,879 installed file and symlink entries matched the candidate
payload, and strict deep code-signature verification passed.

This verifies feed parsing, signature enforcement, extraction and replacement via
the external CLI. It does not verify Observatory's Update menu, app relaunch,
distinct-build data migration or the production feed. The payload code was the
same in both versions. No production key or normal installation was changed.

### Clean Mac build with Sparkle

The [clean Mac workflow](https://github.com/ScribleSean/observatory/actions/runs/35112006086)
passed at source `c278c8f4b72f2f690762ab6df6f3e2488c31eb02` in 4 minutes 53 seconds.
It fetched checksum-pinned runtimes and Sparkle 2.10.0, built the complete Apple
Silicon app, and compiled the native updater smoke test against the framework
inside that app. The smoke test verified delegate bindings and rejection of
missing release trust before updater initialization.

ZIP verification passed, including file and privacy checks, nested signatures,
extraction, relocated collector and archive bridges, rendering and dashboard
lifecycle checks. The runner produced a 66,056,303-byte ZIP and a 188,069,099-byte
unpacked app. These temporary CI outputs were not retained as downloadable release
artifacts and do not replace the candidates below. The app was ad-hoc signed.
No production key, update feed, notarization or complete Sparkle update transaction
was verified by this run.

## Mac development upgrade, September 17

The retained `73d1145` build-24 candidate replaced the installed build 22 after
normal application quit. The retained ZIP matched its recorded SHA-256. The
replacement verified the old and new payloads against independent manifests and
passed strict deep code-signature verification. The previous app and both
manifests remain in a local recovery directory. Seven checked configuration,
snapshot and allowance files were byte-identical before and after replacement.

The installed app relaunched normally. Its Allowances view rendered and Settings
visibly reported version 0.3.13, build 24. Check for updates displayed the expected
notice that updates are unavailable pending release verification. Production
signing and feed delivery remain unconfigured. The UI-control connection closed
after these checks, so further interactive checks were not verified in this pass.
The app process remained running. A subsequent allowance collection completed
successfully after relaunch. A full collection attempt read 12 of 13 configured
sources. Configured agent receipts reported a read timeout, so complete source
health remains unverified. The user reported a renewed Observatory Documents
access prompt. The old and new ad-hoc signing requirements differ, matching the
known [permission continuity limitation](MAC-PERMISSIONS.md). Stable signing and
permission preservation across upgrades remain release requirements.

## Windows development upgrade, September 17 UTC

The ordinary `2b44466` build-24 installer was applied on the development Windows
machine after a normal tray-menu quit. The installed build-23 payload first
passed full inventory verification against an independently retained package
manifest. A restricted local recovery directory retained the old application,
saved data, shortcut and registration evidence before uninstalling anything.

The new installed payload passed full inventory and ownership verification.
All 306 saved-data files matched their pre-upgrade hashes before relaunch, and
3,056 previous application files remain available for recovery. The existing
startup setting was restored and the new Start menu shortcut was present.
Build 24 acknowledged readiness in the logged-in desktop session and subsequently
completed its configured source reads successfully. The temporary launcher was
removed, leaving the application running.

This verifies one development-machine upgrade from build 23 to build 24. It does
not establish clean-machine compatibility, actual login startup, sleep/wake,
visual dashboard verification, or production signed-feed delivery. The Windows
process API returned no main-window handle, so process readiness must not be read
as proof of a visible dashboard. The installer remains unsigned and unpublished.

## Retained Windows candidate, September 16

After the Windows development host returned online, its clean release checkout
was fast-forwarded from `9f9cec8` to `2b44466`. The new self-contained package
passed native/runtime and manifest checks, its synthetic dashboard test, and all
29 signed-update archive regressions with no failures or skips.

The separate TEST installer passed installation, payload verification, running-app
and overwrite refusal, linked-directory rejection, uninstall and reinstall, with
saved test data and unrelated registrations preserved. The ordinary installer was
compiled and retained without executing it against the development installation.
Its transferred SHA-256 matched the Windows artifact:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Windows x64 setup EXE, source `2b44466` | 98,710,693 | `003ad911e4e69162dc5b6b7e6c709fa12261089e1e8a9a4588421c34aa46f970` |

The candidate remains 0.3.13 build 24, unsigned and unpublished. During candidate preparation, the development installation remained 0.3.12
build 23. The later installed upgrade is recorded above.
Synthetic Settings and the 800-by-560 allowance view were inspected. This does
not establish full accessibility, real-source migration, or production update
feed verification. The hosted ordinary-install evidence above remains separately
scoped to its named source and disposable runner.

## Retained Mac candidate, September 16

A new Mac ZIP was built from clean source `73d1145` with the pinned runtime and
Sparkle framework. It remains version 0.3.13, build 24, and is not an advancing
update for an existing build 24. The ZIP is 65,244,958 bytes with SHA-256
`94a3d38598f7c238b239a9500ca0c2030e124b3a6ece66764933893717e39b59`.
The unpacked app contains 187,219,003 bytes.

The retained ZIP has an independent file manifest, checksum and verification
receipt. Native build checks and ZIP extraction checks passed, including nested
signatures, archive access, disabled-source collection, rendering and dashboard
lifecycle. The build also passed synthetic pairing, shutdown and popup checks.
The app is ad-hoc signed, has no production update trust, and remains unpublished
and uninstalled. No DMG was requested. The newer Windows candidate is recorded above.

## Current candidate evidence, September 15

The paired September 15 artifacts use clean source
`9f9cec8ec48230f4b4173319b2a55341d9a59d2f`. They remain unpublished build-24
candidates. They are not advancing updates for an installed build 24. Source
changes after this revision do not change these artifact identities.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| macOS arm64 ZIP | 65,244,956 | `c8974b6da983cfaf21e05afdff778ae1a74d5a4937b4d517e4f8ebb343c8ee96` |
| Windows x64 setup EXE | 98,710,668 | `5c0bb6f2637e4697a35d950d07d703785711a235000cc3c55f3511916788f170` |

The Mac manifest covers 187,219,003 payload bytes. The Windows manifest covers
262,294,538 bytes in 3,067 files. Compressed artifact sizes are 62.2 MiB and
94.1 MiB respectively. These are disk sizes, not runtime memory measurements.

| Area | Verified for this source | Remaining boundary |
| --- | --- | --- |
| Mac package | Full native build, synthetic archive/sync/shutdown/collector/UI checks, privacy and file inventory scan, nested signatures, ZIP extraction and relocated runtime/UI checks. | Ad-hoc signed, not notarized. No current-candidate DMG or clean-machine installation check. |
| Windows package | Fresh web build, self-contained publish, pinned updater/runtime checks, native self-tests, isolated sharing/history/sync bridges, Python SQLite/timezones, manifest scan and packaged synthetic dashboard. | Normal update startup and activation were skipped on the personal machine because they require a disposable hosted runner. |
| Windows installer | Compiled from the same clean package and source. Transferred installer checksum and package-manifest digest matched. A separate full-package TEST identity passed install/uninstall/reinstall, payload hashes, shortcuts, ownership guards and synthetic preservation checks. | Unsigned. The production-identity installer was not executed. TEST identity is not clean-machine production-install evidence. |
| Update configuration | Sparkle 2.10.0 and pinned WinSparkle are packaged. Build-time public-key embedding and configuration rejection checks passed with test values. | No production release keys, signed installation envelope or working release feed are configured in these candidates. Automatic updates remain unavailable. |

Both installed production applications were left unchanged during these candidate
checks. See [desktop updates](UPDATES.md) for the signed update pipeline and its
remaining verification. The older evidence below belongs to the revisions named
there and must not be applied to these new artifacts.

## Changes

- Shared native navigation and styling, clearer saved allowance history entry,
  and improved narrow-window layouts.
- Saved allowance-used charts with Day, Week and All retained periods. Dashed
  connectors disclose missing observations; reset boundaries remain separate.
- Compact counts advance through K, M, B and T. Long durations display days
  with remaining hours and minutes. Unknown data remains unknown.
- Opening the Mac menu-bar popup does not activate the dashboard. Tests cover
  opening without a dashboard and keeping an existing hidden dashboard hidden.

## Evidence before packaging

The preceding source checkpoint passed 535 JavaScript tests on Mac, with seven
skips. The complete Windows development build passed native self-tests and 503
JavaScript tests, with 39 platform-specific skips. No test failures were reported.
Mac synthetic popup checks verify accessible filter defaults and explicit
dashboard/Settings handoff. These checks do not establish every accessibility,
integration or clean-install requirement.

## Earlier candidate package evidence

Build 24 packages use clean source `acdf876864d8c96d76ef1bfa26d9540f40886f67`.
The Mac build, ZIP extraction, native checks and read-only mounted DMG verification
passed. The Windows self-contained payload manifest, runtime and native bridge
checks passed. Its packaged synthetic dashboard test wrote a passing receipt.
The separate test-identity installer passed install/uninstall/reinstall, shortcut
and registration checks, linked-directory rejection, existing-install refusal,
and preservation of saved data and unrelated files/registry values. Test-owned
installation files and registrations were removed. The ordinary app was untouched.
The packaged native collector also completed against a fresh runtime with every
source disabled, retained the consent configuration and reported partial coverage.
This verifies the packaged collector path, not live provider reads.

On September 15, read-only npm advisory queries for production dependencies and
the complete lockfile reported zero known vulnerabilities. The Windows NuGet
query included transitive dependencies, used the existing restore without
restoring packages, and returned no vulnerable entries from nuget.org. Lockfile
SHA-256 values were `caa344b6249b32dfb35f7ed21ec1b035b6eae662e97f239476cdf313bdfa0095`
for npm and `da81446ea7bfe69b9216e393c5dea8e305bc66b43cae4a6afa88d44936ed615f`
for NuGet. These checks do not clear every bundled native library, system webview
or application security boundary.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| macOS arm64 ZIP | 64,238,790 | `79b4058dc3992431fba1e9dfe240fc34ae5875e3641cdae5fbc10ef37c504ae6` |
| macOS arm64 DMG | 71,397,416 | `8e8e709271bbdcc38d018865dc7d2539e0e08c346d750bbe75644a5d11472191` |
| Windows x64 setup EXE | 97,448,151 | `e6f4974ead5b958dd93b5efea1080358c2e250788bafdfddebe5f5e747983896` |

The Mac app is ad-hoc signed, not notarized. The Windows installer is unsigned.
The personal-machine package run skipped update activation and normal startup
checks because they require a disposable hosted runner. The subsequent
[clean Windows run](https://github.com/ScribleSean/observatory/actions/runs/35026365962)
completed those checks successfully against the same source revision. Its log
records signed-inventory validation, wrong-key/stale-build/changed-byte rejection,
native activation with retained previous files, normal dashboard readiness and
graceful shutdown. It also passed actual installer receipt preparation, bounded
archive extraction, complete installation replacement through an external helper,
relaunch acknowledgement, recovery retention and removal of the disposable app.

That run passed 503 JavaScript tests with 39 platform/tool-specific skips and no
failures, plus the native and installer checks. Update signing used ephemeral
synthetic keys. The full replacement test reused one build's payload with an
advancing synthetic receipt. It does not establish migration between different
releases, production signing, a working download feed or the user-facing Update
button. No release was signed or published by the workflow.

A later [full Windows archive run](https://github.com/ScribleSean/observatory/actions/runs/35029917064)
passed at source `4e91e39dae8876cb39d14e4da25b9771b0028f83` in 21 minutes 17 seconds.
It verified a 100,266,406-byte signed update wrapper through bounded native
extraction, complete installation replacement, retained recovery, normal dashboard
readiness and graceful shutdown. Its focused archive suite passed all 24 tests
without skips. The installer tests also confirmed running-app refusal, linked-path
rejection and preservation of saved data and unrelated registry/startup entries.
The disposable installation was removed afterward. This is separate evidence from
the candidate artifacts listed above and retains the same synthetic-key and
same-payload limitations. It does not verify the newer native staging bridge or
change the candidate artifact hashes.

The [packaged native staging run](https://github.com/ScribleSean/observatory/actions/runs/35031326234)
then passed at source `07296b00401a4dbd32274aad83188e92377482a8` in 21 minutes
35 seconds. The clean package contained 3,064 verified files. The focused archive
suite passed all 25 tests without skips. The full fixture used a 100,271,201-byte
signed wrapper and called the packaged native staging bridge. It rejected an
unrelated signer without creating a candidate or changing installed files, then
verified the valid candidate and completed replacement, recovery retention,
dashboard readiness and graceful shutdown. The disposable installation was
removed. Signing remained synthetic, and the advancing receipt still reused the
same payload. Later callback-guard and WinSparkle-library work is not covered by
this run. Downloads, production trust configuration and the Update button remain
unverified.

## Gates remaining

- Upgrade verification against installed Mac build 22 and Windows build 23,
  preserving private data and a recoverable previous application.
- Installed interface and collection checks, signing/distribution limitations,
  clean-machine and lifecycle coverage described in the release checklist.

No raw messages, transcripts, credentials or private snapshots belong in an
artifact or its verification report. Synthetic fixtures are used for UI checks.
