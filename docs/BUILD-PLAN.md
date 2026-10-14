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
4. Two devices pair through Tailscale and a pairing code.
5. The SwiftUI and Windows Forms viewers and the earlier web dashboard are gone from `main`.
6. The demo site is the shared viewer with sample data.
7. Every claim in the README is true of an installed build.

## Standing approvals from the owner

Given on 2026-10-13. The owner asked for the build to run without questions until the app meets "What done means", unless he is truly needed.

Approved in advance, with the condition beside each:

| Action | Condition |
| --- | --- |
| Squash-merging a workstream's pull request | CI passes and the reviews under "Reviews" are posted. Until the script suite workflow from Q1 exists, "CI passes" means the orchestrator ran the full suite, `npx tsc --noEmit` and the design token check on the branch and recorded the counts in the pull request, because `main` has no branch protection and no pull-request workflow runs the full suite today. |
| Removing the SwiftUI viewer, the Windows Forms viewer and the earlier web dashboard | The shared viewer is the default on that platform and its checks pass. Tag `main` first as `archive/pre-viewer-removal`, annotated with the date, on the merge commit before the first removal pull request, as `archive/pre-web-direction` was. List the removed files in the pull request. |
| The removals in R1, and the Ubuntu fields and legacy pairing shape in R2 | Saved settings and saved history stay readable, and the current pairing on both devices stays readable. Tests with a fixture in today's on-device shape show it. Both apps are installed from the R2 change before any re-pair. |
| The settings bridge contract in B1 | An independent reviewer session checks it against the rule that no action carries a path, a command or free text that reaches a shell. The contract is recorded in the design direction before a shell implements it. |
| Replacing the installed app on the Mac or the PC with a build from `main` | The data folder is backed up and matches by checksum first, the previous build stays recoverable, and the result is recorded in the state record |
| Installing the Claude Code limits bridge on the PC | It was approved on the Mac the same day. H1 does it from the PC session, outside a Claude desktop session, and records what changed, including the PowerShell quoting of the status line command and whether the usage command finds `claude.exe` from the installed app. |

Added on 2026-10-13 from the owner's answers before the autonomous build:

| Decision | Detail |
| --- | --- |
| Where the build stops | After everything in "What done means" is installed and verified on both devices, publish a GitHub release with the install guides and publish the demo page. This is approved in advance, once, for that finished state. Because [the design direction](DESIGN.md) asks for the owner's approval each time something is published, F1 first posts the release draft, both checksums and the demo build location in its issue and waits for the owner's reply, which is that approval. |
| What a Mac session may touch | `~/Developer`, the installed Observatory app in `~/Applications`, its data folder for backups and installs, and the status line entry in Claude Code's settings. Nothing else on the Mac. |
| How the PC is driven | The owner keeps the "Observatory Windows" session open with prompts skipped. The orchestrator sends it tasks by message and through issues. |
| Windows build time | Fix both causes: run the full suite on pull requests, and reuse one PowerShell process for the permission checks. The second is security-sensitive and needs two reviews. Baseline read from the job log of the last successful package run (38493681280) on 2026-10-14: 38 m 33 s against a 40 minute cap, of which the script suite inside `build.ps1` is about 32 minutes, publish, Python preparation, native tests and manifest hashing about 42 seconds, and the installer lifecycle 3 m 39 s. The suite is the cost. The per-check PowerShell share is unmeasured and is measured before it is changed. |
| Internal name | Rename "Workspace Observatory" to "Observatory" in this build, with a tested migration that copies saved data to the new location and keeps the old folder until the owner confirms. What the rename means for the Mac bundle identifier, the Windows receipt identity and the old install entry is under N1. |
| Old leftovers | Keep the newest data backup on each device and the build 40 installer on the PC. Move older installers, test builds and backups to the Trash or the Recycle Bin for the owner to empty. Never delete them outright. |
| Tailscale | Installed and signed in on both devices, so pairing can be tested end to end. The owner pastes the invitation on the second device and confirms the claimed device on the first (see "Pairing code" under the corrections). The only earlier two-device test, on 2026-09-13, timed out before TLS on Windows outbound firewall rules ([local pairing](LOCAL-PAIRING.md)), so a Windows Firewall rule for the bundled `node.exe` listening on the Tailscale interface may need the owner. |
| What he most wants fixed | The apps still show the old look, and Claude Code is not shown beside Codex. The shared viewer as the default fixes both. |

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
- Branch names start with `shared/`, `mac/` or `win/`. Everything reaches `main` by pull request. The orchestrator squash-merges a pull request when CI passes and the reviews under "Reviews" are posted. The PC session does not merge.
- Use synthetic data in tests. Never print, commit or attach real usage values.
- Unknown is never zero. Device records are never added together outside the collector's verified aggregate.
- Do not delete code, files or data that the workstream or the standing approvals do not list for removal.
- Do not publish a release, the demo page or anything else, except as F1 describes. Do not change repository settings. Spend nothing.
- Quit the installed app only when a workstream requires it, tell the owner first, relaunch it straight afterwards and record how long it was closed. Mac measurement runs quit it three times on 2026-10-13.
- Mac native work can only be built and checked on the Mac. Windows native work can only be built and checked on the Windows PC. Every Windows acceptance check starts the app through `Win32_Process.Create` (parent `WmiPrvSE.exe`) or the Start menu, never from a Claude desktop session, and records the parent process (issue 58, [the state record](STATE.md) build 41 install on Windows). Every Mac acceptance check starts the app with a clean environment (`env -i` with `HOME`, `USER` and `PATH`, then `/usr/bin/open -n`), never from a shell inside a Claude desktop session, and records the launch line ([the state record](STATE.md) build 41 install on the Mac).
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
| W1 | Windows shell hosts the shared dashboard. Done in pull request 87: the web view is released a minute after closing and measured, and `--web-dashboard` shows a page in the main window. Left: show `dashboard.html` once V1 provides it, a test for the release timer, release of a web view that failed to start, a real click-away check, and the second review that pull request 87 did not get. | `native/windows/**` | Windows PC | V1 for the page |

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

### Added on 2026-10-13, to run alongside the phases

| Id | Workstream | Owns | Machine | Depends on |
| --- | --- | --- | --- | --- |
| Q1 | Windows build time. Run the full script suite on pull requests so a failure shows before packaging. Reuse one PowerShell process for the private-folder permission checks, with the same checks and results. Record the run time before and after. | `.github/workflows/**`, `scripts/private-sync-acl.ps1`, `scripts/peer-directory.mjs`, their tests | Any for the workflow, Windows PC to verify the permission checks | Nothing |
| H1 | Housekeeping. Point the Mac status line entry at the script inside the installed app. Move the old leftovers to the Trash or Recycle Bin as the owner decided. Bring `docs/STATE.md` and `docs/PARITY.md` up to build 41. Give pull request 87 its second review. | `docs/STATE.md`, `docs/PARITY.md` | Mac and Windows PC | Nothing |
| N1 | Internal rename to "Observatory" with a data migration on both platforms: the app file and bundle identifier on Mac, the install entry and folders on Windows, and the data folder on both. Copy, verify by checksum, switch, and keep the old folder. Pairing, saved history and settings must survive. | The names in `native/**`, the packaging scripts, `docs/BRAND.md` | Mac and Windows PC | M2 and W2, so the rename is not done twice |
| F1 | Finish. When every item in "What done means" is verified on both devices, write the install guides into a GitHub release with both builds and their checksums, and publish the demo page. | The release, `.github/workflows/demo.yml` | Any | Everything else |

### Phase 4, larger pieces with their own design step

| Id | Workstream | Notes |
| --- | --- | --- |
| P1 | Tailscale pairing. Finish the five integration steps in [product direction](PRODUCT-DIRECTION.md) and [local pairing](LOCAL-PAIRING.md), with sharing as one choice at pairing time. Remove the Ubuntu fields and the legacy pairing shape in the same change for both apps. Keep SSH pairing working until the new path is verified on both of the owner's devices. Needs scripts, both shells and the Settings view. |
| T1 | Device time zone. Days follow the device's zone. Needs a tested migration of saved history and a rollback. |
| K1 | Working store and import. A design document first, reviewed by the owner. Then the store, the migration from today's files, and import of a `.observatory` file. |
| C1 | Claude Code log scan cache, so the scan limit applies per run. |

## Model choice

The orchestrator and the reviewers are Claude sessions on the strongest model available. Code is written by Codex with `gpt-6-astra` at medium effort, as described under "Who does what". Security-sensitive pieces (B1, P1, K1, and the file guards and bridges in M1, W1, M2 and W2) get a Claude review and a second, independent review before they merge. A workstream that cannot be verified on the machine it runs on must not be started there.

## How the autonomous run is started

Checked against Claude Code's documentation on 2026-10-13.

- Skipping permission prompts removes the prompts. It does not confine a session to a folder, and every subagent and workflow agent inherits it. The limits in "What a Mac session may touch" are therefore rules the sessions follow, backed by deny rules in the user's Claude Code settings for credential stores.
- Plan mode comes first. The orchestrator reads the repository, writes its plan and waits. When the owner approves, a session started with prompts skipped offers to continue in that mode.
- A long run is kept going with `/goal` and a condition, not with a loop. The condition is the "What done means" list.
- Workflows fan work out to many agents at once. One workflow per phase of work, with the orchestrator reading each result before starting the next.

## How progress is tracked

One GitHub issue per workstream, titled with its id, labelled `mac` or `windows` when it is platform work. The issue holds the acceptance checklist. The pull request closes the issue. The coordinator reviews `mac/` and `win/` pull requests for what must also land on the other platform and keeps [the parity table](PARITY.md) and [the design direction](DESIGN.md) current.
