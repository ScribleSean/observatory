# Unified usage tracking: reuse review

Reviewed September 12, 2026. This is an implementation direction and first-pass source review, not a claim that every integration works. No third-party code has been copied by this review.

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

1. Verify continued collection across startup, sleep and reconnect. Retained quota collection is wired into the legacy Mac collector and has saved real background observations. Successful reads have a five-minute minimum interval with persistent deadlines. The Windows installation preserves its existing quota-off setting.
2. Make the cadence visible and configurable per supported provider. Coordinate polling for a shared account, respect rate limits, and test account switches and source disabling.
3. Complete installed native-history verification, with gap/reset handling consistent with the selected cadence. The Mac native main window includes the retained graph and has passed synthetic checks. Windows native main-window work remains open. Keep tray panels compact.
4. Extend the reviewed private sync schema to account observations, with explicit account linking and deterministic duplicate handling. The current quota history is local, not unified across devices.
5. Evaluate additional adapters in priority order: Antigravity, Claude, Gemini, Copilot and Cursor. Reuse already working integrations instead of claiming a universal sign-in flow.

Current retention is bounded to 30 days of raw quota observations, with a 10,000-sample and 8 MB limit. It is not permanent history. Long-term retention and rollups need a visible policy before promising that all past allowance statistics remain available.
