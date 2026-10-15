<img src="../public/favicon.svg" width="56" height="56" alt="Observatory telescope mark">

# Observatory guide

Observatory is a Mac menu-bar and Windows tray app that shows Claude Code and Codex limits, token usage, screen time and optional dictation statistics. It reads records that other tools already keep on your devices. It has no account and no hosted service, and it makes no model requests. Supported sources and their gaps are listed in [source coverage](SOURCE-COVERAGE.md).

WSL and Ubuntu tracking are out of scope, as is a standalone Linux app. iPhone integration is later work and is not implemented. See [product direction](PRODUCT-DIRECTION.md) and the [roadmap](ROADMAP.md).

Desktop version and build identity come from `native/Release.props`. The private npm package version in `package.json` identifies the web build workspace, not an installed desktop release. Changing source files does not update an installed app.

## Native app setup

Install the app with the guide for your platform: [Observatory on a Mac](MAC.md) or [Observatory on Windows](WINDOWS.md). Then:

1. Open the app and complete the setup screen. Every source starts off, and nothing is collected until you finish.
2. For screen time, install and run [ActivityWatch](https://activitywatch.net/) on each device you want to track, then turn on its source in Observatory. Missing readings stay Unknown. Limits and Tokens work without it.
3. Review the source choices in Settings, under Sources to collect. Turn on only the records you want read. Provider sign-ins stay in their own apps. Observatory does not manage accounts.
4. Choose Refresh in the panel or the window to collect now. Collection also runs every five minutes while the app is running. The Sources section shows which sources were read and when.
5. Optionally pair a second device. See [Pair two devices](#pair-two-devices).

Each app collects its own enabled local sources. Closing the window leaves the menu-bar or tray app running. Use Quit Observatory in the icon's right-click menu to stop it. See [startup](STARTUP.md) for login behaviour.

## What you can see

The panel opens from the menu-bar or tray icon. It shows each limit with the percent remaining and the reset time, device and period filters, token and screen-time totals for the chosen device and period, and four buttons: Refresh, Check for updates, Settings and Open Observatory.

The full window has six sections, in this order:

| Section | What it shows |
| --- | --- |
| Limits | Claude Code and Codex limits side by side: percent remaining, reset time, pace, the estimated time until a limit runs out, and the history of each limit |
| Activity | Screen time by app category and recognised app, with an hourly breakdown, from ActivityWatch |
| Tokens | Claude Code and Codex tokens by day, model and token class, with the API-equivalent estimate |
| Dictation | Wispr Flow dictation counts, words and recorded audio duration. Shown only when a dictation source is on. |
| Sources | Which sources were read, when, and why a source was not read |
| Settings | Sources to collect, accounts, devices and sharing, startup, and About and updates, which also holds appearance, skin and data export |

Every view uses the same periods:

| Period | Meaning |
| --- | --- |
| Now | The last 60 minutes, approximated from hourly records |
| Day | One calendar day |
| Week | The seven calendar days ending on the selected day |
| Month | The 30 calendar days ending on the selected day |
| All time | Every retained day |

The device filter lists All and then each device. Each device shows its name if you set one in Settings, and its platform otherwise. With one device and nothing paired, All shows that device's totals.

Settings offers four skins (Sage, Almanac, Instrument and Amber CRT) and an appearance choice of System, Light or Dark. Export data saves an `.observatory` file. Import is not built yet.

## Pair two devices

Pairing a Mac and a Windows PC is optional. Each device works alone without it.

1. Install [Tailscale](https://tailscale.com/) on both devices and sign in to the same account. Observatory uses the installed Tailscale client only to reach the other device. It does not include or configure Tailscale.
2. On both devices, open Settings, then Devices and sharing, and choose Check Tailscale. It should read "Tailscale is running."
3. On the first device, choose Host on this device and start pairing. Copy the invitation. Share it privately, because clipboard managers may keep copies. It expires within ten minutes.
4. On the second device, choose Join with an invitation, paste it and start.
5. The first device shows the claimed device's fingerprint. Confirm it there.
6. Choose on both devices what to share with the other one. Sharing Codex limits or Claude Code tokens needs consent on both devices.

The devices then exchange sanitized records directly over an encrypted connection after each collection. Disconnect in Settings on either device ends the pairing. Windows Firewall may ask whether the bundled `node.exe` may listen on the Tailscale network. Allow it only for that network.

Pairings made over SSH by earlier builds keep working. [Pairing maintenance](PAIRING-MAINTENANCE.md) describes that route, and [local pairing](LOCAL-PAIRING.md) records the earlier direct-connection tests.

## How to read the numbers

Unknown means a value was not read. It never means zero.

ActivityWatch records foreground windows and away time. Activity separates AI apps, editors, terminals, browsers and other apps. Editor time may include AI assistance. These categories do not establish attention, manual coding time or productive output. Empty hours can mean inactivity or missing records. Overlapping intervals on two devices count once, and simultaneous activity in different categories is labelled Device overlap, since foreground records cannot establish which device had your attention.

Codex and Claude Code counts come from saved logs. Cached tokens are included in the reported total, and reasoning tokens are part of output. These counts cannot tell you how much subscription allowance remains or how much money you spent. Limits come from the provider and are a separate number.

Dates use America/New_York on every device. Week covers the seven calendar days ending on the selected date, and All time includes all retained daily records, with missing dates left as gaps. Activity is collected over a rolling seven-day window and displayed by calendar day. The first and current days may be partial. During daylight saving transitions, repeated clock hours share one chart cell, while totals keep elapsed duration.

The API-equivalent estimate uses standard short-context list prices from the price table in `native/prices.json`, which is taken from [LiteLLM's open price table](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json). The app shows the date the table was last checked and never fetches prices. A maintainer refreshes the table by hand with `node scripts/price-refresh.mjs --write`, which prints the changes before saving. The estimate is a hypothetical token-price scenario, not a bill or a subscription savings claim. A model with no entry in the table is left out and its estimate shows Unknown. Prices are looked up by exact model name, so a dated name or a `-latest` name also shows Unknown unless the table lists it. Claude model names the collector does not recognise, including Claude Fable, are counted under `unknown` and stay unpriced. Long-context premiums, Fast mode, tool charges and unreported cache writes are not included. The table's cache-write price is the standard short-lived cache rate, so longer cache writes are underestimated.

Claude Code also reports its own session cost to the status line. Observatory shows it as "Session cost (estimate)", separate from the API-equivalent estimate.

Codex tokens and screen time for All add the two paired devices only after the collector confirms that no session is counted twice. Claude Code tokens are shown per device. Dictation stays per device because synced history may overlap.

## Data and security

Each app stores its snapshot in `public/local/usage.json` inside its data folder: `~/Library/Application Support/Observatory` on a Mac and `%LOCALAPPDATA%\Observatory` on Windows. The snapshot holds daily totals, app breakdowns, hourly buckets and limit readings. Window titles stay in ActivityWatch. Exact intervals, raw titles, prompts, commands and credentials are not stored. Pairing state and private caches live in `private-*` folders beside it, with permissions that only the current user can use.

Git excludes personal configuration, snapshots and generated builds. A generated build may contain a copy of your snapshot, so do not upload it. Deleting the snapshot clears the views without deleting the original tool records.

Read [SECURITY.md](../SECURITY.md) and [private sync](PRIVATE-SYNC.md) for the trust boundaries.

## Optional dictation statistics

Wispr Flow is the supported dictation source. Turn it on in Settings on each device. ChatGPT voice tracking is not supported, and its absence is not zero usage.

Wispr reads `flow.sqlite` from Application Support on a Mac and AppData\Roaming on Windows. Read-only SQLite authorizes only the History timestamp, duration and word-count columns. No transcript or audio content is read. Only dates, transcription counts, word counts and recorded audio duration enter the snapshot. A missing, invalid or unsupported store reports Unknown, not zero.

Wispr counts retained history rows, including unfinished or failed entries when present, not confirmed successful dictations. Audio duration includes silence. Device labels identify stores, not necessarily recording devices. Synced or imported history can overlap, so devices and tools are never added together. Clearing source history clears what its reader can show.

## Try the demo

The demo is the same shared viewer that both apps show, with fictional sample data from `lib/sample-snapshot.mjs`. No personal activity or account data is included. It is not the app and cannot connect devices.

You need Node.js 22.13 or later. Check `node --version` before running `npm ci`. Node 20 is not supported.

```sh
git clone https://github.com/ScribleSean/observatory.git
cd observatory
npm ci
npm run build:web
npm run serve:local
```

Open [localhost:5601/?demo](http://127.0.0.1:5601/?demo) for the window and [localhost:5601/panel.html?demo](http://127.0.0.1:5601/panel.html?demo) for the panel. With `?demo` both pages show made-up records and label them as sample data. You do not need an AI account, ActivityWatch or a second device to try it. `npm run build:demo` builds the site version in `dist/pages`, with the base path `/observatory/`.

`npm run serve:local` serves the built files from `.native-build/web` on the loopback address. It does not run framework server functions and has no authentication. The pages reload the snapshot every 30 seconds while visible and when they become visible again. That reload never starts collection. In a plain browser the Settings actions are not available, because they need the app.

## Development

### Native apps

The [Mac guide](MAC.md#build-from-source) and the [Windows guide](WINDOWS.md#build-from-source) describe building, packaging and testing each app. Both apps host the same web pages from `.native-build/web` in the system web view (WebKit on the Mac and WebView2 on Windows), and talk to them through the settings bridge described in [the design direction](DESIGN.md). [Brand guidance](BRAND.md) defines the telescope mark and visual language.

### Web development

```sh
npm test
npx tsc --noEmit
npm run build:web
npm run build:demo
```

Collector tests use synthetic records to check filtering, invalid values and repeated conversation counters. The shared viewer uses React and is built with Vite. The local server uses Node's built-in HTTP module.

The synthetic-demo workflow runs tests, type checking and a fresh demo build, and checks `dist/pages/build-info.json`, before publishing to GitHub Pages. It never uploads a workstation build. [ci/check.yml.example](../ci/check.yml.example) is a separate example workflow.

The earlier web dashboard, removed in S1, drew on [lnkiai/m3e-canvas](https://github.com/lnkiai/m3e-canvas). [The design direction](DESIGN.md) replaces that approach.

## Contributing

With the local server running, `npm run test:server` checks request restrictions without reading or printing your usage records.

Keep changes focused on reliable collection and the shared viewer. Use synthetic examples in issues and pull requests. Do not attach personal usage records, transcripts or account details. iPhone integration is deferred under [product direction](PRODUCT-DIRECTION.md#deferred-integrations), not a current setup option.

The project uses the [MIT license](../LICENSE). See [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md) for dependency attribution.
