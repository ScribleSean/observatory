# Observatory 0.3.13 candidate

Status: Both development devices run build 29 from `c23ad3b6aaad92d986d368cd11eebb9da8eb3c86`. Neither is published as a production release.

## Build 29 verification, September 22 UTC

Build 29 contains the native UX follow-up below. Both recoverable development upgrades and initial collections are verified. Full native interaction, motion and accessibility acceptance remain pending.

The [clean Mac build 29 run](https://github.com/ScribleSean/observatory/actions/runs/35678888315) passed at source `c23ad3b6aaad92d986d368cd11eebb9da8eb3c86`, with 557 test passes, 15 platform skips and no failures. The retained ZIP was independently verified locally against its checksum, all 1,863 manifest entries and strict nested signatures.

- ZIP size: 68,367,959 bytes. Unpacked app: 197,329,754 bytes.
- ZIP SHA-256: `44c46f9f630eb5d8347c8ff4bb84d9b666a8d468da764b7b6b6b0c01e9801c32`.
- Signing remains ad hoc, without notarization. The development installation is not a clean-machine or production-distribution result.

The local Windows build at the same source passed 526 tests with 46 platform skips and no failures. Its full 3,068-file manifest passed for an unpacked candidate of 268,902,556 bytes. The retained manifest SHA-256 is `f35a95b3ed574ff6dac63655fed66dd305d535f98a9bfcef1c90ef380bd26c86`. The separate TEST installer passed. The ordinary unsigned installer subsequently completed the development upgrade recorded below.

- Ordinary installer: 100,443,284 bytes, SHA-256 `f83fbefdea10de1a29747b97f7c6df20b1817e89e5dd27fed158c9f97ba5b8a6`.
The [hosted Windows verification run](https://github.com/ScribleSean/observatory/actions/runs/35678894118) passed full package and installer checks. It verified normal packaged startup, native extraction and staging, wrong-signer rejection, retained authenticated receipts, recoverable replacement and normal dashboard readiness. These disposable update checks use synthetic signing; production signing and update-feed activation remain open.

## Windows build 29 development upgrade, September 22 UTC

The ordinary installer replaced build 28 after normal shutdown. Both the old and
new payloads were checked against independent package manifests. Recovery retains
all 3,070 previous app files and a saved-data backup. All 306 saved files retained
their hashes through installation before relaunch; startup preferences and the
Start menu shortcut were preserved.

The app acknowledged normal readiness as `0.3.13.29` and remained running. Its
first collection completed at 02:39:56 UTC with all seven configured sources
read successfully. The completed one-time upgrade launcher was removed. This
verifies the installed payload and collection, not full visual, motion or
accessibility acceptance.

## Mac build 29 development upgrade, September 22 UTC

The staged Mac candidate replaced build 28 after a normal Quit. Full package-manifest and strict nested-signature checks passed before activation. The prior app remains in recovery, and seven specifically checked configuration, snapshot and private-allowance files were unchanged after replacement.

The launched Settings view visibly reported build 29. The initial collection at 02:47:18 UTC was partial: 12 of 13 reads completed because ActivityWatch was unavailable. This verifies the installed payload, preserved checked state and an honest unavailable-source result. Later scheduled coverage changed, as recorded in the [installed UI review](UI-VERIFICATION.md#installed-build-29-review-september-22). Neither observation establishes complete screen-time coverage, motion, accessibility or every native interaction.

## Build 28 permission-check repair

Build 27 Windows verification exposed a race in permission inspection. A child
file could disappear between directory enumeration and `Get-Acl`, causing a
concurrent allowance exchange to report unavailable despite retaining its readings.
A constrained native Windows fixture reproduced the failure and identified
`ItemNotFoundException` while reading a child ACL in `private-repair`.

Build 28 retries the entire inspection once for that specific condition. The
retry verifies the root and every current child. Invalid permissions and other
errors still fail closed. No lock or request timeout was increased. Windows
regressions verify disappearing-child classification and rejection of broad root
and file permissions. Three constrained simultaneous-exchange runs passed after
the repair.

The [clean Mac build 28 run](https://github.com/ScribleSean/observatory/actions/runs/35660345401)
passed at source `97f1f1a1661cacbe92b76d47adf9a09439de6d3d`, with 554 test passes,
15 platform skips and no failures. Native updater, extracted collector, WebKit
and window lifecycle checks passed. The retained ZIP was independently verified
locally against its checksum, all 1,862 manifest entries and strict nested signatures.

- ZIP size: 68,358,612 bytes. Unpacked app: 197,296,631 bytes.
- ZIP SHA-256: `e34009220d1cb1a399c597b25dc338a5036fc09c663e72065117fd0682330340`.
- Signing remains ad hoc, without notarization. The Mac development installation
  is recorded below.

The local Windows build at the same source passed 523 tests with 46 platform
skips and no failures. Packaged sharing and allowance bridges, sync-owner
lifecycle, Python SQLite and timezone checks, and the full 3,067-file manifest
passed. The unpacked candidate is 268,898,965 bytes. Its independently retained
manifest SHA-256 is
`c97f1ccf1114254ece183b7c46678813f4bc2257c95a50d8999dbc3322e7d3d0`.
The separate TEST installer passed installation, payload hashes, running-app and
overwrite refusal, linked-path rejection, saved-data preservation, uninstall and
reinstall. No ordinary app registration was modified. The ordinary unsigned
installer was compiled and retained. Its subsequent development installation is
recorded below.

- Ordinary installer: 100,441,067 bytes, SHA-256
  `970e6d5c9816fe6a362b29ff001ab13d0b4bf38a0dc73ff9ac4aabcaf26d2e37`.
- TEST installer: 100,440,940 bytes, SHA-256
  `67fa72170dbce76b7847c4934889bed6b9b191991ce134556ca1a17a036d5e10`.

The [Windows build 28 run](https://github.com/ScribleSean/observatory/actions/runs/35660343229)
passed full package and installer verification. The clean runner also verified
native extraction and staging, wrong-signer rejection, authenticated receipt
retention, recoverable replacement of a complete disposable installation, normal
dashboard readiness and cleanup. These update checks used a synthetic signer.
They do not establish production signing or update-feed activation. Build 27
artifacts below do not contain this repair and are earlier verification evidence.

## Windows build 28 development upgrade, September 21

The ordinary installer at source `97f1f1a` replaced build 26 after its normal
quit completed. The previous installed payload was verified before replacement.
A private recovery folder retains all 3,070 previous application files and the
saved-data backup. All 306 saved files retained their pre-upgrade hashes through
installation and before relaunch.

The installed payload matched the independent build 28 manifest. Startup
registration and the Start menu shortcut passed verification. The app acknowledged
normal dashboard readiness as version `0.3.13.28` in the interactive user session.
Its first collection finished at 22:18:47 UTC with all seven configured sources
read successfully. The app remained alive, and the completed one-time upgrade
launcher was removed. Full native interaction acceptance remains pending. This development upgrade does not enable production updates.

## Mac build 28 development upgrade, September 21

The verified Mac candidate replaced build 25 after a normal Quit. The replacement
rechecked both package manifests and signatures, retained the previous app in
recovery, and preserved all seven checked configuration, snapshot and allowance
files. The launched native Settings view confirmed version 0.3.13, build 28.

The latest observed collection was partial, with 12 of 13 configured reads
successful. Mac ActivityWatch was unavailable. Saved token, settings and dictation
sources reported OK. These observations do not establish complete screen-time
coverage or full native interaction acceptance.

## Native UX follow-up in source

Build 29 contains this follow-up and is installed on both development devices.

The style follow-up keeps the existing Mono Charts, Apple composition and Hart
direction. Windows token-class tables now use readable metric labels. Mac Activity
keeps saved-history and tracking status visible, with detailed recovery guidance
in an expandable section. Both daily-history views use singular date wording for
one recorded date.

The recent allowance snapshot now labels its full snapshot range Latest 24 hours.
All retained remains available in the separate account-history browser, which
reads the selected account archive and shows unknown gaps without fabricated
observations. The change leaves retention, counters and account boundaries intact.

A shared native token file now supplies both palettes, type sizes, spacing and
card dimensions. Windows links and selected chips follow the same accent. Tokens
and Activity place their headline, chart and coverage note in one card with soft
monochrome bars. The archive entry is a compact action. Windows Settings uses
grouped sections and wrapping action pills, and Activity coverage timestamps use
local date and time.

Swift and Windows compilation and native self-tests passed. The synthetic Windows
dashboard fixture verified navigation, source settings, device callbacks, consent
and theme changes. Bundled-font Mac previews cover light and dark Allowances,
Tokens, Activity and Settings, plus enlarged text and dashed archive gaps. Twenty
focused theme, archive and documentation checks passed. Installed interaction,
motion and accessibility acceptance remains open. The later live Mac review also found long-history date clipping and an Activity chart missing an axis unit; source repairs for those findings are under verification and are not in build 29.

## Build 27 verification, September 21

Build 27 pins Node 24.21.0, with OpenSSL 3.5.8 and SQLite 3.53.4.
The build 27 observations below predate the build 28 installations recorded above.

The [clean Mac run](https://github.com/ScribleSean/observatory/actions/runs/35656225687)
passed at source `ae5451e8413b43b4ca0d03ee8ef209d3fd730841`, including
554 JavaScript tests, 14 platform skips, native checks, updater integration,
and extracted ZIP checks. The exact ZIP was downloaded and independently checked
against its checksum and all 1,862 manifest entries. Strict nested signature
verification passed on the local extracted copy.

- ZIP size: 68,358,326 bytes. Unpacked app: 197,296,005 bytes.
- ZIP SHA-256: `abfc4e6142e26ba5b73b90a65f59425a8fad7905ec75ab19f0d21eda1a64e6ca`.
- Signing remains ad hoc, without notarization. This is not a public release
  or evidence of clean-machine installation.

Extracting under a file-provider-managed Documents directory added Finder metadata
that caused strict signature verification to fail. Extracting the unchanged ZIP
into local temporary storage passed both the manifest and signature checks.
Keep application staging outside managed Documents folders.

The earlier Windows clean run reached the allowance-sharing fixture's overall
two-minute deadline after three passing checks. The Windows-only fixture deadline
is now five minutes to accommodate repeated PowerShell directory-permission checks.
Individual I/O deadlines and all assertions are unchanged. All five fixture tests
passed on native Windows and Mac with the pinned runtime. The
[replacement Windows package run](https://github.com/ScribleSean/observatory/actions/runs/35656223675)
failed in a concurrent allowance fixture. A subsequent run also failed in a
second simultaneous-exchange fixture. The constrained diagnostic then identified
the disappearing-child permission race fixed in build 28 above. These failed
runs do not establish package or installer acceptance.

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

A read-only reconciliation of the Mac and upgraded Windows saved snapshots found
identical per-device, per-date values for all six token counters. Independently
summing the three device rows by date reproduced each combined counter. The
collector reported verified inventories with no shared sessions or cross-host
parents. This checks retained-record agreement after the upgrade, not provider
billing completeness or recovery of unrecorded usage. Personal usage records and
aggregate values remain outside the public repository.

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

- Resolve and verify the post-build-29 native layout and chart-label findings.
- Complete installed interaction, signing/distribution, clean-machine and lifecycle coverage described in the release checklist.

No raw messages, transcripts, credentials or private snapshots belong in an
artifact or its verification report. Synthetic fixtures are used for UI checks.
