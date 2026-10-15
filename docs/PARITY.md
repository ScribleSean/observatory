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
| Refresh action | Done | Done | Change | Add the fast limits-only read on Windows. On the Mac since M2 (issue 102, branch `mac/m2-bridge`), a user refresh (the web panel's button, the View menu, the status item menu and the bridge's `refresh`) runs the limits-only collection first when account monitoring is on, then the full collection. Checked by build and self-tests only, not on the installed app. |
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
| Collection paused banner during pairing work | Done | Missing | Add | Not found in the Windows dashboard source. Since O1's contract amendment (issue 112) the bridge `status` value carries `collectionPaused`, and the shared Settings view and dashboard header show "Collection paused" while it is true (sample data only). Neither shell sets it yet. M2 and W2 add it. |
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
| API-equivalent estimate for Claude Code | Differs | Differs | Change | Both collectors attach `apiEstimate` to local and peer Claude Code day and model rows, and the snapshot carries `prices`. The shared viewer's Tokens view shows them. The native dashboards do not. Only rows with status `ok` get an estimate. Claude Fable models are counted under `unknown` by the Claude reader and stay unpriced. The price lookup matches exact model names, so dated and `-latest` names are also unpriced unless the table lists them. |
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
| Section, receipts, local model runs, tool-call counts | Done | Done | Remove | Since R1 (issue 82) the Mac collector no longer reads receipts or local model runs, and the Windows collector never did. Both snapshots carry an empty `agents` list. The native section goes in M2 and W2. |

## Sources (today named Source health)

| Element | Mac | Windows | Direction | Notes |
| --- | --- | --- | --- | --- |
| Section name | Differs | Differs | Change | Rename to Sources. The shared viewer names it Sources (V1). |
| Per-source status and last check | Differs | Differs | Change | Mac shows absolute times. Windows shows relative times. The shared viewer's Sources view (V5, issue 100) shows the relative time with the exact time on hover, and a refusal code as a sentence that claims no cause. No collector writes `refusal` yet (D1-6). Checked in a browser from the built files with sample data, not inside either host. |
| Status wording | Done | Done | Change | The same nine labels are written separately in Swift and C#. Move them to the shared strings file. Since V5 (issue 100) the nine labels are in `lib/strings.json` under `sources` and the shared viewer reads them. The native views still use their own copies. |
| Codex row | Done | Done | Keep | |
| Claude Code row per device | Done | Done | Keep | |
| ChatGPT and Cursor placeholder rows | Done | Done | Remove | |
| Local benchmarks row | Done | Done | Remove | Since R1 (issue 82) the shared collectors always report this source as not connected. |
| Agent receipts rows and "View Agents" button | Done | Done | Remove | Since R1 (issue 82) the shared collectors always report this source as not connected. |
| Clear message when the private-folder check fails | Missing | Missing | Add | See issue 58 for Windows and issue 60 for Mac |

## Settings

| Element | Mac | Windows | Direction | Notes |
| --- | --- | --- | --- | --- |
| Section order | Differs | Differs | Change | Different order on each. The shared viewer's Settings view (B1-2, sample data only) uses the agreed order, with Appearance, Skin and Export data in About and updates as the design direction records. Neither shell shows it yet. |
| Source switches | Differs | Differs | Change | Mac splits them across three groups. Windows lists six in one group. |
| Save and reload settings | Differs | Differs | Change | "Save collection settings" on Mac. "Save source settings" on Windows. Windows asks for confirmation when limits monitoring is turned off. |
| Agent receipts switch | Done | Missing | Remove | Since R1 (issue 82) a saved `receipts` or `benchmarks` value still loads and the Mac collector ignores it. |
| Claude Code limits switch with consent text | Missing | Missing | Add | Calls `scripts/claude-statusline-install.mjs`. See the bridge section of the design direction for the text a person must see first. The shared viewer's Settings view shows that text before it sends `set-limits-consent` (B1-2, sample data only). No shell handles the action yet. |
| Device connection actions | Differs | Differs | Change | Pairing starts from the Mac only. Windows offers details, disconnect and repair. |
| Tailscale check | Done | Done | Change | Becomes part of the supported pairing flow |
| Direct device pairing | Done | Done | Change | Preview on both. Tested with synthetic data only. |
| Usage sharing, two channels | Done | Done | Change | Becomes one choice at pairing time. The shared viewer's Settings view keeps the two switches, one per `set-sharing` channel, until P1 changes the contract. |
| Startup switch | Differs | Differs | Change | "Launch at login" on Mac. "Start at login" on Windows. Wording should match within each platform's convention. |
| Version and Check for updates | Done | Done | Keep | |
| Footer note | Differs | Differs | Remove | Mac says account management is still being developed. Windows says "Native migration preview". |

## First-run setup

| Element | Mac | Windows | Direction | Notes |
| --- | --- | --- | --- | --- |
| Three-step wizard | Done | Done | Change | Since O1-1 (issue 112) the shared viewer has the wizard at `dashboard.html#setup`, in three steps (sources, other devices, finish), writing only through `set-source`, `set-limits-consent` and `complete-setup`. Checked with render tests and in a desktop browser with the fake bridge and sample data only. Neither shell opens it yet, and both still show their native wizard until O1-2. |
| Source choices | Done | Done | Change | Neither native wizard offers Claude Code. The shared wizard offers the five source switches, Claude Code included, all off at first, and Claude Code limits behind the same disclosure Settings shows. |
| Pairing step | Differs | Differs | Change | Mac offers "Finish and pair Windows". Windows finishes alone. The shared wizard has no pairing control or SSH text. It says pairing is optional and happens later, in Settings. |
| Uses design tokens and Inter Tight | Missing | Missing | Change | Windows uses Segoe UI at fixed sizes. The shared wizard uses the skin tokens and fonts, and becomes the wizard on both platforms with O1-2. |

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
| Settings bridge in the shell | Done | Missing | Add | Mac since M2 (issue 102, branch `mac/m2-bridge`): `native/BridgeHandler.swift` and `native/BridgeActions.swift`. Only the dashboard web view registers the `bridge` handler. A message is read only from the main frame, from `observatory://app/dashboard.html` with no query, as an `NSString` passed to the generated validator. Results go back only to the sending web view and only while the same document is loaded. Admission follows "How many at once" (one running, four queued, one per action name, `busy` while a native dialog or save panel is open). Native confirmations come before turning account monitoring off, sharing on, limits consent on, identity creation, disconnect and repair. One pairing session owns the control process and the collection reservation, polls every 2 seconds and ends after 10 minutes, on cancel, failure, document replacement, window close and quit. `status` and `tailscale-check` answer from a cache refreshed at most every 5 seconds. Child processes start from argument arrays with an allowlisted environment (a fixed `PATH`, plus `HOME`, `USER`, `LOGNAME`, `LANG` and `TMPDIR`). The dashboard guard no longer opens any link in a browser. Checked by self-tests and `--test-web` in staged builds (sender URL after `pushState`, a blank iframe, a reload while a result is pending, a second web view, a refused fragment, a form GET and a script link click). The page side (pull request 129, now merged) was loaded in one preview run, and no action was clicked. `set-limits-consent` returns `unavailable` until the D1 consent script is bundled, and the Mac lists no custom skins. `status` carries `collectionPaused` (true while a pairing session, a disconnect, a repair or a sharing change holds collection, or after an unverified result). `complete-setup` returns `unavailable` until O1-2 implements it on the removal branch. |
| Snapshot format | Done | Done | Change | Add hourly tokens and Claude Code limits |
| Day boundaries | Differs | Differs | Change | Both use America/New_York. Target is the device's time zone. |
| Price table | Done | Done | Keep | `native/prices.json`, taken from LiteLLM's open table and checked on 2026-10-14. The packaged collectors read its generated twin `scripts/price-data.mjs`. `scripts/price-refresh.mjs` refreshes both by hand. |
| Ubuntu fields in pairing and snapshot | Done | Done | Remove | Both apps must change together. R2 (issue 111): the pairing scripts and both apps' pairing requests no longer carry the Ubuntu slot, and saved pairings stay readable. The snapshot `localModel` slot (R2-2) remains. |

## Shared web viewer (spike)

Added on 2026-10-13. See Architecture in [the design direction](DESIGN.md). The shared panel is merged and is in build 41 on both platforms behind `--web-panel`. Neither installed app shows it by default. The Windows column was updated the same day for the spike in issue 65, merged in pull request 74. The Mac column was updated the same day for the spike in issue 64, merged in pull request 75. Both spikes were run from staged builds. Rows for the dashboard page, the shared components, the skin hook and the sample fixture were added on 2026-10-14 for V1 (issue 79), from source at `8b3a0aa` (merged as `833edca` in pull request 118). They were checked with render tests in Node and in desktop Chrome against the built files served by `vite preview`, at 360 and 1280 pixels wide. Neither host loaded these pages, and no installed app contains them. The Mac column of the host rows was updated on 2026-10-14 for M1 (issue 83) from source on `mac/m1-dashboard-host` and staged builds with preview runs. The installed app was not changed or run for this. The Windows column of the host rows was updated on 2026-10-14 for W1 (issue 84) from source on `win/w1-finish`. Codex wrote that code on the Mac because the Windows session was unreachable. It was compiled and its `--self-test` run by the Windows CI job only. It was not run on the PC, and the `--test-web-hosts` fixture that loads both pages in a real WebView2 has not been run.

| Element | Mac | Windows | Direction | Notes |
| --- | --- | --- | --- | --- |
| Shared panel page (`panel.html`) in the bundled web files | Done | Done | Add | Built by the web bundle. On Windows each host serves only its own page, bundled assets and the snapshot. Since W1 the Windows guard also refuses an HTML file under `assets/`, a path whose last component is empty or is a dot segment, a JSON file judged by the extension of the resolved file (so `assets/x.json/` is refused), and any query on a resource request except `panel.html?demo` for the panel. Each path part may hold only ASCII letters, digits, `.`, `-` and `_`, may not be empty or end in a dot, and may not be a reserved device name such as `CON`, `NUL`, `COM1` or `LPT1` with or without an extension. That also refuses 8.3 short names, alternate data streams and Unicode lookalikes. The allowed file types are the same ten as the Mac list and are checked inside the guard, case-sensitively. Every refusal in the self-test runs against a temporary folder where the refused file exists. Checked by the Windows self-test, including one positive case against a temporary `Web` folder. On Mac each web host names its own pages in the file guard: the panel gets `panel.html`, the flagged dashboard gets `dashboard.html` only, the earlier dashboard gets `index.html`, and all three get `assets/`, where an HTML file is refused. |
| Panel shown in the system web view behind a flag | Done | Done | Add | `--web-panel` on both. Default stays the native panel. The web view is created on the first opening and kept. On Windows, since issue 84, the web view is released after the panel has been hidden for 60 seconds. Since W1 a Windows panel whose web view failed to start, whose browser process failed, or whose page did not report ready within about 10 seconds, is hidden and released at once, the person sees a message naming the WebView2 Runtime (a line in `panel-timing.log` instead under `--panel-timing`), and the next opening creates a new one. A browser process failure after the panel has drawn is handled the same way. Browser shortcut keys are off in both Windows hosts. That path is in source and in the release decision's self-test only. It has not been run against a missing runtime. |
| Web view released after the panel or window closes | Differs | Done | Add | Mac rule, decided for M1: the main-window web view (the shared dashboard and the earlier one) is released when its window closes, and the panel's web view is kept after its first opening. `--test-lifecycle --web-dashboard` checks three open and close cycles release it. Memory after release was not measured on the Mac. Measured in [the measurements record](RESOURCE-MEASUREMENTS.md#web-view-release-on-windows-october-13): about 75 MiB five minutes after release, against 57 to 60 MiB never opened and about 400 MiB open. The next open takes 283 to 493 ms. Those measurements are for a web view that started. Release after a failed start on Windows is code only (W1): the release decision is a self-tested function, and the `--test-web-hosts` fixture that checks it with a one-second release time and a simulated failed start is not run yet. On Windows the dashboard window also disposes its web view before it shows the runtime error message. |
| Shared dashboard page in the main window (Mac default since M2, behind a flag on Windows) | Done | Differs | Add | Mac since M2 (issue 102, branch `mac/m2-bridge`): the shared panel and dashboard are the default, `--web-panel` and `--web-dashboard` change nothing, and `--native-viewer` keeps the SwiftUI panel and dashboard for one build. Settings in the app menu opens the dashboard's Settings section. This was checked in staged builds with `--test-lifecycle`, `--test-popup` and a preview run with no mode flag. The installed app still shows the SwiftUI viewer until L1 installs this build. Before M2, `--web-dashboard` on the Mac since M1 (issue 83), checked in staged builds and preview runs against the real `dashboard.html`. The window loads `dashboard.html#<section>` with the snapshot bridge only, so no action reaches the app from it. Its navigation guard follows the bridge contract: only `dashboard.html` at `observatory://app`, in the main frame, with no query, and a fragment only from the six section ids and `setup`. A build without `dashboard.html` shows an error message in the window instead of another page. The page opens on the section named in the address (since V5) and follows a later change to it (since the V1 accessibility pull request), so the shell can switch sections in an open window by loading `dashboard.html#<section>`. Picking a section writes it to the address with `replaceState`, so history does not grow. An unknown fragment shows Limits, and `setup` opens the first-run wizard (since O1-1, issue 112). The fragment following was checked in a desktop browser, not in the Mac window. Until M2, source settings used the earlier alert in this mode. `--web-dashboard` on Windows. Since W1 (issue 84) the Windows host no longer falls back to `panel.html`. A build without `dashboard.html` shows an error message instead. Its navigation guard follows the same contract at `https://observatory.invalid`: only `dashboard.html` with no query and a fragment only from the six section ids and `setup`, with every frame navigation refused. Web messages stay off, so no action reaches the app from that window. WebView2 does not raise `NavigationStarting` for same-document changes (`location.hash`, `history.pushState`), so the fragment list applies to document loads only, as the bridge contract already assumes. Checked by the Windows self-test on CI. The Windows host has not been run against the real `dashboard.html`, which W1-3 does on the PC. |
| Panel closes when another window is clicked | Done | Differs | Add | On Mac the native panel and the web panel both close, checked with real clicks in preview mode. The Windows native popup does not. The Windows web panel stays above other windows and hides when another window holds the foreground. That was seen once during a harness run, when the owner clicked into another app. A tray click followed by a click elsewhere was not checked cleanly. The Windows web panel hides only after it has held the foreground itself. One that Windows never brought to the foreground stays shown until the tray icon is clicked again or the app quits. |
| Four panel actions accepted by the shell | Done | Done | Add | `refresh`, `check-updates`, `open-settings`, `open-dashboard`. On Mac a real click on each button reached the shell in preview mode. On Windows only `refresh` was run end to end. The other three were accepted and not run. |
| Open time and memory measured | Done | Done | Add | Needed before the direction is confirmed. Mac numbers are in [the measurements record](RESOURCE-MEASUREMENTS.md#web-panel-spike-on-mac-october-13): first open 333 ms against 195 ms native, later opens 82 to 104 ms against 122 to 129 ms, and 97 MiB of footprint with the panel open against 49 MiB native. Windows numbers are in [the measurements record](RESOURCE-MEASUREMENTS.md#web-panel-spike-on-windows-october-13): first open 256 ms against 132 ms native, and about 390 MiB working set with the panel open against 65 MiB native. |
| Shared dashboard page (`dashboard.html`) in the bundled web files | Differs | Done | Add | Added for V1 (issue 79). Built by the shared web bundle beside `panel.html`, with the six sections as empty states and Dictation listed only when a dictation source is enabled. On the Mac the M1 host serves it behind `--web-dashboard`, checked in staged builds and preview runs. The Windows dashboard host serves only `dashboard.html` since W1 but was not run against it. Checked in a desktop browser from the built files only. |
| One component set for the panel and the dashboard | Done | Done | Add | Card, filter group, meter, numeral, text bar, row, provider dot, empty state, information control, action bar and three chart primitives in `app/viewer/components`. The panel renders through them with the same markup as before, plus `data-provider` and `data-window` on each limit row. The line chart is used by the Limits view. |
| Skin applied to the whole viewer | Done | Done | Add | One hook applies the skin to both pages and follows later changes to `data-skin`. An unknown name falls back to Sage, at load and when it is set later (since the V1 follow-up pull request). Sage and Almanac checked in light and dark in a desktop browser at 360 and 1280 pixels wide, not inside either host. |
| Limits view in the shared dashboard | Done | Done | Add | Added for V2 (issue 96) from source on `shared/v2-limits` and a browser check of the built page with sample data. Claude Code and Codex side by side with the same layout, a Now card that leads with pace and the estimated time until each window runs out, the limit rows in the skin's limit style, the Claude Code session cost, a history chart per window for the five periods, and the paired device's shared Codex limits with their observation time. Rules live in `lib/view-limits.mjs`. Pace still comes from `scripts/quota-pace.mjs`, which the packaged collectors also use. Not run inside either host. History in a real snapshot covers about the latest 24 hours, and no collector writes `claudeLimits.history` yet, so Claude Code history and pace stay Unknown outside the sample. |
| Tokens view in the shared dashboard | Done | Done | Add | Added for V4 (issue 98). Claude Code and Codex side by side with totals, token classes, models, a 30-day chart, the API-equivalent estimate with the price check date, Claude Code session cost and recorded reasoning and speed. Claude Code for All is shown per device. Codex for All reads only the verified combined row. A missing or unpriced value shows Unknown. Checked in a browser from the built files with sample data only, in Sage and Almanac, light and dark, at 360 and 1280 pixels wide. Not checked inside either host. |
| One sample fixture for both pages | Done | Done | Add | `lib/sample-snapshot.mjs`, fictional. `scripts/demo.mjs` still keeps the older `demoData()` for the earlier web view and a Windows self-test. |
| Skin and theme set by the shell before the page loads | Done | Done | Add | Mac since M2 (issue 102): the stored values come from `<runtime>/viewer.json` (exactly `skin` and `appearance`, 1 KiB cap, a linked file refused, Sage and system when missing or invalid), written by the bridge's `set-skin` and `set-appearance`, which also update both open pages. On first launch the M1 `observatorySkin` and `observatoryAppearance` defaults are copied into `viewer.json` once and removed. Before M2, Mac since M1: a script at document start sets `data-skin` from the `observatorySkin` setting (one of the four bundled ids, Sage otherwise) and `data-theme` from the stored appearance (light or dark, otherwise the system setting), for the panel and the dashboard. With nothing stored the web pages follow the system setting, as the design direction says for appearance, while the native SwiftUI dashboard on the same install shows dark until the person switches it. The two differ on a fresh install until the native viewer is removed in M2. Almanac checked in a preview run on both pages. Windows since W1 (issue 84): a script added through `AddScriptToExecuteOnDocumentCreatedAsync` sets `data-skin` from the `Skin` string value under `HKCU\Software\Observatory\Dashboard` (one of the four bundled ids, Sage otherwise) and `data-theme` from the `Theme` value (light or dark, otherwise the system setting), for the panel and the dashboard. The value is read when each web view is created. The validation is self-tested on CI. It was not run on the PC, and Almanac was not checked inside the Windows host. The design direction's later `viewer.json` store for the settings bridge replaces both platforms' stores when the bridge lands. |
| Page facts printed with `--panel-timing` | Done | Done | Add | Structure only: kind, ready flag, page path (`/dashboard.html`, as on Windows), skin, theme, font, dark, section count, limit rows by provider, button count and text length. The Mac prints one line per page and, in preview mode only, writes a PNG of each page to the preview folder. On Windows since W1 the page text written to `panel-timing.log` is marked `untrusted-page=`, has control characters replaced and is capped at 2,048 characters, and the dashboard window counts only `observatoryDashboardReady` as ready. |
| Skins chosen in Settings | Missing | Missing | Add | Four skins exist in the shared viewer source. A shell selects one with `data-skin`. The shared viewer's Settings view has a skin picker that sends `set-skin` (B1-2). It works with sample data in a browser. No shell handles the action yet. |
| Export of a `.observatory` file in Settings | Missing | Missing | Add | The shared script `scripts/observatory-file.mjs` exports and inspects. The shared viewer's Settings view has an "Export data" button that sends `export-data` (B1-2). No shell handles the action yet. |
| Import of a `.observatory` file | Missing | Missing | Add | Needs the working store first. See the design direction. |

## Web demo

The web dashboard is not a third product surface. It should mirror the native apps with fictional data.

| Element | State | Direction | Notes |
| --- | --- | --- | --- |
| Sections | Differs | Change | Still has the seven old sections |
| Palette | Differs | Change | Uses black and zinc greys, not the tokens |
| Product page content | Missing | Add | |
