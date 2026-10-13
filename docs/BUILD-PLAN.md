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

## Rules for every session

- Read `AGENTS.md`, [the design direction](DESIGN.md) and [the parity table](PARITY.md) before changing anything.
- One workstream per session. Touch only the paths that workstream owns. If a change is needed in a path another workstream owns, open an issue for it and say what is needed.
- Sessions on the same machine each work in their own Git worktree. Never switch branches in a checkout another session is using.
- Branch names start with `shared/`, `mac/` or `win/`. Everything reaches `main` by pull request. A session may squash-merge its own pull request when CI passes, except where this plan says the owner or the coordinator must review.
- Use synthetic data in tests. Never print, commit or attach real usage values.
- Unknown is never zero. Device records are never added together outside the collector's verified aggregate.
- Do not delete code, files or data that the workstream does not explicitly list for removal. Ask the owner before any deletion that is not listed.
- Do not publish a release, the demo page or anything else. Do not change repository settings. Spend nothing.
- Do not replace or quit the installed app without telling the owner first. Mac measurement runs quit it three times on 2026-10-13.
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
| B1 | Settings bridge contract. Write the contract first as a section of the design direction and have the owner approve it: a fixed list of named actions with typed, bounded arguments (source switches, skin, device name, startup, pairing actions, limits consent, export). No action takes a path, a command or free text that reaches a shell. Then the Settings view against a fake bridge. | `app/viewer/settings/**`, `lib/bridge-contract.mjs`, the contract section of `docs/DESIGN.md` | Any | V1. Owner approval of the contract before any shell implements it. |

### Phase 3, after the views exist

| Id | Workstream | Owns | Machine | Depends on |
| --- | --- | --- | --- | --- |
| M2 | Mac shell implements the bridge contract and makes the shared dashboard the default. Then removes the SwiftUI viewer files. The owner must approve the exact file list before the removal. | `native/*.swift` | Mac | B1, V2 to V5, M1 |
| W2 | Windows shell implements the bridge contract and makes the shared dashboard the default. Then removes the Windows Forms viewer files. The owner must approve the exact file list before the removal. | `native/windows/**` | Windows PC | B1, V2 to V5, W1 |
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

Planning, contracts, security-sensitive work (B1, P1, K1, the file guards and bridges in M1, W1, M2, W2) and review go to the most capable model available. Views built from an agreed component set (V2 to V5), guides (G1) and removals with a file list (R1) suit a faster model. A workstream that cannot be verified on the machine it runs on must not be started there.

## How progress is tracked

One GitHub issue per workstream, titled with its id, labelled `mac` or `windows` when it is platform work. The issue holds the acceptance checklist. The pull request closes the issue. The coordinator reviews `mac/` and `win/` pull requests for what must also land on the other platform and keeps [the parity table](PARITY.md) and [the design direction](DESIGN.md) current.
