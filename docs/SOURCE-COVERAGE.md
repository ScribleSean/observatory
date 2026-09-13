# Source coverage

The dashboard reads several kinds of records. A successful read means that adapter returned data, not that every activity or model call has been captured. Per-source check times measure the read, not the latest user activity. Snapshot ages update while the page is open. A stale snapshot is not presented as a current read.

Activity also reports the latest observed tracking coverage, including idle intervals. Coverage within ten minutes of collection is recent. Older coverage produces a warning, without deleting saved activity or treating missing tracking as inactivity. Failed reads, missing coverage metadata and future timestamps are unknown. This status describes the collection time, not continuous watcher monitoring. Recent combined coverage does not prove every paired device is currently tracking. Sleep, an offline device and a stopped watcher can all produce stale coverage.

## Which collector supplies these views?

- The self-contained Mac collector reads local ActivityWatch, saved Codex usage/settings, and optional Wispr statistics. Explicit private pairing enables supported Windows records and verified combined totals. Fresh installations remain unpaired.
- The Windows collector reads local ActivityWatch, saved Codex usage/settings and optional Wispr statistics. It can also start a selected installed Ubuntu WSL distribution to read its saved Codex records. When explicitly paired, it projects received Mac records on its next collection.
- Existing source-configured Mac previews retain the legacy SSH collector. That path supplies the cross-device comparisons, optional account quota and configured receipt views described below. Those capabilities are not automatically enabled in new local-only installations.

Both independent native collectors derive token and settings views from the same saved-log read. The legacy collector instead reconciles settings against separate daily token reports. See [Mac](MAC.md) and [Windows](WINDOWS.md) for tested platform scope.

| Source | What it measures | Important limit |
| --- | --- | --- |
| ActivityWatch | Foreground app intervals intersected with non-away intervals | Foreground time does not prove typing, focus or model execution |
| Saved Codex logs and legacy daily reports | Tokens by recorded day and model | Aliases may be inferred, and hosts may contain mirrored sessions |
| Codex settings metadata | Token counter increments associated with recorded reasoning effort and service tier | Unreconciled counters are withheld, with missing coverage stated explicitly |
| Codex tool metadata | Allowlisted categories of saved tool-call requests | Not an execution-success report, duration measure or full SSH history |
| Codex limits | Read-only account quota windows and reset timestamps | Optional five-minute polling with retained observations and failure backoff, not other providers' limits |
| Local model receipts | Saved benchmark call counts, output tokens, latency and GPU measurements | Not general local-model history or proof the runtime is currently running |
| Dictation statistics | Wispr metadata on Mac/Windows | Counts and durations only, not transcripts, recordings or microphone monitoring. ChatGPT voice tracking is unverified. |

## Foreground app detail

Recognized app names map to a fixed public list before transfer. Unknown applications become Other app. Raw window titles and arbitrary executable names stay on their source device. ChatGPT and Codex can share one desktop process label, so the dashboard keeps that label combined. Different concurrent app categories are presented as Device overlap and counted once.

## Reasoning, speed and price

The settings reader inspects recent session and archive logs on their owning machine. It keeps only model IDs, recorded effort, service tier, token counts and tool-call categories. It never exports prompts, command arguments, working directories or raw session IDs. Duplicate session files select the largest saved copy. It uses the latest request counters when cumulative usage changes, with cumulative deltas as a fallback. Unchanged cumulative counters are not counted twice. A model selection does not relabel an earlier turn. Both `standard` and `default` are recognized as Standard speed.

The legacy cross-device collector brackets each settings read with daily token reports. If those totals change, it retries once. Continued changes withhold settings detail while preserving tool metadata. This prevents active usage from creating a false accounting mismatch. The request-counter rule was checked against the installed daily reader using local aggregate comparisons and synthetic reset fixtures. The upstream [Codex parser](https://github.com/ccusage/ccusage/blob/main/rust/adapters/codex/src/parser.rs) documents the same preference for request counters over cumulative differences.

Before showing a settings breakdown, every token-category subtotal must fit the corresponding daily model report. A mismatch withholds that breakdown. Missing labels stay Unknown, and inferred model aliases are not used for price estimates.

## All-host tokens

Day selects one recorded date. Week selects the seven calendar days ending at the selected date. All time includes every available daily row in the source report, not only the recent settings scan. Deleted or unlogged requests are not recoverable. Model and host contributions use the same selected period, and unknown counters remain unknown.

In the legacy SSH configuration, All combines Mac, Ubuntu and native Windows daily Codex reports. It includes a by-host contribution breakdown, combined model rows and the same standard API comparison. Saved external-agent review receipts and local benchmark measurements are not added to these totals. Independent native candidates leave combined totals unavailable rather than adding potentially mirrored logs.

Before aggregation, every host must return a successful token report and complete session-metadata inventory. Each collection generates a fresh random salt. Source machines turn session and parent identifiers into HMAC comparison keys. These temporary keys exist only during collection and are discarded before the snapshot is written. Only the verification result and overlap counts are saved.

Shared identifiers, cross-host parent relationships or a shared parent block the combined total. Unavailable sources and incomplete inventories also block it. The dashboard does not guess which duplicate to keep. This checks cross-host overlap, not the completeness or correctness of every underlying provider record. Per-host settings must reconcile before they contribute to combined settings.

## Weekly activity timeline

On macOS, the collector accepts watcher pairs matching the local Unix hostname or Bonjour LocalHostName. This handles separate local bucket histories without choosing the newest pair and dropping earlier records. Each window watcher must have exactly one away-status watcher under the same bucket hostname. Other computer names are excluded, ambiguous local pairs fail closed, and overlapping accepted histories count once. Bucket names remain in memory and are not saved in the dashboard.

Week shows seven dated rows with eight slim three-hour bands per row. Hover or focus highlights the same time band across days. Select a band to retain its active and tracked duration below the chart, or select a date to open Day. Missing tracking records are muted and do not display a zero activity total. A tracked interval with no active time can display zero. Tracking coverage comes from intersecting window and away-status records, including idle records. It does not establish full-day coverage. Repeated daylight-saving hours share a band, while totals retain elapsed duration.

Model rows show a standard short-context API comparison and its share of the priced subtotal, not a share of the subscription bill. Expanded settings rows can apply the published Fast-mode rates where the tier was recorded. Reasoning tokens remain part of output. Long-context pricing, tools, regional adjustments and unreported cache writes are excluded. Rates were checked against [OpenAI pricing](https://developers.openai.com/api/docs/pricing) on September 6, 2026.

## Account limits

The optional quota reader starts a short-lived local Codex app-server process, initializes it and calls only `account/rateLimits/read`. It exits after a response or a bounded timeout. It uses the existing authenticated client, never reads credentials into the dashboard, never launches a task, and never redeems resets or requests credits. Account IDs and credit details are discarded. See the [official protocol](https://learn.chatgpt.com/docs/app-server).

## Gaps requiring a separate approach

Recorded tool rows preserve case-sensitive identifiers and directly recorded namespaces. Expand a tool to see counts by date. Older category-only snapshots are labeled as legacy aggregates. The recent saved-log scan is bounded, and private bookkeeping is excluded. Calls nested inside a wrapper are not reconstructed from arguments. Counts do not establish success, duration or every tool execution.

Handoff discovery reads top-level `.usage.json` files only in the configured folder. It rejects symbolic links, limits individual files to 1 MiB, aggregate reads to 8 MiB, matching files to 128, and directory scanning to 10,000 entries. Skipped records or limits produce incomplete coverage. Missing folders are unavailable, not empty successful histories. Continued conversations retain their newest snapshot with a deterministic filename tie-break instead of summing cumulative counters. Roles are restricted to Coordinator, Subagent and Unknown. A role is not inferred from a model name or filename.

- iPhone activity is not a plug-in source for this web dashboard. Apple's [DeviceActivityReport](https://developer.apple.com/documentation/deviceactivity/deviceactivityreport) runs inside a privacy-preserving extension sandbox that restricts exporting sensitive activity. Do not bypass that boundary. A user-supplied summary is a possible future input, not an installed feature.
- Google documents [Gemini data export](https://support.google.com/gemini/answer/16920332?hl=en), including activity and conversations. That does not establish a token-billing report. No export or transcript import has been requested here. A future metadata-only importer needs an inspected sample and explicit scope.
- General SSH commands outside saved Codex logs remain untracked. Broad shell-history capture is deliberately not enabled.
- Other providers' remaining allowance requires a verified provider-specific interface. Codex quota is not a substitute for Gemini or Claude limits.
