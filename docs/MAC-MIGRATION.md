# Legacy Mac migration

Migration is in development. Do not rename or delete `local.config.json` to force the native collector to start. That can change source coverage and account selection before retained data has been checked.

## Read-only assessment

`scripts/mac-migration-plan.mjs --runtime ABSOLUTE_RUNTIME` reports source switches, fixed review codes and coverage changes. It does not create a native configuration, connect devices, alter account state or move history. Its output omits private paths and SSH aliases. An existing native configuration is reported separately and is never replaced.

The mapping preserves enabled Mac dictation sources, the explicit account-client selection, configured receipt reads and configured benchmark reads. Custom Mac Codex log locations require separate support rather than silently switching to the default location. Legacy Windows and Ubuntu collection requires equivalent paired source scope before migration.

## Gates before activation

- Confirm the paired peer and its configured source scope. A legacy SSH alias alone is not new device pairing.
- Archive the prior snapshot and verify that retained history remains accessible after the new collector writes its snapshot. A backup file alone is not proof of dashboard visibility.
- Compare native reader coverage with the existing collector. Current source supports optional Windows TypeWhisper aggregates, but older installed peers do not. Verify updated binaries and the explicit Windows source choice before clearing this coverage gate.
- Stop collection, hold the correct collector lock, retain the old configuration and use a recoverable activation with stale-plan checks.

The compatibility adapters and workflow switches are implemented in source. They do not automatically migrate an installed legacy collector, enable allowance sharing or opt new installations into workflow reads.

The assessment's `windows-typewhisper-not-in-native-peer-payload` review code remains conservative because the assessment does not inspect the remote installed build. Source support alone does not clear the installed-peer coverage gate.

## Viewing retained snapshots

The native Mac dashboard now has an Open saved snapshot action in source. It opens a user-selected Observatory schema-2 JSON snapshot in a separate read-only view. The original collection timestamp remains visible, refresh and settings mutation are unavailable in that view, and Return to live data restores the current collector snapshot. Live collection continues independently. Archived metrics are never added to current totals.

The reader bounds files to 16 MB, rejects final-path symbolic links, non-regular files, changed files and invalid snapshot headers. Native tests cover retained token visibility, unchanged file bytes and invalid/oversized/link rejection.

The September 12 development-machine check of candidate `bf4bdbe` opened a fictional snapshot through the native file picker. The dashboard showed its original timestamp and 42 test tokens, labeled the view as saved rather than live, disabled Refresh and replaced Settings controls with read-only guidance. Return to live data restored the live snapshot and Settings controls. The candidate was then closed and the existing installed app remained running. This is an interactive viewer check, not proof of migration or a clean installation. The candidate has not replaced the installed app, and the viewer does not yet create migration archives or switch collector configuration.
