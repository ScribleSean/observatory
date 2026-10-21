<div align="center">
  <img src="public/favicon.svg" width="72" height="72" alt="Observatory telescope">
  <h1>Observatory</h1>
  <p>A quiet menu bar app and local dashboard for people who work with AI coding agents.<br>It answers four questions at a glance: am I near my limits, what are my agents doing, where did my time go, and what did it cost.</p>
</div>

<p align="center">
  <img src="docs/images/dashboard-one-computer-light.png" width="860" alt="The Observatory dashboard on one computer, light appearance, fictional data: tiles for limits, agents, screen time by category and cost by provider, then the Limits page">
</p>

## What it shows

- **Limits.** Claude Code and Codex, each window (5-hour and weekly), with the percent left, the reset time and how fast it is going.
- **Agents.** Which Claude Code sessions are working, idle, waiting on you or done, and recent Codex jobs, with project and session names.
- **Time.** Screen time today and over time, by app category, from [ActivityWatch](https://activitywatch.net/).
- **Cost.** Tokens today and over time, with what they would cost at public API prices.

The menu bar shows one number, the lowest limit left, with an amber dot when an agent is waiting on you. Its menu lists the rest and has Open dashboard, Refresh and Quit. The dashboard opens in your normal browser at http://127.0.0.1:5601.

Observatory only watches. It never starts, stops or answers an agent, and it changes nothing in the tools it reads.

<p align="center">
  <img src="docs/images/dashboard-agents-dark.png" width="860" alt="The Agents page in dark appearance with fictional data: sessions on two computers with Waiting on you, Working, Idle and Done labels">
</p>

## Install

You need [Node.js](https://nodejs.org/) 22.13 or later. For screen time, install and run [ActivityWatch](https://activitywatch.net/). On a Mac you also need the Xcode Command Line Tools (`xcode-select --install`).

```bash
git clone https://github.com/ScribleSean/observatory.git
```

```bash
cd observatory
```

```bash
npm run setup
```

That is all. Setup writes a settings file with every source on, builds the dashboard and the menu bar app (the tray app on Windows) inside the folder you cloned, and starts it now and at login. Nothing is installed in Applications or Program Files, and nothing needs an account.

- To update: `git pull`, then `npm run setup` again.
- To stop it and remove the login item: `npm run setup -- --remove`. Your data and settings stay.
- On a MacBook with a notch and a busy menu bar, a new item can hide behind the notch. Hold Command and drag it to the right.

## Settings

Settings are in `observatory.config.json`, next to `package.json`. Setup writes it the first time. Edit it to turn a source off, then run `npm run setup` again.

```json
{
  "device": { "name": "Studio Mac" },
  "sources": {
    "screenTime": true,
    "codex": true,
    "codexLimits": true,
    "claudeCode": true,
    "claudeLimits": true,
    "agents": true
  }
}
```

A source is read only while it is `true`. Optional settings: `dashboard.port` (default 5601), `dataFolder`, and `codexPath` if Codex is installed somewhere unusual.

## A second computer (optional)

A Mac and a Windows PC can share one view. The Mac reads the PC's numbers over SSH every five minutes and writes the combined view back, so both menus and both dashboards show both computers. See [Two computers](docs/TWO-COMPUTERS.md).

## How to read the numbers

- Unknown means a value was not read. It never means zero.
- A limit percentage comes from the provider. A dollar figure is an estimate at public API prices, not a bill.
- With two computers, sums are labeled "not deduplicated", and a sum is Unknown if either computer's value is Unknown. Limits are never added, because they belong to the account.
- Days are counted in the America/New_York time zone.

## Privacy

- Everything stays on your computer. The dashboard listens on 127.0.0.1 only and cannot change anything.
- Saved data holds totals, limit readings, agent status and project and session names. It never holds prompts, messages, window titles, commands, job output or credentials.
- Agent status comes from the small state files Claude Code and codex-job already keep. Transcripts and job output are never opened.

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

`npm run preview` serves the dashboard with fictional data at http://127.0.0.1:5602. `npm run tick` runs one collection by hand. [The hub plan](docs/HUB-PLAN.md) maps the code to the design.

| Part | Files |
| --- | --- |
| Settings | `lib/config.mjs` |
| Readers | `scripts/read-settings.mjs`, `scripts/read-claude-usage.mjs`, `scripts/read-agents.mjs`, `scripts/mac-activity.mjs`, `scripts/windows-aggregate-activity.ps1`, `scripts/collect-quota.mjs`, `scripts/claude-limits.mjs` |
| Collect and combine | `scripts/collect.mjs`, `lib/combine.mjs`, `scripts/tick.mjs` |
| Second computer | `scripts/hub.mjs`, `scripts/hub-transport.mjs` |
| Dashboard | `serve-local.mjs`, `app/viewer`, `lib/panel-data.mjs` |
| Menu bar and tray | `glance/mac/Glance.swift`, `glance/windows/Glance.cs` |
| Setup | `scripts/setup.mjs` |

Bug reports and small fixes are welcome. Use synthetic examples and never attach real usage records. Read [AGENTS.md](AGENTS.md) first.

[MIT license](LICENSE) · [Third-party acknowledgments](THIRD-PARTY-NOTICES.md)
