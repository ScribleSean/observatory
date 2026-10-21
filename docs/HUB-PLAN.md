# Hub rebuild: implementation plan

This plan maps the hub spec (the draft Sean approved on 2026-10-21, kept outside the repository in `work/HUB-SPEC-DRAFT.md`) to work on the `claude/hub-rebuild-bd9fca` branch. It records the choices made where the spec was silent, and what is built.

## Shape

```
 each computer, every 5 minutes (started by the glance app)
   node scripts/tick.mjs
     1. collect   -> <data>/public/local/usage.json       (this computer only)
     2. hub only: pull each spoke's usage.json over SSH
     3. combine   -> <data>/public/local/combined.json
     4. hub only: write combined.json back to each spoke over SSH
```

- `<data>` is the existing data folder, so saved history stays readable: `~/Library/Application Support/Observatory` on the Mac and `%LOCALAPPDATA%\Observatory` on Windows. Screen time history, the Codex limits store (`private-quota`) and the Claude limits folder are reused as they are.
- `combined.json` holds three things: each device's own rows (so any computer can recombine), a merged snapshot in the schema the existing viewer already draws (`view`), and a small `glance` block that the menu bar and tray apps print as is.
- A spoke recombines on its own tick from its fresh snapshot plus the device rows in the last `combined.json` the hub wrote, so its own numbers stay current while the hub is away, and the other device shows its real age.

## Spec section to work

| Spec section | Work | Files | State |
| --- | --- | --- | --- |
| Settings | `observatory.config.json` at the clone root, validated by `lib/config.mjs`. A source runs only when it is `true`. The hub lists its spokes. | `lib/config.mjs`, `observatory.config.example.json` | Built, tested |
| Python readers | Ported to Node. Checked against golden outputs the Python versions produced on synthetic fixtures (34 fixtures), then the Python was removed. | `scripts/read-settings.mjs`, `scripts/read-settings-cache.mjs`, `scripts/read-claude-usage.mjs`, `scripts/fixtures/` | Built, tested |
| Collector | One cross-platform entry point that reuses the kept cleaners and stores. No pairing hooks. | `scripts/collect.mjs` | Built, tested, run once on the Mac against real sources into a temporary folder |
| Combine | Pure function from device snapshots to `combined.json`. Limits: freshest reading. Tokens and screen time: per device plus a labeled sum, Unknown when any part is Unknown. | `lib/combine.mjs` | Built, tested |
| Hub pull and write-back | SSH with fixed PowerShell (Windows spoke) or `sh` (Mac spoke) commands. | `scripts/hub-transport.mjs`, `scripts/hub.mjs`, `scripts/tick.mjs` | Built, tested with a fake transport. Not run against the PC. |
| Glance | Swift menu bar app and C# tray app, one file each. | `glance/mac/Glance.swift`, `glance/windows/Glance.cs` | Swift compiles here. C# is compiled by CI and by setup on the PC, not yet run. |
| Dashboard | Read-only Limits, Activity, Tokens and Sources pages plus a Today summary. Server on 127.0.0.1. | `serve-local.mjs`, `app/viewer`, `app/web` | Built, tested, checked in a browser with fictional data |
| Install | `npm run setup`, `--dry-run`, `--no-login`, `--remove`. | `scripts/setup.mjs` | Dry run and `--no-login` build checked on the Mac. Login item not registered here. |
| Keep and drop | Dropped areas deleted. CI is one workflow. Old-app docs moved to `docs/history`. | | Done |

## Decisions made without asking

- **One device per platform.** The viewer only knows the hosts `Mac` and `Windows`, so the first version supports one Mac and one Windows PC. Either can be the hub.
- **The glance app runs the tick.** The spec says a login item on the Mac and a scheduled task on Windows run the collector. A scheduled task that starts `node.exe` flashes a console window on Windows, so instead the glance app starts at login on both computers (a LaunchAgent on the Mac, the `HKCU\...\Run` key on Windows) and runs `node scripts/tick.mjs` hidden every 5 minutes and on Refresh. Quitting the app stops collection on that computer.
- **The app is built inside the clone.** `build/Observatory.app` on the Mac (ad hoc signed) and `build\windows\ObservatoryGlance.exe` on Windows. Nothing goes into Applications or Program Files.
- **The config file lives in the clone.** `observatory.config.json` sits next to `package.json` and is ignored by Git. The first `npm run setup` writes it from the example and stops so it can be edited.
- **Write-back uses no remote Node.** The hub sends fixed PowerShell (Windows) or `sh` (Mac) commands over the SSH alias. Files travel as base64, and the remote side writes a temporary file and renames it.
- **The remote data folder is found on the spoke.** For a Windows spoke the hub uses `$env:LOCALAPPDATA\Observatory`, so the config needs only the SSH alias.
- **A spoke snapshot must be about the spoke.** The hub refuses a pulled file whose device is the hub's own platform. Older snapshots (build 42 and 43) carry the other device's rows too, and only the spoke's own rows are used.
- **Claude Code limits consent is the config.** `claudeLimits: true` replaces the old consent marker. The status-line bridge files are kept (the spec keeps `claude-statusline-*`), but setup does not install the bridge.
- **Codex location.** The collector looks in the app bundles, Homebrew, `~/.local/bin` and `PATH`, and `codexPath` in the config overrides it. The old app's `local.config.json` in the data folder is still honoured on the Mac.
- **Title.** The menu bar title is the lowest current limit left, as one number. A trailing `?` means `combined.json` is older than 15 minutes. The Windows tray draws the same number into its icon.
- **Old app guard.** Setup stops if the build 42 or 43 app is running and the new app would use the same data folder.
- **Dictation, skins 2 to 4, the panel, Settings and Setup pages, the demo and product page** are removed. `lib/sample-snapshot.mjs` stays as the fictional data for tests and `npm run preview`.
- **Docs.** Guides and dated records for the old app are moved unchanged to `docs/history`, as AGENTS.md asks that dated records be preserved. `docs/PARITY.md` and `docs/BUILD-PLAN.md` stay in place with a "Historical" note, because AGENTS.md links to them.

## Open questions for Sean

1. **AGENTS.md.** The spec says the sections that describe the old app get rewritten in one pass when the rebuild starts. Only the approved sum sentence was applied. A proposed rewrite is below. Apply it, change it, or leave it?
2. **Old apps.** Build 43 (Mac) and build 42 (PC) write the same `usage.json`. For the live check, they need to be quit and their login items turned off. Uninstalling them is your call.
3. **Claude Code status line.** If the old app installed its status-line bridge into `~/.claude/settings.json`, that command points into the old app bundle and breaks when the bundle goes. Keep the bridge (repoint it with `node scripts/claude-statusline-install.mjs`) or remove it and rely on `/usage` every tick?
4. **Time zone.** Days are counted in America/New_York on every computer, as before. Making it follow each computer's own zone touches the readers and the viewer. Worth doing before others use it?
5. **Another Mac as the second computer.** Needs the viewer to accept more than the two host names. Later?
6. **Unused development packages.** `happy-dom` and `lucide-react` may no longer be needed. Removing them changes `package-lock.json`, which needs a network install. Fine to do in a later small pull request?
7. **Reader edge cases kept from Python.** The Codex reader fails the whole read on some malformed events (for example a null timestamp), exactly as the Python did. Keep that strictness or skip bad events?

## Independent critique, 2026-10-21

A Codex review of the spec and spike raised five points. How the build handles each:

1. **SSH contract.** `scripts/hub-transport.mjs` runs SSH in batch mode with strict host key checking, no agent, X11 or port forwarding, and a 30 second kill. It sends two fixed commands. The pull reads `<data>\public\local\usage.json`. The write-back writes a temporary file in `<data>\public\local` and renames it to `combined.json`. Nothing in the spoke's reply chooses a path. One nuance: for a Windows spoke `<data>` comes from the spoke account's own `LOCALAPPDATA`, unless the hub's config sets `dataFolder`.
2. **Pulled JSON is validated.** Size is capped at 16 MB, `schema` must be 2, the snapshot must be about the spoke, and a `collectedAt` more than 2 minutes in the future is refused. A limit reading dated in the future never wins "freshest". When a pull is refused or fails, the last good copy from `combined.json` is kept and shown with its age.
3. **Unknown never becomes zero.** A computer's token total is Unknown when any enabled provider is Unknown, and the "Both computers" sum is Unknown when any part is. "No records" (read, nothing today) is the only case that counts as zero.
4. **Freshness at display time.** Menu lines carry clock times ("as of 1:05 PM"), and the apps and dashboard compute ages when they draw. `tick.mjs` stops itself after 4 minutes, and the apps end a tick that runs past 4.5 minutes.
5. **Hub offline and migration.** A spoke recombines its own fresh snapshot with the last copy from the hub on every tick. Before the first write over the old app's `usage.json`, the collector copies it once to `usage.before-hub.json`, so returning to build 43 or 42 is a matter of quitting the new app and restoring that file.

## Proposed AGENTS.md rewrite (not applied)

Replace the "Scope and priorities" bullets 2, 5 and 7 and the "Sessions and branches" section with:

- [The hub plan](docs/HUB-PLAN.md) records the current design: the Mac is the hub, it pulls each spoke's snapshot over SSH, combines them and writes the result back. Read it before changing a data format, the combine rules or the glance apps. [The design direction](docs/DESIGN.md) still describes the dashboard's look. `docs/history` holds the old app's records.
- The second computer is reached with the user's own SSH alias. Do not add a listener, a pairing service or a hosted account service.
- There is no demo page or release until the owner asks for one. Builds are made locally by `npm run setup`. This scope does not authorize publication, releases or repository-visibility changes.
- Work happens on branches and reaches `main` by pull request. One review per pull request. Tests cover the readers, the combine step and the local server.
- On Windows, a live check starts the tray app from the Start menu or at login, not from inside a Claude desktop session (issue 58).

## Live check with Sean

Nothing on this branch has talked to the PC. The steps are in the build session's final summary.
