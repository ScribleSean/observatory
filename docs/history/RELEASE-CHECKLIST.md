# Desktop release checklist

Status reviewed October 18, 2026 UTC for build 43. A passing development-machine test is not a clean-install result. This checklist tracks the requested desktop release, not every future integration in the [roadmap](ROADMAP.md). The sections dated September 26, 2026 are kept below as the historical record of build 35 and earlier.

## Build 43, October 18, 2026 UTC

Release candidate: 0.3.14, build 43, source `02555e8` (`native/Release.props`). The planned tag is `v0.3.14-build.43`, the form `native/update-appcast.mjs` uses. Nothing is tagged or published yet.

Installed revisions:

- Mac: build 43 from `02555e8`, installed on October 17, 2026 by replacing build 42 with a recoverable copy kept beside it. The installed `build-info.json` names `02555e8` with `sourceDirty` false. The main binary declares macOS 14.0 and the 26.5 SDK.
- Windows PC: build 42 from `a5a1d3c`, installed on October 16, 2026. Build 43 is not installed on the PC.

Neither install has a section in [the state record](STATE.md) yet.

The checks of "What done means" in [the build plan](BUILD-PLAN.md) and the README checklist on issue 105 have not been run against build 43 on either device. Their results go in [the state record](STATE.md), not here.

### Release steps

Each step names what was done for build 43. "Not run" means the step has not happened.

1. **Script suite on the exact revision.** Run `script-suite.yml` on the release revision on both hosted runners. Build 43: run 38994239128, dispatched on `main` at `02555e8`, succeeded.
2. **Windows package, gated on that suite.** Dispatch `windows-package.yml` on the same revision with installer verification on. Before it builds, it refuses a commit that has no successful Script suite run (push or dispatch) for the same SHA. It uploads the installer and package as workflow artifacts kept for one day only. Download the installer artifact the same day and check its ZIP digest against the one in the run log, the setup file against its `.sha256` sidecar, and `installer-build.json` (version, build number, source revision, clean, not a test identity). Build 43: run 38996117293 succeeded at `02555e8` on October 17, 2026, but its artifacts expired before they were downloaded. A new package run at the same revision is needed, and the PC installs that file. A rebuild is a new file even at the same revision, so its digests are recorded fresh and the expired run's values are never reused.
3. **Mac build on the Mac.** From a clean worktree at the release revision, build with the macOS 26.5 SDK and package the ZIP:

   ```sh
   SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk node native/build.mjs
   node native/mac/package.mjs --bundle "<bundle named in .native-build/app.json>" --output "<folder>" --zip-only
   ```

   Build 43: `Observatory-0.3.14-macos-arm64.zip`, 66,394,917 bytes, SHA-256 `d792b69a7feb7c5bbff84b981ad4b7ceb5033c9180790fb9ff18a3adddf3f37e`. `zip-verification.json` names source `02555e8` and lists the source-clean, privacy-scan, full-file-manifest, nested-signatures, ZIP round-trip and relocated collector, WebKit and window-lifecycle checks. It is ad hoc signed, not notarized, ZIP only (no DMG).
4. **Install the release files on both devices.** Each device installs the exact file that will be published, matched by SHA-256 in its install record. Build 43: installed on the Mac from the build 43 package. The SHA-256 match between the installed bundle and the ZIP above is not yet in an install record. Not run on the PC.
5. **Dependency review.** Record a dated review of the current lock file in [the security notes](../SECURITY.md), and repeat it if the lock file changes before publication. Build 43: the npm review of October 18, 2026 found no advisory in a shipped package. The NuGet query has not run on the PC yet.
6. **One checksum file.** Write `SHA256SUMS.txt` with one line for each asset, then check it with `shasum -a 256 -c` on the Mac and with the install guide's `Get-FileHash` snippet on the PC. Repeat both checks against the published file after publication. Build 43: not run, because the Windows installer has to be rebuilt.
7. **Unsigned warnings.** The Mac build is ad hoc signed and not notarized, and the Windows installer is unsigned. The install guides say so and give the supported steps: [Open an unsigned app](MAC.md#open-an-unsigned-app) for Gatekeeper and [Run an unsigned installer](WINDOWS.md#run-an-unsigned-installer) for SmartScreen. Neither tells people to turn off a system protection. The exact warning text is recorded in the guides after a browser download of the published assets. Build 43: guides written, warning text not yet recorded.
8. **Tag.** An annotated tag on the installed revision, not on a later `main`. Build 43: not run.
9. **Draft release, checked, then published once.** Create the GitHub release as a draft with the two assets and `SHA256SUMS.txt`, and check each asset's name, size and `sha256:` digest against `SHA256SUMS.txt` before publishing. If something is wrong after publishing, return the release to draft and report. Deleting a release, tag or asset needs the owner. Nothing else is published: no update feed, no appcast and no DMG. Build 43: not run.
10. **Demo deploy.** Dispatch `demo.yml` on `main` once. The deploy step must read `success`, not `skipped` (it skips when `main` moved during the run). Then check the live `build-info.json` revision, its fixture digest against `local/usage.json`, and its asset digests against the published files. The demo builds from `main`'s head, which can be later than the release revision. Build 43: not run.

### Gates still open for build 43

- Build 43 installed and checked on the PC, from a new package run (step 2).
- "What done means" verified on both devices against installed build 43, including Tailscale pairing with a pasted invitation between the installed apps (P1-6). That pairing has passed only in the synthetic two-device harness (P1-4). The existing SSH pairing stays until it passes.
- The NuGet vulnerable-package query on the PC (step 5).
- The runtime review that the September 13 section of [the security notes](../SECURITY.md) names as a gate on final publication. It is archived and has not been repeated for build 43.
- Clean-machine installation and first launch on each platform. The development devices are not clean machines.
- Signing and notarization. The release ships with the unsigned-app warnings described in step 7.
- Automatic updates. No production update feed, keys or appcast exist, and none is published with this release. See [desktop updates](UPDATES.md).

## Build 35 state, September 26, 2026 (historical)

Both development apps run **0.3.13, build 35**, with Mac source `ced6698` and Windows source `7c7ae25` retaining identical production application code. Mac local Claude and Antigravity checks passed, and its 14:44 UTC publication read **15 of 15 configured sources**. This does not establish coverage of every provider or combined totals. Missing readings remain Unknown.

Windows installation and readiness were accepted at 14:53:56 UTC, with strict payload and prelaunch saved-state checks, startup and shortcut preservation, and protected recovery. The exact live process was independently verified at 14:55 UTC. Windows local scheduled Claude acceptance passed at 22:50 UTC. The release evidence (archived) preserves exact package and installed pins, earlier failures and the bounded console-observer limitation.

Claude sharing remains off on both devices and installed Claude synchronization is unverified. The latest installed Mac UI observation (archived) verifies selected navigation and Tokens controls. Broader visual, motion and accessibility checks remain unobserved. See audit reconciliation (archived) for remaining acceptance work.

Mac remains ad-hoc signed, Windows remains unsigned, and production updates are unavailable. Repeated Documents prompts remain a [Mac permission continuity limitation](MAC-PERMISSIONS.md). The release is unpublished.

Build-36 packages now passed both hosted full-package workflows and root inventory verification. The Mac candidate also passed independent sibling staging. Neither candidate is installed. See exact candidate pins and remaining gates (archived).

The table below retains revision-specific historical evidence. Older installed or staged versions describe those earlier checks, not the current installation or current clean-install coverage.

## Historical preparation evidence

| Area | Evidence and boundary |
| --- | --- |
| Source and demo | Reviewed source is synced to GitHub and the Windows build checkout. Hosted CI runs tests, TypeScript, the synthetic demo and production build. Public demo records are fictional. |
| Mac app | Installed development bundle `30f91ca` has a native SwiftUI dashboard and menu-bar panel. Native self-tests, bundled-runtime tests, renderer bridge, three window open/close cycles and popup-to-dashboard handoff pass. These checks do not establish normal collection CPU or total helper memory. |
| Mac 0.3.2 artifacts | Clean-source candidate `2265c86` passed full-file inventory, privacy checks, nested signatures, ZIP extraction, relocated runtime/lifecycle tests and DMG integrity/read-only mounted-content checks. ZIP 63,043,485 bytes, DMG 70,086,098 bytes. Ad hoc signed, not notarized. Staged for activation, not installed. |
| Mac deployment targets | The app declares macOS 14.0; its eleven bundled runtime binaries declare macOS 11.0. This is binary-header evidence, not a test on macOS 14. |
| Windows package | Installed clean-source candidate `2265c86` passed native/runtime checks, the isolated sharing bridge and all 3,026 payload hashes. 257,764,341 bytes unpacked. Packaged native-dashboard, system-tray panel and setup-wizard tests passed with fictional data. Python now includes OpenSSL 3.5.8 and SQLite 3.53.1. |
| Windows installer | The unsigned `2265c86` ordinary installer was applied with a verified recoverable app/registration backup. Full installed payload, private-data preservation, responsive desktop launch, Start menu and login registration passed. The preceding `22ec487` test-identity installer passed install, overwrite refusal, linked-directory rejection, data-preserving uninstall and reinstall. Those checks are not a clean-machine test of 0.3.2. The installer remains unpublished. |
| Installed updates | Windows was updated to `2265c86` under its collection lock. Checks preserved configuration, pairing, quota history, private Codex cache and saved snapshots before relaunch. At 01:37:33 UTC its collector had read all six configured sources and incorporated recent Mac records, with combined activity/tokens verified and allowance sharing off. Mac remains `30f91ca`, with its native configuration active and legacy settings retained. Both have recoverable prior-app backups. |
| Retained snapshots | The Mac native saved-snapshot viewer passed file-picker, original timestamp, fictional token count, disabled Refresh, read-only Settings and return-to-live checks. A real installed snapshot was subsequently archived under the collector lock and opened in the installed read-only viewer. Native activation created another retained archive before publishing the new configuration. |
| Installed Mac migration | Prepared source mapping, stale-plan checks and recoverable configuration activation completed on the development Mac. The initial native run reported Mac tokens/settings unavailable, followed by successful direct-reader diagnostics and a paired run with all 13 configured source checks OK. Windows and Ubuntu records appeared in the Mac snapshot. The initial failure's exact cause remains unestablished. This does not prove every migration, bidirectional recovery or source permission scenario. |
| Windows lifecycle development | Collector draining/timeout and installation-gate checks passed in development and in the new package. Installed `2265c86` includes these changes. Exact-candidate synthetic dashboard, tray-popup and setup-wizard checks passed. Forced OS termination, actual login and sleep/wake remain unverified. |
| Native source reads | Packaged development checks read Mac ActivityWatch, Codex and Wispr metadata. Windows checks read local ActivityWatch, Codex, Wispr and optional Ubuntu Codex records. These are one-setup checks with explicit unavailable states. |
| Aggregation | Tests cover overlapping intervals, repeated records, local midnight, daylight saving time, invalid/missing hosts and private-field filtering. Cross-host token overlap blocks combined totals instead of guessing. |
| Private exchange, development | Temporary authenticated Mac/Windows pairings exchanged sanitized records and produced verified combined ActivityWatch and native Codex totals after the bounded Mac cache warmed. Setup retries preserved the generation. Local revocation and standalone fallback have integration coverage. The September 13 UTC installed check confirmed recent records from both devices in both collectors, with allowance sharing off. Rendered-dashboard behavior, network recovery, repair/rotation and complete onboarding remain unverified. See [private sync](PRIVATE-SYNC.md) and [pairing maintenance](PAIRING-MAINTENANCE.md). |
| Dashboard file boundaries | The `30f91ca` packages include the earlier private-file route and linked-path guards. Synthetic native renderer checks on both platforms and HTTP boundary tests are recorded with their limits in [scope and limits](WEB-BOUNDARIES.md). Historical [CI for `231f378`](https://github.com/ScribleSean/observatory/actions/runs/34379515417) is evidence for that revision, not a current security audit. |
| Package advisories and runtimes | September 13 UTC npm and Windows NuGet queries returned no known vulnerable package entries. The identified Windows Python dependency gap was addressed by the installed 0.3.2 runtime, confirmed after activation. Broader advisory applicability, remaining bundled libraries and system webview review remain open. See runtime review (archived) and [security scope](../SECURITY.md). |

Binary candidates retain their embedded source revisions even when later source-only changes are synced. Never relabel an older artifact as a newer build. Rebuild and reverify affected binaries before final publication.

## Release gates as of September 26, 2026 (historical)

The recorded development installations supersede the older installation blockers. The remaining gates below still require evidence beyond those successful upgrades.

- **Private connection:** both installed development collectors incorporated recent peer activity, token, settings and dictation records in the September 13 UTC read-only check. Combined activity and token validation succeeded on both sides, with allowance sharing off. See [installed collection evidence](PRIVATE-SYNC.md#installed-live-collection-september-13-2026-utc). Complete rendered-dashboard verification, authenticated repair/rotation, actual network-disconnection recovery and the remaining native onboarding/confirmation checks. Repeated-transfer and overlap tests do not prove every recovery path. Retain migration backups.
- **Mac distribution:** the build 34 ZIP and installed app (archived) passed full inventory checks, with strict deep signature checks recorded for the package. The app remains ad-hoc signed, unnotarized and unpublished. Stable signing identity, permission continuity, clean-environment installation and broader upgrade verification remain open. Older DMG checks are not build-34 DMG evidence.
- **Clean environment:** verify installation and first launch without development dependencies. Exercise the documented supported OS/runtime prerequisites and disclose untested versions.
- **Lifecycle:** verify actual login startup and sleep/wake, sustained idle and collection resource use, and orderly shutdown on both platforms. A [bounded installed-process-tree measurement](RESOURCE-MEASUREMENTS.md) now includes scheduled collection on both platforms. It does not establish maximum memory, complete source-service cost, CPU or energy use. The earlier all-sources-disabled Mac baseline is not a normal collection benchmark.
- **Migration coverage:** the development Mac completed explicit source mapping, retained archive creation, stale-plan checks, recoverable native configuration activation and a successful paired collection. Broaden permission, interrupted-activation and migration coverage in clean environments before treating this as a general release guarantee. The Windows isolated test covers same-schema reinstall, not every future migration. See Mac migration (archived).
- **Interface:** native dashboard, source settings, first-run wizard and compact panel tests cover selected interactions, not every control. Earlier web dashboard zoom checks must not be treated as native accessibility evidence. Complete the native keyboard, accessibility, enlarged-text and minimum-window checks on both platforms. See UI verification (archived) for dated evidence and limits.
- **Security review:** npm dependency review and the bounded dashboard file-access checks are recorded above. Complete the remaining runtime/application review, verify final artifact privacy and integrity, and disclose unsigned/unnotarized warnings. Recheck advisories before publication. Passing route tests do not establish protection against all filesystem races or a process controlling the same account. Do not call the app vulnerability-free.
- **Automatic updates:** Sparkle and WinSparkle integration, trust configuration, signature rejection and replacement checks have progressed. The hosted Windows lifecycle check (archived) verified a disposable installed replacement, recovery, relaunch and signed receipt preservation. The disposable Mac replacement (archived) verified Sparkle CLI signature rejection and replacement. Both reused a payload with advancing version metadata and synthetic trust. Production keys, immutable feeds and artifacts, user-facing update transactions, distinct-build migration and final installed recovery still require verification. Manual source synchronization and development installations do not satisfy this gate. See [desktop updates](UPDATES.md).
- **Publication:** publish versioned artifacts, checksums, changelog and accurate download links only after the applicable gates pass. Keep the README concise and detailed instructions in this folder. Use synthetic data for screenshots or a later demonstration video.

## Later coverage, not claims of this release

Broader providers, other-provider quota, general shell/SSH history, iPhone activity and standalone Linux UI remain roadmap work. They need their own supported sources, privacy boundaries and verification. Token counts are not subscription charges.

See [source coverage](SOURCE-COVERAGE.md), [Mac verification](MAC.md) and [Windows verification](WINDOWS.md) for measurement limits and commands.
