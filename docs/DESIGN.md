# Design direction

Agreed on 2026-10-13 between the owner and the coordinator session, from `main` at `57518b7` (version 0.3.14 build 40). This document records direction. It is not a build, an installed-app result or a verification record. Nothing described here as planned exists until [the parity table](PARITY.md) marks it Done for a platform.

This file replaces a short note about the earlier Material 3 web dashboard. That note remains in Git history at `57518b7`. [Brand guidance](BRAND.md) still owns the mark and the palette values. Where an older document disagrees with this one about scope or audience, this one is newer.

## Who the app is for

Observatory is the owner's app, built in public. It should be usable by anyone who installs it on a Mac or a Windows PC without the owner's setup. It is not sold. The repository and the demo page should look finished enough to show as portfolio work.

A person with one device must get a complete app. Pairing a second device is optional.

## What the app answers, in order

1. How much of my coding limit is left for Claude Code and for Codex, and how fast am I using it?
2. How many tokens and how much screen time did I record in a chosen period, on a chosen device?
3. Is collection working?

Claude Code and Codex get equal weight on every screen that shows either one.

## Tray and menu-bar panel

The Mac menu-bar panel and the Windows tray panel have the same content in the same order.

1. **Limits.** One row per provider and window (for example Claude Code 5-hour, Claude Code weekly, Codex 5-hour, Codex weekly). Each row shows percent remaining, a meter and the reset time. A reading that is not current shows the time it was observed.
2. **Filters.** Device: All, then one entry per device. Period: Now, Day, Week, Month, All time. The device list comes from the snapshot, so a later device type needs no layout change.
3. **Totals.** Tokens and screen time for the selected device and period.
4. **Actions.** Refresh, Check for updates, Settings, Open Observatory. The update action uses an upward arrow in a circle. A downward arrow read as "download my data" when the owner first saw it.

Dictation does not appear in the panel.

### Device names

Each device has a name the person can edit in Settings. With a custom name set, the app shows the name alone in the panel and the name with the platform in parentheses in the dashboard, for example "Studio (Mac)". Without one, it shows "macOS" or "Windows". Phrases such as "this Mac" and "this PC" are retired from views that show data.

The name is stored in local settings and will be sent only to a paired device, after R2 as "Snapshot additions" describes. It replaces no identifier used for pairing or deduplication. The snapshot keeps the platform value it has today, so saved history stays readable.

### Periods

| Period | Meaning |
| --- | --- |
| Now | The last 60 minutes, approximated from hourly buckets as "Snapshot additions" describes. A meter or small graph, visually distinct from the other four. It leads with pace and estimated time until a limit runs out. |
| Day | One calendar day in the device's time zone |
| Week | The seven calendar days ending on the selected day |
| Month | The 30 calendar days ending on the selected day |
| All time | Every retained day |

The same five names are used in the panel and in the dashboard. "Today", "All retained" and "Latest 24 hours" are retired as filter labels.

### Refresh

Refresh in the panel runs a limits-only read first, which takes seconds, and shows the result. The full collection then continues in the background.

## Dashboard sections

In order: Limits, Activity, Tokens, Dictation, Sources, Settings.

- **Limits** replaces the name Allowances everywhere, including code identifiers when they are next touched.
- **Dictation** is optional. It appears only when a dictation source is enabled.
- **Sources** replaces Source health.
- **Agents** is removed.

Each section uses the same card order and grouping on both platforms. Settings sections appear in the same order on both: Sources to collect, Accounts, Devices and sharing, Startup, About and updates.

## Numbers that must stay separate

| Number | Source | Label |
| --- | --- | --- |
| Percent of a limit remaining | Provider-reported | "remaining" |
| Session cost | Claude Code's own `cost.total_cost_usd` from the status line | "Session cost (estimate)" |
| API-equivalent cost | Computed from recorded tokens and the shared price table | "API-equivalent (estimate)" |
| Tokens | Saved logs | "tokens" |
| Screen time | ActivityWatch | Duration |

Dollar figures are estimates at list price. A subscription is not billed per token. A model with no entry in the price table stays unpriced. Unknown is never shown as zero.

## Data source decisions

| Topic | Decision |
| --- | --- |
| Claude Code limits | Read the documented `rate_limits` fields that Claude Code passes to a status line command. A small bridge script writes them to a private file that the collector reads. Installing the bridge needs explicit consent, must pass data through to any status line the person already has, and must be removable. |
| Claude Code limits, not allowed | Do not call the undocumented OAuth usage endpoint. Do not read the Claude Code token from the Keychain or a credentials file. Do not read browser cookies. Anthropic's legal page says developers may not collect, store or intermediate Claude.ai credentials or session tokens. |
| Codex limits | Keep the read through the Codex app-server (`account/rateLimits/read`). Handle the newer response that lists several named limits. |
| Price table | One file in the repository, taken from a maintained open table. A script refreshes it. The app shows the date it was last checked. A test fails when a model in the fixtures has no price. No network request at runtime. |
| Claude Code log scan | Replace the hard stop at 2,000 files or 128 MiB with an incremental cache keyed by file, as the Codex reader already has. |
| Time zone | Days follow the device's time zone. Saved history needs a tested migration before this ships. |
| Combined Claude Code total | Per device until cross-device overlap checks exist. |
| Screen time | ActivityWatch stays a separate install. A built-in tracker is later work. |

## Known limits of these decisions

- Claude Code limits update only when a Claude Code session responds. Between sessions the app shows the observation time.
- The `rate_limits` fields appear only for Pro and Max subscribers. People have reported versions where the fields were missing. Both cases show Unknown.
- The Codex app-server protocol is versioned with the installed Codex client and can change.
- Collection runs every five minutes. Now can be fresher than that only for limits.
- The snapshot stores tokens per day. Now needs the hourly token field described under "Snapshot additions", which no collector writes yet.
- Provider terms changed several times in 2026. Recheck the Claude Code legal page before each public release.

## Removals

Approved for removal from both apps in one change each: the Agents section and receipt source, local benchmarks, the ChatGPT and Cursor placeholder rows, the web fallback inside the native apps, the legacy SSH hub collector, Open saved snapshot, and the remaining Ubuntu fields.

Removal from the interface does not authorize deleting saved records or original source files.

Done on 2026-10-13 in source: limits for a third provider that the owner no longer uses were removed from both collectors, both native apps and the earlier web view, with their helper process, launch flags, settings switch and tests. A saved settings file that still holds that provider's key is read without error and the key is ignored. The provider's name remains only in the list of recognised app names for screen time, because saved activity history is validated against that list.

## Pairing and sharing

- Tailscale is the supported route for other people. The app uses the Tailscale client the person has installed for reachability. Trust still comes from a pairing code and the existing TLS pairing code. The app does not embed Tailscale.
- The existing SSH pairing keeps working until the new path is verified on both of the owner's devices.
- Sharing becomes one choice made at pairing time, replacing the two separate sharing switches. Consent on both devices and revocation are preserved.

## Distribution

- Builds stay unsigned. The install guides state the security warning each platform shows and why.
- Mac and Windows each get a short install guide. A signed installer and automatic updates are later work.
- Check for updates reports whether a newer release exists and links to it.
- The web demo mirrors the native apps and doubles as the product page. It uses fictional data only. Publishing it, or publishing a release, needs the owner's approval each time.

## Visual style

One source for values and one source for words. Each platform generates its constants from them.

| Shared file | Holds | Generated into |
| --- | --- | --- |
| `native/design-tokens.json` | Palette, meaning colours, provider colours, chart colours, type sizes, spacing, radii, shadows | Swift, C# and CSS |
| A shared strings file (to be added) | Section names, period names, status words, button labels, time formats | Swift, C# and TypeScript |

Tests fail when a generated file is stale. A later test should fail when a view uses a fixed colour or a local label where a shared one exists.

**Colour.** Keep the earthy sage palette in [brand guidance](BRAND.md). Four colours carry meaning and are used the same way on every surface.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `claude` | `#B5633C` | `#E0916B` | Claude Code meters, dots and chart series |
| `codex` | `#3F6E8C` | `#8FB8D4` | Codex meters, dots and chart series |
| `warning` | `#94620F` | `#E2B866` | A low limit, a reading that is not current |
| `error` | `#A23B32` | `#E58A80` | A failed read or a failed action |

The sage accent stays reserved for selected controls. Contrast of these four against the background and surface colours has not been measured yet. Appearance follows the system setting by default, with a manual switch.

**Type.** Inter Tight on every surface, including the panel and the setup wizard. Sizes stay at 22, 19, 14.5 and 12. Numbers use tabular figures.

**Spacing.** The existing scale of 4, 8, 12, 16 and 24. Cards keep a 16 radius and 16 padding.

**Wording.** Short labels. At most one caveat sentence per view, with further detail behind an information control. Missing values read "Unknown". Times are relative ("4m ago") with the exact time available on hover or focus. Raw status values such as `ok` are never shown.

## Skins

Decided in direction on 2026-10-13. Four skins and three limit styles exist as source in the shared panel since that date. No installed app shows them, and there is no skin choice in Settings yet.

A skin changes how the shared viewer looks. It never changes what a number means, which values are shown or how they are computed.

- **A skin is data, not code.** It is one JSON file with a fixed set of fields. A skin cannot contain CSS, script, markup or a link to a remote file. The viewer ignores unknown fields and rejects a skin with a missing or malformed field.
- **Fields.** A name, light and dark values for every colour token, a font choice from the bundled fonts for text and for numerals, a corner radius, whether rules are drawn, and a limit style.
- **Limit styles.** A fixed list the viewer implements. Bar, numeral and text bar exist. Block and dial are planned. A skin picks one. A new style is a change to the viewer, reviewed like any other.
- **Bundled fonts only.** A skin names a font the app ships. Each added font needs its licence recorded in `THIRD-PARTY-NOTICES.md`.
- **Contrast.** Bundled skins must pass a contrast check for text on background and on surface, in light and dark. A skin a person adds is checked the same way and shown with a warning if it fails.
- **Where skins live.** Bundled skins sit beside `native/design-tokens.json`, which becomes the default skin (Sage). A person's own skins are files in the app's data folder, chosen in Settings.

Bundled skins, in `native/skins/`:

| Skin | Limit style | Light and dark | Notes |
| --- | --- | --- | --- |
| Sage | Bar | Both | The default. Its colours must equal `native/design-tokens.json`, and a test checks that. |
| Almanac | Numeral | Both | The dark values are the look first sketched as Almanac Night. |
| Instrument | Bar | Same in both | Dark by nature |
| Amber CRT | Text bar | Same in both | Dark by nature |

`lib/skins.mjs` validates a skin, builds its style values and checks contrast. Text and secondary text need 4.5 to 1 on the background and on the surface. Meters, dots and large numerals need 3 to 1. All four bundled skins pass in light and dark, which also covers the provider, warning and error colours that were unmeasured before.

A shell chooses a skin by setting `data-skin` on the root element or by loading `panel.html?skin=name`. With sample data the page shows a skin picker so a person can compare them.

Fonts: Almanac uses Fraunces and the two mono skins use JetBrains Mono. Both are bundled in `public/fonts/` under the SIL Open Font License, with their licence texts beside them and in the generated web notices. The app makes no font-service requests.

Candidates not built: Ledger, Blueprint, Terminal, Poster, Riso, Arcade and Nordic.

Because the viewer is shared, a skin applies to the panel, the dashboard and the demo on both platforms at once. Skins depend on the shared viewer replacing the native viewers. They are not planned for the SwiftUI or Windows Forms viewers.

## The `.observatory` file

Decided in direction on 2026-10-13. Export and inspection exist as a shared script since that date. Import, the Settings controls and the working store are not built.

### What exists

`scripts/observatory-file.mjs` has two commands.

| Command | What it does |
| --- | --- |
| `export --runtime <folder> --out <file.observatory>` | Reads the saved snapshot and writes one file. It refuses to replace an existing file. |
| `inspect <file.observatory>` | Validates a file and prints its devices, record sets, date ranges and counts. It prints no usage values. |

The file is one gzip-compressed JSON document. Decompressed, it is plain JSON a person can read.

| Section | Holds |
| --- | --- |
| Header | Format name, version 1, export time, app version, exporting device, time zone |
| `devices` | Each device with records in the file: its platform and its custom name when one is set |
| `records` | One set per device, kind and provider: screen time, Codex tokens, Claude Code tokens, dictation. Each set is a list of days. |
| `combined` | The collector's verified combined days, kept apart from any device |
| `limits` | Account-wide limit readings for Codex and Claude Code, with the reading history the snapshot holds |

Rules the script enforces: a record keeps the device it came from, a source that was not read is left out and not written as zero, a combined token set is included only when the collector verified it, and every value must be a number, a boolean, a short label or a small container of those. Text longer than 80 characters is refused, so a title, prompt or path cannot be carried. On import-side validation, unknown top-level fields are dropped and an unknown version is refused.

Limits of version 1:

- Limit history covers what the snapshot holds, which is about the latest 24 hours. The longer history in the private allowance archive is not exported yet.
- Codex reasoning and speed settings and tool-call counts are not exported.
- Exercised on the Mac against the real snapshot on 2026-10-13 from the source checkout, writing to a temporary folder: two devices, seven record sets, two combined sets and Codex limits, 38.5 kB compressed from 356 kB. Not exercised on Windows.

### Why import is not built yet

The collector rebuilds token history from the tools' own logs on every run. Records imported from another computer have no logs behind them, so the next collection would drop them. Import therefore needs the working store described below, where imported history can live. Until then a file can be exported, kept as a backup and inspected.

### Direction

- **Export and import.** Settings offers "Export data" and "Import data". Export writes one `.observatory` file. Import reads one back. This covers backup, moving to a new computer and sharing a sample.
- **Scope of an export.** An export always holds everything this device has: its own history and the records it has received from each paired device. There is no date-range option. Every record keeps the device it came from and that device's platform.
- **What import does with devices.** Import groups records by their source device. Records for a device that already exists here are merged into that device's history. Records for a device this installation has never seen are kept as a separate, read-only device and are never folded into another one. A device is matched by its pairing identity when the file carries one, and otherwise by platform and name.
- **Contents.** A versioned, compressed container holding the same sanitized records the snapshot and the saved history hold today. It holds no pairing keys, device identities, provider credentials, comparison salts, window titles, prompts or file paths.
- **Import is additive and checked.** Import validates the whole file before changing anything, keeps a recoverable copy of the current data first, never replaces a newer record with an older one and never adds one device's records to another's.
- **As the working store.** The owner wants the app to read from and write to this format directly if that is a sound way to build it, with the result readable, maintainable and effective. The coordinator's recommendation is yes, in this shape: one folder-like container with a small manifest, one file of daily records per device and source, and one file of limit readings, each in plain JSON so a person can open and read it. The viewer keeps reading one snapshot that the collector derives from the store. That is a change to how collected data is saved, so it needs its own design, a tested migration from the files both installed apps hold now, and a rollback path. Export and import come first and use the same format, so the format is proven before anything depends on it.

Open question: how a device is identified in a file made on an unpaired installation, where no pairing identity exists.

## Where each platform follows its own conventions

| Topic | Mac | Windows |
| --- | --- | --- |
| Panel | Menu-bar popover | Tray popup |
| Secondary menu | App menu with shortcuts, short right-click menu | Short right-click menu: Open, Refresh, Quit |
| Icons | SF Symbols | A matching bundled or drawn set |
| Startup | Login Items | Start-at-login registration |
| Window | System title bar and traffic lights | System title bar |
| Accessibility | VoiceOver, system text size, View menu zoom | Narrator, system text scaling |
| Settings shortcut | Command comma | None required |

## Architecture

Decided on 2026-10-13. Both spikes measured it that day and the owner chose to go ahead. The measurements, the one open condition for Windows and the order of work are in [the build plan](BUILD-PLAN.md). Only the panel exists so far, behind a launch flag on each platform.

The app has three parts.

| Part | What it does | Built how many times |
| --- | --- | --- |
| Collector | Reads sources and writes one sanitized snapshot | Once, in the shared scripts |
| Shell | Tray or menu-bar icon, window, startup, updates, security checks, pairing processes | Once per platform |
| Viewer | Turns the snapshot into what the person sees | Three times at build 40: SwiftUI, Windows Forms and React |

The direction is one viewer. It is written once with web technology and shown inside each shell in the system web view (WebKit on Mac, WebView2 on Windows), for the dashboard window and for the panel. The web demo is the same viewer with fictional data. No web server, container or browser tab is involved.

The SwiftUI and Windows Forms viewers stay the default until the shared viewer is verified on both of the owner's devices. Nothing is removed during the spike. This replaces the earlier plan to remove the web view from the native apps. Electron was rejected for its size. Tauri, Flutter and similar were rejected because they would also replace the shells, which hold the tested update and security code.

### Spike

The spike built the panel only. Its numbers are in [the build plan](BUILD-PLAN.md) and [the measurements record](RESOURCE-MEASUREMENTS.md). Open time was acceptable on both platforms. Memory was acceptable on the Mac. On Windows the web view is released a minute after the panel closes, which was then measured and brought memory back near the never-opened figure.

### Panel contract

| Item | Contract |
| --- | --- |
| Page | `panel.html` in the bundled web files. It sets `window.observatoryPanelReady` when it has drawn. |
| Data | It requests `./local/usage.json` through the existing snapshot bridge. It reads nothing else. |
| Actions | Four fixed names with no arguments: `refresh`, `check-updates`, `open-settings`, `open-dashboard`. Mac receives them on the `panelAction` message handler. Windows receives `{ "panelAction": name }` as a web message. A shell must ignore any other value. |
| Reload | The shell may dispatch `observatory:snapshot-changed` on `window` after a collection. The page also reloads every 30 seconds while visible. |
| Appearance | Follows the system setting. A shell may set `data-theme` to `light` or `dark` on the root element. |
| Sample data | `panel.html?demo` shows fictional data and labels it "Sample data". |

The four actions map to things each shell already does. This is not a general command channel, and it must not become one.

### Snapshot fields the panel reads that no collector writes yet

| Field | Meaning | Until it exists |
| --- | --- | --- |
| `claudeLimits` | Claude Code limit windows in the same shape as `quota`. Written by the collectors since the change described under "Claude Code limits bridge". | Without the bridge installed its status is `not-connected` and the panel shows one Claude Code row reading Unknown |
| `deviceNames` | Custom names keyed by `Mac` and `Windows` | The panel shows "macOS" and "Windows" |

`deviceNames` is designed under "Snapshot additions" below. It becomes part of the snapshot format when the collector change that writes it is reviewed and merged.

### Snapshot additions

Designed on 2026-10-14 for issue 80, before any collector writes these fields. Nothing in this subsection exists in a collector, a saved snapshot or an installed app until [the parity table](PARITY.md) says so. Every addition is optional, so a saved snapshot without it still loads, and a missing field means Unknown, never zero.

**Local-first rule.** A paired collector rebuilds the snapshot from a fixed key list in `mergePeerPayloads` (`scripts/peer-payload.mjs`), and both peer channels refuse fields they do not know (`parsePeerPayload` and `parseProviderTokenSource` compare the parsed record with its clean projection). So each addition is written on the device that observed it and kept out of every record a device sends to its peer, on both channels:

- The core payload carries the reader reports, not the snapshot rows. An addition is either a field the payload's projection already ignores, or it is stripped in `createPeerPayload`.
- The Claude Code provider record strips it before `updateProviderTokenSource` in `collectProviderTokenSources` (`scripts/provider-token-sync.mjs`), because that function stores the same parsed object it returns as the dashboard row. The dashboard keeps the local row with the addition.

On a paired device `mergePeerPayloads` rebuilds this device's own `activity`, `tokens`, `settings` and `dictation` rows from the payloads, so a local addition on those rows is lost in the merge. After `finalizePeerCollection` the collector re-applies its local additions to the merged rows of its own host. Each addition below says how. An addition crosses to the paired device only in R2, the change that updates the exchange format in both apps together.

#### Hourly totals

| Field | Shape |
| --- | --- |
| `tokens[].days[].hours` | Codex. An array of exactly 24 non-negative integers, the total tokens of that day per hour. |
| `providerTokenSources[].days[].hours` | Claude Code, in the same shape, using the same deduplication identity the day totals use. A request's hour is the hour of its earliest retained timestamp, the same timestamp that sets its day in `scripts/read-claude-usage.py`, so a request that finishes after an hour boundary or after midnight stays in one hour of one day. The reader keeps only the earliest date today, so D1-2 keeps the earliest full timestamp. |
| `activity[].days[].hours` | Screen time. This array already exists and holds seconds per hour, for both devices, because `mergePeerPayloads` recomputes the peer's activity from its intervals. It is listed here because Now reads it. |

- Index 0 is the hour starting at midnight. The hour is the wall-clock hour in the zone that sets the day's date. Today that is the snapshot's `timezone` value, which both readers fix to `America/New_York`. When device time zones (T1) land, hours move with the days. On the day clocks go forward the skipped hour stays 0. On the day clocks go back both readings of the repeated hour add into the same index, so that index can hold two hours. Now is Unknown while either of its two buckets is a skipped or repeated hour, because the caveat sentence below would not be true then.
- **Codex route.** A Codex token's hour is the hour of the `token_count` event that recorded it, which the reader already caches, so the cache format does not change. `scripts/read-settings.py` reports the hours in a separate per-date field of its report, `hourTotals: [{date, hours}]`, not on `profiles` or `tokenProfiles`. `cleanSettings` (`scripts/collect-dashboard.mjs`) ignores that field, so it never reaches `settings[]` or the core payload's `codex` entries. The collector attaches it to the `tokens` row after `tokensFromSettings`, matched by date.
- The 24 values add up to the day's `totalTokens`. A day whose values do not add up gets no `hours`. A test checks the sum on every fixture day.
- For the two token fields, `hours` is present only when the reader read that day's events. A day saved before this change, or a token day received from a paired device, has no `hours`, and its hourly values are Unknown.
- For the two token fields, re-applying after a merge means: the collector puts its local `hours` on the merged row of its own host, matched by date, and only for a day whose merged `totalTokens` equals the sum of the 24 local values. Any other day keeps no `hours`.
- Every record sent to the peer leaves token `hours` out (local-first rule).
- The `.observatory` export drops token `hours` in version 1, because a 0 after the reading time cannot be told apart from an observed 0 inside the file. This needs a change in `scripts/observatory-file.mjs`, which copies every day field today. Activity `hours` are exported as they are today.

**Reading time.** Each row has a reading time, the moment up to which its hours were observed:

- A device row: its `checkedAt`, or the snapshot's `collectedAt` for a row without one. A reader stamps `checkedAt` with the time its read started, not the time it finished, so events written during the read are never counted as an observed 0.
- The `Combined` activity row: the earlier of the two payloads' `collectedAt` values, which `mergePeerPayloads` already uses as `asOf` for the `Combined` history row. D1 records that time on the row as `checkedAt`. The same rule applies to any later aggregate that carries `hours`, including a verified `combinedTokens` row after R2.

Within a day that was read, an hour that ends at or before the reading time holds a real value, and 0 there is a real 0. The hour that contains the reading time holds the events from its start up to the reading time, and 0 there is a real 0 for that span. An hour that starts after the reading time is Unknown, even though the array holds 0 there, because a stopped or late collector leaves those buckets untouched.

**Now.** The Now period is the trailing 60 minutes, approximated by adding the current hour bucket, up to the reading time, to the previous one. Across midnight the previous bucket is hour 23 of the day before. Now ends at the reading time, not at the moment the view is drawn. For a device, Now is Unknown when:

- either of the two days it needs has no `hours`,
- the current hour starts after the reading time,
- the reading time is more than 10 minutes old, the threshold the merge and the limits already use, or
- either bucket is a skipped or repeated daylight saving hour.

For All, Now reads only the collector's verified aggregates, as the other periods do. Device hours are never added together outside them:

- Codex tokens for All come only from a `combinedTokens` row whose verification status is `verified`. They stay Unknown until that row carries `hours`, which needs R2, because the peer's days have no `hours` before then.
- Screen time for All uses the `hours` of the `Combined` activity row, with the `Combined` reading time above.
- Claude Code tokens for All stay "By device", as they are for the other periods.

The panel and the dashboard show this one caveat sentence with every Now total:

> Now adds the previous clock hour to the current one up to the last reading, so it covers 60 to 120 minutes ending at that reading.

Screen time for Now uses the activity `hours` in the same way. Limits in Now keep their own observation times and are not approximated.

#### Device names

| Field | Shape |
| --- | --- |
| `deviceNames` | An object with optional keys `Mac` and `Windows`. Each value is the trimmed name, 1 to 32 UTF-16 code units long. |

- The local name is read from `<runtime>/device.json`, a file holding exactly `{"name": "..."}`. It is a separate file because the Mac Settings save path rewrites `collector.config.json` from fixed switches and both native validators would refuse a new key there.
- The reader refuses a linked file, a file over 1 KiB, a name that is empty after trimming, a name over 32 UTF-16 code units after trimming, and a name with control or format characters, an unpaired surrogate, or `/`, `\` or `:`. A refused or missing file leaves the key out, and the views show "macOS" or "Windows", as "Device names" above describes.
- The limit counts UTF-16 code units because the export in `scripts/observatory-file.mjs` does: it trims names and cuts them with `.slice(0,32)`, and its import check uses `length`. JavaScript `length`, C# `string.Length` and Swift `utf16.count` all count the same way, so both native Settings screens can enforce one rule. With the same limit here the export carries the whole name and needs no change. The 40 first planned was cut to 32 for this reason.
- A device writes only its own key. `deviceNames` is a top-level snapshot field that the merge does not rebuild, so the collector attaches it after `finalizePeerCollection`. The peer's name crosses only after R2 installs on both devices. Until then a paired device's entry is absent and shows its platform name.
- The name replaces no identifier used for pairing, deduplication or the platform value.

#### Claude Code session cost

| Field | Shape |
| --- | --- |
| `claudeLimits.sessionCost` | `{usd, observedAt}`. `usd` is a finite number from 0 to 10,000, rounded to the cent. `observedAt` is an ISO 8601 time. |

- Only the status line bridge writes it, from Claude Code's `cost.total_cost_usd`. It is stored beside the windows in `claude-limits/limits.json` as `{usd, observedAt}` with `observedAt` in Unix seconds, like the windows. That file's 4 KiB read limit still holds.
- The usage command never writes it. `scripts/claude-usage-command.mjs` accepts a result only when it reports zero cost, so a usage reading carries no cost. A usage reading runs on every collection, and `cleanStored` and `mergeClaudeLimits` (`scripts/claude-limits.mjs`) rebuild the stored record from `observedAt` and `windows` only today. D1-4 changes both to carry a stored cost through unchanged when the new reading has none, so a usage reading never removes or replaces a stored cost. A test covers a usage reading after a bridge write.
- The cost belongs to one session, while the windows are account-wide and merge by keeping the higher reading. So the cost has its own rule: the newest observation replaces the stored one, whichever session sent it. The session identifier is not kept, so the view cannot say which session it was.
- It uses the same 10 minute threshold as the windows, with a different result. A window 10 minutes old or older is still shown, with status `stale`. A cost 10 minutes old or older is left out of the snapshot and the view shows Unknown. A cost is never carried forward as a current figure.
- A status line input can carry a cost without `rate_limits`, for example for a person without a Pro or Max subscription. Today `extractClaudeLimits` returns nothing for that input and nothing is written. D1-4 changes this: the bridge stores a cost on its own, the stored record is valid with a cost and no windows, and `claudeLimitsSource` projects `sessionCost` whenever consent is given and the cost is current, including when `claudeLimits.status` is `unavailable`. Without consent (`not-connected`) there is no `sessionCost`.
- `claudeLimits` is attached after the merge and is not exchanged, so nothing needs re-applying.
- Label: "Session cost (estimate)". It stays separate from the API-equivalent estimate, as "Numbers that must stay separate" requires. Like the limits, it is observed on this device and is not sent to a paired device.

#### Source refusal codes

| Field | Shape |
| --- | --- |
| `refusal` on a device row of `activity`, `tokens`, `settings` or `dictation` | One code from a fixed list, present only when the row is not `ok` because a private folder was refused |

The field is named `refusal`, not `reason`, because `agentSource` rows already carry a `reason` with their own codes (`access-denied`, `unsafe-directory`, `read-timeout` and others, in `scripts/agent-receipts.mjs` and `scripts/bounded-receipts.mjs`), and `native/ReceiptSourceStatus.swift` renders a fallback message for a `reason` it does not know. The two lists stay separate.

| Code | Meaning |
| --- | --- |
| `private-folder-refused` | A private folder check failed, so the guarded source was not read |
| `ancestor-refused` | On Windows, the private folder check failed at its ancestry stage. That stage covers every ancestor failure (a reparse point, an unexpected owner, an unknown access list or a writable ancestor), so the code names the stage and does not claim a cause. |

- **Detection.** Today the only caller, `windowsPermissions` in `scripts/peer-directory.mjs`, runs `private-sync-acl.ps1` without `-Diagnostic` and discards its error output, so nothing can see the stage. D1-6 adds `-Diagnostic` to that call, maps only the exact line `Verification stage: inspect-ancestry` to `ancestor-refused`, and maps every other failure to `private-folder-refused`. No error output is kept or passed on. `peer-directory.mjs` attaches the code to the error it throws, so the collector can tell a private-folder failure from any other reader failure. When an error carries no code, `refusal` is absent.
- The row carries the code and nothing else about the failure: no path, no stage text, no error message.
- The views show a code they do not know as `private-folder-refused` would be shown, without its text. A new code is added here first.
- After a merge the collector re-applies `refusal` to the merged row of its own host with the same name, as it does for `hours`.
- The plan's name `packaged-app-start` is not used, because the script cannot yet tell the issue 58 pattern apart from a genuinely unsafe ancestor. If the script later reports a fixed stage value for an app-container owner, a `packaged-app-start` code can be added here for that case only.
- It exists for issue 58 reporting and is local-only. Records sent to the peer leave it out.

### Claude Code limits bridge

Added as source on 2026-10-13. The owner consented to installing it on the Mac that day, and it produced a real reading there. It is not installed on Windows.

| Piece | File | What it does |
| --- | --- | --- |
| Bridge | `scripts/claude-statusline-bridge.mjs` | Claude Code runs it as the status line command. It saves the 5-hour and 7-day percentages and reset times, then prints what the person's earlier status line command prints. With no earlier command it prints one line such as "5h 77% left · 7d 59% left". |
| Store | `claude-limits/limits.json` in the app's data folder | Two percentages, two reset times and the times they were observed, plus the session cost and its observation time described under "Snapshot additions". Nothing else from the status line input is kept. |
| Installer | `scripts/claude-statusline-install.mjs` | `status`, `install` and `uninstall` for the `statusLine` entry in Claude Code's `settings.json`. Install needs `--consent`, saves the earlier entry, writes a backup beside the settings file and refuses to overwrite a settings file that changed during the update. Uninstall restores the earlier entry. Nothing calls it automatically. |
| Reader | `scripts/claude-limits.mjs` | Both collectors attach `claudeLimits` to the snapshot. |

### Reading through the usage command

Added on 2026-10-13, after the bridge was found to update only from terminal sessions. On the Mac, two Claude desktop app sessions ran for several minutes without producing a reading, while one terminal session produced one within seconds.

With limits consent given, each collection also runs the installed Claude Code CLI once: `claude -p /usage --output-format json --no-session-persistence`. `scripts/claude-usage-command.mjs` accepts the result only when it reports no error, zero turns, zero cost and the local command name `usage`. It keeps the "Current session" and "Current week (all models)" percentages and reset times and discards the rest of the text. The reading goes into the same store as the bridge's, so the newest one wins.

- Observed on the Mac with Claude Code 2.1.296: the command returned in under half a second by itself, made no model request, and included usage from desktop app sessions. Through the collector's reader the whole read took about 3 seconds.
- With `--no-session-persistence` it writes no session file. It does create one empty project folder for its working directory, which is the app's `claude-limits` folder, so that happens once.
- The command prints text meant for a person. If the wording or the JSON fields change, the reader returns nothing and the bridge reading, if any, is still used. Nothing is guessed.
- The reader looks for `claude` on `PATH` and in a few usual install folders. A desktop app started from the Dock may not have the same `PATH` as a terminal. This is not yet verified inside an installed build, and not at all on Windows.
- Consent is the same marker the bridge installer writes. A way to give limits consent without changing Claude Code's settings is still needed.

Status values: `not-connected` when the bridge is not installed, `unavailable` when it is installed and no usable reading exists, `ok` when the newest reading is under 10 minutes old, and `stale` when it is older. A window whose reset time has passed is dropped, because its value is unknown until the next reading.

Things a person should be told before they consent:

- Claude Code hides most of its footer keyboard hints while any custom status line is configured.
- Readings arrive only while a Claude Code session is responding, and only for Pro and Max subscriptions.
- The limits are account-wide. They are observed on this device and are not sent to a paired device.

Verified on the Mac on 2026-10-13, from `main` at `50b2e7e`: the installer added the `statusLine` entry to a settings file that had none, left the other nine keys unchanged and wrote the backup. A Claude Code session in a terminal then wrote a reading with both windows within seconds, and `readClaudeLimits` returned status `ok`. The weekly figure matched the plan usage the Claude desktop app reported for the same account at the same time. The installed command points at the script in the source checkout, because build 40 does not contain it.

Not verified: the command quoting under PowerShell on Windows, the fields Claude Code sends on Windows, uninstall on a real settings file, and the native Settings switch, which does not exist yet. No installed build reads the saved reading into the snapshot yet.

## Order of work

0. The shared-viewer spike described under Architecture. Its result decides whether steps 2 to 8 are built once in the shared viewer or twice in the native viewers.
1. Removals.
2. Shared strings file, and wider use of the design tokens.
3. Month period and the five shared period names.
4. Claude Code limits through the status line bridge.
5. Claude Code beside Codex in Limits, Tokens and the panel.
6. Fast panel refresh and the four panel actions.
7. Now view and the hourly token field.
8. Claude Code cost and the shared price table.
9. Device time zone, with its migration.
10. Claude Code log scan cache.
11. Tailscale pairing and the single sharing choice.
12. Web demo as mirror and product page, install guides, README.
13. Skins, starting with Sage and Almanac.
14. Export and import of the `.observatory` file, then the design for using it as the working store.

Issue 58 (the Windows app refusing its private folders when started from a packaged app) is handled alongside this list.

## Open questions


## Sources

- [Claude Code status line](https://code.claude.com/docs/en/statusline)
- [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
- [Codex app-server rate limits read](https://github.com/openai/codex/pull/5302)
- [CodexBar](https://github.com/steipete/CodexBar), reviewed as a reference for approach, not as a dependency
