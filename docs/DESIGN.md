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

The name is stored in local settings and sent only to a paired device. It replaces no identifier used for pairing or deduplication. The snapshot keeps the platform value it has today, so saved history stays readable.

### Periods

| Period | Meaning |
| --- | --- |
| Now | The last 60 minutes. A meter or small graph, visually distinct from the other four. It leads with pace and estimated time until a limit runs out. |
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
- The snapshot stores tokens per day. Now needs an hourly token field added to the snapshot format.
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

The spike built the panel only. Its numbers are in [the build plan](BUILD-PLAN.md) and [the measurements record](RESOURCE-MEASUREMENTS.md). Open time was acceptable on both platforms. Memory was acceptable on the Mac. On Windows the web view must be released after the panel closes, and that is not measured yet.

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

`deviceNames` is still a proposal. It becomes part of the snapshot format only when the collector change is reviewed.

### Claude Code limits bridge

Added as source on 2026-10-13. The owner consented to installing it on the Mac that day, and it produced a real reading there. It is not installed on Windows.

| Piece | File | What it does |
| --- | --- | --- |
| Bridge | `scripts/claude-statusline-bridge.mjs` | Claude Code runs it as the status line command. It saves the 5-hour and 7-day percentages and reset times, then prints what the person's earlier status line command prints. With no earlier command it prints one line such as "5h 77% left · 7d 59% left". |
| Store | `claude-limits/limits.json` in the app's data folder | Two percentages, two reset times and the times they were observed. Nothing else from the status line input is kept. |
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
