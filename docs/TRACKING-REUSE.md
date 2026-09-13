# Unified usage tracking: reuse review

Reviewed September 12, 2026, with a sampling follow-up on September 13. This is an implementation direction and source review, not a claim that every integration works. No third-party code has been copied by this review.

## Useful upstream projects

| Project | Relevant evidence | Observatory decision |
| --- | --- | --- |
| [CodexBar](https://github.com/steipete/CodexBar/blob/main/docs/providers.md) | Provider-specific quota strategies, account switching, explicit data provenance and separate local token history. Its adapters include Codex, Claude, Gemini, Antigravity, Cursor and Copilot. | Best reference for adapter boundaries and native provider cards. Inspect specific adapters and tests at pinned commits before reuse. Do not adopt its credential or browser-cookie access implicitly. |
| [ccusage](https://github.com/ccusage/ccusage) | Reads local coding-agent records and produces dated and session token reports across multiple providers. | Best reference for incremental log parsers, token classes and reporting. Local token counts are not authoritative subscription-limit percentages. |
| [ActivityWatch architecture](https://docs.activitywatch.net/en/latest/architecture.html) | Watchers collect activity independently of the storage server and UI. | Keep collectors independent of whether Observatory's window is open. Retain the existing screen-time integration. |
| [ActivityWatch sync](https://docs.activitywatch.net/en/latest/syncing.html) | Beta sync stages device-specific databases and relies on a separate transport. Mobile support has limitations. | Learn from device-owned records and retryable transport, but do not turn on raw ActivityWatch database sync. Our sync boundary excludes raw window titles. |

CodexBar's [root license](https://github.com/steipete/CodexBar/blob/main/LICENSE) and ccusage's [application license](https://github.com/ccusage/ccusage/blob/main/apps/ccusage/LICENSE) are MIT. Any copied code still needs its applicable notices, dependency review, pinned provenance and independent tests. A project's supported adapter is not proof of vendor support for its internal endpoints or permission to access a user's cookies. ActivityWatch module licenses must be checked individually before copying code.

## Required data behavior

The requested graph stores actual quota observations, not percentages inferred from tokens. A 15-minute interval is the initial baseline, with five-minute sampling where the provider and local overhead permit it. Sleep, offline periods and failed checks create visible gaps. Reopening a window must not invent past readings or reset retry deadlines.

Keep related measurements on the same time range while preserving their units:

- Screen time: timestamped foreground and away intervals, with overlapping device intervals counted once.
- Tokens: provider, model, token classes and source-record identity. Deduplicate replicated logs.
- Allowances: provider, an explicitly linked private account identity, bucket/window, observation time, remaining percentage, reset time and collection-device provenance. Never sum the same account's remaining percentages across devices.
- Availability: last successful read, source state and gaps. Unknown is not zero.

The target is a unified Mac and Windows history with offline local collection, queued sanitized synchronization and matching native views. iOS remains later work and must use platform-supported permissions. Credentials, raw transcripts and raw window titles stay on their owning devices. Account linking must be explicit because the current per-device salted account hashes are not cross-device identities.

## Current gaps and sequence

1. Verify continued collection across startup, sleep and reconnect. Retained quota collection has saved real background observations. Successful reads have a five-minute minimum interval with persistent deadlines. On September 13 the installed Windows collector saved a successful allowance observation using an explicitly selected Ubuntu Codex client. The credentials remained with that client. This does not establish sleep/wake or rendered-graph coverage.
2. Make the cadence visible and configurable per supported provider. Coordinate polling for a shared account, respect rate limits, and test account switches and source disabling.
3. Complete installed native-history verification, with gap/reset handling consistent with the selected cadence. Both native main windows include retained graphs with synthetic test coverage. Complete live rendered-history and accessibility checks. Keep tray panels compact.
4. Complete installed consent and account-history exchange verification. The implemented quota-sharing contract has isolated bidirectional tests, but sharing remains off on the development pair. Account linking and device observations must not be inferred from matching percentages.
5. Evaluate additional adapters in priority order: Antigravity, Claude, Gemini, Copilot and Cursor. Reuse already working integrations instead of claiming a universal sign-in flow.

Current retention is bounded to 30 days of raw quota observations, with a 10,000-sample and 8 MB limit. It is not permanent history. Long-term retention and rollups need a visible policy before promising that all past allowance statistics remain available.

## Faster sampling investigation

### Allowance pace estimates

The source now calculates percentage points of allowance consumed per hour and approximate hours and minutes remaining. Each account observation and limit window is handled separately. The calculation uses up to one hour of contiguous readings and requires at least three readings spanning 15 minutes. History continuity allows ten minutes plus 30 seconds of native timer tolerance. Reset timestamps may vary by up to two seconds to accommodate observed provider rounding. Larger gaps, larger reset changes, allowance increases and conflicting observations split the history. Account switches discard the previous account's pace.

An estimate is not a measured countdown. The display identifies its observation interval and labels remaining time as approximate at the last check. It reports when the reset should arrive before exhaustion, when no recent consumption is observed, or when history is insufficient. Readings ten minutes old cannot supply a current estimate. These calculations do not change stored observations, retention or polling frequency.

The 0.3.7 candidate also compares estimated exhaustion with the remaining time until reset. A compact Now-to-Reset bar represents the portion of that interval the allowance is expected to cover. For example, 2 hours 30 minutes until exhaustion against 4 hours until reset produces 62.5% coverage. This is a time comparison, not another allowance percentage or a guarantee of future availability. When reset comes first, coverage is capped at 100% and the text explains why. Stale or insufficient estimates have no comparison bar.

The Mac 0.3.7 candidate passed a synthetic visual check of the estimate, reset duration and coverage bar. Windows native tests verify the rendered bar value, endpoint label and removal for stale readings. Installed Mac 0.3.6 has a live-verified hourly pace display, but the new reset comparison is not yet installed. Building, packaging, installing and publishing a signed release remain separate verification steps.

Both native displays consume the same summary. Focused calculation tests pass on Mac and Windows. Windows synthetic native tests verify fresh text appears and stale text is withheld. Mac visual and accessibility checks verified the synthetic pace display. Packaged collectors on both platforms preserve pace fields in saved snapshots. Mac 0.3.5 is installed, but delivery of the timing correction remains pending. Windows 0.3.5 installer preparation and read-only upgrade preflight passed without replacing the installed app.

### Sampling cadence

The requested next direction is the most frequent practical sampling without noticeable performance impact. No faster production cadence has been enabled yet. Both native schedulers request collection every five minutes, while successful quota reads set a separate five-minute retry deadline after completion. A scheduled tick before that deadline skips the read, so actual allowance observations can be about ten minutes apart. Do not describe the timer interval as a guaranteed observation interval.

A September 13 read through the installed Windows-to-Ubuntu account adapter completed in 1.615 seconds. A separate bounded diagnostic allowing graceful process shutdown measured 1.181 seconds, 0.30 user CPU seconds, 0.25 system CPU seconds and 139,944 KiB maximum resident memory for the Linux timed command. These measurements exclude Windows Node overhead, WSL VM overhead, network bytes and Mac collection. A short read is not proof of zero battery or responsiveness impact.

The next candidate is an allowance-only one-minute lane, with heavier token, activity and dictation scans scheduled separately. Daily account-token history should not be downloaded on every quick limits check. Preserve persistent backoff, serialized collection, settings-change fencing, original observation times and sleep/offline gaps. A one-minute timer must not create catch-up bursts after a long read or wake.

The pinned CodexBar revision `afa483f2a287ebb999adbfaa060a2c3d0cfa1cc8` provides useful reference behavior. Its [fixed timer](https://github.com/steipete/CodexBar/blob/afa483f2a287ebb999adbfaa060a2c3d0cfa1cc8/Sources/CodexBar/UsageStore%2BAdaptiveRefresh.swift) advances from scheduled ticks and skips missed ticks. Its [provider coordinator](https://github.com/steipete/CodexBar/blob/afa483f2a287ebb999adbfaa060a2c3d0cfa1cc8/Sources/CodexBar/ProviderRefreshCoordinator.swift) groups concurrent requests and invalidates superseded publication generations. Its [token sequence](https://github.com/steipete/CodexBar/blob/afa483f2a287ebb999adbfaa060a2c3d0cfa1cc8/Sources/CodexBar/UsageStore%2BTokenRefreshSequence.swift) serializes heavier scans separately. These are architectural references, not evidence of a provider-approved polling rate or code already integrated into Observatory.

Before enabling the faster lane, test both native schedulers, real repeated reads, process cleanup, low-power behavior, source/account changes and peer publication. Address history storage too: one-minute observations reach 10,000 samples in about seven days. Do not silently shorten retention or replace genuine missing observations with interpolation to make the graph appear more detailed.
