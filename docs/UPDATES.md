# Desktop updates

Automatic production updates are requested but not yet implemented. Source changes, release artifacts and installed applications are distinct states. A successful source push is not proof of an installed update.

## Shared release version

`native/Release.props` is the version source for the Mac bundle, Windows application and installer filename. `native/release-version.mjs` validates its numeric fields for JavaScript build tools. The Mac uses the shared display version and build number. Windows uses the same display version and a four-component file version. Advance the build number for each published release, even when its display version stays unchanged. Never reuse an existing release asset URL for different bytes.

Version 0.3.1, build 7, from clean source `30f91ca` is installed on both development machines through verified recoverable updates. Matching release artifacts are prepared but unpublished. This manual update is not an automatic update mechanism. Focused tests cover shared values, invalid versions and existing installer/package checks. Broader release gates remain in the release checklist.

## Update integration

`native/update-appcast.mjs` now provides the shared feed renderer. It requires both platform artifacts from one source revision and release version, an increasing build number, exact versioned GitHub download URLs, matching SHA-256 digests and Ed25519 signatures verified against separately supplied trusted public keys. It emits separate Mac and Windows feeds. It does not publish anything or enable update checks in installed applications.

The caller supplies `release` with `version`, `buildNumber`, `sourceRevision` and canonical UTC `publishedAt`, two `artifacts` with those identity fields plus `platform`, `data` as a Buffer, `sha256`, `edSignature` and `url`, a trusted public-key map keyed by `macos-arm64` and `windows-x64`, and the previous published build number. Release tags use `v<version>-build.<buildNumber>`. A versioned URL is not inherently immutable: the publishing workflow must refuse replacement of existing tags and assets. Verify packaging receipts before invoking this renderer. A matching signature authenticates artifact bytes, not their safety or the accuracy of caller-supplied build identity.

Focused tests use temporary in-memory Ed25519 keys and synthetic package bytes. They cover metadata and cryptographic rejection, not compatibility with the upstream signing tools or either updater's runtime parser. Cross-check real artifacts using Sparkle's `sign_update` and WinSparkle's signing tool before enabling production feeds. Keep each updater's trusted public key in the installed application and keep private signing material outside Git. The renderer never accepts private keys.

The Mac feed is intended only for the arm64 distribution. Use a platform-specific feed URL when integrating the Mac framework. Windows must configure its comparison version from the shared build number, rather than its four-component file version. Minimum OS compatibility and feed parsing must be checked against the final integrated framework and package. No unattended installer arguments are emitted before the installer shutdown, locking and consent-preservation gates pass.

The existing package pipeline verifies clean source, file inventories, privacy boundaries and packaged runtime behavior. Reuse those checks before publishing either platform. The present GitHub workflow publishes a synthetic web demo, not desktop application updates.

[Sparkle for Mac](https://sparkle-project.org/documentation/publishing/) supports signed archive updates through an appcast and a monotonically increasing bundle version. [WinSparkle](https://winsparkle.org/guides/getting-started/) provides a native Windows update flow using an appcast and an embedded public verification key. Their integration and compatibility with Observatory's existing installers still require validation. A checksum alone is not publisher authentication.

The production path must build and verify both platforms from one reviewed source revision, sign the update artifacts, publish immutable artifacts and update metadata, then verify receipt and activation on the development machines. Signing keys remain outside Git and application packages. Do not introduce paid signing services or bypass operating-system protections.

Before enabling automatic updates, verify clean and existing installations, application shutdown, collector locking, preservation of settings/history/pairing, failed-download recovery, invalid-signature rejection, stale-version rejection, relaunch and rollback. A newer application may require data migration, so a binary rollback alone does not prove saved-data compatibility. Updates must show their version and outcome and must not reset collection or sharing consent.
