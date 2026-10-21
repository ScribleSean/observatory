# Hub rebuild: implementation plan

This plan maps the hub spec (the draft Sean approved on 2026-10-21, kept outside the repository in `work/HUB-SPEC-DRAFT.md`) to work on the `claude/hub-rebuild-bd9fca` branch. It records the choices made where the spec was silent.

## Shape

```
 each computer, every 5 minutes (started by the glance app)
   node scripts/tick.mjs
     1. collect   -> <data>/public/local/usage.json       (this computer only)
     2. hub only: pull each spoke's usage.json over SSH
     3. combine   -> <data>/public/local/combined.json
     4. hub only: write combined.json back to each spoke over SSH
```

- `<data>` is the existing data folder, so saved history stays readable: `~/Library/Application Support/Observatory` on the Mac and `%LOCALAPPDATA%\Observatory` on Windows.
- `combined.json` holds three things: each device's own rows (so any computer can recombine), a merged snapshot in the schema the existing viewer already draws, and a small `glance` block that the menu bar and tray apps print as is.
- A spoke recombines on its own tick from its fresh snapshot plus the device rows in the last `combined.json` the hub wrote, so its own numbers stay current while the hub is away, and the other device shows its real age.

## Spec section to work

| Spec section | Work | Files |
| --- | --- | --- |
| Settings | `observatory.config.json` at the clone root, validated by `lib/config.mjs`. A source runs only when it is `true` there. The hub lists its spokes. | `lib/config.mjs`, `observatory.config.example.json` |
| Collector | One cross-platform entry point that reuses the kept cleaners and stores. No pairing hooks. A lock file stops overlapping runs. | `scripts/collect.mjs` |
| Python readers | Ported to Node and checked against golden outputs produced by the Python versions. | `scripts/read-settings.mjs`, `scripts/read-settings-cache.mjs`, `scripts/read-claude-usage.mjs` |
| Combine | Pure function from device snapshots to `combined.json`. Limits come from the freshest reading. Tokens and screen time are per device plus a labeled sum that is Unknown when any part is Unknown. | `lib/combine.mjs` |
| Hub pull and write-back | SSH transport that reads and writes one file with PowerShell (Windows spoke) or `sh` (Mac spoke). Tested with a fake transport. | `scripts/hub-transport.mjs`, `scripts/hub.mjs` |
| Glance | Swift menu bar app and C# tray app, one file each, that read `glance` from `combined.json` and offer Open dashboard, Refresh and Quit. | `glance/mac/Glance.swift`, `glance/windows/Glance.cs` |
| Dashboard | `serve-local.mjs` serves the built viewer and `combined.json` from the data folder, on 127.0.0.1 only. Read-only pages: Limits, Activity, Tokens, Sources. | `serve-local.mjs`, `app/viewer` |
| Install | `npm run setup`: checks Node and ActivityWatch, writes a starter config, builds the dashboard and the glance app, registers login start. | `scripts/setup.mjs` |
| Keep and drop | Delete the dropped areas listed in the spec, then fix imports in what stays. | many |

## Order

1. AGENTS.md sum rule (done first, as the spec asks).
2. Config and setup skeleton.
3. Node readers with golden tests.
4. Collector, combine, hub, fake-transport tests.
5. Dashboard reads `combined.json`.
6. Menu bar app, tray app.
7. Remove dropped areas and their tests, one CI workflow, README.

## Decisions made without asking

- **One device per platform.** The viewer only knows the hosts `Mac` and `Windows`, so the first version supports one Mac and one Windows PC. Either can be the hub. A second Mac would need viewer work.
- **The glance app runs the tick.** The spec says a login item on the Mac and a scheduled task on Windows run the collector. A scheduled task that starts `node.exe` flashes a console window on Windows, so instead the glance app starts at login on both computers and runs `node scripts/tick.mjs` hidden every 5 minutes and on Refresh. Quitting the app stops collection on that computer, the same as quitting ActivityWatch.
- **The config file lives in the clone.** `observatory.config.json` sits next to `package.json` and is ignored by Git. `npm run setup` copies the example when it is missing.
- **Write-back uses no remote Node.** The hub sends PowerShell (Windows) or `sh` (Mac) commands over the SSH alias. The file travels as base64 so code pages cannot change it, and the remote side writes a temporary file and renames it.
- **The remote data folder is found on the spoke.** For a Windows spoke the hub uses `$env:LOCALAPPDATA\Observatory`, so the config needs only the SSH alias. A spoke entry may set `dataFolder` to override it.
- **Claude Code limits consent is the config.** `claudeLimits: true` replaces the old consent marker and status-line check. The status-line bridge stays available as a reader but is not installed by setup.
- **Dashboard server lifetime.** The glance app starts `node serve-local.mjs` the first time Open dashboard is used and stops it on Quit.

## Open questions for Sean

1. Should the second computer be allowed to be another Mac? That needs the viewer to accept more than the two host names.
2. The old build 43 and 42 apps write the same `usage.json`. Setup refuses to continue while the old app is running. Is quitting and removing the old app by hand acceptable for the live check?
3. Keep the Claude Code status-line bridge (it gives fresher Claude limits while a terminal session runs), or rely only on the `/usage` command each tick?
4. Codex limits and history live in the SQLite quota store with its sharing fields unused. Fine to leave the store format as is for now?

## Live check with Sean (not done on this branch)

See the steps in the final summary of the build session. Nothing on this branch has talked to the PC.
