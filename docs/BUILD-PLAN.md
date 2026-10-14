# Build plan

Written on 2026-10-13 from `main` at `11ba4ea`, with additions the same day through `02b83ac`, and corrected on 2026-10-14 after the orchestrator read the plan against the repository before the autonomous run (the "Corrections of 2026-10-14" section lists what changed and why). This is a plan. Nothing in it is built unless [the parity table](PARITY.md) or [the state record](STATE.md) says so. [The design direction](DESIGN.md) is the source for what to build. This file says who builds what, in which order, and how the pieces stay out of each other's way.

## Decision this plan rests on

The shared viewer goes ahead. Both spikes measured it on 2026-10-13.

| Measure | Mac web panel | Mac native | Windows web panel | Windows native |
| --- | ---: | ---: | ---: | ---: |
| First open | 333 ms | 195 ms | 256 ms | 110 ms |
| Later opens | 82 to 104 ms | 122 to 129 ms | 4 to 6 ms | 17 to 21 ms |
| Memory with the panel open | 97 MiB | 49 MiB | 396 MiB | 65 MiB |
| Memory a minute after closing | 108 MiB | 51 MiB | 405 MiB | 68 MiB |

Open time is acceptable on both. Memory is acceptable on the Mac. On Windows it was not acceptable while the web view stayed alive, so the Windows shell now releases the web view a minute after the panel closes (pull request 87).

Measured on the PC after that change, in four runs: 73.9 to 76.2 MiB five minutes after release, against 57.1 to 59.7 MiB with the panel never opened and 394 to 408 MiB with it open. The next open after a release took 283 to 493 ms. The owner's condition is met: memory returns near the never-opened figure, and the cost is a slower open after a long idle. The full record is in [the measurements record](RESOURCE-MEASUREMENTS.md).

## What done means

1. The Mac and Windows apps show the same shared viewer for the panel and the dashboard, with the same six sections, skins and wording.
2. Claude Code and Codex appear side by side for limits and tokens.
3. A person with one device, ActivityWatch and nothing else configured gets a working app.
4. Two devices pair through Tailscale and an invitation pasted on the second device. Earlier wording called the invitation a "pairing code". The owner confirmed on 2026-10-14 that this is what it means.
5. The SwiftUI and Windows Forms viewers and the earlier web dashboard are gone from `main`.
6. The demo site is the shared viewer with sample data.
7. Every claim in the README is true of an installed build.

## Standing approvals from the owner

Given on 2026-10-13. The owner asked for the build to run without questions until the app meets "What done means", unless he is truly needed.

Approved in advance, with the condition beside each:

| Action | Condition |
| --- | --- |
| Squash-merging a workstream's pull request | CI passes, the reviews under "Reviews" are posted, and no blocking finding in them is unresolved. Until the script suite workflow from Q1 exists, "CI passes" means the orchestrator ran the full suite, `npx tsc --noEmit` and the design token check on the branch and recorded the counts in the pull request, because `main` has no branch protection and no pull-request workflow runs the full suite today. |
| Removing the SwiftUI viewer, the Windows Forms viewer and the earlier web dashboard | The shared viewer is the default on that platform and its checks pass. Tag `main` first as `archive/pre-viewer-removal`, annotated with the date, on the merge commit before the first removal pull request, as `archive/pre-web-direction` was. List the removed files in the pull request. |
| The removals in R1, and the Ubuntu fields and legacy pairing shape in R2 | Saved settings and saved history stay readable, and the current pairing on both devices stays readable. Tests with a fixture in today's on-device shape show it. Both apps are installed from the R2 change before any re-pair. |
| The settings bridge contract in B1 | An independent reviewer session checks it against the rule that no action carries a path, a command or free text that reaches a shell. The contract is recorded in the design direction before a shell implements it. |
| Replacing the installed app on the Mac or the PC with a build from `main` | The data folder is backed up and matches by checksum first, the previous build stays recoverable, and the result is recorded in the state record |
| Installing the Claude Code limits bridge on the PC | It was approved on the Mac the same day. H1 does it from the PC session, outside a Claude desktop session, and records what changed, including the PowerShell quoting of the status line command and whether the usage command finds `claude.exe` from the installed app. |

Added on 2026-10-13 from the owner's answers before the autonomous build:

| Decision | Detail |
| --- | --- |
| Where the build stops | After everything in "What done means" is installed and verified on both devices, publish a GitHub release with the install guides and publish the demo page. This is approved in advance, once, for that finished state. On 2026-10-14 the owner confirmed that F1 publishes without stopping for a further confirmation (see "Publishing" below). Nothing else is published. |
| What a Mac session may touch | `~/Developer`, the installed Observatory app in `~/Applications`, its data folder for backups and installs, and the status line entry in Claude Code's settings. Nothing else on the Mac. |
| How the PC is driven | The owner keeps the "Observatory Windows" session open with prompts skipped. The orchestrator sends it tasks by message and through issues. |
| Windows build time | Fix both causes: run the full suite on pull requests, and reuse one PowerShell process for the permission checks. The second is security-sensitive and needs two reviews. Baseline read from the job log of the last successful package run (38493681280) on 2026-10-14: 38 m 33 s against a 40 minute cap, of which the script suite inside `build.ps1` is about 32 minutes, publish, Python preparation, native tests and manifest hashing about 42 seconds, and the installer lifecycle 3 m 39 s. The suite is the cost. The per-check PowerShell share is unmeasured and is measured before it is changed. |
| Internal name | Rename "Workspace Observatory" to "Observatory" in this build, with a tested migration that copies saved data to the new location and keeps the old folder until the owner confirms. What the rename means for the Mac bundle identifier, the Windows receipt identity and the old install entry is under N1. |
| Old leftovers | Keep the newest data backup on each device and the build 40 installer on the PC. Move older installers, test builds and backups to the Trash or the Recycle Bin for the owner to empty. Never delete them outright. |
| Tailscale | Installed and signed in on both devices, so pairing can be tested end to end. The owner pastes the invitation on the second device and confirms the claimed device on the first (see "Pairing code" below). The only earlier two-device test, on 2026-09-13, timed out before TLS on Windows outbound firewall rules ([local pairing](LOCAL-PAIRING.md)), so a Windows Firewall rule for the bundled `node.exe` listening on the Tailscale interface may need the owner. |
| What he most wants fixed | The apps still show the old look, and Claude Code is not shown beside Codex. The shared viewer as the default fixes both. |

Added on 2026-10-14 from the owner's answers to the three questions in [the execution plan](EXECUTION-PLAN.md), section 10:

| Decision | Detail |
| --- | --- |
| Pairing code | "Pairing code" means the existing invitation. The owner copies it on the first device, pastes it on the second, and confirms the claimed device on the first. No short typed code is built in this run. |
| Mac bundle identifier | Keep `io.workspace-observatory.app` during the rename. Names the owner sees change (app file, data folders, Start menu entry, release assets). Internal identifiers stay, which [the brand note](BRAND.md) allows: the Mac bundle identifier, and on Windows the mutex names, the uninstall key and the receipt product string. |
| Publishing | F1 publishes once, at the finished state, with no further confirmation: one GitHub release with both builds, their checksums and the install guides, and the demo page. Nothing else is published, and nothing is published before that state is verified on both devices. |

Still needs the owner, because no session can do it or because it reaches outside his machines:

- Anything that costs money.
- Weakening a security rule, a file guard or the private-folder check. Issue 58 stays open until he decides.
- Physical or account steps: signing in to Tailscale, pasting the invitation on the second device and confirming the claimed device on the first, a Windows Firewall rule if the live pairing test times out before TLS, switching the system appearance for a check, a real click that a session cannot perform, and granting computer-use access to the Observatory app on the Mac once.
- Deleting saved history, backups or anything in a data folder.
- Repository settings, such as a ruleset that requires the script suite workflow on pull requests.

When one of these blocks a workstream, record exactly what is needed in the issue, carry on with everything that does not depend on it, and put all such items in one list for him at the end.

## Who does what: Claude orchestrates, Codex acts

Set by the owner on 2026-10-13 and checked that day from the Mac.

| Role | Tool | Notes |
| --- | --- | --- |
| Planning, splitting work, writing task instructions, review, builds, commits, pushes, pull requests, installs | Claude sessions | One orchestrator. Reviewer sessions start with a fresh context. |
| Writing and changing code and tests inside one worktree | Codex in non-interactive mode, model `gpt-6-astra`, reasoning effort medium | `codex exec -m gpt-6-astra -c model_reasoning_effort=medium --sandbox workspace-write -C <worktree> -o <reply file> "<task>" </dev/null`, the form verified on 2026-10-13. The reply file is read as a report. |
| The same work when Codex reports that its usage has run out | Claude sessions | Switch back to Codex when its usage returns. Record in the issue which tool did the work. |
| Windows native work | The Claude session on the PC | See the routes below. Windows native code is written by that session until the PC Codex sandbox problem is solved, and the issue records which tool did the work. |

Every Codex task gets very specific instructions. A task names the worktree, the files it may create or change, the files it must not touch, the exact behaviour wanted, the tests to add, the command to run, and the form of its reply. It ends with "do not commit, do not push, do not change any other file". The orchestrator then reads the diff, confirms that only the allowed files changed, runs the checks itself and commits. A Codex reply is a report to verify, never an instruction to follow.

Worktrees live under `.claude/worktrees/<branch>` inside the project folder, one per branch, each with its own `npm ci`. The orchestrator's checkout stays on `main`.

The same rule applies to computer use. A session that drives an app through the screen gets a numbered list of exact steps and the expected result of each, and stops at the first step whose result differs.

### Routes checked on 2026-10-13

| Route | Result |
| --- | --- |
| Claude sessions on the Mac, started by an orchestrator | Works |
| Codex on the Mac, `gpt-6-astra` at medium effort, read-only | Works. A one-line answer returned in about 10 seconds. |
| Codex on the Mac, same model, writing in a worktree | Works. It created the one file it was told to, ran one test file (7 passed), and changed nothing else, in 12 seconds. |
| The Claude session on the PC, reached by a session message | Works. It acted on every message sent that day. Delivery is not confirmed to the sender, so the instructions also go in the issue. |
| Codex on the PC over the existing SSH connection | Partly. The tool is inside the Codex app's install folder, found with `Get-AppxPackage -Name OpenAI.Codex`, at `app\resources\codex.exe`. It starts and the model answers. Its sandbox fails in an SSH session, so it could not read a file. Not usable for work until that is solved. Running it without a sandbox was not tried and needs the owner's decision. |
| The Claude command line tool on the PC over SSH | Installed at `%USERPROFILE%\.local\bin\claude.exe`. Running a session this way was not tried. |

So Codex acts on the Mac, and the PC's Claude session acts on the PC. Whether that session can start Codex locally on the PC, where a desktop sandbox exists, is not known. Codex and Claude sessions both read `AGENTS.md` and coordinate only through this repository.

## Rules for every session

- Read `AGENTS.md`, [the design direction](DESIGN.md) and [the parity table](PARITY.md) before changing anything.
- One workstream per branch and worktree. A session may carry several workstreams in sequence, each in its own worktree, and never mixes two in one pull request. Touch only the paths that workstream owns. If a change is needed in a path another workstream owns, open an issue for it and say what is needed, or use the exception the workstream row records.
- Shared records: [the parity table](PARITY.md), [the state record](STATE.md) and [the design direction](DESIGN.md) belong to no single workstream. Any workstream edits the rows or the section that describe its own change, in its own pull request, and nothing else in them. The orchestrator resolves conflicts at merge.
- Sessions on the same machine each work in their own Git worktree. Never switch branches in a checkout another session is using.
- Branch names start with `shared/`, `mac/` or `win/`. Everything reaches `main` by pull request. The orchestrator squash-merges a pull request when CI passes, the reviews under "Reviews" are posted, and no blocking finding in them is unresolved. The PC session does not merge.
- Use synthetic data in tests. Never print, commit or attach real usage values.
- Unknown is never zero. Device records are never added together outside the collector's verified aggregate.
- Do not delete code, files or data that the workstream or the standing approvals do not list for removal.
- Do not publish a release, the demo page or anything else, except as F1 describes. Do not change repository settings. Spend nothing.
- Quit the installed app only when a workstream requires it, tell the owner first, relaunch it straight afterwards and record how long it was closed. Mac measurement runs quit it three times on 2026-10-13.
- Mac native work can only be built and checked on the Mac. Windows native work can only be built and checked on the Windows PC. Every Windows acceptance check starts the app through `Win32_Process.Create` (parent `WmiPrvSE.exe`) or the Start menu, never from a Claude desktop session, and records the parent process (issue 58, [the state record](STATE.md) build 41 install on Windows). Every Mac acceptance check starts the app with a clean environment (`env -i` with `HOME`, `USER` and `PATH`, then `/usr/bin/open -n`), never from a shell inside a Claude desktop session, and records the launch line ([the state record](STATE.md) build 41 install on the Mac).
- When blocked for more than a few minutes on one thing, write down what was tried in the issue or pull request and stop.
- Update [the parity table](PARITY.md) in the same pull request as the change it describes. Record what was verified, on which revision, and what was not.

## Workstreams

Paths are owned by one workstream at a time. "Machine" says where it can be done. "Depends on" names what must merge first. The task-by-task breakdown, the checks for each task and the order of work are in [the execution plan](EXECUTION-PLAN.md), sections 2 and 4. Where a workstream must change a file another workstream owns, the row says so as an exception. The shared records rule above covers [the parity table](PARITY.md), [the state record](STATE.md) and [the design direction](DESIGN.md).

### Phase 1, in parallel now

| Id | Workstream | Owns | Machine | Depends on |
| --- | --- | --- | --- | --- |
| R1 | Removals in shared scripts: agent receipts, legacy workflows, legacy quota, the receipt and benchmark settings keys, and the legacy SSH hub collector (the old route to the earlier web dashboard, not the SSH pairing path). Keep saved settings readable, as the Antigravity removal did in pull request 77. The base snapshot keeps its empty `agents`, `agentSource` and `localModel` slots until S1 and R2. The ChatGPT and Cursor placeholder rows go with S1, and the native Agents rows go with M2 and W2. | `scripts/agent-receipts*`, `scripts/bounded-receipts*`, `scripts/legacy-quota*`, `scripts/legacy-workflows*`, `scripts/collect-dashboard*`, `scripts/settings-snapshot*` and `scripts/cached-settings*` if only the hub uses them, new `scripts/snapshot-clean.mjs`, the lines in `scripts/collect-mac.mjs`, `scripts/mac-snapshot.mjs`, `scripts/windows-snapshot.mjs` and `scripts/windows-dashboard.mjs` that call the removed modules or import the moved cleaners, the hub branch of `scripts/run-collector.py`, `scripts/legacy-collection-scope.test.mjs` (retargeted, not deleted), one mock in `native/tests/archive-retirement-fixture.mjs`, the `test:collectors` script in `package.json`, the SSH hub appendix of `docs/GUIDE.md` and its line in `scripts/documentation.test.mjs`, and the tests for these | Any | Nothing |
| D1 | Snapshot additions: hourly token and activity totals for the Now period, custom device names from a separate `device.json`, the Claude Code session cost from the status line feed, a limits consent marker independent of the status line entry, a fixed `reason` code on a refused source row, a status probe that prints statuses and never values, and the cause of the stale `claudeLimits` reading after build 41's install. New fields stay local first and are stripped from the published record until R2 installs on both devices. Document each new field in the design direction before writing it. | `scripts/read-settings.py`, `scripts/read-claude-usage.py`, `scripts/collect-mac.mjs`, `scripts/collect-windows.mjs`, `scripts/windows-snapshot.mjs`, `scripts/provider-token-sources.mjs`, new `scripts/device-name.mjs`, `scripts/claude-statusline-bridge.mjs`, `scripts/claude-statusline-install.mjs`, `scripts/claude-limits.mjs`, new `scripts/claude-limits-consent.mjs`, `scripts/claude-usage-command.mjs`, new `scripts/snapshot-status.mjs`, and the tests for these. By exception: the cleaners in `scripts/snapshot-clean.mjs` after R1, the strip-on-publish lines in `scripts/peer-collection.mjs`, the error class in `scripts/peer-directory.mjs`, and `totals()` and `sourceCounts()` in `lib/panel-data.mjs` after V1 moves the panel | Any. The Windows reason code is verified on the PC. | R1 |
| D2 | Price table: one price file from a maintained open table (LiteLLM's unless the owner names another), a refresh script run by hand and never by a collector, the checked-on date in the snapshot, the Claude Code API-equivalent estimate attached after the peer merge, and a test that fails when a fixture model has no price. | new `native/prices.json`, new `scripts/price-table.mjs`, new `scripts/price-refresh.mjs`, `scripts/api-estimate.mjs`, the estimate lines in `scripts/provider-token-sources.mjs`, `scripts/collect-mac.mjs` and `scripts/collect-windows.mjs`, the price line of `docs/GUIDE.md`, and the tests for these | Any | R1 |
| V1 | Viewer foundation: a `dashboard.html` entry beside `panel.html` with the six sections in order, which sets `window.observatoryDashboardReady` when it has drawn, the skin applied to the whole viewer through `data-skin` and `data-theme`, shared components (card, filter group, meter, numeral, text bar, row, provider dot, empty state, info control, action bar) and inline SVG chart primitives, a shared strings file generated for TypeScript, Swift and C# with a staleness check, and one fictional sample fixture used by `?demo` and the demo site. Move the panel onto those components with identical output. | `app/viewer/**`, `app/panel.*`, `native/web/**`, `native/vite.config.mts`, `lib/panel-data.mjs`, `lib/skins.mjs`, `lib/strings*`, new `lib/sample-snapshot.mjs`, `native/skins/**`, `scripts/build-design-tokens.mjs`, new `scripts/build-strings.mjs`, `native/design-tokens.json` and its generated outputs (`native/DesignTokens.swift`, `native/windows/DesignTokens.cs`, `app/design-tokens.css`), the generated `native/Strings.swift` and `native/windows/Strings.cs`, the re-export in `scripts/demo.mjs`, the `build:web` and `preview:web` scripts in `package.json`, and the tests for these | Any | Nothing |
| M1 | Mac shell hosts the shared dashboard. A `--web-dashboard` flag and a dashboard window host with the same file guard and snapshot bridge rules as the panel, page sets in the file guard so each host serves only its own page, `--test-web` covering both pages, skin and appearance set at document start from a stored value, the `--panel-timing` facts line and a preview image of each page, and the owner-check items of issue 83 in preview mode. Record that the dashboard web view is released when its window closes and the panel web view is kept. The default switch is in M2. | `native/Snapshot.swift` (`AssetResolver` only), new `native/WebDashboard.swift`, `native/WebPanel.swift`, `native/WebView.swift`, `native/WebSmokeTest.swift`, the dashboard mode in `native/main.swift`, the skin key in `native/Store.swift`, `native/SelfTests.swift`, and the check list in `native/build.mjs` | Mac | Nothing for the host. V1 for `dashboard.html`. |
| W1 | What is left on Windows after pull request 87: release a web view that failed to start, the findings of the two reviews of pull request 87 posted on issue 84 (including the trailing-slash JSON case in the file guard and tests for the release decision and the request path), a web-host fixture that creates a real WebView2 against a synthetic snapshot, skin and appearance set at document start from a registry value, and a check of `dashboard.html` from a staged build once V1 provides it. The real click-away check needs the owner. | `native/windows/WebPanel.cs`, `native/windows/WebDashboard.cs`, the web-host fixture and its launch flag in `native/windows/Program.cs`, their self-tests, and the Windows web view rows of [the measurements record](RESOURCE-MEASUREMENTS.md) | Windows PC | V1 for the real page |

### Phase 2, after V1 merges

Each view is one workstream, built from V1's components and charts, with a rules module in `lib/`, tests on synthetic data and a browser check in light and dark for the Sage and Almanac skins. By exception to V1's ownership, each view adds its own keys to `lib/strings.json` and its own fields to `lib/sample-snapshot.mjs`.

| Id | Workstream | Owns | Machine | Depends on |
| --- | --- | --- | --- | --- |
| V2 | Limits view: Claude Code and Codex windows with equal weight, pace, estimated time remaining, the limit history graph with the five periods, and limits shared from the paired device. The pace and display rules move into the view module, not copied. | `app/viewer/limits/**`, new `lib/view-limits.mjs`, `scripts/quota-pace.mjs` and `scripts/quota-display.mjs` (moved), and their tests | Any | V1, D1 |
| V3 | Activity view: total, bar chart, categories and apps, hourly breakdown, tracking status and ActivityWatch help. | `app/viewer/activity/**`, new `lib/view-activity.mjs`, and their tests | Any | V1, D1 for Now |
| V4 | Tokens view: Claude Code and Codex by day and model, token classes, the API-equivalent estimate with its checked-on date, the Claude Code session cost, and reasoning and speed settings. | `app/viewer/tokens/**`, new `lib/view-tokens.mjs`, and their tests | Any | V1, D2 for cost |
| V5 | Sources and Dictation views, including the `reason` codes as plain sentences. | `app/viewer/sources/**`, `app/viewer/dictation/**`, new `lib/view-sources.mjs`, and their tests | Any | V1, D1 for the reason code |
| B1 | Settings bridge contract. Write the contract first as a section of the design direction and have an independent reviewer session check it: a fixed list of named actions with typed, bounded arguments (source switches, skin, device name, startup, appearance, limits consent, sharing, the TLS pairing steps, Tailscale check, export, and one `status` query). No action takes a path, a command or free text that reaches a shell. The SSH pairing dialog stays a native menu item outside the contract until P1 removes it. Then the contract module, its generated Swift and C# validators, and the Settings view against a fake bridge. | the contract section of `docs/DESIGN.md`, new `lib/bridge-contract.json`, `lib/bridge-contract.mjs`, new `scripts/build-bridge-contract.mjs` and its generated outputs (`lib/bridge-contract.generated.ts`, `native/BridgeContract.swift`, `native/windows/BridgeContract.cs`), `app/viewer/settings/**`, `app/viewer/bridge.ts`, and their tests | Any | V1. Reviewer check of the contract before any code. |

### Phase 3, after the views exist

| Id | Workstream | Owns | Machine | Depends on |
| --- | --- | --- | --- | --- |
| M2 | Mac shell implements the bridge contract and makes the shared panel and dashboard the default, with `--native-viewer` for one build. The `refresh` action runs the limits-only collection first. The default is checked on the installed build with a real click on each action. Then the three pairing items move to the status item's menu, the shell is detached from the SwiftUI viewer, and the SwiftUI viewer files, `--legacy-dashboard` and Open saved snapshot are removed under the standing approval above. | `native/*.swift` (including new `native/BridgeHandler.swift`) except the pairing and setup files P1 and O1 change in their own branches and the generated `native/DesignTokens.swift`, `native/Strings.swift` (V1) and `native/BridgeContract.swift` (B1), `native/CollectorConfiguration.swift`, `native/install.mjs`, the legacy variants in `native/build.mjs`, and by exception the `QuotaPanel.swift` assertion in `scripts/theme.test.mjs` | Mac | B1, V2 to V5, M1 |
| W2 | Windows shell implements the bridge contract and makes the shared panel and dashboard the default, with `--native-viewer` for one build, and shows "Collection paused" during pairing work as the Mac does. Then the Windows Forms viewer files, `--legacy-dashboard` and their tests are removed under the standing approval above, with the web-host fixture from W1 replacing `--test-web`. | `native/windows/**` except the pairing and setup files P1 and O1 change in their own branches, the generated `native/windows/DesignTokens.cs`, `native/windows/Strings.cs` (V1) and `native/windows/BridgeContract.cs` (B1), and the phase timings in `native/windows/build.ps1` (Q1), and by exception the viewer line in `.github/workflows/native-compile.yml` and the required file in `native/windows/inspect-package.mjs` and `native/windows/package.ps1` | Windows PC | B1, V2 to V5, W1 |
| S1 | Demo and site. Remove the earlier web dashboard once neither shell loads it, with its packages and the tests that pin its files, including the ChatGPT and Cursor placeholder rows. Build the demo from the shared viewer in sample-data mode with a short product page, and write `build-info.json` and the fixture into the built folder so the published copy can be checked. Publishing waits for F1. | `app/page.tsx`, `app/layout.tsx`, `app/allowances.tsx`, `app/dictation.tsx`, `app/provider-coverage.tsx`, `app/tool-detail.tsx`, `app/week-timeline.tsx`, `app/globals.css`, `app/observatory.css`, `components/**`, `lib/utils.ts`, `vite.config.ts`, `next.config.ts`, `.openai/`, `components.json`, `tsconfig.json` types, `serve-local.mjs`, `native/web-licenses.mjs`, the shadcn line of `THIRD-PARTY-NOTICES.md`, package dependencies and the `dev`, `build` and `start` scripts in `package.json`, `.github/workflows/demo.yml`, `scripts/demo.mjs`, `scripts/check-demo-build.mjs`, `scripts/prepare-pages.mjs`, new `native/vite.demo.config.mts`, new `native/web/product.html` and `app/viewer/product/**`, and the tests for these. By exception: `native/web/index.html`, `native/web/main.tsx` and the `index` input in `native/vite.config.mts` (removed), `scripts/demo-workflow.test.mjs`, the `demo.yml` check in `scripts/native-private-state-workflow.test.mjs`, the demo sentence of `README.md` with its line in `scripts/documentation.test.mjs`, and the required file in `native/mac/inspect-package.mjs` with `scripts/mac-package.test.mjs` and `scripts/mac-replacement.test.mjs` | Any. The package check runs on both machines. | M2 and W2 no longer load the earlier dashboard (their removal pull requests) |
| G1 | Guides and README. Install guides for both platforms that state the unsigned-build warning plainly and the exact dialog each system shows, a README in which every sentence is true of the installed build, and a line-by-line README checklist for L1. | `docs/MAC.md`, `docs/WINDOWS.md`, `docs/GUIDE.md`, `README.md`, `scripts/documentation.test.mjs` | Any. The download dialogs are recorded on each device. | M2, W2, S1 for the demo sentence, N1 for the names |

### Added on 2026-10-13, to run alongside the phases

| Id | Workstream | Owns | Machine | Depends on |
| --- | --- | --- | --- | --- |
| Q1 | Build time and checks. Run the full script suite, `tsc`, `oxlint` and the design token check on pull requests in a new workflow on both hosted runners (Q1-a). Measure the Windows package steps and the PowerShell share before changing anything (Q1-b). Reuse one PowerShell process for the private-folder permission checks, with the same checks and results (Q1-c, two reviews). Record the run time before and after. | `.github/workflows/**` except `demo.yml`, the six workflow contract tests (new `scripts/script-suite-workflow.test.mjs`, `scripts/native-private-state-workflow.test.mjs`, `scripts/demo-workflow.test.mjs`, `scripts/windows-package-fixture-root.test.mjs`, `scripts/source-python-workflow.test.mjs`, `native/tests/source-retirement.test.mjs`), the phase timings in `native/windows/build.ps1`, `scripts/private-sync-acl.ps1`, `scripts/windows-powershell.mjs`, and by exception the permission-check calls in `scripts/peer-directory.mjs`, with `scripts/peer-directory.test.mjs` and `scripts/private-directory-policy.test.mjs` | Any for the workflow. Windows PC to measure and to verify the permission checks. | Nothing |
| H1 | Housekeeping. Give pull request 87 its two reviews (done on 2026-10-14, posted on issue 84). Bring the state record and the parity table up to build 41 (in the plan corrections pull request). Install the Claude Code limits bridge on the PC outside a Claude desktop session. Point the Mac status line entry at the script inside the installed app, and repeat that after N1. Move the old leftovers to the Trash or Recycle Bin as the owner decided. | `docs/UPDATES.md` and `docs/ARCHIVE.md`. It edits the shared records under the shared records rule. | Mac and Windows PC | The Mac status line step needs D1's `--bridge` option |
| N1 | Internal rename to "Observatory" with a data migration on both platforms. Visible names change: the app file, the data folders, the Start menu entry and the release assets. Internal identifiers stay, as the owner decided on 2026-10-14: the Mac bundle identifier `io.workspace-observatory.app`, and on Windows the mutex names, the uninstall key and the receipt product string. Copy the data, verify by checksum, switch, and keep the old folder until the owner confirms. Windows private folders are re-created with their protected permissions rather than copied. Pairing, saved history and settings must survive, shown by R2's fixture test against the migrated folder. | new `native/app-names.json` and the names it replaces in `native/**` and the packaging scripts, new `native/mac/migrate-data.mjs` and a Windows migration script, `docs/BRAND.md`, and the tests that pin the names | Mac and Windows PC | M2 and W2, so the rename is not done twice |
| F1 | Finish. When every item in "What done means" is verified on both devices, tag the release, write one checksum file for both builds, create one GitHub release with the install guides as notes, and run the demo workflow once. This single publication is approved in advance and needs no further confirmation. | No code. The release and the tag, and `docs/RELEASE-CHECKLIST.md` and `SECURITY.md` | Any | L1, G1, S1 |

### Added on 2026-10-14

| Id | Workstream | Owns | Machine | Depends on |
| --- | --- | --- | --- | --- |
| R2 | Ubuntu fields and the legacy pairing shape, in one change for both apps. `codexHosts` is still read but never written, the Ubuntu slot, `includeUbuntu` and the `localModel` slot are removed, and the retirement checkpoint code goes, which supersedes issue 39. A fixture in today's on-device pairing shape, with synthetic values, is read by the new code with the peer record, sequence and sharing state unchanged. Both apps are installed from this change before any re-pair. | `scripts/peer-pairing.mjs`, `scripts/peer-collection.mjs`, `scripts/peer-payload.mjs`, `scripts/peer-store.mjs`, `scripts/peer-setup.mjs`, `scripts/peer-setup-endpoint.mjs`, `scripts/peer-tls-client.mjs`, `scripts/peer-tls-host.mjs`, `scripts/peer-tls-join.mjs`, `scripts/peer-tls-control.mjs`, `scripts/combine-tokens.mjs`, `scripts/peer-inventory.mjs`, the Ubuntu lines in `scripts/collect-windows.mjs`, `scripts/windows-dashboard.mjs`, `scripts/mac-snapshot.mjs`, `scripts/current-sources.mjs`, `scripts/run-collector.py`, `scripts/mac-snapshot-archive.mjs`, `scripts/demo.mjs` and `lib/sample-snapshot.mjs`, the request shapes in `native/PairingSetup.swift`, `native/PairingSetupDialog.swift`, `native/PairingDetails.swift`, `native/DirectPairingWindow.swift` and `native/windows/DirectPairingWindow.cs`, and the tests for these, including `native/tests/source-retirement.test.mjs` | Mac for scripts and Swift. Windows PC for C#. Both to install. | Nothing |
| O1 | One device, ActivityWatch and nothing else (done item 3). A first-run wizard in the shared viewer at `dashboard.html#setup`: sources including Claude Code with the limits consent text, no SSH text, pairing described as something to do later in Settings, and Finish with ActivityWatch alone. It writes through the bridge, with one added action `complete-setup`, reviewed as a contract amendment. Both shells open it while setup is incomplete, drop their native wizards, and gain a `--runtime <absolute folder>` flag that runs the app with collection enabled against a fresh folder outside the real data folder. | `app/viewer/setup/**`, new `lib/view-setup.mjs`, the `complete-setup` amendment to the contract, and in the M2 and W2 branches `native/SetupWizard.swift`, `native/windows/SetupWizard.cs`, `native/windows/SetupWizardTests.cs` and the `--runtime` flag, with their tests | Any for the wizard. Mac and Windows PC for the shells. | B1, M2, W2 |
| L1 | Release build and installs. Raise the build number, package Windows in CI and the Mac with the macOS 26.5 SDK (or in CI if the Mac runtime workflow passes again), record the checksums, install on both devices under the standing approval with backups matched by checksum, start each app outside a Claude desktop session, and run the proof for each "What done means" item on both devices against that revision. | `native/Release.props` and the install records in the state record | Mac and Windows PC | Every workstream in this plan except T1, K1 and C1, including P1 |

### Phase 4, larger pieces with their own design step

P1 is needed for done item 4. T1, K1 and C1 are not needed for "What done means" and are outside this run.

| Id | Workstream | Owns | Machine | Depends on |
| --- | --- | --- | --- | --- |
| P1 | Tailscale pairing. Let a repaired device pair over TLS at all (only the SSH setup reads the repair nonce today). Pre-fill this device's Tailscale address and the claimant's address, use a fixed default sync port, make sharing one choice at pairing time, show the pairing state in Settings, and finish integration step 5 of [product direction](PRODUCT-DIRECTION.md) and [local pairing](LOCAL-PAIRING.md): first a live fixture in temporary runtimes over Tailscale, driven by a new test-only controller, then the owner's two installed apps. Keep SSH pairing working until the new path is verified on both of the owner's devices, then remove it from both apps together. | `scripts/peer-*.mjs`, `scripts/tailscale-status*.mjs`, `scripts/quota-sharing-control*.mjs`, `scripts/provider-token-sharing-control*.mjs`, `scripts/quota-sync*.mjs`, `scripts/provider-token-sync*.mjs`, `scripts/quota-exchange*.mjs`, new `scripts/sharing-choice.mjs`, and their tests, `docs/LOCAL-PAIRING.md`, `docs/PAIRING-MAINTENANCE.md`, `docs/PRIVATE-SYNC.md`, `docs/USAGE-LIMITS.md`, and the pairing files in both shells through `mac/p1` and `win/p1` branches | Mac and Windows PC. The live test needs both devices and the owner. | R2, B1, M2, W2 |
| T1 | Device time zone. Days follow the device's zone instead of America/New_York. Needs a tested migration of saved history and a rollback. | The zone handling in `scripts/read-settings.py`, `scripts/read-claude-usage.py`, `scripts/read-wispr.py`, `scripts/wispr.mjs`, `scripts/activity-timeline.mjs`, `scripts/mac-snapshot.mjs`, `scripts/windows-dashboard.mjs`, `scripts/peer-payload.mjs`, `scripts/claude-usage-command.mjs`, and their tests | Any, verified on both devices | Not in this run |
| K1 | Working store and import. A design document first, reviewed by the owner. Then the store, the migration from today's files, and import of a `.observatory` file. | Set by its design document | Any | Not in this run. The owner's review of the design. |
| C1 | Claude Code log scan cache, so the scan limit applies per run. | The scan in `scripts/read-claude-usage.py` and its tests | Any | Not in this run |

## Model choice

The orchestrator and the reviewers are Claude sessions on the strongest model available. Code is written by Codex with `gpt-6-astra` at medium effort, as described under "Who does what". Security-sensitive pieces get two reviews before they merge (see "Reviews"):

- B1, the contract text and the contract module.
- M1 and W1, the file guards and the web hosts.
- The M2 and W2 bridge pull requests.
- Q1-c, the reused PowerShell process for the permission checks.
- R2, the pairing shape.
- Every P1 pull request.
- N1, the data migration.
- K1, when it starts.
- Any change to `AssetResolver`, `SnapshotBridge`, `PanelActionBridge`, `WebPanel.Resolve`, `Respond`, `ParseAction` or a bridge handler.

A workstream that cannot be verified on the machine it runs on must not be started there.

## Reviews

- **A reviewer session** is a fresh-context Claude agent started with a fixed brief: read `AGENTS.md`, [the design direction](DESIGN.md), [the parity table](PARITY.md), the rules in this file and the pull request's diff, run the checks the pull request names, and post a review with `gh pr review` that names the revision reviewed and each finding with its file and line. It edits nothing. It never sees the orchestrator's reasoning, only the diff and the documents.
- **Every pull request** gets one such review and must pass CI. After the script suite workflow from Q1 merges, that workflow counts as CI for shared changes. Native changes also need the three existing pull-request workflows. Until then, "CI passes" means what the standing approval above says.
- **Two reviews** for the pieces listed under "Model choice". The second comes from a separately started session briefed to refute the first review and find what it missed, against the rule that no action carries a path, a command or free text that reaches a shell.
- **Merging.** The orchestrator squash-merges after CI passes, the required reviews are posted, and no blocking finding in them is unresolved, for `shared/`, `mac/` and, under the standing approval of 2026-10-13, `win/` pull requests from the PC session. The PC session does not merge. `main` has no branch protection, so this is a rule the orchestrator enforces at merge time. A ruleset that requires the script suite is a repository setting and stays with the owner.

## Corrections of 2026-10-14

Before the autonomous run, the orchestrator read this plan against the repository and the other records. Of 63 claimed defects, 39 went to adversarial reviewers, who refuted none. The full list with evidence is in [the execution plan](EXECUTION-PLAN.md), section 7. This file now carries these corrections:

- **Ownership.** V1 owned none of the files it had to change (`app/panel.tsx`, `lib/panel-data.mjs`, `lib/skins.mjs`, the skin files and the generators), and `app/panel.tsx` fell under S1's removal glob. D2 owned files that did not exist and not `scripts/api-estimate.mjs`. M2 and W2 had to change build and packaging files outside their globs. Q1 and G1 both owned the workflows, and S1 and F1 both owned `demo.yml`. Every row above now names its files, and exceptions are stated in the row.
- **Missing workstreams.** Done item 3 had no owner, so O1 was added. The Ubuntu removal was split across R1, P1 and an approval while the state record said it was ready, so R2 was added. Done item 7 needs a build number, two builds, two installs and a record, so L1 was added. P1, T1, K1 and C1 now have the same four columns as the others.
- **Order.** R1 and D1 edit the same collector files, so R1 merges first and D1 and D2 depend on it. S1 depends on the viewer removals in M2 and W2, because the Mac's `--test-web` and package check still expect the earlier dashboard. F1 depends on a named list instead of "everything else", which had included T1, K1 and C1.
- **Pairing.** The "pairing code" did not exist in source. The only credential is the invitation of about 370 characters. The owner confirmed on 2026-10-14 that "pairing code" means the invitation. A TLS pairing cannot be committed beside an existing SSH pairing, and a repaired device cannot pair over TLS at all today. P1 fixes the second first, and verifies with a live fixture before the owner's installed apps, with the retired folder as rollback.
- **Publishing.** The rule "do not publish anything" contradicted the standing decision for F1, and `AGENTS.md` and the design direction asked for approval each time. The owner decided on 2026-10-14 that F1 publishes once at the finished state with no further confirmation. The rule, `AGENTS.md` and the design direction now say so, and nothing else may be published.
- **Shared records.** "Touch only the paths that workstream owns" conflicted with "update the parity table in the same pull request". The shared records rule above replaces both, and H1 no longer owns the state record and the parity table.
- **Snapshot fields.** A field attached before the peer merge is dropped on a paired device, and a field inside an exchanged row breaks the exchange until both apps carry it. D1 fields therefore stay local first and cross to the peer only in R2's both-apps change. Device names live in a separate `device.json` because the Mac's Settings save rewrites the collector configuration.
- **Reviews and CI.** "An independent reviewer session" was undefined, the two-review list omitted Q1's PowerShell change, pull request 87 had merged with no review, and no pull-request workflow ran the full suite. The "Reviews" section, Q1-a and the merge-time rule answer these.
- **Smaller items.** The full Codex command, the Windows and Mac acceptance launch routes, the tag name `archive/pre-viewer-removal`, the worktree layout, "one workstream per branch and worktree", the PC firewall gate for the live pairing test, a consent route for Claude Code limits other than the status line entry, and the stale lines in the design direction, the parity table, the state record and `AGENTS.md`.

## How the autonomous run is started

Checked against Claude Code's documentation on 2026-10-13.

- Skipping permission prompts removes the prompts. It does not confine a session to a folder, and every subagent and workflow agent inherits it. The limits in "What a Mac session may touch" are therefore rules the sessions follow, backed by deny rules in the user's Claude Code settings for credential stores.
- Plan mode comes first. The orchestrator reads the repository, writes its plan and waits. When the owner approves, a session started with prompts skipped offers to continue in that mode.
- A long run is kept going with `/goal` and a condition, not with a loop. The condition is the "What done means" list.
- Workflows fan work out to many agents at once. One workflow per phase of work, with the orchestrator reading each result before starting the next.

## How progress is tracked

One GitHub issue per workstream, titled with its id, labelled `mac` or `windows` when it is platform work. The issue holds the acceptance checklist and records which tool wrote the code. The pull request closes the issue. The orchestrator reviews `mac/` and `win/` pull requests for what must also land on the other platform and keeps [the parity table](PARITY.md) and [the design direction](DESIGN.md) current.

On 2026-10-14 issues existed only for V1 (79), D1 (80), D2 (81), R1 (82), M1 (83) and W1 (84). The orchestrator opened the others the same day with the acceptance lists from [the execution plan](EXECUTION-PLAN.md): V2 (96), V3 (97), V4 (98), V5 (100), B1 (101), M2 (102), W2 (103), S1 (104), G1 (105), Q1 (106), H1 (107), N1 (108), F1 (109), P1 (110), R2 (111), O1 (112) and L1 (113). The corrected scope is commented on issues 79 to 84.
