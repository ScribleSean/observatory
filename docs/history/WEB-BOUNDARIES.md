# Dashboard file boundaries

The native dashboards expose approved snapshots separately from bundled static assets. Pairing configuration, pending setup and private inventories are not dashboard endpoints.

Mac static requests are limited to the bundled index and supported files under `assets/`. Static JSON is not served. The snapshot bridge accepts only the main application frame and the names `usage` and `collector`. It rejects snapshot paths that resolve through a filesystem link.

Windows static requests are limited to the bundled index and supported assets. Static JSON is not served. Snapshot and asset paths reject reparse points at each component below their supplied root, including directory junctions. The separate first-run endpoint returns only version, platform and whether collection is configured.

The optional loopback HTTP server serves known page entries, framework assets, branding and its generated client manifest. Its only snapshot routes are `local/usage.json` and `local/collector.json`. Snapshot paths cannot resolve through links. Static paths must remain within the build output, and arbitrary JSON files are not served. Existing host, cross-site request and write restrictions remain in place.

## September 9 verification

- Actual Mac renderer checks loaded a normal snapshot, rejected pairing and pending-setup canaries placed in runtime and static folders, and rejected linked snapshot files, linked snapshot directories and linked assets.
- Windows renderer checks loaded a normal snapshot while rejecting runtime/static pairing canaries and a linked asset directory. A second run rejected the snapshot after its public directory was replaced by a junction to the synthetic private fixture.
- HTTP integration tests exercised normal page/assets/snapshot requests, forbidden pairing routes, copied private JSON, encoded traversal and existing host/cross-site restrictions on Mac and Windows. POSIX file and directory symlink checks passed on Mac and are skipped on Windows. Windows HTTP junction coverage remains separate from the native renderer check.

All checks used synthetic files. They did not read installed pairing state or transfer test screenshots. These guards do not sanitize deliberately replaced allowed assets or snapshots, prove resistance to every concurrent filesystem race, or protect against a process already controlling the same user account. Collector sanitization and release-payload verification remain separate requirements. Previously generated installers do not contain these new guards.
