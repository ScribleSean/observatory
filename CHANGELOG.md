# Changelog

## 2.0.0, the lean hub (unreleased)

Observatory was rebuilt from a full desktop app into a small menu bar companion with a local dashboard. The old app is kept on the `archive/full-app` tag.

### Added

- **When each limit runs out.** The dashboard and the menu bar panel open on one tile per engine with the percent left and when it runs out at the current pace, or "Has room". The engine closest to running out comes first, and the menu bar shows its percent. The pace uses the last day of readings (the last two hours for a 5-hour limit) and ignores readings from before a reset. Limits, Screen time and Tokens sit under History.
- **Off instead of an old number.** An engine reads Off when its client is signed out, when the account reports a free plan, or when it has had no reading for a day. The `engines` setting sets each engine to `auto`, `on` or `off`.
- **Zero-config install.** `git clone`, then `npm run setup`. Setup writes a settings file that reads limits, tokens and screen time, builds the dashboard and the menu bar or tray app on your own computer, and starts it now and at login. `npm run setup -- --remove` takes it out again.
- **Optional second computer.** A Mac and a Windows PC can share one view over your own SSH connection. Limits are not added across computers, and sums of time, tokens and cost are labeled "not deduplicated".
- **History kept for good.** Each computer saves its own daily token totals, so a day stays counted after Claude Code deletes old transcripts. All starts at the first recorded day, Both shows one combined total over each computer's own, and a computer that is offline keeps its past days.
- **Your own time zone.** Days are counted in each computer's time zone instead of a fixed one.
- **Today by project.** The Tokens page shows today's tokens per project folder name. Only folder names are kept, not paths.
- **WSL on Windows.** With `sources.wsl` set to `true`, a Windows PC counts the Claude Code and Codex logs inside its WSL distributions as its own.
- **Status for scripts.** `npm run status -- --json` prints each engine's percent left, reset time, burn rate and pace from saved data, and `--wait codex` (or `claude`) waits until that engine is no longer out.
- **Optional Grok tile.** With `sources.grokLimits` set to `true`, a Grok tile reads a cached weekly limit, a request log, or both, from the files set in `grok.appFolder` and `grok.requestLog`.
- **Same-repo line.** When two live Claude Code or Codex sessions work in one repository, on one computer or both, the dashboard shows one line naming the repository and the sessions. A worktree and its main checkout count as one repository. It reads only process names, working folders and git facts, and shows nothing when there is no overlap. It is on in the example settings. In settings you already have, turn it on with `"sessions": true` under `sources`. It is not available on Windows yet.

### Changed

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

### Before you update from the full app

Quit the old app and turn off its login item. The new collector uses the same data folder, and on its first run it keeps a copy of the old snapshot as `usage.before-hub.json`.
