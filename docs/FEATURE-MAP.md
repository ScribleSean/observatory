# Feature map

What a user can do, how they reach it, and what checks it today. Test files are under `test/` and `scripts/`. Tests marked Mac or Windows skip on Linux.

| Feature | How a user reaches it | Checked by |
| --- | --- | --- |
| Install, start now and at login | `npm run setup` | `test/setup.test.mjs` (Mac and Windows parts skip on Linux) |
| Preview setup | `npm run setup -- --dry-run` | `test/setup.test.mjs` (skips on Linux) |
| Uninstall | `npm run setup -- --remove` | none |
| Menu bar panel (Mac) | Click the telescope | `test/glance-limits.test.mjs` and `test/repo-rules.test.mjs` for shared rules and wording, rendering none |
| Tray panel (Windows) | Click the tray icon | `test/windows-dpi.test.mjs` (source text only), rendering none |
| Open dashboard, Refresh, Quit | Panel footer and tray menu | `test/server-lifetime.test.mjs` (server stops with the app), Refresh none |
| Dashboard server on 127.0.0.1, GET and HEAD only | http://127.0.0.1:5601 | `test/server.test.mjs`, `test/server-lifetime.test.mjs`, `scripts/request-policy.test.mjs` |
| Forecast: when each engine runs out, with a range once there is history, and the scarcer engine in the menu bar | Dashboard home, menu bar and tray | `test/forecast.test.mjs`, `test/forecast-backtest.test.mjs` (accuracy on made-up readings), `test/dashboard-render.test.mjs`, `test/repo-rules.test.mjs` (panel wording) |
| Limit history charts | Dashboard, History, Limits | `scripts/view-limits.test.mjs`, `scripts/limits-view.test.mjs`, `test/limit-history*.test.mjs`, `test/dashboard-render.test.mjs` |
| Screen time page | Dashboard, History, Screen time | `scripts/view-activity.test.mjs`, `scripts/activity-*.test.mjs`, `test/dashboard-render.test.mjs` |
| Tokens page and today by project | Dashboard, History, Tokens | `scripts/view-tokens.test.mjs`, `scripts/tokens-view-render.test.mjs`, `test/project-tokens.test.mjs` |
| Model drift: thinking, time, tokens and retries per Claude model and day, against that model's normal | Dashboard, History, Drift | `test/drift.test.mjs`, `test/repo-rules.test.mjs` (wording) |
| API price estimates | Tokens page dollar figures | `scripts/api-estimate.test.mjs`, `scripts/price-table.test.mjs`, `scripts/provider-token-sources.test.mjs` |
| Switching computer, period, date or range | Dashboard controls | none (views are only rendered with their first props) |
| Collection every five minutes | Runs on its own, or `npm run tick` | `test/collect.test.mjs`, `test/run-lock.test.mjs`, `test/cycle-processes.test.mjs` |
| Claude limits | Limits page and panel | `scripts/claude-limits.test.mjs`, `scripts/claude-usage-command.test.mjs` |
| Codex limits and pace | Limits page and panel | `scripts/read-quota.test.mjs`, `scripts/collect-quota.test.mjs`, `scripts/quota-*.test.mjs` |
| Claude Code tokens | Tokens page | `scripts/read-claude-usage-node.test.mjs`, `scripts/token-hours.test.mjs` |
| Codex tokens, settings and tool calls | Tokens page | `scripts/read-settings-node.test.mjs` |
| Screen time from ActivityWatch on a Mac | Activity page | none for the reader in `scripts/mac-activity.mjs` |
| Screen time from ActivityWatch on Windows | Activity page | `scripts/windows-aggregate-activity.test.mjs` (Windows only) |
| Sources on or off | `sources` in `observatory.config.json` | `test/collect.test.mjs`, `test/config.test.mjs` |
| Off engines (signed out, free plan, no reading for a day, `engines` setting) | Dashboard home, menu bar and tray | `test/forecast.test.mjs`, `scripts/quota-history.test.mjs`, `test/collect.test.mjs` |
| Grok engine from local files (`sources.grokLimits`, `grok.appFolder`, `grok.requestLog`) | Dashboard home, menu bar and tray | `scripts/grok-usage.test.mjs`, `test/forecast.test.mjs` |
| `dashboard.port`, `dataFolder`, `codexPath` | `observatory.config.json` | `test/config.test.mjs` (parsing only) |
| WSL logs counted on the PC | `"wsl": true` | `test/token-roots.test.mjs` |
| Two computers over SSH | `hub.spokes`, see `docs/TWO-COMPUTERS.md` | `test/hub.test.mjs`, `test/combine.test.mjs`, `test/unknown-not-zero.test.mjs` |
| Daily history kept for good, Both totals | Activity and Tokens, All and Both | `test/history.test.mjs`, `test/history-two-computers.test.mjs`, `scripts/view-activity.test.mjs`, `scripts/view-tokens.test.mjs` |
| Older limit history imported | `scripts/import-history.mjs` | `test/limit-history.test.mjs` |
| Check that a computer matches the Mac (read-only) | `node scripts/harness/parity-check.mjs` | `test/parity-check.test.mjs` |
| Unknown, never zero, and no private text kept | Every view | `test/unknown-not-zero.test.mjs`, `scripts/snapshot-clean.test.mjs`, `scripts/snapshot-size.test.mjs` |
| Agent status | `npm run status`, `--json`, `--wait`, `--timeout` | `test/agent-status.test.mjs` |
| Fictional demo and preview | `npm run preview`, `npm run demo` | `scripts/demo.test.mjs`, `scripts/sample-snapshot.test.mjs`, `test/project-tokens.test.mjs` |
| Skin and shared wording | Every page | `scripts/skins.test.mjs`, `scripts/strings.test.mjs` |

## Human-owned

None yet.
