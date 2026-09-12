# Usage limits and token history

Status: development implementation, not a finished public release. The installed legacy Mac collector saved its first real retained allowance observation on September 12, 2026. The update preserved configuration and retained a backup of the previous scripts. The database was verified as owner-readable and owner-writable only. The installed Windows app includes optional account-source controls, but account-limit collection remains disabled in its current configuration. Cross-device allowance history, the finished graph and final release checks remain open.

## Allowance sharing under development

`scripts/quota-peer.mjs` defines a tested, opt-in payload contract. It is not connected to the peer transport or enabled in installed apps. Existing pairings do not share allowance history.

The contract carries the source device, a random sharing generation, original observation times, supported Codex allowance windows and dated token totals. It omits credentials, account identifiers and local account-scope hashes. It rejects unexpected inbound fields and conflicting observations. Duplicate totals are never added together. Retired Spark windows are excluded.

The private quota store now supports account-bound and pairing-bound consent. It defaults off for existing stores. Each explicit enable creates a random generation. Account changes, failed authentication and disabling monitoring revoke consent. A late collector result cannot undo a concurrent settings change. Disabling sharing preserves local readings.

Pairing disconnection now revokes local sharing consent and invalidates in-flight quota collection without deleting local readings. It writes the pairing fence before attempting quota cleanup. A cleanup failure is reported while pairing remains disabled. Users who never enabled quota monitoring do not get a quota database just by disconnecting.

Before transport integration, both devices still need explicit sharing controls and an authenticated agreement on the owner's current generation. Receiving code must check freshness and retain device provenance. A matching allowance percentage is not proof that two devices use the same account, so cross-device account totals must not be summed.

`quota-sharing-control.mjs` provides the local settings interface for that integration. Status returns only availability, consent state and an opaque confirmation token. Enabling requires a successful observation within ten minutes and a current token bound to the account-store revision and pairing. Disconnect and settings operations share the pairing lock. This interface has synthetic and command-line tests but is not yet exposed in native settings or used by transport.

`quota-exchange.mjs` implements a separate local endpoint intended for the authenticated SSH session. A readiness request sends no readings. Exchange checks the saved peer identity and local consent, then saves the validated peer record and allocates the outgoing revision in one quota-store transaction. Older records cannot replace newer ones, conflicting revisions fail, and revocation clears received records. Synthetic endpoint tests pass. The collector transport, native controls and peer-history rendering are not connected yet, so installed apps still do not exchange allowance history.

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

Quota observations are bounded to 30 days, 10,000 samples and an 8 MB serialized sample budget. Daily account totals retain up to 366 reported dates. The dashboard data projection includes the last 24 hours ending at the latest quota reading and recent reported daily token totals. These are different time resolutions, not a token-to-percentage conversion. Graphs must show missing quota polls and resets as gaps, and must not fill missing token days with zero.

Turning off the source clears active history, but is not a forensic secure-erasure operation. The retry deadline remains so toggling the source cannot bypass backoff.

## Remaining verification

The following September 9 candidate checks are historical evidence, not proof of the current installed layout. The September 12 Mac popup is a compact, non-scrolling native summary. Its Open Observatory action was verified in the installed app. Spark / Bengal-fox is excluded from the native allowance summaries, while historical token records remain. Mac source now defaults to a native main window with allowance history. Its launch, Settings and popup handoff passed isolated checks. Windows main-window migration and remaining legacy display checks are unfinished.

The September 9 Mac candidate passed native self-tests, packaged collection with all sources disabled, pairing preparation/status/revocation checks, the dashboard renderer and data bridge, three dashboard open/close cycles, and the synthetic usage popup test. The popup test checks full on-screen placement, dashboard handoff, and reopening and closing the usage view without losing the dashboard. It allows up to two seconds for AppKit's animated close state to settle. These checks do not establish clean-install behavior or complete visual and accessibility coverage.

When the menu-bar item is hidden or cannot anchor a popover, the Mac app presents the same usage view in a floating panel. The Show usage popup menu action and Command-U remain available. The normal anchored popover is retained when its menu-bar button is visible.

A synthetic-data visual check of the Mac candidate verified selection of Codex five-hour, Codex weekly and Spark five-hour history, readable chart labels, scrolling to the lower controls, saved-reading treatment, the sign-in-required empty state and the dashboard button. The accessibility tree exposed all three window choices and chart summaries without duplicate point counts. This was not a full VoiceOver interaction audit.

The Windows form test passed on the signed-in desktop with in-memory data and inert refresh/navigation callbacks. It verified full on-screen placement, three allowance values, distinct rendered histories for all three window selections, selection preservation after reload, saved and unavailable states, and callback invocation. Form-only captures were reviewed for chart labels, reset/gap breaks and progress bars after their animation settled. The quota graph exposes the selected window's starting, ending and range values to accessibility clients, and the daily graph describes dated token totals. This does not verify tray activation or a complete keyboard/screen-reader session.

- Verify the native Windows account source on a machine that permits its installed Codex client to launch. The explicitly selected Ubuntu route has passed a live collection check.
- Verify Windows tray activation and complete remaining keyboard and screen-reader checks on both platforms.
- Verify the final packaged collectors, source controls and process cleanup on both platforms, then sync reviewed source and prepare updated releases.
