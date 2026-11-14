Observatory is a menu bar app (a tray app on Windows) and a local dashboard for people who use Claude Code and Codex. It shows how much of each limit is left and when it runs out at your current pace. Screen time and token history are one click away.

Version 2.0 replaces the earlier desktop app with a small menu bar app, a read-only dashboard and one settings file. The earlier app is kept on the [`archive/full-app`](https://github.com/ScribleSean/observatory/tree/archive/full-app) tag.

You can try the dashboard with fictional data on the [demo page](https://scriblesean.github.io/observatory/).

## What it does

- **When each limit runs out.** The dashboard opens on one tile per engine with the percent left and a short phrase, such as "Runs out Thu 4 PM" or "Has room". The engine closest to running out comes first, and the menu bar shows its percent. The pace comes from the readings of the last day (the last two hours for a 5-hour limit) and ignores readings from before a reset.
- **Off instead of an old number.** An engine reads Off when its client is signed out, when the account reports a free plan, or when it has had no reading for a day. The `engines` setting takes `auto` (the default), `off`, or `on` to keep a free plan's allowance on screen.
- **History.** Limits charts each limit window for today, 7 days, 30 days or all time. Screen time shows apps and categories from ActivityWatch. Tokens shows use by day and model, today's use by project folder name, and an estimated cost at public API prices.
- **Token totals that outlast transcripts.** Each computer saves its own daily token totals, so a day stays counted after Claude Code deletes old transcripts. Days are counted in each computer's own time zone.
- **An optional second computer.** A Mac and a Windows PC can share one view over SSH, using a host alias from your SSH config. Limits are account-wide and are not added across computers. Token and screen time sums are labeled "not deduplicated". On a Windows PC, `sources.wsl` also counts the Claude Code and Codex logs inside WSL. See [Two computers](https://github.com/ScribleSean/observatory/blob/v2.0.0/docs/TWO-COMPUTERS.md).
- **Status for scripts.** `npm run status -- --json` prints each engine's percent left, reset time and pace. `npm run status -- --wait codex` waits until Codex is no longer out. It reads saved data only and makes no network calls.

## Install

You need Node.js 22.13 or later on a Mac, or 22.17 or later on Windows. On a Mac, also run `xcode-select --install`. For screen time, install and run [ActivityWatch](https://activitywatch.net/).

```bash
git clone https://github.com/ScribleSean/observatory.git
cd observatory
npm run setup
```

Setup writes `observatory.config.json` if there is none, set to read limits, tokens and screen time. It builds the dashboard and the menu bar or tray app on your computer, and starts the app now and at login. There is no installer and no account. Click the telescope icon in the menu bar (the tray on Windows), then **Open dashboard**. The dashboard runs at http://127.0.0.1:5601.

- `npm run setup -- --dry-run` lists what setup would do and changes nothing.
- To update, run `git pull`, then `npm run setup`.
- To remove, run `npm run setup -- --remove`, then delete the folder. History stays in the data folder (`~/Library/Application Support/Observatory` on a Mac, `%LOCALAPPDATA%\Observatory` on Windows) until you delete it.

## Privacy

Observatory reads records your tools already keep on your computer. It keeps totals, limit readings and times. It does not keep prompts, responses, window titles, paths or credentials. For tokens by project it keeps the project folder's name, not its path. Limits are read through the Claude Code and Codex clients you already have, with your existing sign-in. Observatory has no account, no hosted service and no telemetry. The dashboard listens on 127.0.0.1 only and accepts only GET and HEAD requests.

## Updating from the earlier app

Quit the old app and turn off its login item before you run setup. Settings now live in `observatory.config.json` instead of settings screens. The new version uses the same data folder. On its first run it keeps a copy of the old snapshot as `usage.before-hub.json`.

## Removed

Device pairing, installers and automatic updates, the settings screens, dictation, the Agents view and the Claude Code status line bridge are gone. The [changelog](https://github.com/ScribleSean/observatory/blob/v2.0.0/CHANGELOG.md) lists every change.

## Known limits

- It runs on macOS and Windows only, with at most one Mac and one Windows PC.
- A value that could not be read shows as Unknown, not as zero. Dollar figures are estimates, not a bill.
