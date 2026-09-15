# Usability problems

Severity is impact on a first-time or daily user, not engineering effort. P0 blocks the promised setup-to-history outcome or hides a collection stop. P1 is high friction or a docs/UI betrayal on a primary path. P2 is moderate. P3 is polish.

The desktop apps were not run here. Where a repro is inferred from control flow, it is labeled **Repro from code**. Confirm on a signed-in Mac and Windows desktop before treating visual or timing details as proven.

Codex should implement one item at a time against the acceptance criteria. Non-goals for this audit are listed on each item. The ordered backlog is `00-codex-handoff.md`.

## P0

### P0-1 Silent Mac collection pause after pairing failure

**Problem.** After a failed pairing, disconnect, or repair helper, Mac sets `collectionPausedForPairing` and `refresh()` becomes a no-op. The flag is not `@Published`. Compact and main UIs keep showing the last freshness string.

**Evidence.** `native/Store.swift` lines 17, 82 to 86. Assignments in `native/main.swift` around 394, 442, 473, 514. Contrast Windows MessageBox paths in `native/windows/Program.cs` disconnect/repair `catch` blocks.

**Repro from code.** In a native Mac build, start Pair with Windows, force the helper to fail (invalid alias or missing remote script). Dismiss the error. Click Refresh in the dashboard or panel. `refresh()` returns at the guard. `lastAttempt` is not updated by that guard.

**Acceptance.**

- When `collectionPausedForPairing` is true, dashboard header and menu-bar panel show a persistent callout: collection is paused for this app session, saved snapshot unchanged.
- Refresh explains the pause instead of appearing enabled and doing nothing.
- Retry pairing or Quit clears the pause as today, and the callout disappears.
- Tests: existing pairing-failure fixtures assert the callout string is present in the view model or panel copy.

**Non-goals.** Do not auto-retry pairing. Do not unpause on a timer. Do not change SSH or TLS protocols.

### P0-2 First-run pairing copy contradicts the only complete pairing path

**Problem.** Wizard welcome says this release uses direct encrypted device pairing. Step 3 requires an existing SSH alias. Direct TLS is a separate Settings window whose success state says live sync is not verified. Users can finish setup believing devices will discover each other.

**Evidence.** `native/SetupWizard.swift` lines 18 and 27 to 29. `native/windows/SetupWizard.cs` lines 40 and 70 to 72. `docs/PRODUCT-DIRECTION.md` lines 16 to 18. `DirectPairingWindow.swift` line 58. `docs/LOCAL-PAIRING.md` live two-device timeout.

**Repro from code.** Read wizard steps in order. Finish on this Mac without pairing. Open Settings and compare **Pair with Windows…** versus **Direct device pairing…**.

**Acceptance.**

- Wizard step 1 and step 3 use the same pairing model. If SSH is the supported path, welcome must not say the release uses consumer direct pairing as a completed capability.
- Optional pairing step lists what the user must already have (SSH alias, trusted host key, key auth) before offering Pair now.
- Direct TLS is labeled preview or hidden until the LOCAL-PAIRING integration gate is met.
- Unsupported discovery (code/QR, automatic LAN find) is not implied.

**Non-goals.** Do not implement QR pairing in this repair. Do not remove the TLS modules. Do not enable TLS in installed apps without the existing security checklist.

### P0-3 ActivityWatch enablement has no recovery path

**Problem.** Screen time is a headline feature. The only in-app control is a boolean. If ActivityWatch is missing or stopped, the Activity view is empty Unknown with no installer, port check, or distinct not-installed state.

**Evidence.** `SetupWizard.swift` line 24. `NativeSettings.swift` line 46. `docs/WINDOWS.md` line 139. Collectors map reader throws to `unavailable`. Empty UI: `NativeDashboard.swift` 203 to 204, `app/page.tsx` 513 to 515.

**Repro from code.** Complete setup with only `activity: true`. Do not run ActivityWatch. Wait for collection. Snapshot activity status is unavailable. UI shows unknown, not zero, and no next step.

**Acceptance.**

- When activity is enabled and the last snapshot status is unavailable or not-connected, Activity empty state includes: ActivityWatch must be installed and running separately, Observatory does not bundle it, plus a link to the official ActivityWatch site.
- Settings copy matches.
- Do not invent idle zeros while the source is unavailable.
- Optional later enhancement (not required for this item): distinguish connection refused versus enabled-but-empty. If added, tests must not treat missing coverage as zero activity.

**Non-goals.** Do not bundle ActivityWatch. Do not start it as a child process. Do not read window titles.

## P1

### P1-1 Compact Mac gear claims Settings and opens the tray menu

**Problem.** Accessibility label "Observatory settings" (`Panel.swift` line 99) calls `showMenu()` (`main.swift` line 196). Command-comma and the app menu correctly open Settings (`sourceSettings`).

**Repro from code.** Click the gear in the menu-bar panel. Context menu appears. Native Settings section does not.

**Acceptance.** Gear opens the main window on the Settings section (or a menu item literally named Settings). Right-click on the status item still opens the full menu. Label matches behavior. `--test-popup` or equivalent asserts the settings callback.

**Non-goals.** Do not put full Settings controls inside the 370pt panel.

### P1-2 Default landing is Allowances while README and GUIDE lead with Activity

**Problem.** `openDashboard("allowances")`, web `useState('allowances')`, Windows `SelectedIndex = 0`. GUIDE line 27 says Activity opens in Day view.

**Acceptance.** Pick one product landing view and use it in README, GUIDE, demo, Mac launch, and Windows launch. If Allowances remains default, GUIDE must not say Activity opens first. If Activity becomes default, quota-empty users still need a way to notice Allowances.

**Non-goals.** Do not add customizable widgets (`docs/PRODUCT-DIRECTION.md` Deferred).

### P1-3 README Workflows / GUIDE Agents are not a top-level view

**Problem.** Six-section chrome. Agents nested under Sources. WINDOWS.md line 23 still lists Agents as a sibling.

**Acceptance.** Either add an Agents/Workflows section on Mac, Windows, and web with the same snapshot data, or change README, GUIDE, and WINDOWS.md to Sources then Execution details. Hash `#agents` should land on that place with visible expanded details.

**Non-goals.** Do not add live agent monitoring. Do not export receipts over pairing (Mac currently keeps them owner-local).

### P1-4 Windows native Refresh sources runs collection while docs say Reload snapshot

**Problem.** `NativeDashboard.cs` lines 93 to 101. `docs/WINDOWS.md` line 51 describes read-only reload for the (legacy) dashboard. Web button is Reload snapshot and only fetches JSON (`app/page.tsx` 303 to 312).

**Acceptance.** Native label and help text state that Refresh sources starts collection. If a read-only reload is required, it is a separate control that does not call `collector.Refresh()`. WINDOWS.md matches the native default.

**Non-goals.** Do not change collector interval.

### P1-5 GUIDE still teaches the SSH hub as the current collector

**Problem.** `docs/GUIDE.md` lines 60 to 72. Native apps use `collector.config.json` and local readers. Users who follow GUIDE on Windows will not find a standalone tray app workflow.

**Acceptance.** GUIDE opens with native Mac/Windows install and wizard. SSH `local.config.json` plus `npm run collect` is a clearly titled legacy/developer path. README Try it section links the native path first.

**Non-goals.** Do not delete the legacy collector. Existing `local.config.json` installs must keep working (`NativeSettings` migration wall).

### P1-6 Windows keyboard and zoom parity with Mac

**Problem.** Mac Command-1 to 6 and 75% to 200% zoom (`docs/MAC.md` 13 to 18). Windows native has neither. Full accessibility review is unfinished (`docs/WINDOWS.md` 41).

**Acceptance.** Document as an accepted Windows-only limit in WINDOWS.md **or** implement Ctrl+1 to Ctrl+6 and a 75% to 200% text scale with tests analogous to Mac `DashboardZoom`. Setup wizard checkboxes expose `AccessibleName` matching visible titles (`SetupWizard.cs` 46 to 65).

**Non-goals.** Do not port SwiftUI to WinUI in this item.

### P1-7 Web Allowances omits `peerQuota`

**Problem.** Native renders peer quota separately (`NativeDashboard.swift` 111 to 119, `NativeDashboard.cs` ~160). Web `<Allowances quota={data.quota} />` (`app/page.tsx` 372). Paired users on `--legacy-dashboard` or the public-style web UI will not see shared allowance history even if the snapshot contains it.

**Acceptance.** Web Allowances shows `peerQuota` with the same never-summed labeling as native, or the web view states that shared account history is native-only. Tests with a synthetic snapshot that includes `peerQuota`.

**Non-goals.** Do not add peer percentages into local totals. Do not fetch quota from the browser.

### P1-8 Windows workflows never collected

**Problem.** `collect-windows.mjs` has no `collectLegacyWorkflows`. Merge sets `agents:[]` (`peer-payload.mjs` 103 to 105). README Workflows claims agent receipts on the product.

**Acceptance.** WINDOWS.md and README state Windows native does not read Antigravity receipts or Ubuntu benchmarks **or** Windows gains an equivalent opt-in reader with the same sanitization bounds. Empty Agents UI must say the source is not collected on this platform, not merely "no receipts".

**Non-goals.** Do not scrape arbitrary folders. Do not add receipts to peer payloads without a new consent category.

## P2

### P2-1 Dictation ChatGPT control and "coming soon"

**Evidence.** `app/dictation.tsx` 24, 56. `voice-overview.mjs` 17 to 19. `NativeRecordedUsage.swift` 74 to 75, 99. `NativeDictation.cs` 24, 60.

**Acceptance.** Remove ChatGPT from filters until a reader exists, or keep a single disabled row "Tracking not yet verified" without implying comparable coverage. Remove "coming soon" or point at `docs/ROADMAP.md` without promising a date.

**Non-goals.** Do not implement ChatGPT voice capture in this repair.

### P2-2 All voice time always Unknown

**Evidence.** `voice-overview.mjs` 42 to 43. `NativeRecordedUsage.swift` 93 to 94. `NativeDictation.cs` 45.

**Acceptance.** Relabel as "All-tools speech time is not computed" so it does not look like a failed load of a real total. Keep device rows.

### P2-3 Development footers on every native section

**Evidence.** `NativeDashboard.swift` 128 to 129. `NativeDashboard.cs` 109.

**Acceptance.** Show once in Settings or only when quota/providers are incomplete. Release candidates should not stamp "Native migration preview" on Activity.

### P2-4 Sources versus Settings naming

**Acceptance.** Rename sidebar Sources to Source health (or Coverage). Keep Settings for toggles. Update Command-5 / docs.

### P2-5 Mac join path ignores Ubuntu scope

**Evidence.** `DirectPairingWindow.swift` 113 versus 123. Windows sends `ubuntu.Checked` on join (`DirectPairingWindow.cs` 46).

**Acceptance.** Join confirm uses the same includeUbuntu control as host confirm, or the toggle is disabled with copy that join inherits host scope.

**Non-goals.** Do not change pairing generation format.

### P2-6 Mac update gate exits with no UI

**Evidence.** `MacUpdateGate.swift`. `main.swift` 29 to 33. Windows can MessageBox (`Program.cs` 135).

**Acceptance.** If the install lock exists, show one alert then terminate (unless `--background`). Copy matches Windows: try again when the installer finishes.

### P2-7 Windows Configure modal when main window is closed

**Evidence.** `Program.cs` 330 to 339.

**Repro from code.** Hypothesis: tray-only session, Configure, `ShowDialog()` on a new `NativeDashboard`.

**Acceptance.** Configure reuses or creates the same main window instance as Open Observatory, non-modal, single collector. Tests: no second collector, save still works.

### P2-8 Web `setup.json` only on native Windows bridge

**Evidence.** `app/page.tsx` 188 to 193, 367. `docs/WEB-BOUNDARIES.md` line 8. `serve-local.mjs` allows usage.json and collector.json only.

**Acceptance.** Document that the unconfigured Windows empty state is native-shell only, or serve a bounded setup.json from the loopback server without exposing pairing files.

### P2-9 Usage popup All host lacks verified-combined footnote

**Evidence.** Tray MessageBox adds it (`Program.cs` 360). Popup stats do not.

**Acceptance.** When host is All and combined tokens are unverified, popup shows the same sentence as the tray totals dialog.

### P2-10 Panel health dot overstates readiness

**Evidence.** `Panel.swift` 76 to 78.

**Acceptance.** Orange or muted when any source is failed, stale, pairing-paused, or setup-required, even if read count equals total. Do not use a green dot for "counts matched".

## P3

### P3-1 Mac popup always dark while dashboard can be light

**Evidence.** `Panel.swift` 103. `NativeDashboard.swift` 137.

**Acceptance.** Popup follows `observatoryAppearance` or MAC.md states the compact panel is always dark.

### P3-2 Panel uses system fonts, dashboard uses Inter Tight

**Evidence.** `Panel.swift` 18 to 19 versus `ObservatoryTheme`.

**Acceptance.** Align or document.

### P3-3 `package.json` version `0.1.0` versus native `0.3.12`

**Evidence.** `package.json` line 3. `native/Release.props`.

**Acceptance.** Single version source or an explicit note that npm version is not the desktop version.

### P3-4 Unused shadcn/recharts surface

**Hypothesis.** Confirm with import analysis. Remove unused dependencies only if no native/web preview relies on them.

### P3-5 `--native-dashboard` no-op on Windows

**Evidence.** `Program.cs` line 7. Self-test still mentions it.

**Acceptance.** Document leftover flag. Optional one-time stderr deprecation.

### P3-6 Setup and pairing dialogs ignore dashboard zoom

**Evidence.** `docs/MAC.md` line 19. `SetupWizard.swift` line 43.

**Acceptance.** Document only, or inherit last dashboard scale. Do not clip the 600-by-500 wizard.

## Test notes for Codex

Prefer existing harnesses:

- Mac: `--preview`, `--preview-setup`, `--test-popup`, `--test-lifecycle`, `DirectPairingTests`.
- Windows: `--test-native-dashboard`, `--test-setup-wizard`, `--test-usage-popup`, `--test-pairing-details`.
- JS: `scripts/*.test.mjs` with synthetic snapshots.

Do not attach private usage records. Do not enable live pairing against the owner's devices in CI.
