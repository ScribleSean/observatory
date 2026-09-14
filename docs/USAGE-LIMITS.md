# Usage limits and token history

Status: development implementation, not a finished public release. Both development machines have native apps with allowance graphs and sharing controls. Mac collection retains real readings. On September 13, 2026 UTC the installed Windows collector also saved a successful reading from its explicitly selected Ubuntu Codex client. Allowance sharing remains off. Real paired consent, broader migration coverage and clean-machine release checks remain open.

## Allowance sharing under development

`scripts/quota-peer.mjs` defines the tested, opt-in payload contract used by the authenticated SSH quota endpoint and the source-level pinned TLS quota channel. Installed apps contain the SSH implementation, but existing pairings do not opt into allowance sharing automatically. TLS changes are not yet installed or verified across the user's devices.

The contract carries the source device, a random sharing generation, original observation times, supported Codex allowance windows and dated token totals. It omits credentials, account identifiers and local account-scope hashes. It rejects unexpected inbound fields and conflicting observations. Duplicate totals are never added together. Retired Spark windows are excluded.

The private quota store now supports account-bound and pairing-bound consent. It defaults off for existing stores. Each explicit enable creates a random generation. Account changes, failed authentication and disabling monitoring revoke consent. A late collector result cannot undo a concurrent settings change. Disabling sharing preserves local readings.

Pairing disconnection now revokes local sharing consent and invalidates in-flight quota collection without deleting local readings. It writes the pairing fence before attempting quota cleanup. A cleanup failure is reported while pairing remains disabled. Users who never enabled quota monitoring do not get a quota database just by disconnecting.

Both devices require explicit sharing consent. The authenticated exchange validates the owner's generation, original timestamps and device provenance. A matching allowance percentage is not proof that two devices use the same account, so cross-device account totals are not summed.

`quota-sharing-control.mjs` provides the local settings interface for that integration. Status returns only availability, consent state and an opaque confirmation token. Enabling requires a successful observation within ten minutes and a current token bound to the account-store revision and pairing. Disconnect and settings operations share the pairing lock. Windows native source exposes Check sharing status and Enable/Disable allowance sharing under Settings, This device. Enabling requires confirmation, with No selected by default. Matching controls are implemented in Mac native Settings with a cancelable confirmation and preview mutations disabled. Consent is explicitly labeled as distinct from a completed exchange.

Windows synthetic callback tests cover cancelled consent, enable and disable. Both native-to-Node bridges pass isolated empty-runtime checks against bundled runtimes for status, disable and rejecting unpaired enable. The Mac bridge also passed fictional paired enable, expired-token rejection and disable while preserving local history. Its installed Settings panel was visually checked, including disabled enable controls when unpaired. Successful paired consent through both actual interfaces remains unverified.

Historical development revisions Mac `fa8681d` and Windows `65bfe3d` passed native package checks, and both bundled script sets passed actual SSH exchange using fictional readings. Windows installer integration covered install/uninstall, overwrite refusal and preservation of unrelated files. Installed updates retained rollback copies and verified private data was unchanged during replacement. See the [release checklist](RELEASE-CHECKLIST.md) for newer installed revisions. These are not public releases or clean-machine certification.

An actual SSH test with two isolated runtimes and fictional readings exposed a roughly nine-second difference between device clocks. The receiving parser now permits at most five minutes of future source-clock skew, matching the core peer protocol, without changing observation timestamps. Future-dated readings remain stale. History validation uses the source observation time so reopening a retained record cannot silently prune it into a different canonical payload.

Actual SSH exchange using the corrected Mac and Windows bundles passed bidirectional retention, duplicate delivery and both disable checks. Real accounts were not enabled. Older `3c81dcb` candidates are superseded. Successful paired consent through both native interfaces remains a separate verification gate.

`quota-exchange.mjs` implements the handler for the separate authenticated SSH endpoint and the pinned TLS quota channel. A readiness request sends no readings. Exchange checks the saved peer identity and local consent, then saves the validated peer record and allocates the outgoing revision in one quota-store transaction. Older records cannot replace newer ones, conflicting revisions fail, and local revocation clears received records.

The source collectors now call `quota-sync.mjs` after local quota collection. Only an explicitly enabled Mac initiates the SSH readiness and exchange requests. Windows reads the saved peer projection on its next collection. The snapshot keeps this in `peerQuota`, separate from the local quota and all combined totals. Failed transport preserves dated peer readings with a stale label after ten minutes. Disabled peer readiness clears the Mac's peer projection without sending readings. Two temporary device runtimes have passed exchange tests through the SSH adapter with a synthetic transport.

For an explicitly configured TLS pairing, either platform can initiate the exchange. The client rechecks consent before sending and after network waits, and never holds the pairing lock while awaiting the peer. Disabling and re-enabling sharing cannot reuse an in-flight request from the old sharing generation. Mac loopback tests and simulated concurrent exchanges cover this source integration. Installed two-device verification remains open. See [local pairing](LOCAL-PAIRING.md) for transport limits and the Windows network test gate.

Both installed native allowance views render shared history beneath local observations, with a source-device label, original reading time and receipt time. They reuse the gap/reset-aware graphs without adding device totals. Windows synthetic UI tests cover missing local quota, stale peer history and removing the peer graph, and the rendered fixture was visually checked. Mac shared-history visual interaction and real installed-device exchanges remain unverified. Sharing remains off until pairing and consent prerequisites are satisfied.

## Reference implementation

Reviewed [Codenotch](https://github.com/vinzdg/codenotch/tree/0a6c6fb62b7fda52e4f8bd1ce7e8c7e7b8595b75), including `UsageStore.swift`, `UsageArchive.swift`, `CodexLocalProvider.swift` and `CodexUsage.swift`, on September 9, 2026. Its root license is MIT. This work uses its behavior as a reference, not copied source or artwork.

Codenotch remembers the last successful provider reading and its timestamp. It restores that reading as stale on launch, persists retry deadlines, and reads daily account token totals separately from quota percentages. Its archive is a latest-reading cache, not a time series of quota observations.

Observatory uses those patterns and adds bounded historical quota observations for graphs. The compact menu-bar and system-tray panels are summaries, not the finished history screen. Disabled sources do not discover clients or poll. A detected account change or sign-out invalidates the previous account's readings. Changes made in Codex are detected at the next permitted check, not immediately. Turning off monitoring clears Observatory's active retained readings without signing the owner application out.

## Codex data sources

The adapter uses the installed Codex App Server's `account/rateLimits/read` and `account/usage/read` methods. Both methods are described in the [official App Server documentation](https://learn.chatgpt.com/docs/app-server). These are metadata reads, not inference requests. The collector checks the signed-in account before and after each observation. An unsupported daily-token method does not discard otherwise valid quota readings.

Windows source settings offer native Windows or Ubuntu as the account source. The Ubuntu choice uses that distribution's existing Codex sign-in and may start WSL during collection. It is independent of saved-log collection. No credentials are copied, no client is installed, and a failed source never silently falls back to another account source. The native Windows packaged client could not be launched on the tested machine, so its account-reading path remains unverified. The Ubuntu path passed with Codex CLI 0.153.4.

Only allowlisted metrics enter the dashboard. Account names, email addresses, credentials, credit details and conversation content are excluded. Daily token buckets preserve missing days as unknown, distinct from an explicitly reported zero.

## Storage and polling

Readings live in `private-quota/state.sqlite` inside the local runtime directory. The directory uses the application's private filesystem permissions. The database stores a locally salted account key, not an account name or email. Only sanitized metrics are projected into the local dashboard snapshot. Quota history is not added across devices.

Successful checks wait at least five minutes before another attempt. Failed checks back off from one minute to fifteen minutes. Retry deadlines survive restart and source toggling. Cached values retain their original timestamp and appear as saved readings. A source disabled during a read discards the result.

Current source treats a saved successful allowance sample as healthy for less than ten minutes from its original observation time. Reloading it during cooldown does not create a new sample or change that time. At ten minutes it becomes stale. A failed latest poll remains stale even when the retained sample is recent. The correction passed focused Mac and Windows tests and was applied separately to the legacy Mac runtime with backup and private-data preservation checks. An installed-app refresh verified a healthy reading with its original observation time retained through a later cooldown refresh. It is not yet included in the packaged development bundles.

The recent quota cache is bounded to 30 days, 10,000 samples and an 8 MB serialized sample budget. Its daily account totals retain up to 366 reported dates. The dashboard data projection includes the last 24 hours ending at the latest quota reading and recent reported daily token totals. These are different time resolutions, not a token-to-percentage conversion. Graphs must show missing quota polls and resets as gaps, and must not fill missing token days with zero.

Current source now adds `quota_archive` to the private quota database, separate
from that recent cache. It keeps sanitized allowance observations, dated token
reports and polling outcomes without a rolling expiry. Exact duplicate records
are ignored. Different reports for the same date remain separate evidence, not
values to add together. Writes share the cache transaction and revision fence.
Disabling collection clears the active display but preserves the archive.
Account scopes remain separate, and raw provider replies and credentials are
not stored. Failed checks carry their status, not invented usage. A poll's
account scope describes its collection context, not proof of a successful login.

The migration backfills existing retained records before the first cache prune.
Already discarded observations and time before collection began cannot be
reconstructed without a supported historical source. Owner-local date-range
queries require an account scope and record kind, use indexed pagination, and
return at most 200 records or 512 KB per page. The archive is not included in
snapshots or shared automatically with paired devices. Existing sharing limits
and consent remain unchanged.

Storage has an 8 GiB safety ceiling and no automatic historical deletion. Disk
exhaustion or the ceiling causes a failed transaction, not silent record pruning.
Native archive browsing is being connected in Mac source. Deletion controls and
historical sync are still unfinished. The Mac development installation now uses this archive.
The installed Windows app has not yet received this migration.
Migration is incompatible with older binaries' strict single-table validator.
Installation must preserve a verified database backup, and rollback must not
point an older binary at the migrated database or discard newer observations.
Before migrating a populated legacy store, the collector now creates a private
`private-quota/migration-v1-<random>.sqlite` recovery copy. It contains the
exact legacy record and schema, including private account state. The original
database stays write-locked until migration completes. Backup failure prevents
migration. Fresh stores do not need a copy, and successful migration does not
repeat it on subsequent reads. A failed migration can leave an additional copy.
Interrupted backup files must pass SQLite integrity and schema checks before use.

Recovery copies stay on the owning device and are not dashboard or sync payloads.
They are not restored automatically. A rollback must first stop collection and
preserve the newer database separately. Restoring an older copy alone would hide
later observations and could restore obsolete sharing consent. Full installer
rollback and consent reconciliation still require separate verification.
Synthetic Mac and Windows tests cover migration, a 400-day cache expiry,
account changes, monitoring disable, duplicate delivery, pagination, failed
polls, superseded writes and unexpected-schema rejection.

The internal owner-local `inspectQuotaArchive` API reports per-kind record
counts, observation bounds and allocated database bytes for a selected account,
plus a deletion confirmation token. `deleteQuotaArchive` requires that token and
an explicit confirmation value. Tokens are bound to the local salt, account
scope and current store revision. A later write expires the confirmation. The
delete operation holds the pairing lock and a database transaction, removes
only that account's archive records, and advances the revision to reject stale
collectors. Deleting the active account's history also clears its recent cache
and revokes sharing. Deleting an older account preserves the active account.
It does not change source configuration or disable future collection.
New provider reports may include cumulative totals or older reported dates.
Users who also want to stop receiving those reports must disable collection.

These are internal APIs, not an installed Delete button or a public endpoint.
The owner-local `quota-archive-control.mjs` process now provides paginated account
catalogues, allocated storage bytes and explicitly bounded date-range pages for
the native history browser. Catalogue pages contain at most 100 opaque account
scopes, with no account names, credentials or private salts. Record pages retain
the existing 200-record and 512 KB bounds. Requests use stdin, are limited to
2 KB and accept only catalogue or page actions. No network route or delete
action is exposed. Opening a never-enabled source does not initialize storage.
Existing legacy databases still use the backup-aware migration path when read.
Mac source now connects this process to a saved-history sheet in Allowances.
It has separate account groups, local-calendar date filters, allowance readings,
reported daily tokens, collection checks and bounded next-page navigation.
It displays allocated database bytes and the storage ceiling. Account names are
not retained, so groups use numbered labels with an explicit current marker.
The sheet is unavailable for saved snapshots and isolated dashboard previews.
Native compilation and reply-parser self-tests pass. The bundled native-to-Node
archive test also passes empty-store handling, separate account groups, paged
readings, daily reports, collection checks and rejection of a delete request.
Native runtime paths and script entry points resolve macOS path aliases without
relaxing private-store path checks. This test is required by build and ZIP checks.
First-account navigation and saved date ranges help identify account groups.
Interactive and visual checks remain pending, and this UI is not installed yet.

Deletion is logical removal from this device. It does not promise secure erasure
of free database pages, filesystem snapshots, backups or data already shared to
another device. Allocated database size may not shrink after deletion. Native
confirmation UI must communicate these limits and resolve the selected account
locally without exposing private account-scope keys to a peer.

Current Mac source adds a large live pace estimate and reset countdown, refreshed
every 30 seconds without provider polling. The coverage bar recalculates against
the current time. Estimates disappear after ten minutes without a fresh reading.
Hourly bars show percentage points per hour normalized over observed intervals
within each hour, with observed minutes exposed to accessibility clients. Gaps,
resets and intervals crossing hour boundaries are omitted rather than filled.
The chart is taller for readability. Native calculation tests cover countdown,
staleness, reset coverage and hourly segmentation. This iteration has compiled
and passed native self-tests, but has not been visually reviewed, installed or
ported to the Windows renderer.

Turning off the source clears active history, but is not a forensic secure-erasure operation. The retry deadline remains so toggling the source cannot bypass backoff.

## Remaining verification

The following September 9 candidate checks are historical evidence, not proof of the current installed layout. Both platforms now use native main windows. The September 12 Mac popup is a compact, non-scrolling summary, and its Open Observatory action was verified after the installed update. Spark / Bengal-fox is excluded from current allowance summaries, while historical model token records remain. Legacy collector migration and broader accessibility checks are unfinished.

The September 9 Mac candidate passed native self-tests, packaged collection with all sources disabled, pairing preparation/status/revocation checks, the dashboard renderer and data bridge, three dashboard open/close cycles, and the synthetic usage popup test. The popup test checks full on-screen placement, dashboard handoff, and reopening and closing the usage view without losing the dashboard. It allows up to two seconds for AppKit's animated close state to settle. These checks do not establish clean-install behavior or complete visual and accessibility coverage.

When the menu-bar item is hidden or cannot anchor a popover, the Mac app presents the same usage view in a floating panel. The Show usage popup menu action and Command-U remain available. The normal anchored popover is retained when its menu-bar button is visible.

A synthetic-data visual check of the Mac candidate verified selection of Codex five-hour, Codex weekly and Spark five-hour history, readable chart labels, scrolling to the lower controls, saved-reading treatment, the sign-in-required empty state and the dashboard button. The accessibility tree exposed all three window choices and chart summaries without duplicate point counts. This was not a full VoiceOver interaction audit.

The Windows form test passed on the signed-in desktop with in-memory data and inert refresh/navigation callbacks. It verified full on-screen placement, three allowance values, distinct rendered histories for all three window selections, selection preservation after reload, saved and unavailable states, and callback invocation. Form-only captures were reviewed for chart labels, reset/gap breaks and progress bars after their animation settled. The quota graph exposes the selected window's starting, ending and range values to accessibility clients, and the daily graph describes dated token totals. This does not verify tray activation or a complete keyboard/screen-reader session.

- Verify the native Windows account source on a machine that permits its installed Codex client to launch. The explicitly selected Ubuntu route has passed a live collection check.
- Verify Windows tray activation and complete remaining keyboard and screen-reader checks on both platforms.
- Verify the final packaged collectors, source controls and process cleanup on both platforms, then sync reviewed source and prepare updated releases.
