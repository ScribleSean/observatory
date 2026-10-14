# Platform parity

First recorded on 2026-10-13 by reading source on `main` at `57518b7` (version 0.3.14 build 40). Rows changed since then describe `main` at build 41, where the shared web panel is merged behind launch flags on both platforms and is not what either installed app shows by default. This table describes source code. It was not checked against the installed apps, and no interaction was exercised to produce it.

No single workstream owns this file. Each pull request updates the rows that describe its own change, as the shared records rule in [the build plan](BUILD-PLAN.md) says, and the orchestrator resolves conflicts at merge. Update it also when [the design direction](DESIGN.md) changes.

## How to read it

| Value | Meaning |
| --- | --- |
| Done | Present in that platform's source and matches the direction |
| Differs | Present, but its content, wording, layout or behaviour differs from the other platform or from the direction |
| Missing | Not present in that platform's source |
| Unknown | Not read closely enough to say |

The Direction column says what [the design direction](DESIGN.md) asks for: Keep, Change, Add or Remove.

## Tray and menu-bar panel

| Element | Mac | Windows | Direction | Notes |
| --- | --- | --- | --- | --- |
| Left click opens the panel | Done | Done | Keep | |
| Name and freshness line | Differs | Differs | Change | Different freshness wording on each. Windows uses "Updated 4m ago". |
| Codex limits | Differs | Differs | Change | Mac draws rings for up to two windows. Windows shows text and a bar for up to two windows. |
| Claude Code limits | Missing | Missing | Add | The shared collector writes `claudeLimits` once the status line bridge is installed. No native view reads it. The shared web panel does. |
| Device filter (All, Mac, Windows) | Differs | Differs | Change | Mac opens on All. Windows opens on Windows. The list is fixed in code on both. |
| Period filter | Differs | Missing | Change | Mac offers Today, Week, All time. Windows shows the latest recorded day only. |
| Now period | Missing | Missing | Add | |
| Month period | Missing | Missing | Add | |
| Editable device name shown as "Name (Platform)" | Missing | Missing | Add | Both show fixed Mac and Windows labels |
| Tokens total | Done | Differs | Change | Windows shows the latest recorded day only |
| Screen time total | Done | Differs | Change | Windows shows the latest recorded day only |
| Voice row | Done | Missing | Remove | Dictation leaves the panel |
| Sources read count | Done | Missing | Keep | |
| Refresh action | Done | Done | Change | Add the fast limits-only read |
| Open Observatory action | Done | Done | Keep | |
| Settings action | Done | Missing | Add | On Windows it is in the right-click menu only |
| Check for updates action | Missing | Missing | Add | Present in the right-click menu on both |
| Right-click menu | Differs | Differs | Change | Mac has 8 items. Windows has 11, including three pairing items and a totals submenu. Target is Open, Refresh, Quit. |
| Uses design tokens and Inter Tight | Missing | Differs | Change | Mac panel uses system fonts and a fixed near-white accent. Windows uses the tokens with several fixed greys. |
| Light appearance | Missing | Missing | Add | Both panels are dark only |
| Escape closes the panel | Unknown | Done | Keep | |

## Dashboard shell

| Element | Mac | Windows | Direction | Notes |
| --- | --- | --- | --- | --- |
| Sidebar with seven sections in the same order | Done | Done | Change | Becomes six sections with new names |
| Sidebar icons | Done | Done | Keep | SF Symbols on Mac, drawn icons on Windows |
| Title and freshness header | Differs | Differs | Change | Shared wording needed |
| Devices button | Done | Done | Keep | Opens Settings on both |
| Refresh button | Done | Done | Keep | |
| Open saved snapshot | Done | Missing | Remove | |
| Appearance switch | Done | Done | Change | Both default to dark. Target is follow the system. |
| Text zoom | Done | Missing | Keep | Mac has View menu zoom. Windows relies on system scaling. Platform convention. |
| Section keyboard shortcuts | Done | Missing | Keep | Mac app menu. Platform convention. |
| Layout at large text sizes | Done | Unknown | Keep | Mac switches the sidebar to a picker above 125 percent |
| Collection paused banner during pairing work | Done | Missing | Add | Not found in the Windows dashboard source |
| Fixed colours outside the tokens | Differs | Differs | Change | About 60 fixed colours in Windows source. Mac uses system orange and secondary colours in many views. |

## Limits (today named Allowances)

| Element | Mac | Windows | Direction | Notes |
| --- | --- | --- | --- | --- |
| Section name | Differs | Differs | Change | Rename to Limits |
| Codex windows with percent remaining | Done | Done | Keep | |
| Layout of limit windows | Differs | Differs | Change | Mac uses cards in a grid. Windows uses one column of text rows. |
| Pace and estimated time remaining | Done | Done | Keep | |
| Coverage-until-reset meter | Done | Done | Keep | |
| Limit history graph with period filter | Done | Done | Change | Uses "Latest 24 hours" and "All retained" labels |
| Usage pace by hour chart | Unknown | Done | Keep | |
| Daily account token totals graph | Done | Done | Keep | |
| Browse saved history window | Done | Done | Keep | |
| Limits shared from the paired device | Done | Done | Keep | |
| Raw status text ("Account source: ok") | Missing | Differs | Change | Windows prints the raw status value |
| Claude Code limits | Missing | Missing | Add | |

## Activity

| Element | Mac | Windows | Direction | Notes |
| --- | --- | --- | --- | --- |
| Device filter | Done | Done | Keep | |
| Period filter (Day, Week, All retained) | Differs | Differs | Change | Add Now and Month. Rename All retained to All time. The shared dashboard's Activity view (V3, issue 97) offers Now, Day, Week, Month and All time. Its Now follows the rule under "Snapshot additions" in the design direction, reads only the `Combined` row for All, and shows Unknown until a collector stamps `checkedAt` on that row. Checked with synthetic tests and the sample in a browser, not inside either host. |
| Date picker | Done | Done | Keep | |
| Total and bar chart, up to 30 days | Done | Done | Keep | |
| Tracking status and ActivityWatch help | Differs | Differs | Change | Collapsed on Mac. Always expanded on Windows. The shared dashboard's Activity view shows the status as a fixed word and keeps the detail and the help collapsed behind an information control. Neither app hosts the shared dashboard yet. The help wording moved to the `activity` group of `lib/strings.json`, with "Allowances" renamed to "Limits". `native/ActivityWatchHelp.swift` still holds its own copy until M2 retires the native view. |
| Categories and recorded apps | Done | Done | Keep | |
| Hourly breakdown | Done | Done | Change | Labelled as New York clock hours on both. The shared dashboard's Activity view labels the hours with the snapshot's `timezone` value and says days follow that zone until device time zones land. An hour after the reading time shows as Unknown, not 0. |
| "Show recorded values" table | Missing | Done | Keep | Decide whether Mac needs it |

## Tokens

| Element | Mac | Windows | Direction | Notes |
| --- | --- | --- | --- | --- |
| Codex totals and chart | Done | Done | Keep | |
| Breakdown by model | Done | Done | Keep | |
| Token classes | Done | Done | Keep | |
| Recorded reasoning and speed settings | Done | Done | Keep | |
| API-equivalent estimate for Codex | Done | Done | Keep | Rates come from the shared price table (`native/prices.json`). The native dashboards' comparison note still names OpenAI's price page as the source. The shared viewer's Tokens view refers to the shared price table and shows the date it was checked. |
| Claude Code tokens | Missing | Missing | Add | Collected, but shown only in Source health in the native apps. The shared viewer's Tokens view shows them by day, model and token class, per device, with All reading "By device". Neither app shows the shared dashboard by default. |
| API-equivalent estimate for Claude Code | Missing | Missing | Add | The shared price table prices current Claude models. The collectors do not yet attach an estimate to Claude Code day rows, so the shared viewer's Tokens view shows Unknown for it until they do. |
| Claude Code session cost | Missing | Missing | Add | The shared viewer's Tokens view shows `claudeLimits.sessionCost` as "Session cost (estimate)" when the device filter is All, because the snapshot does not say which device observed it. It reads Unknown when the cost is 10 minutes old or older. No collector writes the field yet. |

## Dictation

| Element | Mac | Windows | Direction | Notes |
| --- | --- | --- | --- | --- |
| Section present | Done | Done | Change | Show only when a dictation source is enabled. The shared viewer does this since V1 and draws the view since V5 (issue 100). |
| Tool, device and period filters | Done | Done | Keep | The shared viewer's Dictation view (V5, issue 100) has tool, device and period (Day, Week, Month, All time) filters and never adds devices or tools together. Checked in a browser from the built files with sample data, not inside either host. |
| Layout | Differs | Differs | Change | Windows uses tables and a chart titled "Voice over time" |
| ChatGPT voice placeholder row | Done | Done | Remove | "Not implemented" row on both |

## Agents

| Element | Mac | Windows | Direction | Notes |
| --- | --- | --- | --- | --- |
| Section, receipts, local model runs, tool-call counts | Done | Done | Remove | |

## Sources (today named Source health)

| Element | Mac | Windows | Direction | Notes |
| --- | --- | --- | --- | --- |
| Section name | Differs | Differs | Change | Rename to Sources. The shared viewer names it Sources (V1). |
| Per-source status and last check | Differs | Differs | Change | Mac shows absolute times. Windows shows relative times. The shared viewer's Sources view (V5, issue 100) shows the relative time with the exact time on hover, and a refusal code as a sentence that claims no cause. No collector writes `refusal` yet (D1-6). Checked in a browser from the built files with sample data, not inside either host. |
| Status wording | Done | Done | Change | The same nine labels are written separately in Swift and C#. Move them to the shared strings file. Since V5 (issue 100) the nine labels are in `lib/strings.json` under `sources` and the shared viewer reads them. The native views still use their own copies. |
| Codex row | Done | Done | Keep | |
| Claude Code row per device | Done | Done | Keep | |
| ChatGPT and Cursor placeholder rows | Done | Done | Remove | |
| Local benchmarks row | Done | Done | Remove | |
| Agent receipts rows and "View Agents" button | Done | Done | Remove | |
| Clear message when the private-folder check fails | Missing | Missing | Add | See issue 58 for Windows and issue 60 for Mac |

## Settings

| Element | Mac | Windows | Direction | Notes |
| --- | --- | --- | --- | --- |
| Section order | Differs | Differs | Change | Different order on each |
| Source switches | Differs | Differs | Change | Mac splits them across three groups. Windows lists six in one group. |
| Save and reload settings | Differs | Differs | Change | "Save collection settings" on Mac. "Save source settings" on Windows. Windows asks for confirmation when limits monitoring is turned off. |
| Agent receipts switch | Done | Missing | Remove | |
| Claude Code limits switch with consent text | Missing | Missing | Add | Calls `scripts/claude-statusline-install.mjs`. See the bridge section of the design direction for the text a person must see first. |
| Device connection actions | Differs | Differs | Change | Pairing starts from the Mac only. Windows offers details, disconnect and repair. |
| Tailscale check | Done | Done | Change | Becomes part of the supported pairing flow |
| Direct device pairing | Done | Done | Change | Preview on both. Tested with synthetic data only. |
| Usage sharing, two channels | Done | Done | Change | Becomes one choice at pairing time |
| Startup switch | Differs | Differs | Change | "Launch at login" on Mac. "Start at login" on Windows. Wording should match within each platform's convention. |
| Version and Check for updates | Done | Done | Keep | |
| Footer note | Differs | Differs | Remove | Mac says account management is still being developed. Windows says "Native migration preview". |

## First-run setup

| Element | Mac | Windows | Direction | Notes |
| --- | --- | --- | --- | --- |
| Three-step wizard | Done | Done | Keep | |
| Source choices | Done | Done | Change | Neither wizard offers Claude Code |
| Pairing step | Differs | Differs | Change | Mac offers "Finish and pair Windows". Windows finishes alone. |
| Uses design tokens and Inter Tight | Missing | Missing | Change | Windows uses Segoe UI at fixed sizes |

## Platform integration

| Element | Mac | Windows | Direction | Notes |
| --- | --- | --- | --- | --- |
| Runs with the main window closed | Done | Done | Keep | |
| Start at login | Done | Done | Keep | Off on the owner's PC |
| Update check | Done | Done | Change | Sparkle and WinSparkle code is present. Automatic updates are not available. |
| Package | Differs | Differs | Change | Mac is a ZIP with a guarded replace script. Windows is an NSIS installer. Both unsigned. |
| Install guide for other people | Missing | Missing | Add | |
| Web fallback (`--legacy-dashboard`) | Done | Done | Remove | WebKit on Mac, WebView2 on Windows |
| Full test suite in CI on pull requests | Missing | Missing | Add | Corrected on 2026-10-14. Only `native-compile.yml`, `native-private-state.yml` and `update-safety.yml` run on pull requests, each on a named subset. The full suite runs only inside the manually dispatched Windows package and Mac runtime workflows. Pull request 94 (Q1-a) adds a workflow for both and was not merged on 2026-10-14. |

## Shared code and data

| Element | Mac | Windows | Direction | Notes |
| --- | --- | --- | --- | --- |
| Design tokens generated from one file | Done | Done | Change | Add meaning, provider and chart colours. CSS for the web viewer is already generated as `app/design-tokens.css` by `scripts/build-design-tokens.mjs`. |
| Shared strings file | Differs | Differs | Add | `lib/strings.json` exists since 2026-10-14 and generates `native/Strings.swift` and `native/windows/Strings.cs`, which compile but are not read by any native view. The shared viewer reads all its labels from it. |
| Settings bridge message validator | Missing | Missing | Add | B1-1 (issue 101) generates it from `lib/bridge-contract.json` as `native/BridgeContract.swift` and `native/windows/BridgeContract.cs`, with types for the page. Neither shell calls it yet, which is M2 and W2. The Swift validator was compiled on the Mac and matched the page validator on every test message. The C# validator compiles in the Windows CI job but has not been run against the test messages, because no .NET SDK is installed on the Mac. The script suite from pull request 94 runs that comparison on Windows and macOS once it merges. |
| Snapshot format | Done | Done | Change | Add hourly tokens and Claude Code limits |
| Day boundaries | Differs | Differs | Change | Both use America/New_York. Target is the device's time zone. |
| Price table | Done | Done | Keep | `native/prices.json`, taken from LiteLLM's open table and checked on 2026-10-14. The packaged collectors read its generated twin `scripts/price-data.mjs`. `scripts/price-refresh.mjs` refreshes both by hand. |
| Ubuntu fields in pairing and snapshot | Done | Done | Remove | Both apps must change together |

## Shared web viewer (spike)

Added on 2026-10-13. See Architecture in [the design direction](DESIGN.md). The shared panel is merged and is in build 41 on both platforms behind `--web-panel`. Neither installed app shows it by default. The Windows column was updated the same day for the spike in issue 65, merged in pull request 74. The Mac column was updated the same day for the spike in issue 64, merged in pull request 75. Both spikes were run from staged builds. Rows for the dashboard page, the shared components, the skin hook and the sample fixture were added on 2026-10-14 for V1 (issue 79) from source on `shared/v1-viewer` and a browser check of the built pages.

| Element | Mac | Windows | Direction | Notes |
| --- | --- | --- | --- | --- |
| Shared panel page (`panel.html`) in the bundled web files | Done | Done | Add | Built by the web bundle. On Windows a separate panel host serves the page, bundled assets and the snapshot. The dashboard host's guard is unchanged. On Mac the file guard serves `panel.html` only to the flagged panel. The dashboard still gets only the index page and `assets/`. |
| Panel shown in the system web view behind a flag | Done | Done | Add | `--web-panel` on both. Default stays the native panel. The web view is created on the first opening and kept. On Windows, since issue 84, the web view is released after the panel has been hidden for 60 seconds. |
| Web view released after the panel or window closes | Missing | Done | Add | Windows only so far. On Mac the panel's web view is kept after its first opening, and only the earlier dashboard's web view is released when its window closes (corrected on 2026-10-14 from source). Measured in [the measurements record](RESOURCE-MEASUREMENTS.md#web-view-release-on-windows-october-13): about 75 MiB five minutes after release, against 57 to 60 MiB never opened and about 400 MiB open. The next open takes 283 to 493 ms. |
| Shared dashboard page in the main window behind a flag | Missing | Differs | Add | The Mac has no dashboard flag or host (corrected on 2026-10-14 from source). Workstream M1 adds them. `--web-dashboard` on Windows. The host exists and showed `panel.html` because the bundle had no `dashboard.html`. The bundle builds `dashboard.html` since V1 (issue 79). The Windows host was not run against it. No action reaches the app from that window. |
| Panel closes when another window is clicked | Done | Differs | Add | On Mac the native panel and the web panel both close, checked with real clicks in preview mode. The Windows native popup does not. The Windows web panel stays above other windows and hides when another window holds the foreground. That was seen once during a harness run, when the owner clicked into another app. A tray click followed by a click elsewhere was not checked cleanly. |
| Four panel actions accepted by the shell | Done | Done | Add | `refresh`, `check-updates`, `open-settings`, `open-dashboard`. On Mac a real click on each button reached the shell in preview mode. On Windows only `refresh` was run end to end. The other three were accepted and not run. |
| Open time and memory measured | Done | Done | Add | Needed before the direction is confirmed. Mac numbers are in [the measurements record](RESOURCE-MEASUREMENTS.md#web-panel-spike-on-mac-october-13): first open 333 ms against 195 ms native, later opens 82 to 104 ms against 122 to 129 ms, and 97 MiB of footprint with the panel open against 49 MiB native. Windows numbers are in [the measurements record](RESOURCE-MEASUREMENTS.md#web-panel-spike-on-windows-october-13): first open 256 ms against 132 ms native, and about 390 MiB working set with the panel open against 65 MiB native. |
| Shared dashboard page (`dashboard.html`) in the bundled web files | Done | Done | Add | Added for V1 (issue 79). Built by the shared web bundle beside `panel.html`, with the six sections as empty states and Dictation listed only when a dictation source is enabled. Checked in a browser from the built files, not inside either host. |
| One component set for the panel and the dashboard | Done | Done | Add | Card, filter group, meter, numeral, text bar, row, provider dot, empty state, information control, action bar and three chart primitives in `app/viewer/components`. The panel renders through them with the same markup as before, plus `data-provider` and `data-window` on each limit row. The line chart is used by the Limits view. |
| Skin applied to the whole viewer | Done | Done | Add | One hook applies the skin to both pages and follows later changes to `data-skin`. Sage and Almanac checked in light and dark in a browser at 360 and 1280 pixels wide. |
| Limits view in the shared dashboard | Done | Done | Add | Added for V2 (issue 96) from source on `shared/v2-limits` and a browser check of the built page with sample data. Claude Code and Codex side by side with the same layout, a Now card that leads with pace and the estimated time until each window runs out, the limit rows in the skin's limit style, the Claude Code session cost, a history chart per window for the five periods, and the paired device's shared Codex limits with their observation time. Rules live in `lib/view-limits.mjs`. Pace still comes from `scripts/quota-pace.mjs`, which the packaged collectors also use. Not run inside either host. History in a real snapshot covers about the latest 24 hours, and no collector writes `claudeLimits.history` yet, so Claude Code history and pace stay Unknown outside the sample. |
| Tokens view in the shared dashboard | Done | Done | Add | Added for V4 (issue 98). Claude Code and Codex side by side with totals, token classes, models, a 30-day chart, the API-equivalent estimate with the price check date, Claude Code session cost and recorded reasoning and speed. Claude Code for All is shown per device. Codex for All reads only the verified combined row. A missing or unpriced value shows Unknown. Checked in a browser from the built files with sample data only, in Sage and Almanac, light and dark, at 360 and 1280 pixels wide. Not checked inside either host. |
| One sample fixture for both pages | Done | Done | Add | `lib/sample-snapshot.mjs`, fictional. `scripts/demo.mjs` still keeps the older `demoData()` for the earlier web view and a Windows self-test. |
| Skins chosen in Settings | Missing | Missing | Add | Four skins exist in the shared viewer source. A shell selects one with `data-skin`. No Settings control exists. |
| Export of a `.observatory` file in Settings | Missing | Missing | Add | The shared script `scripts/observatory-file.mjs` exports and inspects. No Settings control calls it. |
| Import of a `.observatory` file | Missing | Missing | Add | Needs the working store first. See the design direction. |

## Web demo

The web dashboard is not a third product surface. It should mirror the native apps with fictional data.

| Element | State | Direction | Notes |
| --- | --- | --- | --- |
| Sections | Differs | Change | Still has the seven old sections |
| Palette | Differs | Change | Uses black and zinc greys, not the tokens |
| Product page content | Missing | Add | |
