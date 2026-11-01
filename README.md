# Observatory

A menu bar app and local dashboard for people who use Claude Code and Codex. It shows how much of each limit is left, where your screen time went, and how many tokens you used, on a Mac, a Windows PC or both.

Observatory reads records your tools already keep on your computer. It has no account, no hosted service and no telemetry. It only watches: it does not start, stop or answer an agent, and it does not change the tools it reads.

[Demo with fictional data](https://scriblesean.github.io/observatory/)

## Install

You need [Node.js](https://nodejs.org/) 22.13 or later on a Mac, or 22.17 or later on Windows. On a Mac, also run `xcode-select --install`. For screen time, install and run [ActivityWatch](https://activitywatch.net/). Everything else is optional.

```bash
git clone https://github.com/ScribleSean/observatory.git
```

```bash
cd observatory
```

```bash
npm run setup
```

Setup writes a settings file, builds the dashboard and a small menu bar app (a tray app on Windows) inside the cloned folder, and starts it now and at login. Click the telescope, then **Open dashboard**. The dashboard runs at http://127.0.0.1:5601.

- Preview the changes first with `npm run setup -- --dry-run`.
- Update with `git pull`, then `npm run setup`.
- Remove with `npm run setup -- --remove`, then delete the folder. History lives in `~/Library/Application Support/Observatory` on a Mac and `%LOCALAPPDATA%\Observatory` on Windows.
- If the notch hides the menu bar item on a MacBook, hold Command and drag it right.

## How it works

Every five minutes the app collects one snapshot of this computer:

| Source | Read from | Kept |
| --- | --- | --- |
| Limits | The installed Claude Code and Codex clients, with your existing sign-in | Percent left and reset time per window |
| Claude Code | `~/.claude/projects` | Tokens per day, hour and model |
| Codex | `~/.codex` | Tokens per day and model, effort and speed settings, tool call counts |
| Screen time | ActivityWatch on 127.0.0.1 | Seconds per app and category |

No prompts, responses, window titles, paths or credentials are kept. A value that could not be read shows as Unknown, never as zero. Dollar figures are estimates at public API prices, not a bill.

**Two computers.** A Mac and a Windows PC can share one view. The Mac reads the PC's snapshot over your own SSH alias and sends the combined view back, so both show both computers. Limits are account-wide and never added across computers. Token and screen time sums are labeled "not deduplicated". See [Two computers](docs/TWO-COMPUTERS.md).

## Settings

`observatory.config.json`, next to `package.json`:

```json
{
  "device": { "name": "Studio Mac" },
  "sources": {
    "screenTime": true,
    "codex": true,
    "codexLimits": true,
    "claudeCode": true,
    "claudeLimits": true
  }
}
```

A source is read only while it is `true`. Run `npm run setup` after a change. Optional: `dashboard.port` (default 5601), `dataFolder`, and `codexPath`.

On a Windows PC, set `"wsl": true` under `sources` to also count the Claude Code and Codex logs inside WSL toward that PC. See [Two computers](docs/TWO-COMPUTERS.md#wsl-on-the-pc).

## Agent status

`npm run status -- --json` prints each engine's limits for scripts and agents: percent left, reset time, burn rate and pace per window, the engine with the most room, and when an engine that is out comes back. It reads this computer's `combined.json` only, makes no network calls and writes nothing.

```bash
npm run status -- --wait codex --timeout 60
```

That waits until Codex has room again. Exit codes: 0 for a current reading, 3 for missing or stale data, 4 on a wait timeout. [Agent status](docs/AGENT-STATUS.md) lists every field.

## Development

```bash
npm test
```

`npm run tick` runs one collection. After `npm run build`, `npm run preview` serves the dashboard with fictional data at http://127.0.0.1:5602. Bug reports and small fixes are welcome, see [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

[MIT license](LICENSE) · [Third-party notices](THIRD-PARTY-NOTICES.md)
