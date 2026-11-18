# Round 2 plan

Round 2 rebuilds the dashboard around one scope bar and seven views: Overview, Sessions, Limits, Tokens, Screen time, Drift and Settings. Every screen is composed from a small set of blocks, so a question can rearrange blocks instead of needing a new page. The dashboard stays monitor-only and read-only.

This file records the data model, the contract modules and how the work splits into lanes. The contract modules hold types and signatures only. Each lane fills in its own files.

## What is missing today

The ledger (`lib/ledger-shape.mjs`, `scripts/ledger.mjs`) keeps only the current and previous weekly limit windows. Month, year and all-time views of sessions, spend and shipped work have no data. Token and screen-time totals already keep daily history for good (`scripts/token-store.mjs`, `scripts/activity-history.mjs`, `lib/view-history.mjs`), so those views only need the new scope.

## Data model

### Scope

`lib/scope.mjs` defines the scope every view follows:

- `devices`: the selected computers, by host key (`Mac`, `Windows`, `Linux`). The chips show each computer's device name and its state: live, stale since a time, or not set up.
- `range`: a unit (`day`, `week`, `month`, `year`, `all`) and an anchor date. Periods are calendar spans in the snapshot's time zone, stepped as dates. Weeks start on Monday. Back and forward arrows step one unit and are disabled past today or before the first recorded date.
- `sources`: `claude`, `codex` and `grok`. A source is shown only when a computer's settings file turns it on and it has data in the period. Otherwise it is hidden on every view.

A headline compares the current period with the previous one cut to the same number of days, so a Wednesday is compared with the previous Monday to Wednesday. A previous period with no recorded day reads "no earlier data", never a percentage.

The scope lives in the URL search text, so a view can be bookmarked and the back button works.

### Ledger history

`lib/r2-shape.mjs` defines one `LedgerDay` per computer, tool and date:

- Totals: API-equivalent spend, session count, subagents, tokens.
- Breakdowns: spend by model, by work kind, by how sessions ran (headless or interactive) and by repository.
- Shipped work: commits, commits on main and branches merged, in total and per repository.
- Sessions: the 30 largest sessions of the day, each with its hashed id, the tool's title (only while `sessions.titles` is true), how it ran, the kind of its first prompt, its repository folder, its models, its work kinds and its commits per repository. The rest are summed, with a compact row each (id, spend, commits, commits on main), so "spend with no commits" stays exact over any range.

The role of a session is not stored. `lib/roles.mjs` derives it when the session is shown, from the stored inputs, so a better rule also applies to past days.

Where it is kept:

- Each computer keeps the full record in its private folder, in `private-history/ledger.sqlite` beside `tokens.sqlite`, for as long as that folder exists. The store also keeps commit ids, which never enter a snapshot.
- Each snapshot carries a trimmed copy as `ledgerHistory`. Day totals and breakdowns stay for good. Session rows stay for 92 days. The hub passes each computer's copy through as it is, as it does the ledger row.
- The hub also echoes each computer's settings into `view.config`, without paths, SSH aliases, data folders or program locations. The Settings view and the source filter read it.

How days change: a branch merged on Friday turns Monday's commits into commits on main. Each collection rebuilds the last 14 days from transcripts and git. Older days are frozen, except that commits on main are checked again for 92 days from the stored commit ids. The first collection backfills every day the transcripts still hold. Claude Code deletes transcripts after 30 days by default, so history before that is not recoverable.

Size: each computer's `ledgerHistory` must fit in 1.5 MB. When it does not, `fitLedgerHistory` drops, in order, session rows from the oldest day down to 35 days, then the compact rows, then the per-day breakdowns, oldest first. Day totals and shipped counts are the last to go. `combined.json` holds each computer twice, so three computers stay under `snapshotMaximumBytes` with the activity history beside them. Lane a measures this with a year of fixture data.

### Rules every number follows

These are the existing rules in `AGENTS.md`, applied to the new views:

- Unknown is null and reads "Unknown". It is never shown as zero.
- A day a computer could not read is Unknown, and so is any total that includes it. A computer with no records for the period, or with the source turned off, adds nothing.
- A sum across computers of spend, tokens, screen time or commits is labeled "not deduplicated" and is shown next to its per-device parts. Sessions are per computer, so spend is not counted twice in practice, but a repository cloned on two computers can count a commit twice.
- Account limits are never summed across computers. The Limits view shows each limit once, with the computer it was read on.
- Grok requests are never added to dollars or tokens. The models-and-agents breakdown shows Grok in requests and each Claude or Codex model in dollars and tokens, with no total row.
- Every number carries its breakdowns (`METRIC_DIMS` in `lib/r2-blocks.mjs`), so the page can open the split by device, role, session, repository, model or work kind in place.

### Headline metrics

| Metric | Definition |
| --- | --- |
| Spend | API-equivalent dollars, as `scripts/api-estimate.mjs` prices them. |
| Branches merged | Merged branches, a merge commit and the branch it brought in counting once. |
| Commits on main | Commits other than merges that reach the default branch, out of all such commits. |
| Not yet on main | Commits minus commits on main. Recent commits may still land. |
| Cost per landed change | Spend divided by commits on main. Unknown when there are none. |
| Spend with no commits | Spend by sessions that made no commit anywhere in the period. |

All shipped figures are estimates: a commit counts for the session that last wrote in that repository within 20 minutes before it.

### Roles

`lib/roles.mjs` gives each session a role from a small fixed set: Chief of staff, Builder, Reviewer, Designer, Researcher, Runner, Sweeper and Ops. It looks, in order, at a `Role:` prefix in the title, a short list of generic title starts (such as "Orchestrator" or "Chief"), the user's own `sessions.roles` map in the settings file, how the session ran (a headless review or test run is Reviewer, any other headless run is Runner), and the kind of work it did (build is Builder, review and test are Reviewer, design is Designer, research and search are Researcher). The Sessions table shows "[Builder] Lantern", with the role as a tag the table can group by. Headless runs of one role and repository fold into one row, and sessions under 1% of the period's spend fold into a "Smaller sessions" row per role. Personal naming habits belong in the user's settings file, not in the code.

## Generative UI

Every screen is a [json-render](https://github.com/vercel-labs/json-render) spec over one Observatory block catalog. Built-in views and composed views share one renderer.

- Packages: `@json-render/core` and `@json-render/react`, pinned to exactly 0.22.0 (Apache-2.0, published 2026-11-04, peer `react ^19.2.3`), and `zod` pinned to 4.6.7, which json-render requires.
- Blocks (`lib/r2-blocks.mjs`): Section, Headline, SpendLandedChart, SessionsTable, Breakdown, LimitMeter, GrokRequests, Timeline and Flags. Section is the one container.
- Props are queries, never data. A block names a metric, a breakdown and an optional scope patch, and its component asks `resolveBlock` in `lib/view-r2.mjs` for the numbers when it draws. A saved spec therefore holds no usage data.
- `lib/r2-catalog.mjs` builds the zod catalog with `defineCatalog` and checks specs with `validateSpec` plus the limits in `SPEC_LIMITS`.
- `lib/r2-specs.mjs` holds the built-in specs: one per view and one per pinned question, such as "Where did today's spend go?" and "What did Builders ship this month?".

Who composes a screen, with no model call inside the dashboard:

1. Built-in specs, and a local rules matcher for the Ask field (`answerQuestion`). Words in the question pick a pinned question or fill a rule's slots (metric, breakdown, role, range, device, source).
2. An optional stdio MCP server, `scripts/mcp-server.mjs`, that the user adds to their own Claude client. It offers read-only query tools over the latest `combined.json` and a `compose_view` tool that checks a spec against the catalog and saves it to the data folder. The dashboard lists and draws saved views. The server never starts, stops or answers an agent, and writes only saved views.

`@ui-sdk/*` is a later option. It is in beta and too new to pin today.

## Settings

The Settings view is a read-only display of each computer's settings echo. The dashboard server answers GET and HEAD only, and no safe local mechanism to change settings exists today: `npm run setup` has no source options, and the server must not become a command API. The view says to edit `observatory.config.json` on that computer, and the next collection uses it.

## Backups

A backup of Observatory history into another agent's workspace was considered and is rejected for now: history is usage data and stays on the user's computers. The future option is an opt-in backup to a private Git repository the user owns, off by default, behind a new setting. It is design only and is not part of round 2.

## Lanes

Each lane works in its own worktree off `claude/observatory-r2` and touches only the files listed. Every lane runs the full suite before it hands back. Lane b lands its dependency commit first, because lanes c, d and f import its packages.

### Lane a: collector

- Files: `scripts/ledger-history.mjs` (new: builds `LedgerDay` records from the source adapters and the commit join), `scripts/ledger-store.mjs` (new: the private SQLite store, rebuild and recheck windows, backfill), `scripts/collect.mjs` (writes `ledgerHistory` and the settings echo), `lib/r2-shape.mjs` (bodies of `cleanLedgerHistory` and `fitLedgerHistory`, no type changes without the architect), `scripts/snapshot-clean.mjs`, `lib/combine.mjs` (`ownRows` passes `ledgerHistory` and the echo through, `view.ledgerHistory` and `view.config`), `scripts/snapshot-size.mjs` (calls `fitLedgerHistory`), `lib/config.mjs` (optional `sessions.roles` and the echo function), `observatory.config.example.json`.
- Tests: `test/ledger-history.test.mjs`, `test/ledger-store.test.mjs` (new), plus cases in `test/combine.test.mjs`, `test/unknown-not-zero.test.mjs`, `test/config.test.mjs`, `scripts/snapshot-clean.test.mjs` and `scripts/snapshot-size.test.mjs`. Synthetic transcripts only (`test/synthetic-sessions.mjs`, `test/ledger-fixtures.mjs`).
- Done when: a collection over synthetic transcripts writes a `ledgerHistory` row that `cleanLedgerHistory` accepts. A merge made after the rebuild window turns old commits into commits on main. Titles are null with `sessions.titles` false. A hub with three computers and a year of fixture history writes `combined.json` under `snapshotMaximumBytes`. No path, prompt or commit id appears in any snapshot. The full suite passes.

### Lane b: view-models

- Files: `lib/scope.mjs`, `lib/view-r2.mjs`, `lib/roles.mjs`, `lib/r2-catalog.mjs` (new), `lib/r2-specs.mjs` (new), `lib/sample-r2.mjs`, `lib/strings.json` and `lib/strings.generated.ts` (a new `r2` group only), `package.json` and `package-lock.json` (the three pinned packages, in a first commit of its own).
- Tests: `test/scope.test.mjs` (every unit, stepping across month and year ends and a daylight saving change, the comparison cut), `test/roles.test.mjs`, `test/view-r2.test.mjs` (each builder against `sampleR2Combined`: Unknown days, a computer that starts later, the "not deduplicated" label, limits never summed, Grok never added to dollars), `test/r2-catalog.test.mjs` (every built-in spec validates, oversize and unknown blocks are refused), `test/r2-ask.test.mjs`. The stub checks in `test/r2-contract.test.mjs` are replaced.
- Done when: every builder returns its documented shape for every range unit on the fixture, every number has the breakdowns `METRIC_DIMS` names, and the full suite passes.

### Lane c: UI shell, Overview and Sessions

- Files: `app/viewer/r2/` (new): `App.tsx`, `ScopeBar.tsx`, `Nav.tsx`, `registry.tsx`, `blocks/Section.tsx`, `blocks/Headline.tsx`, `blocks/SpendLandedChart.tsx`, `blocks/SessionsTable.tsx`, `blocks/Breakdown.tsx`, `blocks/Timeline.tsx`, `blocks/Flags.tsx`, `views/Overview.tsx`, `views/Sessions.tsx`, `AskField.tsx`, `r2.css`. Also `app/viewer/dashboard.tsx` (switch the entry) and `blocks/more.tsx` as a one-line placeholder that lane d replaces.
- Tests: `test/r2-render.test.mjs` (server-side render of each built-in spec against the fixture, including Unknown values, a stale computer chip and an empty period).
- Done when: Overview and Sessions render from the fixture through the json-render renderer, the scope bar steps and filters, every headline opens its breakdown, the layout holds at 390, 900 and 1440 pixels wide, and the full suite and `vite build` pass.

### Lane d: Limits, Tokens, Screen time, Drift and Settings

- Files: `app/viewer/r2/views/Limits.tsx`, `Tokens.tsx`, `ScreenTime.tsx`, `Drift.tsx`, `Settings.tsx`, `app/viewer/r2/blocks/LimitMeter.tsx`, `GrokRequests.tsx`, `more.tsx`, and their CSS. It reuses the existing chart components in `app/viewer/components/`.
- Tests: `test/r2-render-more.test.mjs` (new, separate from lane c's file to avoid conflicts).
- Done when: each view renders from the fixture for every range unit, limits show once with the computer they were read on, Grok shows requests per day and its weekly limit, Settings shows each computer's sources with no control that changes them, and the full suite and `vite build` pass.

### Lane e: documentation and screenshots

- Files: `README.md`, `docs/FEATURE-MAP.md`, `docs/R2-PLAN.md` (status only), `docs/images/`, `CHANGELOG.md`, `scripts/demo.mjs` and `scripts/preview.mjs` (serve the round 2 fixture).
- Tests: `scripts/demo.test.mjs` (the demo build holds no private value), `test/repo-rules.test.mjs`.
- Done when: the feature map lists every round 2 view with its tests, the screenshots come from the fictional fixture, and the docs make no claim that has not been checked. Starts after lanes c and d.

### Lane f: MCP server (optional)

- Files: `scripts/mcp-server.mjs` (new: stdio JSON-RPC, read-only query tools, `get_catalog`, `compose_view`, `list_views`, `remove_view`), `lib/saved-views.mjs` (new: read, check and write saved views in `<dataFolder>/public/local/views/`), `serve-local.mjs` (one new GET route, `/local/views.json`, that returns the checked saved views), `docs/MCP.md` (new).
- Tests: `scripts/mcp-server.test.mjs`, `test/saved-views.test.mjs`, a case in `test/server.test.mjs` for the new route and that every other method is still refused.
- Done when: a spec that fails the catalog, exceeds `SPEC_LIMITS` or names an unknown block is refused. A saved view holds no number or session title. The server never writes outside the views folder. The dashboard lists saved views. The full suite passes.

### Order

1. Lane b's dependency commit.
2. Lanes a, b and f in parallel. Lanes c and d start against the fixture and the stubbed signatures and rebase onto lane b as it lands.
3. Lanes c and d.
4. Lane e.

Builds and tests run one at a time on the build computer.
