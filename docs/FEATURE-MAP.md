# Feature map

What a user can do, how they reach it, and what checks it today. Test files are under `test/` and `scripts/`. Tests marked Mac or Windows skip on Linux.

| Feature | How a user reaches it | Checked by |
| --- | --- | --- |
| Install, start now and at login | `npm run setup` | `test/setup.test.mjs` (Mac and Windows parts skip on Linux) |
| Preview setup | `npm run setup -- --dry-run` | `test/setup.test.mjs` (skips on Linux) |
| Uninstall | `npm run setup -- --remove` | none |
| Menu bar panel (Mac) | Click the telescope icon | `test/glance-limits.test.mjs` and `test/repo-rules.test.mjs` for shared rules and wording, rendering none |
| Tray panel (Windows) | Click the tray icon | `test/windows-dpi.test.mjs` (source text only), rendering none |
| Menu bar and tray icon: the tube is the Claude weekly share used, the star is on pace, over pace, stale or off | Menu bar (Mac), tray (Windows) | `test/glance-text-contract.test.mjs` (state, percent and words match the Limits view), `test/glance-icon.test.mjs` (geometry in JS, Swift and C# as source text, the committed app icons decoded and checked, favicon), `test/config.test.mjs` and `test/glance-view.test.mjs` (`glance.accent`). Mac rendering checked by hand with `--render-icon`, no test runs it. Windows rendering none |
| Open dashboard, Refresh, Quit | Panel footer (Open dashboard, Refresh; Refresh also runs when the panel opens on a reading over a minute old) and tray menu | `test/server-lifetime.test.mjs` (server stops with the app), Refresh none |
| Dashboard server on 127.0.0.1, GET and HEAD only | http://127.0.0.1:5601 | `test/server.test.mjs`, `test/server-lifetime.test.mjs`, `scripts/request-policy.test.mjs` |
| Forecast: when each engine runs out, with a range once there is history and "Too early to forecast" in the first tenth of a window, and the scarcer engine in the menu bar. Made once per reading by the hub and shown as stored, in the same words, on every surface | Dashboard Limits view and Overview Limits now, menu bar, tray and `npm run status -- --json` | `test/forecast.test.mjs`, `test/forecast-contract.test.mjs` (every surface agrees, the round 2 Limits view-model included), `test/forecast-backtest.test.mjs` (accuracy on made-up readings), `test/view-r2.test.mjs`, `test/repo-rules.test.mjs` (panel wording) |
| Scope bar: computers, period (day, week, month, year, all) stepped back and forward, sources, kept in the address | Every dashboard view | `test/scope.test.mjs`, `test/r2-render.test.mjs` (address followed, stale and Off chips) |
| Overview: headline numbers with their comparison, each opening its breakdown, spend over what landed, sessions, Limits now, Running now and Needs you | Dashboard, Overview | `test/view-r2.test.mjs`, `test/r2-render.test.mjs` |
| Sessions: "[Role] object" names, grouping by role, folded headless runs, one "N more sessions" row, a panel per session | Dashboard, Sessions | `test/view-r2.test.mjs`, `test/r2-render.test.mjs`, `test/roles.test.mjs` |
| Session roles from a `Role:` title, the user's `sessions.roles` map, how a session ran or its kind of work | Sessions view and every session name | `test/roles.test.mjs`, `test/view-r2.test.mjs`, `test/config.test.mjs` (the setting) |
| Limits: each window once with the computer it was read on, the week's burn, past weeks, the share per computer, Grok requests and its weekly limit | Dashboard, Limits | `test/view-r2.test.mjs`, `test/r2-render-more.test.mjs`, `test/limit-history*.test.mjs` |
| Tokens: totals by model, kind and computer, today by project | Dashboard, Tokens | `test/view-r2.test.mjs`, `test/r2-render-more.test.mjs`, `test/project-tokens.test.mjs` |
| Screen time: tracked days only, a single untracked day Unknown | Dashboard, Screen time | `test/view-r2.test.mjs`, `test/r2-render-more.test.mjs`, `scripts/view-activity.test.mjs`, `scripts/activity-*.test.mjs` |
| Model drift: model settings and their differences across computers | Dashboard, Drift | `test/r2-render-more.test.mjs`, `test/drift.test.mjs`, `test/repo-rules.test.mjs` (wording) |
| Settings: each computer's sources and roles, read-only | Dashboard, Settings | `test/r2-render-more.test.mjs`, `test/combine.test.mjs` (the settings echo) |
| An Unknown sum shows the part that was read ("at least $642, 1 day not read on Tower") | Headline numbers and breakdown totals | `test/view-r2.test.mjs`, `test/r2-render.test.mjs` |
| Every time names its day ("Wed 8:18 AM"), the header read time and device chips included | Every dashboard view | `test/r2-render.test.mjs`, `test/view-r2.test.mjs`, `test/forecast-contract.test.mjs` |
| Ask field and pinned questions | Dashboard, the Ask row | `test/r2-ask.test.mjs`, `test/r2-render.test.mjs` |
| Block catalog: every view is a checked json-render spec | Every dashboard view | `test/r2-catalog.test.mjs`, `test/r2-render.test.mjs`, `test/r2-contract.test.mjs` |
| Saved views composed through the optional MCP server, checked by the catalog and drawn by the dashboard | Your own Claude client, see `docs/MCP.md`, then the pinned list | `scripts/mcp-server.test.mjs`, `test/saved-views.test.mjs`, `test/server.test.mjs` (`/local/views.json`), `test/r2-render.test.mjs` |
| Daily ledger history per computer, trimmed to its size budget with day totals kept | Collected on its own, drawn by every view | `test/ledger-history.test.mjs`, `test/ledger-store.test.mjs`, `scripts/snapshot-size.test.mjs`, `test/combine.test.mjs` |
| Fonts bundled, nothing loaded from the network | Every dashboard view | `test/r2-render.test.mjs`, `test/server.test.mjs` |
| API price estimates | Spend and Tokens dollar figures | `scripts/api-estimate.test.mjs`, `scripts/price-table.test.mjs`, `scripts/provider-token-sources.test.mjs` |
| Collection every five minutes | Runs on its own, or `npm run tick` | `test/collect.test.mjs`, `test/run-lock.test.mjs`, `test/cycle-processes.test.mjs` |
| Claude limits | Limits view and panel | `scripts/claude-limits.test.mjs`, `scripts/claude-usage-command.test.mjs` |
| A plan that changes in the middle of a reset period: the new reading is shown, and the fall is not counted as use | Limits view, forecast and panel | `scripts/claude-limits.test.mjs`, `test/forecast.test.mjs` |
| Codex limits and pace | Limits view and panel | `scripts/read-quota.test.mjs`, `scripts/collect-quota.test.mjs`, `scripts/quota-*.test.mjs` |
| Claude Code tokens | Tokens view | `scripts/read-claude-usage-node.test.mjs`, `scripts/token-hours.test.mjs` |
| Codex tokens, settings and tool calls | Tokens and Drift views | `scripts/read-settings-node.test.mjs` |
| Screen time from ActivityWatch on a Mac | Screen time view | none for the reader in `scripts/mac-activity.mjs` |
| Screen time from ActivityWatch on Windows | Screen time view | `scripts/windows-aggregate-activity.test.mjs` (Windows only) |
| Sources on or off | `sources` in `observatory.config.json` | `test/collect.test.mjs`, `test/config.test.mjs` |
| Off engines (signed out, free plan, no reading for a day, `engines` setting); Claude signed out reads Sign in on the icon | Dashboard Limits, menu bar and tray | `test/forecast.test.mjs`, `scripts/quota-history.test.mjs`, `test/collect.test.mjs`, `test/combine.test.mjs` (a computer that is up and signed out beats an off computer's old reading) |
| Sign in to Claude from the panel, certificate file passed to every claude process, `npm run doctor` | Menu bar and tray panel, dashboard Limits, setup | `test/claude-sign-in.test.mjs`, `test/combine.test.mjs` |
| Grok engine from local files (`sources.grokLimits`, `grok.appFolder`, `grok.requestLog`) | Dashboard Limits, menu bar and tray | `scripts/grok-usage.test.mjs`, `test/forecast.test.mjs` |
| `dashboard.port`, `dataFolder`, `codexPath` | `observatory.config.json` | `test/config.test.mjs` (parsing only) |
| WSL logs counted on the PC | `"wsl": true` | `test/token-roots.test.mjs` |
| Several computers over SSH | `hub.spokes`, see `docs/SEVERAL-COMPUTERS.md` | `test/hub.test.mjs`, `test/combine.test.mjs`, `test/unknown-not-zero.test.mjs` |
| A computer turned off in the settings (`"off": true` on its `hub.spokes` entry) reads Off on every surface, not the time of its last reading | Dashboard, menu bar, tray and `npm run status -- --json` | `test/hub.test.mjs`, `test/forecast-contract.test.mjs` |
| A computer whose `offSwitch` file says off reads "Off (since <date>)" on the Drift view and is left out of its counts and comparisons | Dashboard | `test/hub.test.mjs`, `test/r2-render-more.test.mjs` |
| The setup table reads Claude Code model, effort and speed from replies, and Codex's from its logs. A source that is off reads off, not Unknown | Dashboard | `test/drift.test.mjs`, `test/r2-render-more.test.mjs` |
| After each hub run a self-check lists metrics that read Unknown or late on a computer that is on, and files one ticket per computer and metric in a Markdown queue when `selfCheck.tickets` is set | `npm run tick` | `test/self-check.test.mjs` |
| With `archive.folder` set, every reading is appended for good as JSON Lines, one file per computer and day | `npm run tick` | `test/raw-archive.test.mjs` |
| Daily token history kept for good | Tokens, All | `test/history.test.mjs`, `test/history-two-computers.test.mjs`, `scripts/view-activity.test.mjs` |
| Older limit history imported | `scripts/import-history.mjs` | `test/limit-history.test.mjs` |
| Check that a computer matches the Mac (read-only) | `node scripts/harness/parity-check.mjs` | `test/parity-check.test.mjs` |
| Unknown, never zero, and no private text kept | Every view | `test/unknown-not-zero.test.mjs`, `scripts/snapshot-clean.test.mjs`, `scripts/snapshot-size.test.mjs` |
| Agent status | `npm run status`, `--json`, `--wait`, `--timeout` | `test/agent-status.test.mjs` |
| Fictional demo and preview | `npm run preview`, `npm run demo` | `scripts/demo.test.mjs`, `scripts/sample-snapshot.test.mjs`, `test/project-tokens.test.mjs` |
| Shared wording | Every page | `scripts/strings.test.mjs`, `test/repo-rules.test.mjs` |

## Human-owned

None yet.
