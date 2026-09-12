# Legacy Mac migration

Migration is in development. Do not rename or delete `local.config.json` to force the native collector to start. That can change source coverage and account selection before retained data has been checked.

Current source collects and exchanges only Wispr dictation aggregates. The retired reader has been removed. Older boolean source settings are accepted but ignored, and the migration plan no longer enables the retired source. Existing snapshots are not rewritten. Native setup controls and installed bundles still need the matching update. Update both peers before relying on the new single-source dictation payload. Older receivers that require the former two-source Mac payload will reject it rather than silently merge incomplete records.

## Optional receipt read isolation

Current source runs the optional receipt-directory reader in a separate local process with a 15-second deadline and bounded output. An unavailable directory must not hold the entire dashboard collection open. Timeout reports unavailable receipts without deleting their original files or widening folder permissions. Both the legacy collector and native workflow adapter use this boundary.

This follows a September 12 development-machine diagnosis where the legacy collector stalled inside the operating system's directory-open call. The cause of that OS-level wait was not established. Synthetic tests verify timeout cleanup, unchanged source bytes and sanitized results. The minimal legacy-runtime update was applied under the existing collector lock with a verified backup and unchanged private-data inventory. A subsequent installed-app refresh completed in about nine seconds and saved a new snapshot. Receipt data was readable during that run, so live timeout behavior is supported by the synthetic stalled-worker test, not that successful read. The prior run had also recovered before deployment. This is not evidence that the underlying OS permission issue is resolved.

## Read-only assessment

`scripts/mac-migration-plan.mjs --runtime ABSOLUTE_RUNTIME` reports source switches, fixed review codes and coverage changes. It does not create a native configuration, connect devices, alter account state or move history. Its output omits private paths and SSH aliases. An existing native configuration is reported separately and is never replaced.

The mapping preserves enabled Mac dictation sources, the explicit account-client selection, configured receipt reads and configured benchmark reads. Custom Mac Codex log locations require separate support rather than silently switching to the default location. Legacy Windows and Ubuntu collection requires equivalent paired source scope before migration.

## Gates before activation

- Confirm the paired peer and its configured source scope. A legacy SSH alias alone is not new device pairing.
- Archive the prior snapshot and verify that retained history remains accessible after the new collector writes its snapshot. A backup file alone is not proof of dashboard visibility.
- Compare native reader coverage with the existing collector and the user's current source choices. Verify updated binaries and the paired Windows Wispr source before clearing this coverage gate.
- Stop collection, hold the correct collector lock, retain the old configuration and use a recoverable activation with stale-plan checks.

The compatibility adapters and workflow switches are implemented in source. They do not automatically migrate an installed legacy collector, enable allowance sharing or opt new installations into workflow reads.

The source mapping still requires confirmed peer scope. Removing a retired reader does not clear the installed-peer verification gate for the supported sources.

## Viewing retained snapshots

`scripts/mac-snapshot-archive.mjs` prepares a retained snapshot in an existing canonical, owner-only archive directory on Mac. It verifies a bounded, stable schema-2 source file, writes an exclusive private copy, verifies its checksum and flushes the copy and receipt to disk. Every preparation uses a new directory and preserves the original collection timestamp. It neither changes collector configuration nor merges historical data into current totals. The caller must still hold the collector lock during migration and verify the saved file in the native viewer before activation. An interrupted preparation is not a successful migration.

Nine focused archive and migration-assessment checks pass on Mac. Archive tests use fictional records and cover exact-byte preservation, retained timestamps, owner-only permissions, repeated preparation without overwrite, linked paths, broad directory permissions and invalid or oversized inputs. They do not establish power-loss recovery or completion of a live migration.

A subsequent installed-app check archived the actual legacy snapshot while holding `.runtime/collector.lock`. The private copy matched the source bytes and checksum, and the legacy configuration was unchanged. The installed native viewer opened that archive, displayed its original timestamp and retained token dates, disabled Refresh and showed read-only Settings guidance. Return to live data restored the live view. This verifies real retained-snapshot visibility, but the collector activation and paired live-data checks remain unfinished. Archive paths and actual usage records are kept outside this repository.

The native Mac dashboard now has an Open saved snapshot action in source. It opens a user-selected Observatory schema-2 JSON snapshot in a separate read-only view. The original collection timestamp remains visible, refresh and settings mutation are unavailable in that view, and Return to live data restores the current collector snapshot. Live collection continues independently. Archived metrics are never added to current totals.

The reader bounds files to 16 MB, rejects final-path symbolic links, non-regular files, changed files and invalid snapshot headers. Native tests cover retained token visibility, unchanged file bytes and invalid/oversized/link rejection.

The September 12 development-machine check of candidate `bf4bdbe` opened a fictional snapshot through the native file picker. The dashboard showed its original timestamp and 42 test tokens, labeled the view as saved rather than live, disabled Refresh and replaced Settings controls with read-only guidance. Return to live data restored the live snapshot and Settings controls. The later installed `40d3a00` bundle includes that viewer. This is an interactive viewer check, not proof of migration or a clean installation. The archive helper is a later source addition and is not yet wired into native migration controls.
