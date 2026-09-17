<img src="../public/favicon.svg" width="56" height="56" alt="Observatory telescope mark">

# Observatory guide

A native Mac and Windows dashboard for workspace activity, AI usage and dictation, with a Mac menu-bar panel and Windows system-tray panel. Supported sources and platform gaps are listed in [source coverage](SOURCE-COVERAGE.md).

[Try the interactive demo](https://scriblesean.github.io/observatory/). It uses the same interface with 14 days of fictional records. No personal activity, account data or connected devices are included.

The app runs on your computer. It does not send usage records to a hosted service or make model requests.

## Native app setup

The native apps are the intended everyday entry point. Public installers are not yet available. For development builds, follow the [Mac build guide](MAC.md#building-the-candidate) or [Windows build guide](WINDOWS.md#build-on-windows). These require developer tools. To explore without building or connecting sources, use the hosted demo above.

1. Launch the native app and complete the first-run wizard. Fresh installations keep sources off until you choose them and complete setup.
2. For screen time, install and run [ActivityWatch](https://activitywatch.net/) separately on each device you want to track, then enable its source in Observatory. Missing readings remain Unknown. You can use Tokens and Allowances independently.
3. Review source choices in Settings. Enable only the records you want to read. Provider sign-ins remain in their owning applications, not an Observatory account manager.
4. Use **Refresh sources** to collect, then inspect Source health for availability and timestamps. Browser **Reload snapshot** only rereads saved data and does not collect.
5. Optionally pair devices from the Mac over an existing trusted SSH connection. Follow [pairing maintenance](PAIRING-MAINTENANCE.md) for prerequisites and supported records. Direct TLS is a separate preview, not a verified replacement for that path.

Each native app can collect its own enabled local sources without the legacy SSH hub. Closing the dashboard leaves the menu-bar or tray app running. Use Quit to stop it. See [Startup](STARTUP.md) for native login behavior and the separate legacy jobs.

## What you can see

Observatory opens Allowances, the usage-limit overview. Activity is a separate screen-time view and does not need to be configured before using Tokens or Allowances. Native Mac, Windows and web source builds have Allowances, Activity, Tokens, Dictation, Agents, Source health and Settings. Agents shows saved execution records and links to collection settings, not a live agent monitor. Older installations or demo deployments may retain the previous navigation until updated.

| View | Records |
| --- | --- |
| Activity | Time spent in app categories and recognized apps on Mac and Windows, excluding away time |
| Tokens | Daily Codex token counts from Mac, Ubuntu and configured native Windows logs, including cached input |
| Agents | Available agent receipts, saved local-model benchmarks and partial Codex tool-call counts |
| Dictation | Voice usage by tool and device, with Wispr recording metadata and explicit coverage |
| Source health | Which sources were read and which measurements are still missing |

Activity offers daily and weekly timelines and a combined Mac and Windows total. Overlapping intervals count once. Simultaneous activity in different categories is labeled Device overlap, since foreground records cannot establish which device had your attention. Tokens offers All, Mac, Ubuntu and Windows sources with Day, Week and All time periods. The All-host total is available only after successful reads and a cross-host session overlap check.

This is an early prototype tested on one Mac, Windows and WSL setup. Optional adapters now read current Codex limits, saved reasoning and speed settings, tool-call categories and local benchmark receipts. It does not capture every terminal command, iPhone activity, Gemini website usage or other providers' live limits. The Antigravity adapter currently reads four named receipt files from one configured directory. [Source coverage](SOURCE-COVERAGE.md) explains what each measurement can establish.

## Try the demo

Select Activity to explore recorded screen time. Day has previous/next controls. Week shows seven dated rows ending on the selected date, with three-hour bands and daily totals. Hover or select a band for details. Select a date to open that day. Missing tracking records are muted, distinct from recorded idle time. All time totals retained daily summaries and lets you open a retained date. Retention starts with the available rolling window and keeps up to 3,650 dates per view, not the complete ActivityWatch archive. Broader reads replace partial days without adding duplicate totals. Failed source reads preserve prior summaries and show their last successful timestamp. Combined history is retained independently, never reconstructed by adding device totals.

Tokens shows model-level counts and shares. Expand a model for its token categories and supported API-equivalent estimate. The recorded-day selector lets you review older days. [Research notes](USAGE-TRACKING-REFERENCES.md) describe the open-source patterns behind the accounting.

You need Node.js 22.13 or later. Check `node --version` before running `npm ci`. If Node is missing or older, install a supported version first using your operating system's installation method or your existing Node version manager. Node 20 is not supported.

```sh
git clone https://github.com/ScribleSean/observatory.git
cd observatory
npm ci
npm run demo
npm run build
npm run serve:local
```

Open [localhost:5601](http://127.0.0.1:5601). The demo uses made-up records and labels them as sample data. It refuses to overwrite an existing snapshot with a one-line explanation and exit code 1. Use a separate checkout if this one already contains records you want to preserve. You do not need an AI account, ActivityWatch or an SSH connection to try it.

## Legacy developer appendix: SSH hub and browser dashboard

This section describes the older Mac-coordinated collector and browser viewer. It is not required for native local collection or the native first-run wizard. Preserve existing private configuration when migrating. Do not create an SSH hub merely to enable a native local source.

The default appearance is black and neutral. The top-bar sun and moon button switches between dark and light themes and saves that choice in this browser. [Brand guidance](BRAND.md) defines the shared telescope mark and visual language.

### View the same instance on another computer

For optional login startup and restart recovery, see [Startup](STARTUP.md).

No second collector or repository clone is needed just to view the dashboard. With a trusted SSH connection from the dashboard host to the viewing computer, run this on the dashboard host:

```sh
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -R 127.0.0.1:5601:127.0.0.1:5601 VIEWER_SSH_ALIAS
```

Open `http://127.0.0.1:5601` on the viewing computer. The host, local server and SSH tunnel must remain running. This is not automatic startup. Stop the tunnel with Ctrl+C. Keep the remote listener restricted to loopback and verify your SSH server permits this forwarding. Do not expose this unauthenticated dashboard to a public or shared network.

The legacy hub collector runs on macOS. It expects ActivityWatch on the Mac and Windows PC, ccusage on the Mac and Ubuntu, and working SSH aliases for Windows and Ubuntu.

For native Windows tokens, optionally set `windowsCodexHome` to the Windows Codex directory as seen from WSL, such as `/mnt/c/Users/YOUR_USER/.codex`. The installed Ubuntu reader processes those logs separately from Ubuntu logs. Only aggregate reports return to the dashboard. This uses ccusage's documented [Codex data directory override](https://github.com/ccusage/ccusage/blob/main/docs/guide/codex/index.md). Host reports stay individually available. All requires a successful cross-host overlap check.

Copy `local.config.example.json` to `local.config.json`. Set the executable paths, SSH aliases and receipt directory for your machines. Keep credentials in your existing SSH and provider settings.

The settings and local-model adapters use Python 3.9 or later on the reader's machine. Configure only the optional sources you want. `codexExecutable` enables the read-only Codex limit check. `macCodexHome`, `ubuntuCodexHome` and `windowsCodexHome` enable saved settings and tool metadata. `localModelResults` points to a benchmark directory containing run subdirectories and `*.metrics.json` files. These readers do not run inference.

```sh
npm run collect
```

The collector replaces the dashboard snapshot atomically. The page checks for a newer snapshot every 30 seconds while visible, and when it becomes visible again. **Reload snapshot** checks immediately. None of these browser actions starts collection or model tasks. You do not need to rebuild after collecting new records.

Collection is manual by default. The optional [login collector](STARTUP.md) runs every five minutes while the hosting Mac is awake and logged in. An operating-system file lock prevents overlapping runs. Each run has a four-minute limit. Stale timestamps and unsuccessful attempts are visible in the dashboard. ActivityWatch continues recording independently.

## How to read the numbers

ActivityWatch records foreground windows and away time. The dashboard separates AI apps, editors, terminals, browsers and other apps. Editor time may include AI assistance. These categories do not establish attention, manual coding time or productive output. Empty hours can mean inactivity or missing collector records.

Codex counts come from ccusage reports. Cached tokens are included in the reported total, and reasoning tokens are part of output. These counts cannot tell you how much subscription allowance remains or how much money you spent.

Antigravity receipts may contain cumulative conversation counters. The dashboard keeps the newest snapshot for each conversation instead of adding them together. A failed call shows unknown token usage. A returned response does not establish that its answer was correct.

Dates use America/New_York. Token history shows the latest seven recorded dates, which may have gaps. Activity is collected over a rolling seven-day window and displayed by calendar day. The first and current days may be partial. During daylight saving transitions, repeated clock hours share one chart cell, while totals retain elapsed duration.

The small API comparison uses standard short-context rates from [OpenAI's price table](https://developers.openai.com/api/docs/pricing), checked September 6, 2026. It is a hypothetical token-price scenario, not a bill or subscription savings claim. Coverage excludes inferred model labels and unsupported models. Long-context premiums, Fast mode, tool charges and unreported cache writes are not included. Google and Anthropic receipt estimates are not connected yet.

## Data and security

Window titles remain in ActivityWatch on their original machines. Windows sends only timestamps and approved category and app labels over SSH. The collector uses those intervals in memory to remove overlap, then stores daily totals, app breakdowns and hourly buckets in `public/local/usage.json`. Exact intervals, raw titles, prompts, commands and credentials are not stored in the dashboard snapshot.

Git excludes personal configuration, snapshots and generated builds. A generated build may contain a copy of your snapshot, so do not upload it. Deleting the snapshot clears the dashboard without deleting the original tool records.

Use `npm run serve:local` for viewing. It serves static files on the loopback address and does not run framework server functions. It has no authentication or multi-user support. Read [SECURITY.md](../SECURITY.md) for dependency advisories and deployment limits.

## Optional dictation statistics

The Dictation view defaults to all tools and devices. Wispr is the supported recording-metadata source. ChatGPT voice tracking remains unverified, not zero usage. For the legacy collector, enable either host in the ignored `local.config.json`:

```json
"dictation": { "mac": true, "windows": true }
```

Wispr reads `flow.sqlite` from Application Support on Mac and AppData/Roaming on Windows. Windows uses its native `py -3` runtime through the Windows SSH connection to avoid WSL shared-memory locking errors. Read-only SQLite authorizes only History timestamp, duration and numWords columns. No transcript or audio content is fetched. Dates use America/New_York, which requires Python timezone data on each reader. Missing numeric metadata has explicit record coverage and is never presented as a confirmed zero.

Only dates, transcription counts, word counts and recorded audio duration enter the dashboard. App names, custom model names, transcripts, recordings and credentials are excluded. A missing, invalid or unsupported store reports unknown usage, not zero. Dates use America/New_York.

Wispr counts retained history rows, including unfinished or failed entries when present, not confirmed successful dictations. Audio duration includes silence. Host labels identify stores, not necessarily recording devices. Synced or imported history can overlap, so hosts and products are never summed. Clearing source history clears what its reader can show. The public demo uses fictional aggregates only.

## Development

### Native Mac application

The native app requires an Apple Silicon Mac running macOS 14 or later. It uses a SwiftUI main window and menu-bar panel. WebKit is an explicit legacy fallback, not the default detail view. Follow the [Mac build guide](MAC.md#building-the-candidate) for runtime preparation, build commands and verification limits.

With an existing ignored `local.config.json`, `node native/install.mjs --install` installs into the current user's Applications folder and enables launch at login. It copies collectors and private configuration into `Library/Application Support/Workspace Observatory`, outside the source checkout. It backs up the old collector login job before disabling it. Existing web-server and tunnel jobs are left unchanged for compatibility.

Click the telescope menu-bar icon for a compact summary. Open Observatory shows the full detail window. Closing that window leaves the menu-bar app running. The app refreshes every five minutes while the Mac is awake and logged in, retries after wake, and preserves the preceding snapshot if a collection fails. Individual unavailable sources are labeled rather than filled with zeros. Remote reads in an existing legacy hub still require its configured SSH hosts and tools.

The panel's All option uses the collector's overlap-aware Mac and Windows active time and verified Mac, Windows and Ubuntu token totals. WSL activity is part of Windows screen time, not an extra desktop to add. Dictation remains per device because synced history may overlap. Missing or unverified combined totals stay unavailable.

Right-click the icon to change Launch at login or quit. This is a locally ad-hoc-signed build, not a notarized distributable or an automatic-update system. ActivityWatch remains a separate collector and is not uninstalled by this app.

### Web development

```sh
npm test
npx tsc --noEmit
npm run build
```

Collector tests use synthetic records to check filtering, invalid values and repeated conversation counters. The interface uses React and Vinext with a static export. The local server uses Node's built-in HTTP module.

The synthetic-demo workflow runs tests, type checking, and a fresh build before publishing to GitHub Pages. It never uploads a workstation build. [ci/check.yml.example](../ci/check.yml.example) is a separate example workflow.

The design draws on [lnkiai/m3e-canvas](https://github.com/lnkiai/m3e-canvas), including its Material 3 Expressive navigation, connected controls and tonal surfaces. [Design notes](DESIGN.md) explain how those ideas apply here.

## Contributing

With the local dashboard running, `npm run test:server` checks request restrictions without reading or printing your usage records.

Reproducible bugs, adapter improvements and accessibility fixes are welcome. Use synthetic examples in issues and pull requests. Do not attach personal usage records, transcripts or account details.

The project uses the [MIT license](../LICENSE). See [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md) for dependency attribution.
