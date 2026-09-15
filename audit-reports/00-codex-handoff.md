# Codex handoff: Observatory repair backlog

Investigation-only audit of [ScribleSean/observatory](https://github.com/ScribleSean/observatory). No product fixes are in this branch. Desktop apps were not launched. Hypotheses are marked in the linked reports.

Read this file first. Then the report named in **See** before implementing.

Constraints from `AGENTS.md` still apply: unknown is not zero, no cross-host sums until deduplication is verified, no raw titles/prompts/credentials in snapshots or Git, synthetic test data only, do not deploy snapshots.

## Report index

| File | Contents |
| --- | --- |
| [01-features.md](01-features.md) | Claims versus code. Stubs, dead UI, collector matrix, docs mismatches |
| [02-ui.md](02-ui.md) | Layout, chrome, empty/error/loading, a11y, charts, Mac versus Windows structure |
| [03-ux-flow.md](03-ux-flow.md) | First-run, ActivityWatch, pairing, tray to dashboard, per-view dead ends |
| [04-usability.md](04-usability.md) | P0 to P3 with repro-from-code and acceptance criteria |
| [05-usefulness.md](05-usefulness.md) | Value, false confidence, SOURCE-COVERAGE, when the promise fails |
| [06-cross-platform-consistency.md](06-cross-platform-consistency.md) | Parity, install/update, web versus native shells |

## How to use this backlog

Work top down. Each item is written so a later agent can implement without re-auditing. Prefer tests that already exist (`scripts/*.test.mjs`, Mac preview flags, Windows `--test-*`). Do not attach private records.

Skip an item if a human product decision is required and not recorded. Several P1 items are "change the UI **or** change the docs." Pick one in the PR description.

## Prioritized backlog

### 1. Surface Mac pairing-pause so Refresh cannot silently no-op

- **Problem.** Failed pairing leaves collection paused for the session with no dashboard or panel copy.
- **Evidence.** `native/Store.swift:17`, `native/Store.swift:86`. `native/main.swift` assignments near 394, 442, 473, 514. Windows already MessageBoxes pause (`native/windows/Program.cs` disconnect/repair catch).
- **See.** [04-usability.md](04-usability.md) P0-1, [03-ux-flow.md](03-ux-flow.md) Journey 3.
- **Acceptance.** Published or otherwise observed pause state. Persistent callout on dashboard and menu-bar panel. Refresh explains pause. Saved snapshot unchanged. Tests cover fail then visible pause then retry/quit clear.
- **Non-goals.** Auto-retry pairing. Protocol changes.

### 2. Make first-run pairing copy match the supported SSH path

- **Problem.** Wizard welcome claims direct encrypted pairing. Step 3 requires SSH. TLS is a separate unverified window.
- **Evidence.** `native/SetupWizard.swift:18`, `native/SetupWizard.swift:27-29`. `native/windows/SetupWizard.cs:40`, `native/windows/SetupWizard.cs:70-72`. `docs/PRODUCT-DIRECTION.md:16-18`. `native/DirectPairingWindow.swift:58`.
- **See.** [04-usability.md](04-usability.md) P0-2, [03-ux-flow.md](03-ux-flow.md) Journeys 1 and 3, [01-features.md](01-features.md) documentation table.
- **Acceptance.** Welcome and step 3 describe the same model. SSH prerequisites are explicit before Pair now. Direct TLS labeled preview or not offered as the finished first-release path. No implied LAN discovery or QR.
- **Non-goals.** Implementing QR/code pairing. Shipping TLS as default without `docs/LOCAL-PAIRING.md` gates.

### 3. Give ActivityWatch failures a next step without inventing zeros

- **Problem.** Screen time is a README pillar. Enablement is a checkbox. Unavailable reads look like empty usage with no installer guidance.
- **Evidence.** `native/SetupWizard.swift:24`. `native/NativeSettings.swift:46`. Empty copy `native/NativeDashboard.swift:203-204`, `app/page.tsx` ~513-515. `docs/SOURCE-COVERAGE.md` ActivityWatch row.
- **See.** [04-usability.md](04-usability.md) P0-3, [03-ux-flow.md](03-ux-flow.md) Journey 2, [05-usefulness.md](05-usefulness.md) section 2.
- **Acceptance.** Enabled-but-unavailable Activity empty states (Mac, Windows, web) say ActivityWatch is separate, must be running, and link to the official site. Still unknown, not zero. Settings matches.
- **Non-goals.** Bundling or spawning ActivityWatch. Reading window titles.

### 4. Align landing view across README, GUIDE, demo, and both native launches

- **Problem.** All UIs open Allowances. GUIDE says Activity opens in Day view. README leads with Screen time. Quota-off users land on an empty account card.
- **Evidence.** `app/page.tsx:175`. `native/NativeDashboard.swift:11`. `native/windows/NativeDashboard.cs:46`. `native/main.swift:85`. `docs/GUIDE.md:27`.
- **See.** [04-usability.md](04-usability.md) P1-2, [02-ui.md](02-ui.md) Information hierarchy, [01-features.md](01-features.md) Claimed product.
- **Acceptance.** One landing view documented and implemented everywhere, including `scripts/demo.mjs` consumers. If Allowances stays default, GUIDE and README say so.
- **Non-goals.** User-customizable home widgets.

### 5. Resolve Workflows / Agents information architecture

- **Problem.** README Workflows and GUIDE Agents are not nav items. WINDOWS.md lists Agents as a top-level native section. Implementation nests under Sources. Windows collector does not read receipts.
- **Evidence.** `README.md:22`. `docs/GUIDE.md:17`. `docs/WINDOWS.md:23`. `native/NativeDashboard.swift:254-256`. `native/windows/NativeDashboard.cs:43`. `scripts/collect-windows.mjs` (no workflows import). `scripts/peer-payload.mjs:103-105`.
- **See.** [04-usability.md](04-usability.md) P1-3 and P1-8, [01-features.md](01-features.md) Workflows, [06-cross-platform-consistency.md](06-cross-platform-consistency.md) receipts row.
- **Acceptance.** Same Agents placement on Mac, Windows, and web. Docs match. `#agents` expands that place. Windows empty state says the platform does not collect receipts **or** an opt-in Windows reader exists with the same sanitization bounds. GUIDE no longer says four named files if the scanner is 128 `*.usage.json`.
- **Non-goals.** Live agent monitoring. Adding receipts to peer payloads without new consent.

### 6. Fix compact Settings affordance on Mac

- **Problem.** Gear labeled Observatory settings opens the status menu.
- **Evidence.** `native/Panel.swift:99`. `native/main.swift:196`.
- **See.** [04-usability.md](04-usability.md) P1-1, [02-ui.md](02-ui.md) Compact chrome, [03-ux-flow.md](03-ux-flow.md) Journey 4.
- **Acceptance.** Gear opens Settings in the main window, or the label stops saying settings. Right-click still opens the full menu. Popup test updated.
- **Non-goals.** Full Settings inside the panel.

### 7. Make Refresh versus Reload verbs honest on Windows native and in WINDOWS.md

- **Problem.** Native Refresh sources collects. Docs and web Reload snapshot only read.
- **Evidence.** `native/windows/NativeDashboard.cs:93-101`. `docs/WINDOWS.md:51`. `app/page.tsx:303-312`.
- **See.** [04-usability.md](04-usability.md) P1-4, [06-cross-platform-consistency.md](06-cross-platform-consistency.md) Shared web UI table.
- **Acceptance.** Native help text says collection starts. WINDOWS.md describes the native default. Optional separate read-only reload must not call `collector.Refresh()`.
- **Non-goals.** Changing the five-minute interval.

### 8. Rewrite GUIDE so native apps are the primary path

- **Problem.** GUIDE teaches `local.config.json`, SSH aliases, and `npm run collect` as how you connect records. Native Windows is standalone. Native Mac does not SSH unless legacy config remains.
- **Evidence.** `docs/GUIDE.md:60-72`. `docs/SOURCE-COVERAGE.md:7-11`. `README.md:39-45`. `scripts/collect-windows.mjs:42-43`.
- **See.** [04-usability.md](04-usability.md) P1-5, [01-features.md](01-features.md) documentation table, [03-ux-flow.md](03-ux-flow.md) Journey 1 legacy path.
- **Acceptance.** GUIDE starts from native install, wizard, ActivityWatch, optional pairing. SSH hub is a titled legacy/developer appendix. `docs/STARTUP.md` already splits native versus legacy LaunchAgents. GUIDE should match that split.
- **Non-goals.** Deleting `collect-dashboard.mjs`. Forcing migration by deleting `local.config.json` (`docs/MAC-MIGRATION.md`).

### 9. Show `peerQuota` in the React Allowances view or document native-only

- **Problem.** Paired snapshots can carry shared account history that the web and legacy dashboard ignore.
- **Evidence.** `app/page.tsx:372`. `native/NativeDashboard.swift:111-119`. `native/windows/NativeDashboard.cs` ~160. `docs/USAGE-LIMITS.md` peerQuota paragraph.
- **See.** [04-usability.md](04-usability.md) P1-7, [05-usefulness.md](05-usefulness.md) Codex quota, [01-features.md](01-features.md) Unified allowance history.
- **Acceptance.** Web renders `peerQuota` with never-summed copy, or explicit native-only copy. Synthetic snapshot test.
- **Non-goals.** Summing peer into local. Browser quota fetches.

### 10. Windows accessibility and zoom: implement or accept in WINDOWS.md

- **Problem.** Mac has section keys and 75% to 200% zoom. Windows native does not. Wizard checkboxes lack explicit accessible names.
- **Evidence.** `docs/MAC.md:13-18`. `docs/WINDOWS.md:41`. `native/windows/SetupWizard.cs:46-65`. `docs/UI-VERIFICATION.md` Still open.
- **See.** [04-usability.md](04-usability.md) P1-6, [02-ui.md](02-ui.md) Accessibility, [06-cross-platform-consistency.md](06-cross-platform-consistency.md) Shell table.
- **Acceptance.** Either Ctrl+1 to 6 plus text scale tests, plus wizard `AccessibleName`s, **or** WINDOWS.md lists these as accepted gaps (not vague "parity unfinished").
- **Non-goals.** Rewriting WinForms in another UI toolkit.

### 11. Dictation stub controls

- **Problem.** ChatGPT filter is always not-supported. All voice time is always Unknown. "Coming soon" on three UIs.
- **Evidence.** `scripts/voice-overview.mjs:17-19,42-43`. `app/dictation.tsx:22-31,56`. `native/NativeRecordedUsage.swift:93-99`. `native/windows/NativeDictation.cs:33,45,60`.
- **See.** [04-usability.md](04-usability.md) P2-1, P2-2, [05-usefulness.md](05-usefulness.md) false confidence table.
- **Acceptance.** No ChatGPT control that looks like a live source. All-tools total relabeled as not computed. Coming soon removed or tied to ROADMAP without dates.
- **Non-goals.** ChatGPT voice reader. Summing devices.

### 12. Native development footers and Sources naming

- **Problem.** Every native section carries unfinished-product captions. Sources means health and also Settings.
- **Evidence.** `native/NativeDashboard.swift:128-129`. `native/windows/NativeDashboard.cs:109`. Sidebar versus Settings in [02-ui.md](02-ui.md).
- **See.** [04-usability.md](04-usability.md) P2-3, P2-4.
- **Acceptance.** Footer once in Settings or only when relevant. Sidebar label not colliding with Settings source toggles. Command-5 / docs updated.
- **Non-goals.** Claiming provider management is done.

### 13. Direct pairing join Ubuntu scope on Mac

- **Problem.** Host confirm sends `includeUbuntu`. Join confirm sends false.
- **Evidence.** `native/DirectPairingWindow.swift:113` versus `:123`. Windows `DirectPairingWindow.cs:46` uses the checkbox.
- **See.** [04-usability.md](04-usability.md) P2-5, [06-cross-platform-consistency.md](06-cross-platform-consistency.md) TLS row.
- **Acceptance.** Same scope control on host and join, or join UI disables the toggle with an explanation. Model test updated (`DirectPairingTests.swift` if applicable).
- **Non-goals.** Enabling TLS in installed release builds.

### 14. Mac update-lock termination UX

- **Problem.** Install lock causes `NSApp.terminate` with no alert.
- **Evidence.** `native/MacUpdateGate.swift`. `native/main.swift:29-33`. Windows `Program.cs:135`.
- **See.** [04-usability.md](04-usability.md) P2-6, [06-cross-platform-consistency.md](06-cross-platform-consistency.md) Update gate row.
- **Acceptance.** Foreground launches show one alert then exit. `--background` may stay quiet.
- **Non-goals.** Automatic updates.

### 15. Windows Configure window lifecycle and popup All-host copy

- **Problem.** Configure may `ShowDialog` a second dashboard. Popup All host omits the verified-combined footnote the tray dialog has. Popup refresh errors may be silent.
- **Evidence.** `native/windows/Program.cs:330-339,360`. Usage popup refresh `finally` (see [04-usability.md](04-usability.md) P2-7, P2-9).
- **See.** [02-ui.md](02-ui.md) Windows tray, [03-ux-flow.md](03-ux-flow.md) Journey 4.
- **Acceptance.** Configure uses the same main window as Open Observatory. All-host unverified tokens explained in the popup. Failed refresh visible. No second collector.
- **Non-goals.** Changing single-instance mutex behavior except as needed for the modal bug.

### 16. Panel health indicator and pairing/setup truth

- **Problem.** Green N of M sources read can hide pause, stale quota, or setup-required.
- **Evidence.** `native/Panel.swift:76-78`. `native/Store.swift` pause flag.
- **See.** [04-usability.md](04-usability.md) P2-10, [05-usefulness.md](05-usefulness.md) false confidence table.
- **Acceptance.** Indicator is not "success green" unless collection is allowed, not paused, and freshness policy matches existing stale (900s) rules. Setup-required and pause override the count.
- **Non-goals.** Per-source tray charts.

### 17. Loopback `setup.json` and web Settings dead end

- **Problem.** Windows unconfigured copy never appears under `npm run serve:local`. Web Settings cannot configure anything.
- **Evidence.** `docs/WEB-BOUNDARIES.md:8`. `app/page.tsx:373-376`.
- **See.** [04-usability.md](04-usability.md) P2-8, [01-features.md](01-features.md) Web Settings.
- **Acceptance.** Document native-only first-run copy, or serve bounded setup.json without pairing files. Web Settings must not look like a connections manager.
- **Non-goals.** Turning the dashboard into a shell-command API (`AGENTS.md`).

### 18. Version string and leftover flags (P3)

- **Problem.** `package.json` 0.1.0 versus `native/Release.props` 0.3.12. `--native-dashboard` no-op. Possible unused `recharts` / shadcn.
- **Evidence.** [04-usability.md](04-usability.md) P3-3 to P3-5. [01-features.md](01-features.md) unused toolkit.
- **Acceptance.** Version story documented or unified. Flag documented. Dependency removal only after import graph.
- **Non-goals.** Marketing version bumps without a release.

### 19. Appearance and type mismatch on Mac compact UI (P3)

- **Problem.** Popup forced dark, system fonts, no zoom.
- **Evidence.** `native/Panel.swift:18-19,103`. `docs/MAC.md:19`.
- **See.** [04-usability.md](04-usability.md) P3-1, P3-2, P3-6. [02-ui.md](02-ui.md) Three shells.
- **Acceptance.** Follow dashboard appearance **or** MAC.md states compact UI is always dark system chrome. Setup dialogs documented as unscaled.
- **Non-goals.** 200% zoom inside the 370pt popover.

## Out of scope for Codex UI/docs repairs

These are real product gaps. They are not the next UI patch:

- Public signed installers, notarization, SmartScreen, Sparkle/WinSparkle production feeds (`docs/UPDATES.md`, README).
- Completing TLS two-device sync (`docs/LOCAL-PAIRING.md` integration list).
- Provider account add/switch/remove and non-Codex quotas (`docs/PRODUCT-DIRECTION.md` Current gaps).
- iPhone, Gemini import, ChatGPT voice, Linux desktop app.
- Migrating installed `local.config.json` Mac previews automatically (`docs/MAC-MIGRATION.md`).
- Clean-machine login and sleep/wake certification (`docs/RELEASE-CHECKLIST.md`).

## Suggested first PR slice

Items 1, 2, 3, and 6 are the highest-impact UX repairs that do not require a pairing protocol change. Pair them with docs item 8 if the PR already touches GUIDE.

Keep missing-data honesty. Add next steps only when state is known. Use "Unknown" for missing values.
