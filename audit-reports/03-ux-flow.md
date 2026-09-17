# Critical user journeys

This report walks first-run, ActivityWatch, pairing, tray to dashboard, and each product view. Friction and dead ends are tied to code. Runtime behavior that was not executed here is labeled as a hypothesis.

Honest missing-data copy is generally strong. The main failures are **next-step** failures: the user can finish a screen without knowing what to install, what pairing path is real, or why the dashboard is empty.

## Journey 1. First-run and source enablement

### Mac

Launch with no `collector.config.json` and no `local.config.json` sets `store.setupRequired`. `applicationDidFinishLaunching` calls `showSetup()` and returns before opening the dashboard (`native/main.swift` lines 80 to 81, 89 to 107).

Wizard (`native/SetupWizard.swift`):

1. Welcome. Copy says collection stays off until setup finishes, and "This release uses direct encrypted device pairing."
2. Four toggles, all starting false: ActivityWatch, saved Codex, Codex account limits, Wispr. Receipts and benchmarks exist in `CollectorConfiguration.defaults` but are not in the wizard. They remain false unless later enabled in Settings.
3. Connect devices. Copy then says the current connection requires an existing SSH alias, trusted host key, and key-based sign-in. Automatic discovery is not available yet. Account-limit history is not synchronized yet.

Finish on this Mac writes selected booleans and opens Allowances, then refreshes. Finish and pair Windows also calls `setupPairing()`. Preview disables the pair button.

Closing the wizard without Finish leaves `setup-state.json` completed false and all sources false (`FirstRunSetup.prepare` lines 27 to 32). Restart shows the wizard again. That is correct fail-closed behavior. There is no in-app explanation on the menu-bar panel beyond waiting for a snapshot, because collection never starts.

### Windows

`Open()` shows `SetupWizard` when setup is required (`Program.cs` around 370 to 377). Cancel does not start the collector.

Windows step 2 adds Ubuntu WSL and "Use Ubuntu's Codex account instead of Windows" (`SetupWizard.cs` lines 44 to 66). WSL is disabled until Codex is checked. Quota account checkbox enables only when quota is checked.

Step 3 tells the user to pair **from the Mac** using this PC's pairing details in the tray after setup. There is no "Finish and pair" equivalent. Direct TLS is not in the wizard.

### Dead ends in this journey

1. **Pairing story split.** Welcome promises direct encrypted pairing. Step 3 requires SSH. Direct TLS is a later Settings window that still says live sync is unverified (`DirectPairingWindow.swift` line 58, `DirectPairingWindow.cs` line 145).
2. **ActivityWatch is a checkbox, not an installer.** Copy says it must already be running (`SetupWizard.swift` line 24). No link, no local port check, no "I do not have ActivityWatch" path.
3. **Quota without a working Codex GUI client.** Enabling quota uses the installed Codex sign-in. WINDOWS.md records that the native Windows Codex client could not be launched on the development machine. The wizard still offers the toggle.
4. **Allowances-first empty dashboard.** After Finish with only ActivityWatch enabled, the first window is still Allowances with no account connected. Hypothesis: users think setup failed.
5. **Legacy GUIDE path.** A developer who follows `docs/GUIDE.md` copies `local.config.json`, runs `npm run collect`, and never sees this wizard. That is a different product surface (SSH hub) that README no longer presents as the primary app.

## Journey 2. ActivityWatch dependency

Screen time is ActivityWatch foreground intervals intersected with non-away intervals (`docs/SOURCE-COVERAGE.md` table). Observatory does not bundle or start ActivityWatch.

If the user enables activity and ActivityWatch is down:

- Readers throw and collectors store `status: 'unavailable'` (`collect-dashboard.mjs` ActivityWatch path, native collectors via `guarded`).
- UI empty copy says the source is unavailable and unknown, not zero (web `app/page.tsx` around 513 to 515, native empty states).

That honesty is correct. The next step is missing. Settings repeat "ActivityWatch must be running separately" (`NativeSettings.swift` line 46) without a download URL, a localhost:5600 check, or a distinguished "not installed" versus "installed but stopped" state.

Hypothesis: a fresh Mac or Windows user enables screen time, waits five minutes, sees Unknown active time, and has no in-app recovery besides Refresh.

WSL activity is documented as part of Windows screen time, not a third desktop (`Panel.swift` lines 71 to 73). There is no Ubuntu activity tab in the web Activity host list. That matches SOURCE-COVERAGE. GUIDE readers who expect three activity hosts will not find Ubuntu there.

## Journey 3. Pairing and SSH

Product direction (12 September 2026) selected direct encrypted pairing without an Observatory account. Existing SSH remains the implementation starting point (`docs/PRODUCT-DIRECTION.md` lines 16 to 18).

### Working SSH path (Mac-initiated)

1. Windows: **Pairing details for Mac…** copies three installation paths after an explicit click (`PairingDetails`). Disabled if bundled tools are missing.
2. Mac: **Pair with Windows…** form (`PairingSetupDialog.swift`) with SSH alias plus those paths. Paste Windows details fills paths only. It cannot set the alias.
3. Setup blocks collection while the dialog or request is active. Success resumes collection. Failure sets `collectionPausedForPairing = true` (`native/main.swift` around 394, 442, 473, 514).

Requirements the UI cannot create: working noninteractive SSH, trusted host key, matching collector scripts on Windows (`docs/PAIRING-MAINTENANCE.md` lines 7 to 11).

Disconnect and repair are explicit two-device operations with confirmations. Repair on one device cannot replace the other device's generation.

### Direct TLS path (Settings, not wizard)

Mac Settings **Direct device pairing…** and Windows Settings **This device** open host/join UI. Identity storage is a restricted plaintext file, not Keychain or DPAPI (`docs/LOCAL-PAIRING.md`). UI must disclose that. Native flows invoke identity creation after consent.

Acknowledged copy: "Pairing setup acknowledged. This does not verify live data sync or source availability." (`DirectPairingWindow.swift` line 58).

Mac `finishJoining()` sends `includeUbuntu: false` always (`DirectPairingWindow.swift` line 123). Host confirm uses the `includeUbuntu` toggle (line 113). Windows Finish joining sends `ubuntu.Checked` (`DirectPairingWindow.cs` line 46). That is a cross-platform join-scope bug if the Mac is the joining device.

`docs/LOCAL-PAIRING.md` records a 13 September two-device live fixture: listeners accepted local TCP, cross-device attempts timed out before TLS, Windows outbound firewall was not changed. That is not evidence of working two-device sync.

Tailscale is a manual **Check Tailscale** action. Peer reachability is always `not-checked` in the helper contract (`TailscaleReadiness.swift` lines 30 to 32). Caption: "Local-network code pairing is still being developed." (`TailscaleReadiness.swift` line 84). Membership does not grant sharing consent.

### Silent pause after pairing trouble (Mac)

`ObservatoryStore.collectionPausedForPairing` is a plain `var`, not `@Published` (`Store.swift` line 17). `refresh()` returns immediately when it is true (line 86). Dashboard and panel do not show a pairing-pause callout. Hypothesis: after a failed Pair with Windows, the menu-bar freshness clock stops updating and Refresh appears to do nothing.

Windows pairing failure MessageBoxes say collection is paused for this session (`Program.cs` repair/disconnect catch paths). That is clearer than Mac.

### Allowance sharing is a fourth pairing concept

Settings can enable quota sharing. Copy says this is consent, not proof of a completed exchange (`NativeSettings.swift` lines 137 to 138). README: real-device allowance sharing remains unverified and off on the development pair. Wizard still says account-limit history is not synchronized yet (`SetupWizard.swift` line 27), which can contradict a later sharing toggle if the user never re-reads Settings.

## Journey 4. Tray or menu bar to dashboard

Happy path: compact overview, Open Observatory, full window, collector keeps running after close.

Friction:

1. Mac gear labeled Settings opens the context menu (`02-ui.md`).
2. Windows left-click toggles the popup closed. Users hunting for Open Observatory must use the menu or double-click.
3. Telescope icon "possibly under the hidden-icons arrow" (`docs/WINDOWS.md` line 17). Web first-run copy repeats that (`app/page.tsx` line 367). Easy to miss on a fresh Windows install.
4. `--background` / login startup opens tray only. User may not know a dashboard exists until they find the icon.
5. Legacy versus native. `--legacy-dashboard` changes the main window. Single-instance Windows activation does not change the already running display mode (`docs/WINDOWS.md` line 23). Hypothesis: a user who launches with a different flag sees the old instance and thinks the flag failed.

## Journey 5. Each view

### Screen time (Activity)

Day, week, all retained. Host filters include Combined / All, Mac, Windows, Ubuntu (native history) even though Ubuntu has no separate activity series.

Week timeline is a first-class web control (`app/week-timeline.tsx`). Native Mac uses Charts. Native Windows uses tables plus hour graphs in detail.

Missing tracking is muted and is not a zero total (GUIDE, SOURCE-COVERAGE, web week bands). Tracked idle can display zero. That distinction is implemented.

Friction: no in-view "install ActivityWatch" when status is unavailable. Combined activity needs a fresh peer merge (payloads within ten minutes, `peer-payload.mjs` line 97). Stale peers yield Combined unavailable. Hypothesis: paired users with one asleep device see Combined disappear and think overlap math broke.

### AI usage (Tokens)

Per-host days from saved logs. All-host withheld on overlap or incomplete inventory. Settings breakdown withheld when counters do not reconcile (`NativeDailyDetails` / `NativeTokenDetails`).

Friction: dollar API comparison looks like a bill unless the user reads "Hypothetical" / "not subscription charges". Web and native both label this. Still a usefulness risk (`05-usefulness.md`).

Quota lives in Allowances, not Tokens. Users chasing "how much Codex I have left" from the README AI usage row may stay on Tokens.

### Workflows (Sources nested)

"Not a live agent monitor." (`NativeDashboard.swift` line 245, web similar). Failed receipts show Unknown tokens.

Friction: empty on Windows native by collector design. Empty on fresh Mac unless receipts/benchmarks are on and legacy `local.config.json` still has paths (`NativeSettings.swift` lines 64 to 72). New installs default those flags off (`CollectorConfiguration.defaults`).

GUIDE says the Antigravity adapter reads four named receipt files. Implementation scans up to 128 `*.usage.json` files (`scripts/agent-receipts.mjs`). Docs are stale.

### Dictation

Wispr rows can be useful. ChatGPT filter is a dead control. All voice time is always Unknown. Chip "Partial coverage" is always shown on web (`dictation.tsx` line 22) even when Wispr is ok.

Device filter is Mac and Windows only. Ubuntu voice is not a source.

### Allowances

Empty if quota is off or not-connected. Pace estimates from sparse history. Retired Spark windows filtered.

Web does not show `peerQuota`. Native does, labeled as never added to local totals.

Browse saved allowance history is Mac sheet / Windows window. Packaged verification still called out as open in WINDOWS.md.

### Sources and Settings

Health versus configuration split (`02-ui.md`). Web Settings is a dead end for pairing. Mac Settings blocks native toggles when `!store.localCollection` (legacy `local.config.json` present): "Migration to these controls is not yet available." (`NativeSettings.swift` lines 40 to 41). That is a dead end for existing Mac preview users. `docs/MAC-MIGRATION.md` says not to delete `local.config.json` to force native collection.

## Missing-data honesty versus next steps

The product is careful not to invent zeros. Empty states often stop at the principle ("unknown, not zero") without a command.

Suggested pattern for Codex repairs: keep Unknown. Add one concrete next action when the cause is known in state (setup incomplete, ActivityWatch unavailable, unpaired Combined, pairing paused, quota not connected, receipts not configured).

Do not add next actions that claim a source is connected when it is not (`docs/PRODUCT-DIRECTION.md` line 10).

## Journey map (intended versus actual)

```text
Install (public installer: not available)
  -> First-run wizard (sources off)
  -> Optional pair
       advertised: direct encrypted pairing
       shipped: SSH from Mac, TLS window experimental
  -> Collection every 5 minutes if configured
       screen time needs separate ActivityWatch
  -> Compact tray / menu bar
  -> Main dashboard defaults to Allowances
  -> Activity / Tokens / Dictation / Sources
```

The demo at GitHub Pages skips this entire path with fictional records (`scripts/demo.mjs`). That is useful for UI exploration and does not train first-run recovery.
