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

Each section uses the same card order and grouping on both platforms. Settings sections appear in the same order on both: Sources to collect, Accounts, Devices and sharing, Startup, About and updates. About and updates also holds Appearance, Skin and Export data, in that order, and Import data when it is built.

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
| Claude Code limits | With consent, each collection runs Claude Code's own usage command and keeps the 5-hour and weekly limit windows. An optional status line bridge can also write the documented `rate_limits` fields that Claude Code passes to a status line command. Installing the bridge needs its own explicit consent, must pass data through to any status line the person already has, and must be removable. Turning on Claude Code limits in the app does not install it. |
| Claude Code limits, not allowed | Do not call the undocumented OAuth usage endpoint. Do not read the Claude Code token from the Keychain or a credentials file. Do not read browser cookies. Anthropic's legal page says developers may not collect, store or intermediate Claude.ai credentials or session tokens. |
| Codex limits | Keep the read through the Codex app-server (`account/rateLimits/read`). Handle the newer response that lists several named limits. |
| Price table | One file in the repository, `native/prices.json`, taken from [LiteLLM's open price table](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json). It holds `source`, `checkedOn` and, per model, `input`, `cachedInput`, `cacheWrite` and `output` in USD per million tokens. The packaged apps ship only script files, so `scripts/price-data.mjs` carries the same data and a test fails when the two differ. `scripts/price-refresh.mjs` refreshes both by hand and is never imported by a collector. The app shows the date it was last checked. A test fails when a model in the fixtures has no price, apart from a short list of older models the source table does not carry under their direct names. No network request at runtime. |
| Claude Code log scan | Replace the hard stop at 2,000 files or 128 MiB with an incremental cache keyed by file, as the Codex reader already has. |
| Time zone | Days follow the device's time zone. Saved history needs a tested migration before this ships. |
| Combined Claude Code total | Per device until cross-device overlap checks exist. |
| Screen time | ActivityWatch stays a separate install. A built-in tracker is later work. |

## Known limits of these decisions

- With consent, Claude Code limits update at each collection. A reading from the status line bridge arrives only while a Claude Code session is responding. The app shows the observation time of the newest reading.
- The `rate_limits` fields appear only for Pro and Max subscribers. People have reported versions where the fields were missing. Both cases show Unknown.
- The Codex app-server protocol is versioned with the installed Codex client and can change.
- Collection runs every five minutes. Now can be fresher than that only for limits.
- The snapshot stores tokens per day. Now needs the hourly token field described under "Snapshot additions". Since D1 the collectors write it for the device that read the tokens, and token hours from a paired device wait for R2.
- Provider terms changed several times in 2026. Recheck the Claude Code legal page before each public release.

## Removals

Approved for removal from both apps in one change each: the Agents section and receipt source, local benchmarks, the ChatGPT and Cursor placeholder rows, the web fallback inside the native apps, the legacy SSH hub collector, Open saved snapshot, and the remaining Ubuntu fields.

Removal from the interface does not authorize deleting saved records or original source files.

Done on 2026-10-13 in source: limits for a third provider that the owner no longer uses were removed from both collectors, both native apps and the earlier web view, with their helper process, launch flags, settings switch and tests. A saved settings file that still holds that provider's key is read without error and the key is ignored. The provider's name remains only in the list of recognised app names for screen time, because saved activity history is validated against that list.

## Pairing and sharing

- Tailscale is the supported route for other people. The app uses the Tailscale client the person has installed for reachability. Trust comes from the existing TLS pairing: the person copies an invitation on the first device, pastes it on the second, and confirms the claimed device on the first. Earlier text called the invitation a "pairing code", and the owner confirmed on 2026-10-14 that this is what it means. The app does not embed Tailscale.
- The existing SSH pairing keeps working until the new path is verified on both of the owner's devices.
- Sharing becomes one choice made at pairing time, replacing the two separate sharing switches. Consent on both devices and revocation are preserved.

## Distribution

- Builds stay unsigned. The install guides state the security warning each platform shows and why.
- Mac and Windows each get a short install guide. A signed installer and automatic updates are later work.
- Check for updates reports whether a newer release exists and links to it.
- The web demo mirrors the native apps and doubles as the product page. It uses fictional data only. One publication is approved in advance: when everything in the build plan's "What done means" is installed and verified on both devices, workstream F1 publishes one GitHub release and the demo page, with no further confirmation (decided by the owner on 2026-10-13 and confirmed on 2026-10-14). Any other publication of the demo or a release needs the owner's approval each time.

## Visual style

One source for values and one source for words. Each platform generates its constants from them.

| Shared file | Holds | Generated into |
| --- | --- | --- |
| `native/design-tokens.json` | Palette, meaning colours, provider colours, chart colours, type sizes, spacing, radii, shadows | Swift, C# and CSS |
| `lib/strings.json` | Section names, period names, status words, button labels, time formats | Swift (`native/Strings.swift`), C# (`native/windows/Strings.cs`) and TypeScript (`lib/strings.generated.ts`) by `scripts/build-strings.mjs` |

Tests fail when a generated file is stale. Since 2026-10-14 the shared viewer reads every label from the strings file. The Swift and C# outputs are compiled but no native view reads them yet. A later test should fail when a view uses a fixed colour or a local label where a shared one exists.

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

Decided in direction on 2026-10-13. Four skins and three limit styles exist as source in the shared panel since that date, and since 2026-10-14 one hook applies the skin to the panel and the dashboard page alike. No installed app shows them, and there is no skin choice in Settings yet.

A skin changes how the shared viewer looks. It never changes what a number means, which values are shown or how they are computed.

- **A skin is data, not code.** It is one JSON file with a fixed set of fields. A skin cannot contain CSS, script, markup or a link to a remote file. The viewer refuses a skin with an unknown, missing or malformed field.
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

A shell chooses a skin by setting `data-skin` on the root element. The page reads it on load and follows a later change to it, so a shell can switch skins without reloading. A shell should not use `?skin=name`, because the Windows host refuses query strings. The query works only for the sample pages in a browser. An unknown name falls back to Sage, whether it is set before the page loads or later. With sample data each page shows a skin picker so a person can compare them.

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

Decided on 2026-10-13. Both spikes measured it that day and the owner chose to go ahead. The measurements, the one open condition for Windows and the order of work are in [the build plan](BUILD-PLAN.md). So far the shared panel exists behind `--web-panel` on both platforms. Since 2026-10-14 the bundle also builds `dashboard.html` with the six sections as empty states. Windows hosts the dashboard window behind `--web-dashboard`. The Mac has no dashboard flag or host yet. Workstream M1 adds them.

The app has three parts.

| Part | What it does | Built how many times |
| --- | --- | --- |
| Collector | Reads sources and writes one sanitized snapshot | Once, in the shared scripts |
| Shell | Tray or menu-bar icon, window, startup, updates, security checks, pairing processes | Once per platform |
| Viewer | Turns the snapshot into what the person sees | Three times at build 40: SwiftUI, Windows Forms and React |

The direction is one viewer. It is written once with web technology and shown inside each shell in the system web view (WebKit on Mac, WebView2 on Windows), for the dashboard window and for the panel. The web demo is the same viewer with fictional data. No web server, container or browser tab is involved.

The installed apps keep showing the SwiftUI and Windows Forms viewers until a build with the shared viewer as the default is installed and checked on both of the owner's devices (L1). Nothing is removed during the spike. In source, the Mac build defaults to the shared viewer since M2-2 (issue 102) and the Windows build since W2-2 (issue 103), and `--native-viewer` keeps the earlier viewer for one build on each. This replaces the earlier plan to remove the web view from the native apps. Electron was rejected for its size. Tauri, Flutter and similar were rejected because they would also replace the shells, which hold the tested update and security code.

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
| Sample data | `panel.html?demo` shows fictional data and labels it "Sample data". The data comes from `lib/sample-snapshot.mjs`, the one fixture both viewer pages use. |

The four actions map to things each shell already does. This is not a general command channel, and it must not become one.

### Settings bridge contract

Written on 2026-10-14 for B1, before any shell implements it. It needs two reviewer checks against the rule below before code starts. The Mac shell implements it on the M2 branch (issue 102). The Windows shell does not yet (W2).

The action list, the argument rules and the limits below are also kept as data in `lib/bridge-contract.json`. `scripts/build-bridge-contract.mjs` generates the TypeScript types (`lib/bridge-contract.generated.ts`) and a message validator for each shell (`native/BridgeContract.swift` and `native/windows/BridgeContract.cs`), and its `--check` fails when a generated file is stale. `lib/bridge-contract.mjs` is the same validator for the page. This section stays the authority, and a change here and in the data file go in one reviewed pull request. The validators read "no readable `id`" as: the text is not valid JSON, nests deeper than 16 levels, is not an object, or has no `id`, more than one `id` or an `id` that is not an integer in range. Each such message is ignored without a result. Whether a custom skin name is in the shell's own list is checked by the shell, not by the validator.

The Settings view, the first-run steps and the pairing screens in the shared viewer change settings by sending named actions to the shell. This contract is the whole list. A shell accepts nothing else, and the list grows only by a reviewed change to this section.

**The rule.** No action carries a path, a command or free text that reaches a shell. Every argument is a boolean, a bounded integer, a value from a fixed list, or a string with a fixed pattern and length, with one exception: the device name is bounded free text, and it is only ever JSON-encoded into one file (see `set-device-name`). Two strings are opaque to the page, the pairing invitation and the sharing confirmation token. They reach only the private stdin pipe of the pairing control process or the standard input of a sharing control script, never a command line, a file name, a URL or a log.

**Consent stays native.** The owner decided on 2026-10-14 that a confirmation shown by the page is never enough for a change that needs consent or cannot be undone. The shell shows its own Yes/No dialog, with the wording the apps use today, before it turns a sharing channel on or records the sharing choice (`set-sharing-choice` with `true`, or a pairing confirmation with `sharing: true`), before `pairing-identity-create`, before it turns `quota` off, and before `pairing-disconnect` and `pairing-repair-prepare`. It sends the command only on Yes and returns `cancelled` otherwise. For `set-limits-consent` the page shows the disclosure listed at the end of "Reading through the usage command" before it sends `true`, and the shell also shows a native Yes/No with that disclosure's first sentence before it runs the consent script. On the Mac the dialog is titled "Turn on Claude Code limits?" with that sentence as its text. On Windows it is titled "Claude Code limits" with that sentence followed by "Turn on Claude Code limits?".

#### What the dashboard web view may load

The real boundary is which documents the dashboard web view loads, because only that web view registers the bridge handler.

- **At navigation.** Before the bridge is enabled, the dashboard web view's navigation guard (`decidePolicyFor` on the Mac, `NavigationStarting` on Windows) accepts only `dashboard.html` at the shell's local origin (`observatory://app` on the Mac, `https://observatory.invalid` on Windows), in the main frame, with no query. A fragment is allowed only from this list: `limits`, `activity`, `tokens`, `dictation`, `sources`, `settings` and `setup`. `dashboard.html?demo` and `panel.html` are refused at navigation.
- **What changes in the shells.** On Windows, `WebDashboard` stops falling back to `panel.html` once `dashboard.html` ships, and the guard it uses (`WebPanel.IsPage`, which today refuses every fragment and accepts `?demo`) gets a dashboard rule that allows the listed fragments and refuses any query. On the Mac, `LocalNavigation` allows any `observatory://app` URL today. The dashboard web view gets a guard with the same rule.
- **Sender check, as a second layer.** Each message is also checked against the sending page: on the Mac `message.webView?.url` with `frameInfo.isMainFrame` and the existing `securityOrigin` check, on Windows `e.Source`. Only the path `/dashboard.html` and the absence of a query are checked. The fragment is not checked, because the page can change it with `history.replaceState`, and the page already does that.
- **Content Security Policy.** The bridge relies on the policy both shells send today: `script-src 'self'` with no inline script or eval, `frame-src 'none'` and `object-src 'none'`. Changing that policy is a change to this contract and needs two reviews.
- **Panel.** The panel contract above stays separate and unchanged on its own `panelAction` channel. The panel web view never registers this bridge, and on Windows a `{"panelAction": ...}` message and a bridge message are never parsed by the same handler.
- **Shared storage.** On Windows the panel and dashboard web views share one profile and origin, so they share storage and `BroadcastChannel`. The dashboard page never turns a `storage` event, a `BroadcastChannel` message or a `window.postMessage` message into a bridge action.

#### Messages

- The page sends one string holding JSON text: `{"id": <id>, "action": "<name>", "args": {...}}`. On the Mac it goes through `webkit.messageHandlers.bridge.postMessage`, on Windows through `chrome.webview.postMessage`.
- The shell reads the message as a string and ignores anything else: `message.body as? NSString` on the Mac, passed to the generated validator as UTF-16 units without converting it to a Swift `String` first. On Windows it calls `TryGetWebMessageAsString()` (not `WebMessageAsJson`, which is the escaped form of the string), which throws `ArgumentException` for a message that is not a string, and the handler catches that and ignores the message.
- The string is at most 4,096 bytes of UTF-8, measured before parsing (`utf8.count` on the Mac, `Encoding.UTF8.GetByteCount` on Windows). A longer one is ignored.
- `id` is an integer from 1 to 2,147,483,647, chosen by the page and not reused within one page load. An `id` already in flight is refused. `action` is one of the names below. `args` is an object with exactly the listed keys, so `{}` for an action without arguments.
- A missing key, an extra key, a duplicate key (at the top level or in `args`), a wrong type or a value out of bounds refuses the message. The Mac cannot use `JSONSerialization` for this, because it keeps one value of a duplicate key silently. It uses a strict tokenizer or an equivalent check. B1-1 tests a duplicate key at both levels on both platforms.
- Types are strict JSON types. A boolean is the literal `true` or `false` only (checked with `CFBooleanGetTypeID` on the Mac, because `NSNumber` bridges `1` to a boolean). An integer is a JSON number with no fraction and no exponent. A string is a JSON string.
- Every string argument is checked after JSON decoding, so escaped characters count. It is refused if it holds a control character (U+0000 to U+001F or U+007F to U+009F) or an unpaired surrogate, unless its own rule below is stricter.
- A character count in this contract counts Unicode scalar values, except the device name, which counts UTF-16 code units (see `set-device-name`). Neither is Swift's `String.count`, which counts grapheme clusters.

#### How many at once

- `status`, `pairing-peer-address` and `pairing-cancel` skip both limits below and are handled at once. `status` and `pairing-peer-address` are answered from the cache. `pairing-cancel` writes `cancel` to the control pipe even while another pairing command is waiting for its reply, which the control process accepts.
- For every other action, at most one message per action name is in flight. A repeat of a name that is in flight gets `busy`.
- At most four of those messages wait in a queue behind the one being handled. A message that does not fit gets `busy`.
- While a native dialog or save panel is open, every action except `status`, `pairing-peer-address` and `pairing-cancel` gets `busy`, so two native dialogs are never open at once.
- `status` and `tailscale-check` never start a process per message. The shell refreshes the sharing and Tailscale parts of its own cache at most once every 5 seconds and answers from that cache.

#### Results

- The shell answers in the web view that sent the message, and only while the same document is loaded. A result for a message from an earlier document (after a reload or navigation) is dropped, because the new page may reuse that `id` and a `pairing-host-start` result holds the invitation.
- Delivery never builds script text. On Windows the shell calls `CoreWebView2.PostWebMessageAsJson` with `{"bridgeResult": detail}`, and the page's `message` listener turns it into the `observatory:bridge-result` event. On the Mac the shell calls `callAsyncJavaScript` with `detail` passed in `arguments`, and the fixed script dispatches `observatory:bridge-result` on `window` with that value. `detail` is `{id, ok, code}` and, for the actions that say so, `value`. The shell never logs `detail` or `value`, because a `value` can hold the invitation, which is a bearer secret.
- `code` is one of `done`, `refused` (the message broke this contract), `busy` (see "How many at once" and "Pairing session"), `cancelled` (the person declined or cancelled), or `unavailable` (anything else). `ok` is true only with `done`. The code carries no error text, path or stage name. `expired` is reserved for when a script reports an expired invitation or sharing token distinctly. Today both sharing scripts and the pairing control process report every failure the same way, so those cases return `unavailable`.
- A message with no readable `id` is ignored without a result. A refused message with a readable `id` gets `{id, ok: false, code: "refused"}`.
- The page waits 60 seconds for a result, longer than the shells' 45 second limit for a pairing control command. A result that arrives later for the same document is still applied. Before it shows a failure for a pairing action, the page reads `status` again.

#### Pairing session

The native pairing window today owns the control process and a collection reservation together. The bridge keeps that lifecycle in the shell.

- The shell owns at most one pairing session app-wide. A session begins on `pairing-host-start` or `pairing-join-claim` (and on `pairing-identity-create` or `pairing-host-defaults` if no session is open). Beginning one starts one pairing control process and pauses collection exactly as the native pairing window does today (`BeginDirectPairing` on Windows, `collectionPausedForPairing` on the Mac).
- A session that began on `pairing-identity-create` or `pairing-host-defaults` ends when that step returns. Hosting or joining then begins a new session.
- The session ends, the control process is stopped and the collection reservation is released on a finished pairing, on `pairing-cancel`, on a failure, when the dashboard window closes, when the dashboard document is replaced, and when the 10 minute limit of the control process (`peer-tls-control.mjs`) runs out.
- While a session is open, `refresh`, `set-sharing`, `set-sharing-choice`, `pairing-disconnect` and `pairing-repair-prepare` get `busy`. While any of those is running, or while the native direct pairing window or the SSH pairing item is open, a pairing action gets `busy`.
- `pairing-host-defaults` gets `busy` while a session is open. It never sends to, changes or ends a session it did not begin.
- `pairing-cancel`, `pairing-peer-address` and `status` never get `busy`.
- The shell polls the control process itself, at the interval the native window uses today (2 seconds), and keeps the pairing state in its own cache. `status` reads that cache and never sends a command to the control process, so page polling cannot use up the control process's limit of 512 commands.
- The shell numbers the commands it writes to the control pipe itself. It never forwards the page's `id`, because a reused id stops the control process.

#### Addresses

The shell checks every address argument with this grammar, which both shells can implement the same way:

- IPv4: dotted decimal, exactly four parts, each 0 to 255 with no leading zeros, in 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 or the Tailscale range 100.64.0.0/10.
- IPv6: groups of one to four hexadecimal digits in lowercase or uppercase, separated by `:`. Either exactly eight groups with no `::`, or two to seven groups with exactly one `::`. The first group is from `fc00` to `fdff` (unique local addresses). No `%` zone identifier and no embedded IPv4 part.
- At most 39 characters.

The pairing control process still checks the address with `isPairingAddress`, as the final check. Since P1 (issue 110) that function follows this same grammar and no longer uses Node's `isIP`, so it refuses IPv6 zone identifiers and embedded IPv4 too.

#### Actions

| Action | Arguments | What the shell does |
| --- | --- | --- |
| `refresh` | none | The panel's existing refresh |
| `check-updates` | none | The existing update check |
| `open-dashboard` | `section`: one of `limits`, `activity`, `tokens`, `dictation`, `sources`, `settings` | Opens the dashboard window at `dashboard.html#<section>` |
| `open-settings` | none | Opens the dashboard at `dashboard.html#settings` |
| `set-source` | `source`: one of `activity`, `codex`, `claude`, `wispr`, `quota`. `enabled`: boolean | Sets that switch in the local source settings, the same keys the native Settings writes today. Before turning `quota` off, the shell shows its native confirmation with the text Windows uses today (`NativeSourceSettings.cs`), titled "Account history": "Turn account monitoring off and clear Observatory's retained account readings on the next collection? Saved log-token history remains." The Mac saves this switch without a confirmation today and adds the same dialog. |
| `set-skin` | `skin`: a bundled skin id (`sage`, `almanac`, `instrument`, `amber-crt`) or a custom skin name matching `^[A-Za-z0-9][A-Za-z0-9 -]{0,31}$` (the `lib/skins.mjs` name rule, at most 32 characters) | Selects that skin. A bundled id always means the bundled skin, and the shell does not list a custom skin whose name equals a bundled id in any letter case. A custom name must equal a name in the list the shell enumerated from its own skins folder. The shell never builds a file name from the string. The choice is stored as described under "Viewer settings". |
| `set-device-name` | `name`: 1 to 32 UTF-16 code units (JavaScript `length`, C# `string.Length`, Swift `utf16.count`) after removing leading and trailing Unicode White_Space characters, with no control or format characters, no unpaired surrogate and no `/`, `\` or `:`. Or `null` to clear it. | Writes the trimmed name to `<runtime>/device.json` as `{"name": "..."}` with its own JSON encoder, with the guards and name rules in "Snapshot additions", "Device names", in this document (a 1 KiB cap and a linked file refused). The name never reaches a process argument, a standard input or a log. The limit and its unit match the export in `scripts/observatory-file.mjs`, which cuts names with `.slice(0,32)`. |
| `set-startup` | `enabled`: boolean | Login Items on the Mac, start-at-login registration on Windows |
| `set-appearance` | `mode`: one of `system`, `light`, `dark` | Sets `data-theme` on the shell's pages. The choice is stored as described under "Viewer settings". |
| `set-limits-consent` | `enabled`: boolean | For `true`, shows the native confirmation described under "Consent stays native". Then runs the limits consent script (D1-5), `claude-limits-consent.mjs`, with the fixed arguments `set --runtime <runtime> --consent` or `clear --runtime <runtime>`. The runtime folder is the one the shell already owns. No page action may pass `--bridge`, `--node`, `--settings` or `--runtime` to this script or to the status line installer. |
| `set-sharing-choice` | `enabled`: boolean | Added with P1-5. The one sharing switch. For `true`, shows the native sharing confirmation. Then writes `{"action": "choose", "enabled": true}` or `{"action": "choose", "enabled": false}` to the standard input of `sharing-choice.mjs --runtime <runtime>`. The choice is applied by the collector to each channel when that channel first has a recent reading. `false` turns both channels off. |
| `set-sharing` | `channel`: one of `codex-limits`, `claude-code-tokens`. `enabled`: boolean. `token`: exactly 64 lowercase hexadecimal characters, required when `enabled` is true and absent when it is false. | For `true`, shows today's native confirmation ("Share these usage records with the paired device? Enable sharing there separately. Credentials stay on their owning device."). Then writes `{"action": "enable", "token": ...}` or `{"action": "disable"}` to the standard input of `quota-sharing-control.mjs` (`codex-limits`) or `provider-token-sharing-control.mjs` (`claude-code-tokens`). The token comes from `status` and only fences a stale confirmation view. It is not consent. |
| `pairing-identity-create` | none | Shows a native confirmation with today's storage wording ("Allow a device identity stored in a permission-restricted file"). On Yes, sends `identity-create` with storage `restricted-file`. The shell supplies the identity: `null` on the Mac, where the control process generates it, and a key and certificate the shell generates on Windows. The identity never comes from the page and never appears in a result. |
| `pairing-host-start` | `address`: an address under "Addresses". `port`: integer from 1024 to 65535, the sync port. | Sends `host-start` with `address` and `port: 0`, so the invitation listener uses a temporary port, as both shells do today. The shell keeps `address` and `port` as this device's sync endpoint for `pairing-host-confirm`, and keeps the invitation for `pairing-copy-invitation`. `value` is `{invitation}`, which the page shows with the clipboard warning. |
| `pairing-copy-invitation` | none | Copies the invitation the shell kept from `pairing-host-start` to the system clipboard, as both native pairing windows do today. The page sends nothing secret. Returns `unavailable` when no invitation is kept. |
| `pairing-host-defaults` | none | Added with P1-5. Sends `host-defaults` to the pairing control process, which begins a session the way `pairing-identity-create` does and ends it when the step returns. `value` is `{address, port, portAvailable}`: `address` is this device's own Tailscale IPv4 (from `tailscaleSelfAddresses()`) or `null`, `port` is the default sync port 43128, and `portAvailable` is the result of the control process's bind check on that address and port, or `null` when `address` is `null`. The page uses it only to pre-fill the `pairing-host-start` fields, which the person can change. |
| `pairing-host-confirm` | `fingerprint`: exactly 64 lowercase hexadecimal characters. `peerAddress`: an address under "Addresses". `peerPort`: integer from 1024 to 65535. `sharing`: boolean, added with P1-5. | For `sharing: true`, first shows the native sharing confirmation (the `set-sharing` wording). On No it returns `cancelled` and sends nothing, and the page can confirm again with sharing off. Sends `host-confirm` with `peerCertificateSha256` set to `fingerprint`, `localEndpoint` set to `{kind: "tls", address, port}` from the kept `pairing-host-start` values, `peerEndpoint` set to `{kind: "tls", address: peerAddress, port: peerPort}`, and `sharing`. It sends no other keys. The control process records the sharing choice only after the pairing step succeeds. If recording fails, the control process answers `unavailable` although the pairing step completed. The page then reads `status`, which shows the pairing state and `sharingChoice.chosen` false, so the person can turn sharing on with the one switch. The page relies on `sharingChoice` from `status`, never on the confirmation result, to show whether sharing was chosen. |
| `pairing-peer-address` | none | Added with P1-5. Answered from the shell's cache. When the shell's own poll first sees the `confirming` state for a claim, it sends `pending-peer` to the control process in the same poll and keeps `peerAddress` until the session ends. A control process holds at most one claim per invitation, so the cached address always belongs to the fingerprint the page is confirming. The page asks again on later status refreshes, at most three times, while the answer is `null`. `value` is `{peerAddress}`, the claimed device's connection address when it passes the address rule, or `null`. The page uses it only to pre-fill `peerAddress` for `pairing-host-confirm`. Never `busy`. |
| `pairing-join-claim` | `invitation`: at most 2,048 characters, starting with `observatory-pair:v1:` and followed by one or more base64url characters (`A-Z`, `a-z`, `0-9`, `-`, `_`) | Sends `join-claim`. The control process decodes and validates it. |
| `pairing-join-confirm` | `sharing`: boolean, added with P1-5 | For `sharing: true`, first shows the native sharing confirmation, as for `pairing-host-confirm`. Sends `join-confirm` with `sharing` and no other keys. The choice is recorded only when the step reaches `local-ready` or `acknowledged`, and a recording failure answers `unavailable` as for `pairing-host-confirm`. A join that is still `awaiting-confirmation` records nothing. The shell asks at most once per pairing session: after a Yes, a later confirmation in the same session sends `sharing: true` without a second dialog. |
| `pairing-cancel` | none | Sends `cancel` and ends the session. Never `busy`. |
| `pairing-disconnect` | none | Shows the native confirmation, then runs `peer-revocation.mjs --runtime <runtime> --revoke`, with today's Mac behaviour (see below the table). |
| `pairing-repair-prepare` | none | Shows the native confirmation, then runs `peer-repair.mjs --runtime <runtime> --confirm-local-retirement`, with today's Mac behaviour (see below the table). |
| `tailscale-check` | none | Answers from the cache, refreshed by running `tailscale-status.mjs`, which takes no arguments. `value` is `{status}`, one of `running`, `offline`, `needs-login`, `needs-device-approval`, `stopped`, `starting`, `other-user`, `not-installed`, `unsupported` or `unavailable`. |
| `export-data` | none | Shows the shell's own save panel, which requires the `.observatory` extension and does not offer to replace an existing file. If the person picks a file, it runs `observatory-file.mjs export --runtime <runtime> --out <file>`. The script refuses to replace a file that exists by then, and the result is `unavailable`. The page never sees or sends the path. Cancelling the panel returns `cancelled`. |
| `status` | none | The one query, answered from the shell's cache. `value` is described below. Never `busy`. |
| `complete-setup` | none | Records that first-run setup finished. Added by O1's amendment on 2026-10-14. The shell writes `{"version": 1, "completed": true}` to `<runtime>/setup-state.json` with its own JSON encoder and the guards `FirstRunSetup` uses today (a 4 KiB cap and a linked file refused), and nothing from the page reaches that file beyond the action name. It does not change the source settings, which the page has already set through `set-source`, so finishing with every source off is allowed. When setup is already complete it changes nothing and returns `done`. When `setup-state.json` is linked, larger than 4 KiB or unreadable, when the source settings file is missing, linked, larger than 4 KiB or lacks one of the five source switches, or when the write fails, the shell writes nothing, returns `unavailable` and collection stays not allowed. While a collection runs it returns `busy`. The action itself runs no script and returns no `value`. After the write, collection is allowed and the shell starts its normal first collection, as finishing the native wizard does today, unless collection is paused (see `collectionPaused` under "The `status` value"), in which case the pause still wins and collection starts when it ends. |

**Disconnect and repair.** Both actions keep what the Mac does today (`native/main.swift`). After the person confirms, the shell pauses collection before it runs the script. It then checks again for a running refresh or pairing step, because one may have started while the dialog was open, and if so returns `busy` with collection still paused for the session. When the script succeeds, collection resumes. When the result cannot be verified, the result is `unavailable` and collection stays paused for the session, because pairing may already be disabled. The Windows shell adopts the same behaviour.

**Starting processes.** Every script above is a bundled script at a fixed location, run by the bundled Node. The shell starts it directly with an argument array (`Process` with `arguments` on the Mac, `Process` with `ArgumentList` and `UseShellExecute = false` on Windows), never through `sh`, `cmd` or PowerShell. It removes `NODE_OPTIONS`, `NODE_PATH` and `NODE_EXTRA_CA_CERTS` from the child's environment, as both `TlsSetupProcess` implementations do today. The other launches in the shells do not yet, and they change to match when they move behind the bridge. On the Mac since M2 the bridge scripts and the pairing control process get an allowlisted environment (a fixed `PATH`, plus `HOME`, `USER`, `LOGNAME`, `LANG` and `TMPDIR`). The collector and the trusted sync owner, which read `CLAUDE_CONFIG_DIR` and `CODEX_HOME`, keep the inherited environment without any `NODE_`, `PYTHON`, `DYLD_` or `UV_` variable and without `OPENSSL_CONF`, `OPENSSL_MODULES`, `SSL_CERT_FILE`, `SSL_CERT_DIR` and `LD_PRELOAD`. The arguments are fixed, apart from the runtime folder the shell already owns and the export file, which comes only from the shell's save panel. Nothing from the page joins the arguments. The shell does not forward a script's output or error text to the page: `observatory-file.mjs` prints the output path and its error messages, and the result carries only a code.

#### Viewer settings

Neither shell stores a skin or appearance choice today. Both store them in `<runtime>/viewer.json`, holding exactly `{"skin": <skin>, "appearance": <mode>}`, written by the shell with its own JSON encoder and the same guards as `device.json` in "Snapshot additions", "Device names" (a 1 KiB cap and a linked file refused). A missing or invalid file means `sage` and `system`. `status` reads the values back from that file.

#### The `status` value

One bounded object, at most 16 KiB as JSON, built from the shell's cache, holding only the keys below, in the order `status.fields` lists them in `lib/bridge-contract.json`:

- `version`: 1
- `app`: `{version, build}`, the version string (at most 32 characters) and build number
- `sources`: the five switches as booleans
- `skin`: `{current, bundled, custom}`, the bundled ids and at most 32 custom names, each following the `set-skin` rule
- `deviceName`: the stored name or `null`
- `startup`: boolean
- `appearance`: `system`, `light` or `dark`
- `limitsConsent`: boolean
- `collectionPaused`: boolean. True while the shell holds collection paused for a pairing session, a disconnect or a repair, or after a result it could not verify (see "Disconnect and repair"). The Settings view and the dashboard header show "Collection paused" while it is true. The dashboard header learns of a pause from its own `status` read, on load, on a snapshot change and every 30 seconds, so it can lag the Settings view by up to 30 seconds. Added on 2026-10-14 with O1's amendment.
- `pairing`: `{state, peerFingerprint, transport, invitationKept}`. Since P1-5, whenever no pairing session is open, the shell reads `<runtime>/pairing-status.json`, read with the rules of `readPairingStatusFile` in `scripts/peer-pairing-status.mjs` (exact keys, at most 1 KiB, a link refused, `unavailable` when missing or more than two minutes old). The age is checked again each time `status` is answered, so a value cached earlier is never reported once it is more than two minutes old. The file's states `establishing-trust` (paired, but no verified record from the other device yet), `active-sync` (a verified record from the other device that was collected within ten minutes of when the file was written, which is at most two minutes ago), `sync-stale` (the newest verified record is older) and `revoked` replace the state the shell reads from its pairing files, including its own `unpaired` for a revoked device, which keeps `pairing.json` beside the revocation marker. The file never replaces a state the shell owns: the file is not applied while a disconnect or repair runs, while collection stays paused after pairing work whose result could not be verified, or while the shell reports `identity-required` or `identity-recovery-required` after a failed host or join start, so the page can still offer to create an identity. `unpaired` from the file is reported as `unpaired`. When the file reads as `unavailable`, the shell reports what it reported before P1-5. The page never calls a device actively syncing for any other state. The control process answers `host-start` and later status polls on a hosting device with `hosting`, which is not in the list below. The shell reports it as `waiting`, and no new state is added for it. `state` is one of the statuses the pairing control process and its identity check report today (`idle`, `identity-ready`, `identity-required`, `identity-recovery-required`, `inactive`, `waiting`, `confirming`, `awaiting-confirmation`, `local-ready`, `acknowledged`, `configuration-ready`, `working`, `cancelled`) or `paired`, `unpaired` or `unavailable`, and since P1-5 `establishing-trust`, `active-sync`, `sync-stale` or `revoked`. A new status is added here first. `peerFingerprint` is 64 lowercase hexadecimal characters while the state is `confirming`, which is the hosting device waiting for the person to confirm the claimed device, and `null` in every other state. A joining device reports `awaiting-confirmation` after its claim, with no fingerprint, and confirms with `pairing-join-confirm` from that state. `transport` is `none`, `ssh` or `tls`. `invitationKept` is a boolean. The invitation itself is never in `status`.
- `sharingChoice`: added with P1-5. `{chosen, channels}`. The shell runs `sharing-choice.mjs` with `{"action": "status"}`, checks that its output has exactly the keys `version`, `chosen` and `channels` with `version` 1, and keeps `chosen` and `channels`. It is refreshed with the sharing part of the cache. Until a shell implements this, it reports `chosen` false and both channels `unavailable`, and the page keeps showing the two `set-sharing` switches while every channel is `unavailable`. `chosen` is a boolean. `channels` has exactly `codex-limits` and `claude-code-tokens`, each one of `on`, `waiting-for-reading`, `off` or `unavailable`.
- `sharing`: one entry per channel, `{enabled, canEnable, reason, token}`. The shell validates each sharing script's output with exact keys, as `QuotaSharing.cs` does today, before it enters the cache. `reason` is one of `ready`, `pairing-unavailable`, `account-unavailable` (Codex limits) or `source-unavailable` (Claude Code tokens). `token` is 64 lowercase hexadecimal characters when `canEnable` is true and `null` otherwise.

It holds no path, address, account identity, key, comparison salt or usage value. The `value` of `pairing-host-defaults` and `pairing-peer-address` holds a private address. The shell never logs it, and the page never stores it outside the two pairing fields it fills.

#### Outside the contract

- **SSH pairing.** Its request carries a host alias and three Windows paths that reach a PowerShell command, so it cannot be an action. It stays a native menu item in each shell until P1-7 removes it.
- **Export location.** Only the shell's own save panel chooses where an export goes.
- **Import.** Not built, as "The `.observatory` file" describes. When it is built, the file comes from the shell's own open panel in the same way.

#### Pairing code

The owner decided on 2026-10-14 that "pairing code" in this document and in the product direction means the existing invitation: the `observatory-pair:v1:` string made on the first device and pasted on the second. There is no separate short numeric code. The invitation is a bearer secret that expires after 10 minutes.

- The page shows it with a warning that clipboard managers may keep copied invitations and that it should be shared privately, the wording both native windows use today.
- Copying goes through `pairing-copy-invitation`, so the shell writes the clipboard itself.
- The page never writes the invitation to `localStorage`, `sessionStorage`, IndexedDB, the URL or history state, and drops it on cancel, on a finished or failed session and on `pagehide`. On Windows the web view profile is kept on disk, which makes this rule matter.

#### First-run setup

The owner decided on 2026-10-14 that the first-run wizard lives in the shared viewer (O1), at `dashboard.html#setup`. It writes through `set-source` and `set-limits-consent`, and finishes with `complete-setup`. It sends no other action except `status`.

- **Opening it.** A shell opens the dashboard at `#setup` while `setup-state.json` says setup is incomplete (O1-2). The page treats `setup` as a section that is not in the section list. The navigation is hidden while the wizard shows, except when no action bridge is available (a plain browser, or a window with only the snapshot bridge), where the wizard can only say "Open Observatory to finish setup." and the navigation stays so the page is not a dead end. When an action bridge is available but `status` cannot be read or is rejected (for example a shell that does not send `collectionPaused` yet), the wizard says "Observatory could not read its settings.", offers "Try again", which sends `status` once more, and keeps the navigation. A shell sends the full `status` value, `collectionPaused` included, before it opens `#setup`. Every other unknown fragment still shows Limits.
- **Step 1, sources.** The five `set-source` switches in the order ActivityWatch, Codex, Claude Code, Wispr Flow and Codex limits, each with one line saying what it reads, then Claude Code limits. Each switch is sent when it changes and shows the value `status` reports, or Unknown while `status` is not known. Turning Claude Code limits on first shows the disclosure listed at the end of "Reading through the usage command" (the same three lines Settings shows), and only "Turn on" sends `set-limits-consent`. The step names no SSH connection and links nowhere.
- **Step 2, other devices.** Text only: pairing a second device is optional and happens later, in Settings, with an invitation made on one device and pasted on the other. There is no pairing control in the wizard.
- **Step 3, finish.** A summary of the six switches as On, Off or Unknown, a note when none is on, and "Finish", which sends `complete-setup`. Finishing with ActivityWatch alone, or with nothing on, is allowed. On `done` the page shows Limits and writes `#limits` to the address. Any other result keeps the wizard open with the message for its code.
- **Demo.** `dashboard.html?demo#setup` runs the same wizard against the page's fake bridge, starting with every switch off. Nothing leaves the page.

### Dashboard page decisions

Recorded on 2026-10-14 from the reviews of pull request 87 (issue 84).

| Item | Decision |
| --- | --- |
| Ready flag | `dashboard.html` sets `window.observatoryDashboardReady` to `true` when it has drawn, as `panel.html` sets `window.observatoryPanelReady`. The Windows dashboard host already reads this name, and the Mac host and the test harnesses use the same one. |
| Web view data folder on Windows | The panel host and the dashboard host share one WebView2 user data folder, `WebViewCache` in the app's data folder. Both hosts create their WebView2 environment with that folder (`WebPanel.cs` and `WebDashboard.cs`), so a second host does not start a separate browser profile. |

### Dashboard page contract

| Item | Contract |
| --- | --- |
| Page | `dashboard.html` in the bundled web files. It sets `window.observatoryDashboardReady` after its first render. |
| Data | It requests `./local/usage.json` through the existing snapshot bridge, reloads on `observatory:snapshot-changed` and every 30 seconds while visible, and reads nothing else. |
| Sections | Limits, Activity, Tokens, Dictation, Sources, Settings, in a navigation labelled "Sections". Dictation is listed only when the snapshot has a dictation source whose status is not `not-connected`. A section without a view shows an empty state. A fragment naming a section, such as `dashboard.html#tokens`, opens that section on the first render, and a later change of the fragment switches to it. When the person picks a section, the page writes its id to the fragment with `history.replaceState`, so history does not grow and a query such as `?demo` is kept. An unknown fragment shows Limits. |
| Actions | Only the actions in "Settings bridge contract", and only when the page is `dashboard.html` without `?demo`. The Settings view sends them, the first-run wizard at `#setup` sends `status`, `set-source`, `set-limits-consent` and `complete-setup`, and the dashboard header sends `status` to show "Collection paused". With `?demo` the Settings view and the wizard answer from sample data and nothing is sent to the shell. No other section sends anything. |
| Appearance and skin | The same rules as the panel: `data-theme` and `data-skin` on the root element. |
| Sample data | `dashboard.html?demo` shows the same fixture as the panel and labels it "Sample data". |

The sample fixture also carries fields that later snapshot changes will add: `hours` on activity, Codex token and Claude Code days, `claudeLimits.sessionCost` and `claudeLimits.history`, top-level `prices`, `apiEstimate` on Claude Code day rows, and a dictation source row with `refusal: 'private-folder-refused'`. As the design requires before R2, the verified `combinedTokens` days carry no `hours`, so Codex Now for All is Unknown in the sample too. Their shapes follow the "Snapshot additions" section and the execution plan text for D2. The collectors now write top-level `prices` and `apiEstimate` on Claude Code day and model rows in those shapes, and since D1 `hours` on this device's Codex and Claude Code token days and `refusal` on a refused Codex row. No collector writes `claudeLimits.history` yet.

### Snapshot fields the panel reads that no collector writes yet

| Field | Meaning | Until it exists |
| --- | --- | --- |
| `claudeLimits` | Claude Code limit windows in the same shape as `quota`. Written by the collectors since the change described under "Claude Code limits bridge". | Without limits consent its status is `not-connected` and the panel shows one Claude Code row reading Unknown |
| `deviceNames` | Custom names keyed by `Mac` and `Windows`. Since D1-3 each collector writes its own key from `device.json`, but nothing writes that file until the Settings action exists. | The panel shows "macOS" and "Windows" |

`deviceNames` is designed under "Snapshot additions" below.

### Price fields in the snapshot

Both collectors write these after the provider exchange, in `attachProviderTokenEstimates` (`scripts/provider-token-sources.mjs`). They are computed on the device that writes the snapshot, from rows already in it, so nothing new crosses the exchange and the exchanged Claude Code record and its digest are unchanged.

| Field | Meaning |
| --- | --- |
| `prices` | `{source, checkedOn}` from the shared price table, so the dashboard can name the table and the date it was checked. Written on every collection. |
| `apiEstimate` on Claude Code day and model rows | The same shape Codex rows carry (`usd`, `parts`, `coveredTokens`, `excluded`, `checked`), computed from the row's model counts and the price table, for each Claude Code row with status `ok`, local or peer. A row with any other status, including a peer row marked `stale`, gets no estimate. A model with no price is excluded. The price lookup matches the exact model name, so a dated name (such as `claude-sonnet-4-20250514`) or a `-latest` name is unpriced unless the table lists that exact name. Claude Fable models and the `unknown` model bucket are unpriced too. When nothing in a row is priced, `usd` and `parts` are null, never zero. |

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
| `providerTokenSources[].days[].hours` | Claude Code, in the same shape, using the same deduplication identity the day totals use. A request's hour is the hour of its earliest retained timestamp, the same timestamp that sets its day in `scripts/read-claude-usage.py`, so a request that finishes after an hour boundary or after midnight stays in one hour of one day. Before D1 the reader kept only the earliest date. Since D1-2 it keeps the earliest full timestamp. |
| `activity[].days[].hours` | Screen time. This array already exists and holds seconds per hour, for both devices, because `mergePeerPayloads` recomputes the peer's activity from its intervals. It is listed here because Now reads it. |

- Index 0 is the hour starting at midnight. The hour is the wall-clock hour in the zone that sets the day's date. Today that is the snapshot's `timezone` value, which both readers fix to `America/New_York`. When device time zones (T1) land, hours move with the days. On the day clocks go forward the skipped hour stays 0. On the day clocks go back both readings of the repeated hour add into the same index, so that index can hold two hours. Now is Unknown while either of its two buckets is a skipped or repeated hour, because the caveat sentence below would not be true then.
- **Codex route.** A Codex token's hour is the hour of the `token_count` event that recorded it, which the reader already caches, so the cache format does not change. `scripts/read-settings.py` reports the hours in a separate per-date field of its report, `hourTotals: [{date, hours}]`, not on `profiles` or `tokenProfiles`. `cleanSettings` (`scripts/snapshot-clean.mjs`) ignores that field, so it never reaches `settings[]` or the core payload's `codex` entries. The collector attaches it to the `tokens` row after `tokensFromSettings`, matched by date.
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

The rule reads the snapshot rows, not the pairing state. When the snapshot shows exactly one native host and no sign of a paired device (the other host appears only as `not-connected` placeholders, no retired host carries data, and there is no `Combined` or `combinedTokens` data and no peer limits), All reads that host's own rows in every view and in the panel, because one device has nothing to add together (`soleHost` in `lib/panel-data.mjs`, issue 112). A paired device whose peer has not been merged yet marks the peer's rows `unavailable` (`finalizePeerCollection` in `scripts/peer-finalize.mjs`), so it keeps the rules above. While a device is paired but has not yet merged any record from the other device, the collector marks the other device's rows `unavailable`, so the one-device rule does not apply, the other device's sources count as configured, and the run state reads Partial until the first merge. If the saved pairing cannot be read safely, the collection stops before that marking step, so such a device still reads as one device.

The panel and the dashboard show this one caveat sentence with every Now total:

> Now adds the previous clock hour to the current one up to the last reading, so it covers 60 to 120 minutes ending at that reading.

Screen time for Now uses the activity `hours` in the same way. Limits in Now keep their own observation times and are not approximated.

#### Device names

| Field | Shape |
| --- | --- |
| `deviceNames` | An object with optional keys `Mac` and `Windows`. Each value is the trimmed name, 1 to 32 UTF-16 code units long. |

- The local name is read from `<runtime>/device.json`, a file holding exactly `{"name": "..."}`. It is a separate file because the Mac Settings save path rewrites `collector.config.json` from fixed switches and both native validators would refuse a new key there.
- The reader refuses a linked file, a file over 1 KiB, a name that is empty after trimming, a name over 32 UTF-16 code units after trimming, and a name with control or format characters, a line or paragraph separator (U+2028, U+2029) inside it, an unpaired surrogate, or `/`, `\` or `:`. A hard-linked file is refused like a symbolic link. A refused or missing file leaves the key out, and the views show "macOS" or "Windows", as "Device names" above describes.
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

- **Detection.** Before D1 the only caller, `windowsPermissions` in `scripts/peer-directory.mjs`, ran `private-sync-acl.ps1` without `-Diagnostic` and discarded its error output, so nothing could see the stage. Since D1-6 `peer-directory.mjs` passes `-Diagnostic` to that call, maps only the exact line `Verification stage: inspect-ancestry` to `ancestor-refused`, and maps every other failure to `private-folder-refused`. No error output is kept or passed on. `peer-directory.mjs` attaches the code to the error it throws, so the collector can tell a private-folder failure from any other reader failure. When an error carries no code, `refusal` is absent.
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
- With `--no-session-persistence` it writes no session file. Claude Code does create a project folder for its working directory, which is the app's `claude-limits` folder, with no session file in it. That happens once.
- The command prints text meant for a person. If the wording or the JSON fields change, the reader returns nothing and the bridge reading, if any, is still used. Nothing is guessed.
- The reader looks for `claude` on `PATH` and in a few usual install folders. A desktop app started from the Dock may not have the same `PATH` as a terminal. This is not yet verified inside an installed build, and not at all on Windows.
- Consent is given by either of two markers in the `claude-limits` folder, which must be a plain folder and not a link: `statusline.json`, which the bridge installer writes, or `consent.json`, which `scripts/claude-limits-consent.mjs set --consent` writes without changing Claude Code's settings. `clear` removes only `consent.json`, and uninstalling the bridge removes only `statusline.json`, so consent ends when neither marker is left. The installer's `--bridge <absolute path>` option is accepted only when its real path is the `claude-statusline-bridge.mjs` beside the installer itself (inside the app, `Contents/Resources/Collector/scripts`), and the stored command uses that real path.
- With consent, `claudeLimits` carries `usageCommand`, one word saying how that collection's command ended: `read` (accepted and stored), `not-found` (no `claude` executable), `failed` (could not start, exited with an error, produced too much output, or the reading could not be stored), `timed-out` (stopped at its time limit, or the whole limits read passed the collector's 20 second limit) or `unrecognized` (finished, but the output was not the expected result or held no usable limit line). It never carries output, an error message, a path or an exit code. A `stale` status beside any word other than `read` means the shown windows are an older reading. Without consent the field is absent.

Status values: `not-connected` when no limits consent is given (neither marker described above), `unavailable` when consent is given and no usable reading exists, `ok` when the newest reading is under 10 minutes old, and `stale` when it is older. A window whose reset time has passed is dropped, because its value is unknown until the next reading.

Things a person should be told before they consent. Settings and the first-run wizard show these three points, from `lib/strings.json` (`settings.disclosureCommand`, `settings.disclosureStorage` and `settings.disclosureOff`), and the native Yes/No in both shells quotes the first sentence of the first point. The switch writes only the consent marker, creating the app's `claude-limits` folder if it is missing. The status line bridge is a separate route with its own consent, and its footer hint note belongs to its installer, not to this switch. "Nothing is added to Claude Code's settings" refers to `settings.json`. The usage command still creates the project folder described above the first time it runs. Turning the switch off removes only `consent.json`. The last reading stays in `limits.json`. It is not shown, because the status is then `not-connected`, unless the status line bridge is installed. With the bridge installed, consent is still given, so the reading is shown and the usage command keeps running.

- Each collection runs Claude Code's own usage command and keeps only the 5-hour and weekly limit percentages and their reset times. The command uses the installed Claude Code sign-in and a small fixed set of environment variables, and nothing else from it is kept. If Claude Code reports no limits for the account, they show as Unknown.
- The readings are kept in this device's data folder and are not sent to a paired device. Export data includes them. A session cost is recorded only when the optional status line bridge reports one.
- Nothing is added to Claude Code's settings. Turn this switch off to stop the readings. If the status line bridge was installed separately, readings continue until it is removed.

Before installing the status line bridge, a person should also be told that Claude Code hides most of its footer keyboard hints while any custom status line is configured, and that the bridge receives readings only while a Claude Code session is responding.

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
