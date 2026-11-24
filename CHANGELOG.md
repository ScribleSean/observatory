# Changelog

## 2.0.0, the lean hub (unreleased)

Observatory was rebuilt from a full desktop app into a small menu bar companion with a local dashboard. The old app is kept on the `archive/full-app` tag.

### Added

- **The Refractor.** Observatory's mark is a telescope on its tripod, pointed at a star, on the app icons, the dashboard header and tab, and the README. The menu bar and tray icon uses the same mark as a meter: the tube fills from the eyepiece to the lens for the share of the Claude weekly limit used, and the star shows the state (a dot on pace, a bar when it runs out before the reset, a hollow dot when the last read is old, nothing when off). On a Mac the percent sits beside it, and on Windows it leads the tooltip. `"glance": { "accent": true }` draws the Mac icon in the accent color. `npm run icons` redraws the app icons.
- **When each limit runs out.** The dashboard and the menu bar panel open on one tile per engine with the percent left and when it runs out at the current pace, or "Has room". The engine closest to running out comes first, and the menu bar shows its percent. The pace uses the last day of readings (the last two hours for a 5-hour limit) and ignores readings from before a reset. Limits, Screen time and Tokens sit under History.
- **Sign in to Claude from the panel.** When Claude Code is signed out on this computer, the menu bar and tray panel offer **Sign in to Claude**, which runs Claude Code's own browser sign-in, shows its progress and reads the limits again. A failure gets one line with its fix: a certificate the network adds, a Console account instead of a subscription, Claude Code missing, or a timeout. `npm run doctor` checks the same on any computer, and setup runs it.
- **Networks with their own certificate authority.** Setup records the certificate file your shell gives Claude Code or OpenSSL (`claude.caCertificates`), and every Claude Code process Observatory starts gets it as `NODE_EXTRA_CA_CERTS`, so limit reads and sign-in renewals work from the apps started at login.
- **Off instead of an old number.** An engine reads Off when its client is signed out, when the account reports a free plan, or when it has had no reading for a day. The `engines` setting sets each engine to `auto`, `on` or `off`.
- **Zero-config install.** `git clone`, then `npm run setup`. Setup writes a settings file that reads limits, tokens and screen time, builds the dashboard and the menu bar or tray app on your own computer, and starts it now and at login. `npm run setup -- --remove` takes it out again.
- **Optional more computers.** A Mac, a Windows PC and a Linux computer can share one view over your own SSH connection. A Linux computer collects tokens, limits and sessions, with no screen time, and `npm run setup` installs a systemd user timer there. Limits are not added across computers, and sums of time, tokens and cost are labeled "not deduplicated".
- **History kept for good.** Each computer saves its own daily token totals, so a day stays counted after Claude Code deletes old transcripts. All starts at the first recorded day, Both shows one combined total over each computer's own, and a computer that is offline keeps its past days.
- **Your own time zone.** Days are counted in each computer's time zone instead of a fixed one.
- **Today by project.** The Tokens page shows today's tokens per project folder name. Only folder names are kept, not paths.
- **Where it went.** The Tokens page ranks today's largest sessions on each computer, across Claude Code and Codex, and opens each one into its main conversation and its largest subagents. Sessions and subagents are kept as short hashes with token counts, not names.
- **Tool uses in the drift view.** The Drift page also shows tool uses per model call for each Claude model and day, next to thinking, time, tokens and retries.
- **Plan changes in the middle of a period.** When a plan changes before a limit resets, the new reading replaces the old one, and the forecast and the pace do not count the change as use.
- **WSL on Windows.** With `sources.wsl` set to `true`, a Windows PC counts the Claude Code and Codex logs inside its WSL distributions as its own.
- **Status for scripts.** `npm run status -- --json` prints each engine's percent left, reset time, burn rate and pace from saved data, and `--wait codex` (or `claude`) waits until that engine is no longer out.
- **Optional Grok tile.** With `sources.grokLimits` set to `true`, a Grok tile reads a cached weekly limit, a request log, or both, from the files set in `grok.appFolder` and `grok.requestLog`.
- **Same-repo line.** When two live Claude Code or Codex sessions work in one repository, on one computer or both, the dashboard shows one line naming the repository and the sessions. A worktree and its main checkout count as one repository. It reads only process names, working folders and git facts, and shows nothing when there is no overlap. It is on in the example settings. In settings you already have, turn it on with `"sessions": true` under `sources`. It is not available on Windows yet.

- **One forecast, the same words everywhere.** Each computer works out the forecast once per reading and stores it, worded, in its `combined.json`. The dashboard, the menu bar, the tray and `npm run status -- --json` all show that stored result, so they always name the same time. A forecast older than a snapshot may be says when it was made ("as of Wed 7:40 AM"), and one whose window has reset since reads Unknown.
- **Turn a computer off.** `"off": true` on a `hub.spokes` entry stops the hub from reaching that computer, and every surface shows it as Off instead of the time of its last reading. A computer that is on but unreachable still shows that time, now with its day.
- **Round 2 dashboard.** Seven views, Overview, Sessions, Limits, Tokens, Screen time, Drift and Settings, under one scope bar that picks the computers, a day, week, month, year or all of it, and the sources. Each headline number (spend at API prices, branches merged, commits on main, commits not yet on main, cost per landed change, spend with no commits) is compared with the same days of the previous period and opens into its parts. Sessions read as "[Builder] Lantern", with a role from the title, your own `sessions.roles` map, how the session ran or its kind of work.
- **Daily ledger history.** Each computer keeps a record per tool and day of spend, sessions, subagents, tokens, commits and merges, so month, year and all-time views have data. The full record stays in a private store on that computer. The snapshot carries a trimmed copy, and a large history drops its oldest session rows first, keeping every day's totals.
- **Ask and pinned questions.** The Ask field and questions such as "Where did today's spend go?" rearrange the same blocks. Nothing in the dashboard calls a model.
- **Optional MCP server.** `scripts/mcp-server.mjs` lets your own Claude client compose and save a view. A saved view holds queries, never numbers or titles, and is checked by the same block catalog as the built-in views. See `docs/MCP.md`.
- **The known part of an Unknown sum.** A total with a day that could not be read stays Unknown and says what was read beside it, for example "at least $642, 1 day not read on Tower".

### Changed

- A time always names its day, today included: "Wed 4 PM", never "4 PM". The dashboard's read time and computer chips do too.
- The dashboard's fonts, Geist and Geist Mono, are bundled with it. The page loads nothing from the network.
- The menu bar and tray show the same forecast words as the dashboard, "at this pace" included.
- `npm run status -- --json`: `burnPerHour` is now the average pace since the window opened, from the stored forecast, not the last hour's rate. A window's pace follows the stored forecast: `slow` when it runs out before the reset, `spend` when 20 points or more are expected left, `hold` in between. The status adds the stored words (`forecast` on each engine and window, a top-level `forecast`) and each computer's state (`devices`).
- A limit window that has just reset reads "Too early to forecast" on every surface until a tenth of it has passed (about 17 hours of a weekly window, 30 minutes of a 5-hour window, a day at most). Before, the first hour's use was carried over the whole window, so a weekly limit with 97% left could read "may run out" within an hour of its reset. A window with 25% or less left, or one burning fast (20 points or more used, and three times the share of the window that has passed), is still forecast. An early window leads an engine's headline only when it is that engine's lowest window. The menu bar and tray icon shows the dot then, never the over-pace bar. `npm run status -- --json` gives such a window the new pace `early`, with no burn rate, and the job cap stays at the most instead of dropping to 1.
- The Limits rows no longer add "runs out in" to a Codex window. That note came from a second, separate estimate, which is gone.
- The Week page shows a tool's tab only when it has sessions in the period. A tool whose sessions could not be read keeps its tab and reads Unknown.
- Running sessions on the Week page come only from computers with a current reading, as in the menu bar.
- A session with no title is named from how it ran, the kind of its first prompt and its repository ("Review run in garden"), the same in the menu bar as on the Week page. A working folder that is not a git repository is not kept.
- The readers that were written in Python are now in Node, checked against saved results from the Python versions. Node is the only runtime to install.
- One hand-edited `observatory.config.json` replaces the settings screens. A source runs only while it is `true` there.
- The dashboard is read-only and listens on 127.0.0.1 only.
- The main token totals leave out cache reads (context sent again with each request). Cache reads are shown on their own.
- Windows needs Node.js 22.17 or later. A Mac still needs 22.13 or later.

### Removed

- Device pairing with invitations and its TLS service, consent and sharing sync, the settings and setup screens, signed packages, installers and updates, dictation, and three of the four skins. Everything removed is on the `archive/full-app` tag.
- The Agents view, which showed Claude Code sessions and background Codex runs, and the amber "waiting on you" dot on the menu bar and tray icon. Observatory no longer reads `~/.claude/sessions` or the Codex run folder. An older settings file that lists `agents` still loads, and that key is ignored.
- The Claude Code status-line bridge and its installer. Claude Code limits still come from the installed `claude` CLI's usage command, run at each collection.
- The Overview tiles for screen time and cost, and the Sources page with its empty Dictation card. The home view now shows the limit forecast, and history is one click away.
- Code left over from the full app that nothing used any more: the old consent marker, session cost, the chart rasterizer and the old combine modules.
- The Week and History pages, replaced by the round 2 views, with the skin setting and the view-models only they used.

### Before you update from the full app

Quit the old app and turn off its login item. The new collector uses the same data folder, and on its first run it keeps a copy of the old snapshot as `usage.before-hub.json`.
