<div align="center">
  <img src="public/favicon.svg" width="80" height="80" alt="Observatory telescope">
  <h1>Observatory</h1>
  <p>Your Claude Code and Codex limits, screen time and tokens, for your Mac and PC together, in the menu bar and the Windows tray.</p>
</div>

## What it shows

- **Limits left.** Claude Code and Codex, each window (5-hour and weekly), with the percent left and the reset time. Limits belong to the account, so the freshest reading from either computer is shown. They are never added together.
- **Screen time today**, read from [ActivityWatch](https://activitywatch.net/), for each computer.
- **Tokens today**, from the logs Claude Code and Codex already keep, for each computer, with an estimate of what they would cost at public API prices.

The menu bar title is one number: the lowest limit left. The menu lists everything else and has three actions: Open dashboard, Refresh and Quit. The dashboard opens in your normal browser and shows the same numbers over time on four read-only pages: Limits, Activity, Tokens and Sources.

## How it works

```
 PC (spoke)                              Mac (hub)
 every 5 min: collect                    every 5 min: collect
   -> usage.json                           -> usage.json
                 <-- hub reads it over SSH --
                 --- hub writes back -------> combined.json
   combined.json                           combined.json
 tray reads combined.json                menu bar reads combined.json
 dashboard on 127.0.0.1                  dashboard on 127.0.0.1
```

1. On each computer, the small menu bar or tray app runs `scripts/tick.mjs` every five minutes. It collects that computer's own numbers into `usage.json`.
2. The hub reads each spoke's `usage.json` over SSH, combines them into `combined.json`, and writes that file back to each spoke. No computer opens a network port. A spoke recombines its own fresh numbers with the last copy it received, so its own numbers stay current even when the hub is away.
3. The menu bar and tray apps print the summary in `combined.json`. The dashboard server listens on 127.0.0.1 only and serves the built pages and `combined.json`, nothing else.

One computer on its own works the same way, without the SSH step.

## Install

You need:

- [Node.js](https://nodejs.org/) 22.13 or later.
- [ActivityWatch](https://activitywatch.net/), running, for screen time.
- On a Mac, the Xcode Command Line Tools (`xcode-select --install`), to build the menu bar app.
- On Windows, nothing else. The tray app is built with the C# compiler that comes with Windows.
- For a second computer: SSH from the hub to the spoke without a password prompt, for example over [Tailscale](https://tailscale.com/). The hub must be able to run `ssh <alias>` on its own.

On each computer:

```bash
git clone https://github.com/ScribleSean/observatory.git
```

```bash
cd observatory
```

```bash
npm run setup
```

The first run writes `observatory.config.json` and stops. Edit it, then run `npm run setup` again. Setup installs the build tools, builds the dashboard and the menu bar or tray app inside the clone, and starts the app now and at login. Nothing is installed in Applications or Program Files.

To update, run `git pull` and then `npm run setup` again. To stop the app and remove its login item, run `npm run setup -- --remove`. Your data and settings stay.

On a MacBook with a notch and a busy menu bar, a new menu bar item can land behind the notch. Hold Command and drag it to the right to bring it into view.

## Settings

Everything is in one hand-edited file, `observatory.config.json`, next to `package.json`. Git ignores it.

```json
{
  "device": { "name": "Mac" },
  "sources": {
    "screenTime": true,
    "codex": true,
    "codexLimits": true,
    "claudeCode": true,
    "claudeLimits": true
  },
  "hub": {
    "spokes": [
      { "name": "PC", "ssh": "my-pc", "platform": "windows" }
    ]
  }
}
```

- A source is read only when it is `true`. Listing it is your consent.
- `hub.spokes` makes this computer the hub. Leave it empty on the spoke and on a computer used alone. `ssh` is a host alias from your SSH configuration. The hub finds the spoke's data folder itself, or you can set `dataFolder` on the spoke entry.
- Optional: `dashboard.port` (default 5601), `dataFolder`, and `codexPath` if Codex is installed somewhere unusual.
- One Mac and one Windows PC are supported in total.

Data lives in `~/Library/Application Support/Observatory` on a Mac and `%LOCALAPPDATA%\Observatory` on Windows.

## How to read the numbers

- Unknown means a value was not read. It never means zero. A computer that has not reported recently shows its last update time, and its numbers for today show Unknown.
- The "Both computers" row adds the two computers' screen time and tokens. It is labeled "not deduplicated", because the same tokens could be counted twice if the same logs exist on both computers. It is Unknown if either computer's value is Unknown.
- A limit percentage comes from the provider. A dollar figure is an estimate at public API prices, not a bill.
- Days are counted in the America/New_York time zone on every computer.

## Data and privacy

- Everything stays on your computers. The only network traffic is the hub's SSH connection to your own spoke, and each provider's own installed client asking for the account's current limits.
- Saved data holds daily and hourly totals and limit readings, not prompts, window titles, commands or credentials.
- Provider sign-ins stay in their own apps. Observatory does not read or store credentials.

See [security](SECURITY.md).

## Development

```bash
npm test
```

```bash
npm run lint
```

```bash
npm run preview
```

`npm run preview` serves the dashboard with fictional data at http://127.0.0.1:5602. `npm run tick` runs one collection and combine by hand. [The hub plan](docs/HUB-PLAN.md) maps the code to the design and lists open questions. The full app this replaced is described in [docs/history](docs/history/README.md).

| Part | Files |
| --- | --- |
| Settings | `lib/config.mjs` |
| Readers | `scripts/read-settings.mjs`, `scripts/read-claude-usage.mjs`, `scripts/mac-activity.mjs`, `scripts/windows-aggregate-activity.ps1`, `scripts/collect-quota.mjs`, `scripts/claude-limits.mjs` |
| Collect | `scripts/collect.mjs` |
| Combine | `lib/combine.mjs` |
| Hub | `scripts/hub.mjs`, `scripts/hub-transport.mjs`, `scripts/tick.mjs` |
| Dashboard | `serve-local.mjs`, `app/viewer`, `lib/panel-data.mjs` |
| Menu bar and tray | `glance/mac/Glance.swift`, `glance/windows/Glance.cs` |
| Setup | `scripts/setup.mjs` |

Bug reports and small fixes are welcome. Use synthetic examples and never attach real usage records. Read [AGENTS.md](AGENTS.md) first.

[MIT license](LICENSE) · [Third-party acknowledgments](THIRD-PARTY-NOTICES.md)
