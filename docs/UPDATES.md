# Desktop updates

Automatic production updates are requested but not yet implemented. Source changes, release artifacts and installed applications are distinct states. A successful source push is not proof of an installed update.

## Shared release version

`native/Release.props` is the version source for the Mac bundle, Windows application and installer filename. `native/release-version.mjs` validates its numeric fields for JavaScript build tools. The Mac uses the shared display version and build number. Windows uses the same display version and a four-component file version. Advance the build number for each published release, even when its display version stays unchanged. Never reuse an existing release asset URL for different bytes.

Development-machine updates have used verified, recoverable manual activation with retained application backups and private-data checks. These procedures are not an automatic update mechanism. The [release checklist](RELEASE-CHECKLIST.md) distinguishes installed versions from candidates, and [0.3.8 candidate evidence](RELEASE-0.3.8.md) records artifact-specific checks. Release artifacts remain unpublished.

The Mac replacement helper now retains the caller-supplied previous and candidate manifests in its recovery directory before moving either app. Both manifests must first pass the existing package and signature checks. Each file is created exclusively with owner-only permissions and flushed before replacement proceeds. A persistence failure prevents promotion. These retained copies preserve evidence for later inspection, but are not independently authenticated merely because they are on disk. This does not reconstruct a missing receipt for an earlier installation, enable automatic updates or establish power-loss durability.

## Update integration

The Windows updater primitives remain unconnected. Native Settings now has a running-version label in source, using the Mac bundle metadata or Windows assembly file version. It does not check for downloads, identify the latest release or enable automatic updates. Installed apps and already-built candidates acquire source changes only after a new build and installation.

Windows installer build metadata now includes the shared build number. After
running the independently verified installer in a controlled release staging
environment, prepare its unsigned receipt with:

```sh
node native/windows/prepare-installation-receipt.mjs <staged-installation> <trusted-installer-build.json> <new-output-directory>
```

Use absolute paths. The output directory must not exist and must be outside the
staged installation. This verifies the build's manifest digest, complete file
inventory and installer ownership before writing `installation-receipt.json`
and `installation-receipt.signing-bytes`. An external release signer must review
and sign the latter's exact bytes. No private key is read or generated. The
unsigned output is not trusted update metadata and is not sent to an app.
Do not derive the trusted build metadata from a downloaded payload. Creating
a receipt does not validate the provenance of an installer that the caller
has not independently verified. Initial trusted receipt provisioning, release
signing and the app's download and activation flow remain required.

`native/update-appcast.mjs` now provides the shared feed renderer. It requires both platform artifacts from one source revision and release version, an increasing build number, exact versioned GitHub download URLs, matching SHA-256 digests and Ed25519 signatures verified against separately supplied trusted public keys. It emits separate Mac and Windows feeds. It does not publish anything or enable update checks in installed applications.

The caller supplies `release` with `version`, `buildNumber`, `sourceRevision` and canonical UTC `publishedAt`, two `artifacts` with those identity fields plus `platform`, `data` as a Buffer, `sha256`, `edSignature` and `url`, a trusted public-key map keyed by `macos-arm64` and `windows-x64`, and the previous published build number. Release tags use `v<version>-build.<buildNumber>`. A versioned URL is not inherently immutable: the publishing workflow must refuse replacement of existing tags and assets. Verify packaging receipts before invoking this renderer. A matching signature authenticates artifact bytes, not their safety or the accuracy of caller-supplied build identity.

Focused tests use temporary in-memory Ed25519 keys and synthetic package bytes. They cover metadata and cryptographic rejection. A separate Windows interoperability test passed against the official WinSparkle 0.9.4 tool: the tool accepts Node-generated signatures, the renderer accepts upstream-generated signatures, and both reject changed bytes. `native/windows/updater-tool.json` pins the verified upstream archive. Set `OBSERVATORY_TEST_WINSPARKLE_TOOL` to the extracted, checksum-verified tool and run `node --test scripts/updater-interop.test.mjs`. Without that explicit path the test reports skipped, not passed. It creates and removes a unique temporary directory containing disposable test keys and synthetic bytes. No production keys are created or used.

The equivalent Sparkle 2.10.0 signing test passed using its official checksum-verified `sign_update` tool. `native/mac/updater-tool.json` pins that archive. Set `OBSERVATORY_TEST_SPARKLE_TOOL` to the extracted verified tool and run `node --test scripts/sparkle-interop.test.mjs`. The test supplies an explicit disposable seed file on every invocation, never uses Keychain, compares Sparkle and Node signatures, checks altered-byte rejection and exercises the feed renderer. Its unique temporary fixture and test key are removed afterward. Without macOS and an explicit tool path, it reports skipped.

These tests do not verify either updater's runtime feed parser or real release artifacts. Cross-check real artifacts using Sparkle's `sign_update` and WinSparkle's signing tool before enabling production feeds. Keep each updater's trusted public key in the installed application and keep private signing material outside Git. The renderer never accepts private keys.

The Mac feed is intended only for the arm64 distribution. Use a platform-specific feed URL when integrating the Mac framework. Windows must configure its comparison version from the shared build number, rather than its four-component file version. Minimum OS compatibility and feed parsing must be checked against the final integrated framework and package. No unattended installer arguments are emitted before the installer shutdown, locking and consent-preservation gates pass.

The existing package pipeline verifies clean source, file inventories, privacy boundaries and packaged runtime behavior. Reuse those checks before publishing either platform. The present GitHub workflow publishes a synthetic web demo, not desktop application updates. Before deploying that demo, it verifies that the run still matches the current main revision. Superseded or non-main runs skip deployment, and an unavailable or malformed revision response fails closed. Serialized deployment avoids an older queued run replacing a newer published demo. Local tests exercised all five decision paths against the workflow's actual shell block.

Both package build paths now require the native trusted-sync owner self-test,
using the staged Node runtime and collector scripts. It verifies sustained
helper startup, duplicate exclusion, graceful shutdown and restart in an empty
temporary runtime without creating a device identity or contacting a peer.
The Mac owner test passed against current scripts. The exact Windows package
test block passed against the rebuilt application, including a Node path with
spaces. These checks do not constitute a new complete package or installation.

[Sparkle for Mac](https://sparkle-project.org/documentation/publishing/) supports signed archive updates through an appcast and a monotonically increasing bundle version. [WinSparkle](https://winsparkle.org/guides/getting-started/) provides a native Windows update flow using an appcast and an embedded public verification key. Their integration and compatibility with Observatory's existing installers still require validation. A checksum alone is not publisher authentication.

The production path must build and verify both platforms from one reviewed source revision, sign the update artifacts, publish immutable artifacts and update metadata, then verify receipt and activation on the development machines. Signing keys remain outside Git and application packages. Do not introduce paid signing services or bypass operating-system protections.

Before enabling automatic updates, verify clean and existing installations, application shutdown, collector locking, preservation of settings/history/pairing, failed-download recovery, invalid-signature rejection, stale-version rejection, relaunch and rollback. A newer application may require data migration, so a binary rollback alone does not prove saved-data compatibility. Updates must show their version and outcome and must not reset collection or sharing consent.

## Mac graceful quit preparation

`native/mac/replace-app.mjs` now adapts the existing retained-payload transaction
for local Mac updates. It requires independently trusted previous and candidate
package manifests, canonical sibling app directories and an advancing build.
It checks full contents and strict code signatures before and after promotion,
refuses replacement while an Observatory app is running, and holds an exclusive
installer lock beside the installed bundle. The native startup gate refuses to
start collection while that lock exists. A stale lock requires inspection, not
automatic deletion. Older installed binaries do not yet contain this gate.

This entry point never launches an app, reads the collection runtime or restores
a database. Failed pre-launch verification can restore the previous app without
replacing newer usage records. After an upgraded app has run a data migration,
binary rollback alone is not safe. Preserve the newer database and reconcile
obsolete consent before any recovery. The synthetic tests cover retained copies,
running-app and lock refusal, tampered content, injected signature failure and
unchanged adjacent history. Actual package replacement, restart and first-upgrade
compatibility remain separate gates. This is not an automatic update service.

The current Mac source requests delayed application termination while local collection or pairing work is active. New refreshes, menu actions and native settings writes are refused during that wait. It waits up to 260 seconds using monotonic elapsed time. If draining times out, the app cancels termination, re-enables work and explains that it stayed open. Existing collection and pairing work is not cancelled by this normal quit path. Forced process termination and OS shutdown deadlines remain outside that guarantee.

The isolated `--test-shutdown` mode covers pending pairing state, refresh exclusion, completion, timeout and retry. It also runs a short synthetic subprocess through the production child completion path while servicing only AppKit's modal run-loop mode. It uses temporary setup state and does not read live collection sources. The standard Mac build runs it with a 15-second outer bound. Full updater-callback integration and live in-flight collection and pairing shutdown verification remain open. These changes are included in the installed Mac `862af49` bundle.

## Windows upgrade compatibility

Windows build output includes an explicit eight-file `Updater` runtime for
installation verification, signed receipts and retained-payload replacement.
The package inspector requires every file. The runtime imports without the
source checkout and contains no release signer or private key. This packaging
step does not enable updates or make a downloaded helper trusted.

`stageUpdateHelper` verifies the installed payload against an independently
trusted receipt, copies it to a unique directory outside the installation and
verifies the copy again. It never launches the copy. Failed copies are retained
for inspection. The caller must exclude concurrent writers and supply a trusted
receipt before staging. Tests cover independent copied bytes, repeated staging,
refusal of an internal destination, wrong receipts and unexpected private files.
This prepares an external helper but does not implement activation or relaunch.

`apply-update.mjs` is the internal replacement subprocess entry point. It
requires its runtime and Node executable outside both payloads, reads bounded
receipt files and repeats signed installation verification before replacement.
It retains the previous payload and recovery evidence. Its native caller must
hold the setup and collection exclusion for the subprocess lifetime. The command
does not acquire those locks, preserve registration or relaunch an application
by itself. It is not a standalone user update command. Synthetic subprocess
tests cover wrong-key refusal and verified replacement with retained receipts.

The packaged `verify-candidate.mjs` command accepts an extracted directory,
receipt-envelope path, pinned public key and previous build number. It bounds
receipt reads, authenticates the signature, rejects stale builds and checks the
full installation inventory. It returns a compact verified identity or fails
without moving files or launching the candidate. Run it only through a trusted
installed runtime, with the key and build supplied by trusted app configuration.
The native `UpdateCandidate` caller uses the installed Node runtime and verifier,
removes Node loader overrides, limits each output stream to 4,096 characters and
sets a two-minute deadline. It validates the returned identity and can terminate
only its read-only child on cancellation or failure. Native self-tests cover
response validation. Package verification now invokes the real executable's
isolated candidate-check mode using synthetic signed files, spaced paths and an
inherited Node loader override. It requires successful inventory verification
and rejection of wrong keys, stale builds and changed payload bytes. This check
does not generate production keys or launch the synthetic payload. Trusted
configuration provisioning and Update button integration remain required.

Windows replacement retains the previous and candidate receipts in its recovery
directory before moving either payload. The signed entry point also retains the
exact candidate signature envelope. Files are created exclusively and flushed.
Receipt persistence failure prevents promotion. A retained unsigned receipt is
evidence, not independent authority. Recovery must authenticate the candidate
envelope with the installed trusted key and obtain independent trust for the
previous receipt before using either to authorize restoration.

`UpdateSession` joins the setup gate and graceful shutdown request. It acquires
the gate before requesting quit and retains it until its caller disposes the
session. Busy setup or command-line collection refuses entry. Unsupported or
timed-out shutdown releases the gate without replacing files. Synthetic tests
cover exclusion during shutdown, retained exclusion after shutdown and release
on timeout or disposal. This is not yet connected to a download or Update button.
It only excludes processes that honor the current setup gate. Authentication,
first-upgrade compatibility, replacement and relaunch remain required.

The Windows update staging helper validates ZIP entries before writing payload
files. It rejects unsafe Windows paths, case-insensitive duplicates, parent-file
conflicts, links and special entries. Default limits are 512 MiB compressed,
768 MiB expanded, 192 MiB per file and 8,000 entries. Extraction uses new files
in a newly named staging directory and checks actual copied lengths. Cancellation
is checked before writes and between copied blocks. If extraction fails after
staging starts, the partial directory is retained for inspection, not promoted.
The caller must exclude concurrent writers to the staging parent.

This helper is not yet called by an Update button. Safe extraction does not
authenticate a release. The download's signature and the extracted installation
receipt and inventory still need verification before any extracted file runs.
Synthetic native tests cover preserved bytes, zero-length files, path and link
rejection, size bounds and cancellation before staging.

Development source accepts `WorkspaceObservatory.exe --quit-for-update` in the
same Windows session as the app. It signals the existing application's normal
quit path and waits up to 270 seconds for its singleton to be released. It does
not start an absent app, force termination or read collection data. Exit code 0
means the app is stopped or was already absent, 2 means the running app lacks
this command's receiver, 3 means the wait timed out, and 1 means the request
failed. Extra arguments are rejected with code 64. Older installed builds still
require quitting from the tray menu.

This command is shutdown preparation, not an upgrade authorization or lock. The
updater must still authenticate the candidate, acquire the installation and
collector locks, recheck that no app has restarted and handle recovery before
replacing anything. It does not prove that a stopped app completed its last
write successfully. Synthetic tests use separate temporary named objects for
absent, unsupported, busy and completed application states.

Windows startup now briefly shares the NSIS setup mutex until the application singleton exists, closing the installer/startup race. Command-line collection holds that setup gate for its complete run. Normal tray-menu quit stops new collector work and waits for active collection or pairing work to finish before disposing application resources. If draining exceeds 260 seconds, the app remains open and resumes scheduling. Native self-tests cover operation exclusion, draining and resume. This does not establish safe forced OS termination, an external process kill or the future updater callback integration.

The current NSIS installer intentionally rejects an existing installation and a running application. WinSparkle's default flow launches the installer before invoking its shutdown-request callback. Connecting that flow directly to this installer would fail. See the upstream [shutdown callback contract](https://winsparkle.org/c-api/callbacks/). Before integration, implement and verify an explicit upgrade transaction or compatible bootstrapper that waits for graceful shutdown, serializes with collection and installation, preserves recovery material, replaces only owned application files, and restores login registration and shortcuts. Do not remove the installer ownership or linked-path protections to bypass this gate.

`native/windows/replace-payload.mjs` implements the directory replacement component, not the complete updater. It requires distinct canonical sibling directories, a synchronous full-payload verifier and an advancing build identity. It retains the previous directory and a flushed transaction journal, promotes the candidate, and verifies it again. A failure attempts to restore the previous payload while retaining the rejected candidate. A blocked restoration returns the recovery location without deleting any payload. Interrupted-process or power-loss recovery requires inspection of the journal and actual directory state, not blind replay.

The future bootstrapper must run outside the directory being replaced and hold installation and collector locks before calling this component. It must authenticate the candidate, stop the app, verify installed ownership and full manifests, handle installer-generated files, capture and restore registration, and verify relaunch. The component does not provide those guarantees itself. Its tests use isolated synthetic directories, including promotion failure, failed verification, blocked rollback, linked paths and unchanged adjacent private-data fixtures. It is not invoked by either installed app.

Rollback now rechecks the restored directory and full payload through the supplied verifier, and compares its revision and build against the original identity before reporting restoration. A corrupt retained copy or a changed verified identity results in recovery inspection, not a success claim. The relocated previous files and rejected candidate remain available. Regression tests demonstrated both false-success cases before the fix and verify rejection afterward. This source-only correction does not enable automatic updates or establish registration and relaunch recovery.

`inspectPayloadRecovery` provides read-only assessment after an interruption. The caller supplies trusted installed, staged and recovery paths and a synchronous verifier bound to the trusted previous and candidate receipts. The inspector validates directory boundaries, rejects links, and checks the payloads themselves without treating journal text as authority. It distinguishes a verified candidate at the installed path, a verified previous app at that path, an absent installed path with the previous app awaiting restoration, and ambiguous states requiring manual inspection. These states describe payload locations, not completed registration, safe launch or data-migration compatibility. It makes no filesystem changes. Tests include a real forced termination of a disposable updater child immediately after candidate promotion, with both payloads retained. Power-loss durability and automatic recovery remain unverified.

`restoreInterruptedPayload` handles only the absent-installed-path state before candidate promotion. Under caller-held installation and collection locks, with the app stopped and concurrent writers excluded, it rechecks the retained previous payload, refuses an occupied destination, moves the previous app back, and verifies it again. The staged candidate remains intact. Ambiguous states, repeated restoration and corrupt backups are refused. A failed post-move verification retains the relocated bytes and reports inspection required. This function does not acquire those locks, restore registration, launch the app or migrate data. It is not invoked by the installed applications. Tests cover the missing-path restore, occupied and newly appearing destinations, corrupt backups and failed post-restore verification.

`verify-installation.mjs` connects that component to the real Windows manifest verifier through `replaceVerifiedInstallation`. It validates the owner product and revision, every package file, and exactly two installer-generated files. The caller supplies trusted receipts containing `sourceRevision`, `buildNumber`, `manifestSha256`, `ownerSha256` and `uninstallerSha256`. The candidate receipt must be authenticated separately from the installed or staged directory. A receipt derived from the candidate itself cannot authenticate that candidate. Ordinary package verification still rejects extra files by default. Full updater integration, authenticated receipt packaging, registration handling and relaunch remain incomplete.

`replaceSignedInstallation` adds authentication before that replacement path. Its candidate envelope contains exactly `receipt` and `signature`. The receipt binds schema 1, product `WorkspaceObservatorySetup`, platform `windows-x64`, source revision, build number and the three installation digests above. `installationReceiptSigningBytes` returns domain-separated canonical UTF-8 bytes for an external Ed25519 release signer. The signature is canonical base64. The application supplies a separately trusted base64-encoded 32-byte public key and the trusted installed receipt. Neither comes from the candidate envelope. The authenticated build must exceed the installed build before any directory replacement begins.

Focused tests use disposable in-memory keys and synthetic installation files. They exercise authenticated replacement, retained rollback files, wrong signers, altered metadata, wrong platform, replayed builds, malformed envelopes and payload tampering despite a valid receipt signature. This is not yet wired to a download service, production key, release signer or installer callback. The release pipeline must produce the signed receipt from verified packaging output, including the exact installer-generated files. Initial installation must establish trusted local receipt state before this update entry point is enabled.

The `Desktop update safety` GitHub workflow runs these dependency-free receipt, replacement and appcast tests on standard Windows and macOS runners when relevant source changes. It uses read-only repository permission, synthetic payloads and disposable in-memory keys. It does not build or publish installers, access release secrets, or establish clean-machine installation coverage. The separate Linux demo workflow continues to run the full shared test suite and TypeScript checks.

The same workflow runs the official Sparkle signing interoperability test on macOS and the WinSparkle test on Windows. Each platform downloads its pinned upstream archive over HTTPS with time and size limits, verifies its SHA-256 digest before extraction, and passes the extracted tool path explicitly so the test runs rather than skips. These checks cover signature compatibility and altered-byte rejection, not native update installation.

The `Native compilation` workflow compiles the Windows C# application with locked NuGet dependencies and the Mac Swift sources, then runs their isolated `--self-test` contracts. Its Windows test executable includes the declared .NET runtime. Neither job packages the dashboard or collector runtimes, installs an app, exercises desktop UI, or uploads a release. These compilation checks supplement, rather than replace, the complete package and installed-app checks.
