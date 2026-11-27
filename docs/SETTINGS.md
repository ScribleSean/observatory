# Settings

Observatory reads one file, `observatory.config.json`, next to `package.json`. Setup writes it if there is none. Run `npm run setup` after a change. With several computers, each computer has its own file.

## Sources

A source is read only while it is `true` under `sources`.

| Key | What it reads |
| --- | --- |
| `claudeLimits` | Claude limits, through the installed Claude Code |
| `claudeCode` | Claude Code tokens and sessions from `~/.claude/projects` |
| `codexLimits` | Codex limits, through the installed Codex client |
| `codex` | Codex tokens, settings and sessions from `~/.codex` |
| `screenTime` | ActivityWatch on 127.0.0.1 |
| `grokLimits` | Grok, from the files under `grok` (see below) |
| `wsl` | On a Windows PC, the Claude Code and Codex logs inside WSL, counted toward that PC. See [Several computers](SEVERAL-COMPUTERS.md#wsl-on-the-pc) |

## Other options

- `dashboard.port`: the dashboard's port, 5601 by default.
- `dataFolder`: where history is kept. The default is `~/Library/Application Support/Observatory` on a Mac, `%LOCALAPPDATA%\Observatory` on Windows and `$XDG_DATA_HOME/observatory` (or `~/.local/share/observatory`) on Linux.
- `codexPath`: an absolute path to the `codex` program, when Observatory should not look for it itself.
- `"glance": { "accent": true }`: draws the Mac menu bar icon in the accent color instead of the system's monochrome.
- `"sessions": { "titles": false }`: keeps a short hash instead of each session title. See [SECURITY.md](../SECURITY.md).
- `"sessions": { "roles": { "tidepool notes": "Researcher" } }`: maps the start of your own session titles to a role. Roles are Chief of staff, Builder, Reviewer, Designer, Researcher, Runner, Sweeper and Ops. Without a match, the role comes from a `Role:` prefix in the title, how the session ran or the kind of work it did.
- `hub.spokes`: other computers to combine into one view. See [Several computers](SEVERAL-COMPUTERS.md).

## Engines

`engines` sets each limit tile to `"auto"` (the default), `"off"`, or `"on"` (keep a free plan's own allowance on screen):

```json
"engines": { "codex": "off" }
```

On `auto`, an engine reads Off instead of an old number when its client is signed out, when the account reports a free plan, or when it has had no reading for a day. When Claude Code is signed out, the menu bar icon reads Sign in and names the computer.

## Grok

Set `"grokLimits": true` under `sources` and point `grok` at local files. Both paths are optional. Nothing is sent anywhere.

```json
"grok": {
  "appFolder": "/absolute/path/to/the/Grok Bot app data folder",
  "requestLog": "/absolute/path/to/requests.jsonl"
}
```

`appFolder` gives the weekly limit the Grok Bot app last read. It counts as current until the app's own expiry, at most a day. `requestLog` is one JSON object per line with an ISO time in `at`. Only the count per day is kept. With a log and no limit, the tile shows today's requests and no percent.

## Networks with their own certificate authority

Some workplace and school networks inspect encrypted traffic with their own certificate. Claude Code then cannot sign in or renew its sign-in ("unable to get local issuer certificate").

Claude Code trusts an extra certificate file only through `NODE_EXTRA_CA_CERTS`. Set it in your shell profile to that network's PEM file, then run `npm run setup` again. The apps start at login without your shell, so setup records the file as `claude.caCertificates` and passes it to every Claude Code process Observatory starts. If you set `CLAUDE_CODE_CERT_STORE` (`system`, `bundled` or both), setup records it the same way as `claude.certStore`. When your shell sets neither, setup takes them from the `env` block of Claude Code's own settings file, which it only reads. Observatory does not change your shell profile or the system's trusted certificates.

`npm run doctor` checks the same things: Claude Code missing, signed out, a Console account instead of a subscription, or a certificate it cannot trust. An Anthropic Console sign-in, an API key or a cloud provider has no subscription limits, so sign in with `claude auth login --claudeai`.

## Self-check

After every run the hub checks what it read. A metric that reads Unknown or late on a computer that is on, with its source on, is a problem. Problems are kept in the data folder. One that lasts 30 minutes can file a ticket in a Markdown work queue (a table whose first column is the row number):

```json
"selfCheck": { "tickets": { "file": "/absolute/path/to/QUEUE.md", "lock": "/absolute/path/to/lock-program", "engine": "agent", "commit": true } }
```

- `lock` is optional: a program that prints `free` for `<lock> status` when no one holds it, and runs `<lock> run <owner> -- <command>` with the lock held. When it is not free, the ticket waits for the next run. A lock ending in `.js`, `.mjs` or `.cjs` runs with Node.
- `commit` commits only that file with git.
- A ticket is filed once per computer and metric, and again only if the queue no longer has it open and the problem is still there a day later. Filing stops after two minutes per run.

## Raw archive

`"archive": { "folder": "/absolute/path" }` keeps every reading as JSON Lines, one file per computer and day. See [Raw archive](RAW-ARCHIVE.md).

## How the numbers are made

- Collection runs every five minutes. `npm run tick` runs one by hand. **Refresh** in the panel reads every source again, and opening the panel on a reading more than a minute old does the same.
- The forecast is worked out once per reading and stored, so the dashboard, menu bar, tray and `npm run status` show the same words. It uses each limit's pace over the last hour and its average pace since the last reset. Once a few days of readings are stored, it gives a range from how far its own earlier forecasts missed. A window that has just reset reads "Too early to forecast" until a tenth of it has passed. `node scripts/harness/forecast-backtest.mjs --fictional` replays the forecast over made-up readings, and `--db` over your own.
- A commit counts for the session that last wrote in that repository in the 20 minutes before it, so commit counts are estimates. A commit pulled in, or made by hand in that time, can count too.
- Token totals leave out cache reads, which are shown on their own. Tokens are saved per day, so a day stays counted after Claude Code deletes its old transcripts.
- Limits are account-wide and are not added across computers. Token and screen time sums across computers are labeled "not deduplicated".
- On a Mac the percent used sits beside the menu bar icon. On Windows it leads the tray tooltip. An empty tube with no star means the limit is off.
