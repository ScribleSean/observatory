# Feature map

What a person can do with Observatory, how they reach it, and what checks it today. Updated on 2026-10-22 during a test review. "None" means no automated check exists.

## Install and run

| Feature | How a person reaches it | Checked by |
| --- | --- | --- |
| Set up on one computer | `npm run setup` | `test/setup.test.mjs` (paths, login item files, dry run, settings file), `test/config.test.mjs` |
| Preview what setup would do | `npm run setup -- --dry-run` | `test/setup.test.mjs` |
| Remove the app and login item | `npm run setup -- --remove` | None |
| Start at login without starting now, for remote sessions | `npm run setup -- --no-start` | None |
| Import limit history kept by earlier versions | Runs inside `npm run setup`, or `node scripts/import-history.mjs` | `test/limit-history.test.mjs` |
| Note about a leftover Claude Code status line | Printed by setup | `test/setup.test.mjs` |
| Older settings file with `agents` still loads | Any setup or collection | `test/config.test.mjs` |

## Collection

| Feature | How a person reaches it | Checked by |
| --- | --- | --- |
| One collection every five minutes | Menu bar or tray app, or `npm run tick` | `test/collect.test.mjs`, `test/run-lock.test.mjs` |
| Claude Code limits from the CLI usage command | `sources.claudeLimits` | `scripts/claude-limits.test.mjs`, `scripts/claude-usage-command.test.mjs` |
| Codex limits | `sources.codexLimits` | `scripts/collect-quota.test.mjs`, `scripts/read-quota.test.mjs`, `scripts/quota-*.test.mjs`, `scripts/windows-quota.test.mjs` |
| Claude Code tokens | `sources.claudeCode` | `scripts/read-claude-usage-node.test.mjs`, `scripts/provider-token-sources.test.mjs` |
| Codex tokens and settings | `sources.codex` | `scripts/read-settings-node.test.mjs` |
| Screen time from ActivityWatch | `sources.screenTime` | `scripts/activity-*.test.mjs`, `scripts/windows-aggregate-activity.test.mjs` |
| Limit history kept per computer | Every collection | `test/limit-history.test.mjs` |
| API-equivalent cost | Tokens and the price table | `scripts/api-estimate.test.mjs`, `scripts/price-table.test.mjs` |
| No prompts, paths, names or keys in saved data | Every collection | `scripts/snapshot-clean.test.mjs`, reader tests that plant private text |

## Two computers

| Feature | How a person reaches it | Checked by |
| --- | --- | --- |
| Hub pulls the other computer over SSH and writes back | `hub.spokes` in the settings file | `test/hub.test.mjs` (fake transport) |
| Combine both snapshots, sums labelled "not deduplicated", limits never summed | Every hub collection | `test/combine.test.mjs`, `test/unknown-not-zero.test.mjs` |
| Pulled data cleaned the same way as local data | Every hub collection | `test/combine.test.mjs`, `test/limit-history.test.mjs` |
| Real SSH to a second computer | `ssh` alias in the settings file | None (live only) |

## Menu bar and tray

| Feature | How a person reaches it | Checked by |
| --- | --- | --- |
| Telescope icon in the menu bar, dimmed when no current reading | Mac menu bar | None (live only) |
| Panel with limits scarcest first, one line per computer, Open dashboard, Refresh, Quit | Click the menu bar item | `--render` draws it from a `combined.json` for screenshots. No automated test |
| Windows tray telescope icon. Left click opens the same panel as the Mac, right click a short menu | Windows tray | `--render` draws the panel from a `combined.json`. No automated test |
| One app icon from the telescope: Mac bundle icon, Windows exe icon and Start menu entry | Finder, Windows search | `test/setup.test.mjs` (bundle icon, Info.plist, shortcut command). Icons are drawn by `glance/icons/make-icons.swift` |

## Dashboard

| Feature | How a person reaches it | Checked by |
| --- | --- | --- |
| Served on 127.0.0.1 only, read-only, stops with the app | Open dashboard | `test/server.test.mjs`, `test/server-lifetime.test.mjs`, `scripts/request-policy.test.mjs` |
| Loading and first-run message | Opening before the first collection | `test/dashboard-render.test.mjs` |
| Overview tiles: limits, screen time today, cost today | Top of every page | `test/dashboard-render.test.mjs`, `test/unknown-not-zero.test.mjs` |
| Limits page: each window, pace, run-out estimate, reading origin | Limits tab | `scripts/limits-view.test.mjs`, `scripts/view-limits.test.mjs`, `scripts/quota-pace.test.mjs` |
| Limit history charts: ranges, one line per computer, gaps, resets | Limits tab | `test/limit-history-view.test.mjs`, `scripts/limits-view.test.mjs` |
| Chart hover, keyboard steps and legend toggles | Limits tab | None |
| Activity page by day, week, month, per computer | Activity tab | `scripts/view-activity.test.mjs`, `scripts/activity-view.test.mjs` |
| Tokens page by provider, model and computer | Tokens tab | `scripts/view-tokens.test.mjs`, `scripts/tokens-view-render.test.mjs` |
| Sources page with read status and refusals | Sources tab | `scripts/view-sources.test.mjs`, `test/dashboard-render.test.mjs` |
| Light and dark appearance, skin | System appearance | `scripts/skins.test.mjs` |
| Layout from a phone to a wide screen | Any width | None (checked by hand in a browser) |

## Human-owned

No tests are marked as owned by Sean yet.
