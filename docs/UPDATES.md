# Desktop updates

Automatic production updates are requested but not yet implemented. Source changes, release artifacts and installed applications are distinct states. A successful source push is not proof of an installed update.

## Shared release version

`native/Release.props` is the version source for the Mac bundle, Windows application and installer filename. `native/release-version.mjs` validates its numeric fields for JavaScript build tools. The Mac uses the shared display version and build number. Windows uses the same display version and a four-component file version. Advance the build number for each published release, even when its display version stays unchanged. Never reuse an existing release asset URL for different bytes.

The initial consolidation keeps the existing 0.3.0 display version and build number 6. It does not announce a new release. Focused tests cover shared values, invalid versions and existing installer/package checks. Native build and installed-update verification are separate gates.

## Update integration

The existing package pipeline verifies clean source, file inventories, privacy boundaries and packaged runtime behavior. Reuse those checks before publishing either platform. The present GitHub workflow publishes a synthetic web demo, not desktop application updates.

[Sparkle for Mac](https://sparkle-project.org/documentation/publishing/) supports signed archive updates through an appcast and a monotonically increasing bundle version. [WinSparkle](https://winsparkle.org/guides/getting-started/) provides a native Windows update flow using an appcast and an embedded public verification key. Their integration and compatibility with Observatory's existing installers still require validation. A checksum alone is not publisher authentication.

The production path must build and verify both platforms from one reviewed source revision, sign the update artifacts, publish immutable artifacts and update metadata, then verify receipt and activation on the development machines. Signing keys remain outside Git and application packages. Do not introduce paid signing services or bypass operating-system protections.

Before enabling automatic updates, verify clean and existing installations, application shutdown, collector locking, preservation of settings/history/pairing, failed-download recovery, invalid-signature rejection, stale-version rejection, relaunch and rollback. A newer application may require data migration, so a binary rollback alone does not prove saved-data compatibility. Updates must show their version and outcome and must not reset collection or sharing consent.
