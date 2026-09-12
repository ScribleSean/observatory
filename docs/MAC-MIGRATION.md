# Legacy Mac migration

Migration is in development. Do not rename or delete `local.config.json` to force the native collector to start. That can change source coverage and account selection before retained data has been checked.

## Read-only assessment

`scripts/mac-migration-plan.mjs --runtime ABSOLUTE_RUNTIME` reports source switches, fixed review codes and coverage changes. It does not create a native configuration, connect devices, alter account state or move history. Its output omits private paths and SSH aliases. An existing native configuration is reported separately and is never replaced.

The mapping preserves enabled Mac dictation sources, the explicit account-client selection, configured receipt reads and configured benchmark reads. Custom Mac Codex log locations require separate support rather than silently switching to the default location. Legacy Windows and Ubuntu collection requires equivalent paired source scope before migration.

## Gates before activation

- Confirm the paired peer and its configured source scope. A legacy SSH alias alone is not new device pairing.
- Archive the prior snapshot and verify that retained history remains accessible after the new collector writes its snapshot. A backup file alone is not proof of dashboard visibility.
- Compare native reader coverage with the existing collector. Windows TypeWhisper is not currently included in the native peer payload and must not disappear without an explicit coverage decision.
- Stop collection, hold the correct collector lock, retain the old configuration and use a recoverable activation with stale-plan checks.

The compatibility adapters and workflow switches are implemented in source. They do not automatically migrate an installed legacy collector, enable allowance sharing or opt new installations into workflow reads.
