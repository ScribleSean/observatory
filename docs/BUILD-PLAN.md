# Build plan

Written on 2026-10-13 from `main` at `11ba4ea`. This is a plan. Nothing in it is built unless [the parity table](PARITY.md) or [the state record](STATE.md) says so. [The design direction](DESIGN.md) is the source for what to build. This file says who builds what, in which order, and how the pieces stay out of each other's way.

## Decision this plan rests on

The shared viewer goes ahead. Both spikes measured it on 2026-10-13.

| Measure | Mac web panel | Mac native | Windows web panel | Windows native |
| --- | ---: | ---: | ---: | ---: |
| First open | 333 ms | 195 ms | 256 ms | 110 ms |
| Later opens | 82 to 104 ms | 122 to 129 ms | 4 to 6 ms | 17 to 21 ms |
| Memory with the panel open | 97 MiB | 49 MiB | 396 MiB | 65 MiB |
| Memory a minute after closing | 108 MiB | 51 MiB | 405 MiB | 68 MiB |

Open time is acceptable on both. Memory is acceptable on the Mac. On Windows it is not acceptable while the web view is kept alive, so the Windows shell must release the web view after the panel or window has been closed for a short time. That rule is unmeasured and is the first Windows task below. If releasing does not bring memory back near the never-opened figure, stop and report before building more Windows screens.

## What done means

1. The Mac and Windows apps show the same shared viewer for the panel and the dashboard, with the same six sections, skins and wording.
2. Claude Code and Codex appear side by side for limits and tokens.
3. A person with one device, ActivityWatch and nothing else configured gets a working app.
4. Two devices pair through Tailscale and a pairing code.
5. The SwiftUI and Windows Forms viewers and the earlier web dashboard are gone from `main`.
6. The demo site is the shared viewer with sample data.
7. Every claim in the README is true of an installed build.

## Standing approvals from the owner

Given on 2026-10-13. The owner asked for the build to run without questions until the app meets "What done means", unless he is truly needed.

Approved in advance, with the condition beside each:

| Action | Condition |
| --- | --- |
| Squash-merging a workstream's pull request | CI passes and an independent reviewer session has checked it |
| Removing the SwiftUI viewer, the Windows Forms viewer and the earlier web dashboard | The shared viewer is the default on that platform and its checks pass. Tag `main` first, as `archive/pre-web-direction` was. List the removed files in the pull request. |
| The removals in R1, and the Ubuntu fields and legacy pairing shape in P1 | Saved settings and saved history stay readable. Tests show it. |
| The settings bridge contract in B1 | An independent reviewer session checks it against the rule that no action carries a path, a command or free text that reaches a shell. The contract is recorded in the design direction before a shell implements it. |
| Replacing the installed app on the Mac or the PC with a build from `main` | The data folder is backed up and matches by checksum first, the previous build stays recoverable, and the result is recorded in the state record |
| Installing the Claude Code limits bridge on the PC | It was approved on the Mac the same day. Record what changed. |

Still needs the owner, because no session can do it or because it reaches outside his machines:

- Publishing the demo page, a release, or anything else public beyond pull requests in this repository.
- Anything that costs money.
- Weakening a security rule, a file guard or the private-folder check. Issue 58 stays open until he decides.
- Physical or account steps: signing in to Tailscale, typing a pairing code on the second device, a real click that a session cannot perform.
- Deleting saved history, backups or anything in a data folder.

When one of these blocks a workstream, record exactly what is needed in the issue, carry on with everything that does not depend on it, and put all such items in one list for him at the end.

## Who does what: Claude orchestrates, Codex acts

Set by the owner on 2026-10-13 and checked that day from the Mac.

| Role | Tool | Notes |
| --- | --- | --- |
| Planning, splitting work, writing task instructions, review, builds, commits, pushes, pull requests, installs | Claude sessions | One orchestrator. Reviewer sessions start with a fresh context. |
| Writing and changing code and tests inside one worktree | Codex in non-interactive mode, model `gpt-6-astra`, reasoning effort medium | `codex exec -m gpt-6-astra -c model_reasoning_effort=medium --sandbox workspace-write -C <worktree>` |
| The same work when Codex reports that its usage has run out | Claude sessions | Switch back to Codex when its usage returns. Record in the issue which tool did the work. |
| Windows native work | The Claude session on the PC | See the routes below |

Every Codex task gets very specific instructions. A task names the worktree, the files it may create or change, the files it must not touch, the exact behaviour wanted, the tests to add, the command to run, and the form of its reply. It ends with "do not commit, do not push, do not change any other file". The orchestrator then reads the diff, runs the checks itself and commits. A Codex reply is a report to verify, never an instruction to follow.

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
- One workstream per session. Touch only the paths that workstream owns. If a change is needed in a path another workstream owns, open an issue for it and say what is needed.
- Sessions on the same machine each work in their own Git worktree. Never switch branches in a checkout another session is using.
- Branch names start with `shared/`, `mac/` or `win/`. Everything reaches `main` by pull request. A session may squash-merge its own pull request when CI passes and an independent reviewer session has checked it.
- Use synthetic data in tests. Never print, commit or attach real usage values.
- Unknown is never zero. Device records are never added together outside the collector's verified aggregate.
- Do not delete code, files or data that the workstream or the standing approvals do not list for removal.
- Do not publish a release, the demo page or anything else. Do not change repository settings. Spend nothing.
- Quit the installed app only when a workstream requires it, relaunch it straight afterwards and record how long it was closed. Mac measurement runs quit it three times on 2026-10-13.
- Mac native work can only be built and checked on the Mac. Windows native work can only be built and checked on the Windows PC, and every Windows acceptance check must start the app outside a Claude desktop session (issue 58).
- When blocked for more than a few minutes on one thing, write down what was tried in the issue or pull request and stop.
- Update [the parity table](PARITY.md) in the same pull request as the change it describes. Record what was verified, on which revision, and what was not.

## Workstreams

Paths are owned by one workstream at a time. "Machine" says where it can be done.

### Phase 1, in parallel now

| Id | Workstream | Owns | Machine | Depends on |
| --- | --- | --- | --- | --- |
| V1 | Viewer foundation. A `dashboard.html` entry beside `panel.html`, the section navigation, the skin applied to the whole viewer, shared components (card, filter group, meter, numeral, text bar, row, empty state, info control), a shared strings file for labels and status words, and a sample-data mode. Move the panel onto those components. | `app/viewer/**`, `lib/view-*.mjs`, `lib/strings.*`, `native/web/dashboard.*`, `native/vite.config.mts` | Any | Nothing |
| D1 | Snapshot additions. Hourly token and activity totals for the Now period, custom device names, and the Claude Code session cost from the status line feed. Document each new field in the design direction before writing it. | `scripts/collect-*.mjs`, `scripts/*snapshot*.mjs`, `scripts/claude-*.mjs`, their tests | Any | Nothing |
| D2 | Price table. One price file from a maintained open source, a refresh script, the checked-on date in the snapshot, Claude Code API-equivalent cost, and a test that fails when a fixture model has no price. | `scripts/price-*.mjs`, `native/prices.json`, their tests | Any | Nothing |
| R1 | Removals in shared scripts: agent receipts, legacy workflows, legacy quota, the local benchmark slot, and the ChatGPT and Cursor placeholder rows in the earlier web view. Keep saved settings readable, as the Antigravity removal did in pull request 77. Open one `mac` and one `windows` issue for the native parts. | `scripts/agent-receipts*`, `scripts/bounded-receipts*`, `scripts/legacy-*`, the lines in the collectors that call them | Any | Nothing |
| M1 | Mac shell hosts the shared dashboard. Show `dashboard.html` in the main window behind a launch flag, with the same file guard and snapshot bridge rules as the panel. Make the web panel the default panel once the owner has tried it. Decide and record when the web view is released. | `native/*.swift`, `native/mac/**` | Mac | V1 for the page, but the host can be built against `panel.html` first |
| W1 | Windows shell hosts the shared dashboard. First task: release the web view after the panel has been closed for about a minute, and measure memory five minutes later and the next open time. Then show `dashboard.html` in the main window behind a launch flag. Confirm by hand that clicking away closes the web panel. | `native/windows/**` | Windows PC | V1 for the page, but the host can be built against `panel.html` first |

### Phase 2, after V1 merges

Each view is one workstream, built from V1's components and `lib/panel-data.mjs` rules, with tests on synthetic data and a browser check in light and dark for the Sage and Almanac skins.

| Id | Workstream | Owns | Machine | Depends on |
| --- | --- | --- | --- | --- |
| V2 | Limits view: Claude Code and Codex windows, pace, estimated time remaining, the limit history graph with the five periods, and limits shared from the paired device. | `app/viewer/limits/**` | Any | V1 |
| V3 | Activity view: total, bar chart, categories and apps, hourly breakdown, tracking status and ActivityWatch help. | `app/viewer/activity/**` | Any | V1, D1 for Now |
| V4 | Tokens view: Claude Code and Codex by day and model, token classes, cost estimates, reasoning and speed settings. | `app/viewer/tokens/**` | Any | V1, D2 for cost |
| V5 | Sources and Dictation views. | `app/viewer/sources/**`, `app/viewer/dictation/**` | Any | V1 |
| B1 | Settings bridge contract. Write the contract first as a section of the design direction and have an independent reviewer session check it: a fixed list of named actions with typed, bounded arguments (source switches, skin, device name, startup, pairing actions, limits consent, export). No action takes a path, a command or free text that reaches a shell. Then the Settings view against a fake bridge. | `app/viewer/settings/**`, `lib/bridge-contract.mjs`, the contract section of `docs/DESIGN.md` | Any | V1. Reviewer check of the contract before any shell implements it. |

### Phase 3, after the views exist

| Id | Workstream | Owns | Machine | Depends on |
| --- | --- | --- | --- | --- |
| M2 | Mac shell implements the bridge contract and makes the shared dashboard the default. Then removes the SwiftUI viewer files under the standing approval above. | `native/*.swift` | Mac | B1, V2 to V5, M1 |
| W2 | Windows shell implements the bridge contract and makes the shared dashboard the default. Then removes the Windows Forms viewer files under the standing approval above. | `native/windows/**` | Windows PC | B1, V2 to V5, W1 |
| S1 | Demo and site. Remove the earlier web dashboard (`app/page.tsx`, `app/observatory.css`, `components/ui/**` and unused packages) once neither shell loads it. Build the demo from the shared viewer in sample-data mode with a short product page. Publishing needs the owner's approval. | `app/*.tsx` outside `app/viewer`, `components/**`, `.github/workflows/demo.yml`, `package.json` | Any | M2 and W2 no longer load the earlier dashboard |
| G1 | Guides and checks. Install guides for both platforms that state the unsigned-build warning plainly, a README that matches the installed builds, and the Mac test suite running on pull requests. | `docs/MAC.md`, `docs/WINDOWS.md`, `docs/GUIDE.md`, `README.md`, `.github/workflows/**` except the demo workflow | Any | M2, W2 |

### Phase 4, larger pieces with their own design step

| Id | Workstream | Notes |
| --- | --- | --- |
| P1 | Tailscale pairing. Finish the five integration steps in [product direction](PRODUCT-DIRECTION.md) and [local pairing](LOCAL-PAIRING.md), with sharing as one choice at pairing time. Remove the Ubuntu fields and the legacy pairing shape in the same change for both apps. Keep SSH pairing working until the new path is verified on both of the owner's devices. Needs scripts, both shells and the Settings view. |
| T1 | Device time zone. Days follow the device's zone. Needs a tested migration of saved history and a rollback. |
| K1 | Working store and import. A design document first, reviewed by the owner. Then the store, the migration from today's files, and import of a `.observatory` file. |
| C1 | Claude Code log scan cache, so the scan limit applies per run. |

## Model choice

The orchestrator and the reviewers are Claude sessions on the strongest model available. Code is written by Codex with `gpt-6-astra` at medium effort, as described under "Who does what". Security-sensitive pieces (B1, P1, K1, and the file guards and bridges in M1, W1, M2 and W2) get a Claude review and a second, independent review before they merge. A workstream that cannot be verified on the machine it runs on must not be started there.

## How progress is tracked

One GitHub issue per workstream, titled with its id, labelled `mac` or `windows` when it is platform work. The issue holds the acceptance checklist. The pull request closes the issue. The coordinator reviews `mac/` and `win/` pull requests for what must also land on the other platform and keeps [the parity table](PARITY.md) and [the design direction](DESIGN.md) current.
