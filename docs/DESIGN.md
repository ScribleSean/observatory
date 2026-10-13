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
4. **Actions.** Refresh, Check for updates, Settings, Open Observatory.

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

Approved for removal from both apps in one change each: the Agents section and receipt source, local benchmarks, Antigravity limits, the ChatGPT, Cursor and Antigravity placeholder rows, the web fallback inside the native apps, the legacy SSH hub collector, Open saved snapshot, and the remaining Ubuntu fields.

Removal from the interface does not authorize deleting saved records or original source files.

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

Decided in direction on 2026-10-13. It is not built. A spike is measuring it first.

The app has three parts.

| Part | What it does | Built how many times |
| --- | --- | --- |
| Collector | Reads sources and writes one sanitized snapshot | Once, in the shared scripts |
| Shell | Tray or menu-bar icon, window, startup, updates, security checks, pairing processes | Once per platform |
| Viewer | Turns the snapshot into what the person sees | Three times at build 40: SwiftUI, Windows Forms and React |

The direction is one viewer. It is written once with web technology and shown inside each shell in the system web view (WebKit on Mac, WebView2 on Windows), for the dashboard window and for the panel. The web demo is the same viewer with fictional data. No web server, container or browser tab is involved.

The SwiftUI and Windows Forms viewers stay the default until the shared viewer is verified on both of the owner's devices. Nothing is removed during the spike. This replaces the earlier plan to remove the web view from the native apps. Electron was rejected for its size. Tauri, Flutter and similar were rejected because they would also replace the shells, which hold the tested update and security code.

### Spike

The spike builds the panel only. The decision to continue rests on measurements from both devices: time from click to a drawn panel, and memory with the panel open and after it closes. Those numbers do not exist yet.

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
| `claudeLimits` | Claude Code limit windows in the same shape as `quota` | The panel shows one Claude Code row reading Unknown |
| `deviceNames` | Custom names keyed by `Mac` and `Windows` | The panel shows "macOS" and "Windows" |

These names are proposals. They become part of the snapshot format only when the collector change is reviewed.

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

Issue 58 (the Windows app refusing its private folders when started from a packaged app) is handled alongside this list.

## Open questions


## Sources

- [Claude Code status line](https://code.claude.com/docs/en/statusline)
- [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
- [Codex app-server rate limits read](https://github.com/openai/codex/pull/5302)
- [CodexBar](https://github.com/steipete/CodexBar), reviewed as a reference for approach, not as a dependency
