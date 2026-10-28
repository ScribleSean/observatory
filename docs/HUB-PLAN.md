# Design notes

How Observatory 2.0 works, and why it is built this way. The full app it replaced (up to build 44) is on the `archive/full-app` tag, and its records are in [docs/history](history/README.md).

## Shape

```
 each computer, every 5 minutes (started by the menu bar or tray app)
   node scripts/tick.mjs
     1. collect   -> <data>/public/local/usage.json        (this computer only)
     2. hub only: read the other computer's usage.json over SSH
     3. combine   -> <data>/public/local/combined.json
     4. hub only: send the result back as combined.incoming.json
```

- `<data>` is `~/Library/Application Support/Observatory` on a Mac and `%LOCALAPPDATA%\Observatory` on Windows. The full app used the same folder, so its history stays readable.
- `combined.json` holds three things: each computer's own rows (so either computer can recombine), a merged snapshot that the dashboard draws (`view`), and a small `glance` block for the menu bar and tray apps. The apps check each limit reading and reset time again when drawing.
- On one computer, steps 2 and 4 do not happen. With two, the computer without the hub role merges the hub's copy on its own cycle, so its own numbers stay current when the hub is away and the hub's numbers show their age.

## Parts

| Part | What it does | Files |
| --- | --- | --- |
| Settings | One hand-edited `observatory.config.json` beside `package.json`. A source is read only while it is `true`. The hub lists the other computer. | `lib/config.mjs`, `lib/timezone.mjs` |
| Readers | Screen time from ActivityWatch, tokens from Claude Code and Codex logs, limits from the installed clients. The log readers were ported from Python and checked against saved Python results on 34 synthetic fixtures. | `scripts/read-*.mjs`, `scripts/mac-activity.mjs`, `scripts/windows-aggregate-activity.ps1`, `scripts/collect-quota.mjs`, `scripts/claude-limits.mjs` |
| Collect | One entry point for both platforms. A lock stops overlapping runs, and a deadline stops a stuck one. | `scripts/collect.mjs`, `scripts/tick.mjs`, `lib/run-lock.mjs` |
| Combine | A pure function from snapshots to `combined.json`. | `lib/combine.mjs` |
| Second computer | Fixed SSH commands, PowerShell for a Windows computer and `sh` for a Mac. | `scripts/hub.mjs`, `scripts/hub-transport.mjs` |
| Dashboard | Read-only pages for Limits, Activity, Tokens and Sources, under three overview tiles. Served on 127.0.0.1 only. | `serve-local.mjs`, `app/viewer`, `lib/panel-data.mjs` |
| Menu bar and tray | One Swift file and one C# file, built on the user's computer. | `glance/mac/Glance.swift`, `glance/windows/Glance.cs` |
| Setup | Writes settings, builds, and starts the app at login. `--dry-run`, `--no-login` and `--remove`. | `scripts/setup.mjs` |

## Rules the numbers follow

- Unknown is never shown as zero. "No records" (the source was read, nothing happened today) is the only case that counts as zero.
- Account limits are never added across computers. The freshest reading wins, and a reading dated in the future never wins.
- Screen time, tokens and cost are shown per computer. With two computers, their sum is labeled "not deduplicated" and is Unknown if either part is.
- Freshness is judged when the page or menu is drawn, not when the file was written. Today's numbers from an earlier day show Unknown with the last update time.
- Days follow each computer's own time zone. `OBSERVATORY_TIMEZONE` overrides it, and the tests pin New York so their saved results match on any machine.

## Privacy

- Saved data holds totals, limit readings and times. It never holds prompts, messages, session names, window titles, commands, paths or credentials.
- A malformed file from the other computer fails only that computer's read.
- The tests plant prompts, messages, paths and fake keys in sample files and check that none of them reach saved data.

## Decisions

- **One computer first.** Setup writes the settings itself and needs no answers. The second computer is an add-on.
- **One Mac and one Windows PC at most.** The dashboard knows the two host names `Mac` and `Windows`.
- **The menu bar or tray app runs the five-minute cycle.** A Windows scheduled task that starts `node.exe` flashes a console window, so the glance app starts at login on both platforms and runs `tick.mjs` hidden. Quitting the app stops collection on that computer. The app stops its dashboard server when it ends, including when launchd stops it, and the server also exits if its app has gone.
- **Built inside the clone.** `build/Observatory.app` on a Mac (ad hoc signed) and `build\windows\ObservatoryGlance.exe` on Windows, compiled with the C# compiler that comes with Windows. Nothing is installed in Applications or Program Files, and there is no download warning.
- **No program needed on the other computer for the connection.** The hub sends fixed commands over the user's SSH alias. Files travel as base64 with a size check, and are written to a temporary file and renamed. The other computer merges the hub's copy itself, under its own lock, so a newer local result is never replaced.
- **Settings are the consent.** `claudeLimits: true` replaces the full app's consent marker. Claude Code limits are read only by running the installed `claude` CLI's usage command at each collection. The status-line bridge was removed on 2026-10-22.
- **Finding Codex.** The collector looks in the app bundles, Homebrew, `~/.local/bin` and `PATH`. `codexPath` in the settings overrides it on both platforms.
- **Three questions only.** Observatory shows limits, screen time and cost. The Agents view was removed on 2026-10-22. An older settings file that lists `agents` still loads, and that key is ignored.
- **Moving from the full app.** Before the first write over a snapshot from the full app, the collector keeps a copy as `usage.before-hub.json`. Setup stops if the full app is running and would share the data folder.

## Reviews

Two independent code reviews, plus a critique of the original design, found these issues. All are fixed and tested:

- A malformed pulled snapshot now affects only that computer.
- The run lock carries a token, checks a takeover, and releases only its own lock.
- The hub writes to an inbox file that the other computer merges, instead of replacing its `combined.json`.
- Windows honours `codexPath`.
- Freshness is judged at draw time, and the results of write-backs are saved and shown in the menu.
- SSH runs in batch mode with strict host key checking and no forwarding, pulled files are bounded and versioned, and future-dated readings are refused.

## Known limits

- The Windows tray app and the connection between two computers have had less use than the Mac app on one computer.
