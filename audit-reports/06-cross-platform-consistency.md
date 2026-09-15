# Cross-platform consistency

Mac and Windows are meant to be one application with two shells (`docs/PRODUCT-DIRECTION.md`, `docs/ROADMAP.md` milestone 1). Shared React UI exists for the demo, `serve-local`, and `--legacy-dashboard`. Default production chrome is native SwiftUI on Mac and native WinForms on Windows.

This report lists feature, chrome, install, path, and docs divergence. Runtime parity was not executed here. Packaging sizes and CI run IDs below come from in-repo docs, not a new build.

## Shell and chrome

| Capability | Mac (`docs/MAC.md`, `native/`) | Windows (`docs/WINDOWS.md`, `native/windows/`) |
| --- | --- | --- |
| Compact UI | Menu-bar `NSStatusItem` + `NSPopover` / floating `NSPanel` | System tray `NotifyIcon` + borderless `UsagePopup` |
| Main window default | SwiftUI `NativeDashboard` | WinForms `NativeDashboard` |
| Legacy | `--legacy-dashboard` WebKit | `--legacy-dashboard` WebView2 (Edge runtime required) |
| Close main window | Collector stays in menu bar | Collector stays in tray. Quit from tray menu |
| Login startup | Login Items, `--background` suppresses window | Current-user Run key, `--background` |
| Single instance | Reopen restores section (`applicationShouldHandleReopen`) | Mutex `Local\\WorkspaceObservatory` plus activation event |
| Section shortcuts | Command-1 to Command-6 | None |
| Text zoom | 75% to 200%, not applied to popup or setup dialogs | None |
| Theme | Main window user light/dark. Popup always dark | Native always dark |
| Default host filter | Mac | Windows |
| Branding name | Observatory in UI. Bundle still "Workspace Observatory" in paths | Start menu **Workspace Observatory**. Tray Observatory |

Shared section list: Allowances, Activity, Tokens, Dictation, Sources, Settings. Agents nested under Sources on both, despite WINDOWS.md listing Agents as a sibling.

## Features that exist on one side more than the other

| Feature | Mac | Windows | Notes |
| --- | --- | --- | --- |
| SSH pair initiator | Yes (`Pair with Windows…`) | No. Exports paths for the Mac | SSH is Mac-initiated by design (`PAIRING-MAINTENANCE.md`, `USAGE-LIMITS.md` SSH sync Mac-initiated) |
| Pairing details copy | Paste Windows details | Copy Windows details | Real clipboard cross-device transfer unverified |
| Direct TLS window | Yes | Yes | Mac join hardcodes `includeUbuntu: false`. Windows join uses the checkbox |
| Receipts / benchmarks | Opt-in Settings, `collectLegacyWorkflows` | Not in `collect-windows.mjs` | Largest data-surface gap |
| WSL Ubuntu Codex | Only via leftover legacy SSH config | Native `wsl.exe --distribution` during collection | Windows wizard has WSL toggles. Mac wizard does not |
| Ubuntu as activity host | Filter present | Filter present | No Ubuntu activity series. WSL is Windows screen time |
| Saved snapshot file picker | Open saved snapshot in dashboard | Unknown as a first-class native control in the same shape | Mac `SnapshotArchive`. Windows has allowance archive window |
| Allowance archive browser | `NativeQuotaArchive` sheet | `QuotaArchiveWindow` | WINDOWS.md: packaged verification still open |
| Quota sharing UI | Settings section | Device settings sharing | Same consent model in docs |
| Tailscale check | Settings `TailscaleReadinessView` | Device settings button | Not automatic. Peer reachability not-checked |
| Power resume refresh | `NSWorkspace.didWakeNotification` (`Store.swift` 46 to 48) | `PowerResumeWindow` PBT_APMRESUMEAUTOMATIC | Both need live sleep/wake release tests |
| Update gate while replacing | `MacUpdateGate` silent terminate | Installation mutex MessageBox (unless `--background`) | `02-ui.md` P2-6 |
| Preview isolation | `--preview`, preview-only binary guard | `--test-native-dashboard` empty dir | Different flags, same idea |
| First-run test harness | Native `--preview-setup` | `--test-first-run` still legacy WebView2 | Windows native wizard tests are `--test-setup-wizard` |

## Shared web UI versus platform shells

`native/web/main.tsx` mounts `app/page.tsx`. Snapshot fetch is `./local/usage.json`, `collector.json`, `setup.json`.

| Behavior | Web | Native Mac | Native Windows |
| --- | --- | --- | --- |
| Reload | Read-only fetch | Refresh runs collector | Refresh sources runs collector |
| peerQuota | Not rendered | Rendered | Rendered |
| Settings | Theme plus "use native settings" | Full collection and pairing | Sources page plus This device page |
| Unconfigured empty state | Needs `setup.json` (Windows bridge) | Wizard before dashboard | Wizard before collection |
| Week timeline | `week-timeline.tsx` | Native charts | Tables / GDI+ hours |
| Demo label | `data.demo` | Preview runtime, not demo JSON | Test directories with synthetic data |

`--legacy-dashboard` on either OS is the closest cross-platform visual match. It is not the default. Feature work on the React dashboard can miss native-only users, and native-only work can miss the public demo.

`docs/GUIDE.md` still describes the native Mac app as WebKit detail views. `docs/MAC.md` says native SwiftUI is default. That docs split will confuse anyone comparing platforms.

## Install, update, bundling

| Topic | Mac | Windows |
| --- | --- | --- |
| Public installer | ZIP/DMG pipeline. Notarization and public release pending | NSIS per-user installer. Public release pending |
| Signing | Ad hoc in development. Not Developer ID | Unsigned candidates. SmartScreen warnings expected |
| Runtimes bundled | Node and Python from `native/mac/runtime-assets.json` | Node, Python, tzdata, .NET. WebView2 is a system prerequisite |
| Install location | Applications / Application Support `Workspace Observatory` | `%LOCALAPPDATA%\Programs\Workspace Observatory` plus data under `%LOCALAPPDATA%\Workspace Observatory` |
| Update | No automatic updates. `replace-app.mjs` for local replacement. Sparkle not integrated | No automatic updates. Installer refuses existing install. WinSparkle not integrated. `replace-payload.mjs` unused by the app |
| Uninstall | Unknown as a first-class documented Mac uninstaller in WINDOWS-equivalent detail | Settings uninstall. Saves data. Unrelated files can block folder removal |
| CI evidence in docs | Clean runtime prep and ZIP checks on GitHub Actions (MAC.md) | Clean package and TEST-identity installer (WINDOWS.md) |
| Architecture | Apple Silicon documented | x64 documented. Other Windows arch unverified |
| App display version | `Release.props` 0.3.12 build 23 | Same props, four-component FileVersion |

Path assumptions:

- Mac collector Python/Node under bundle `Runtime/` (`CollectorConfiguration.launch`).
- Windows packaged Node/Python similarly. Unpackaged `WorkspaceObservatory.exe` wants system Python and Node (`docs/WINDOWS.md` Configure sources).
- Pairing dialog placeholders use `C:/Apps/Observatory/...` (`PairingSetupDialog.swift` lines 23 to 29). Real installs use LocalAppData. Paste-from-Windows is the intended fill path.
- ActivityWatch assumed at `127.0.0.1:5600` on Mac. Windows uses a PowerShell aggregator against local ActivityWatch.
- Codex logs default to `~/.codex` / Windows user `.codex`. Custom Mac Codex locations are a migration gap (`MAC-MIGRATION.md`).
- Wispr: Application Support on Mac, AppData Roaming on Windows (`GUIDE.md`).
- Timezone for dates: America/New_York everywhere. Windows readers need tzdata (bundled in packages).

## Known docs divergence (MAC.md / WINDOWS.md / GUIDE / README)

1. GUIDE native WebKit claim versus MAC.md native default.
2. WINDOWS.md Agents as a top-level section versus six-item sidebar (same nesting as Mac).
3. WINDOWS.md Reload snapshot versus native Refresh sources.
4. README four pillars versus six sections on both platforms.
5. PRODUCT-DIRECTION wizard (local network + Tailscale paths) versus both wizards' SSH step.
6. MAC.md: login and sleep/wake still need release verification. WINDOWS.md: same. Do not treat development-machine checks as parity proof.
7. Tailscale and archive history: source exists on both. Docs say not in older installed builds. Installed versus source divergence is a cross-platform support problem, not only a Mac one.
8. `package.json` 0.1.0 versus desktop 0.3.12.
9. Ubuntu standalone desktop: planned in README. No `native/linux` shell. Windows WSL is not a Linux app.

## Pairing asymmetry (by design, still a UX consistency issue)

The supported SSH story is: configure Windows, copy paths, pair from Mac. Windows cannot initiate SSH pairing. Direct TLS is bidirectional in UI, unverified on a real pair, and Mac join Ubuntu scope is inconsistent.

Wizard copy on Windows ("Pair from the Mac") matches SSH. Wizard copy on Mac ("direct encrypted device pairing" then SSH) does not match Windows-only TLS host/join as an equal path.

## What to keep aligned when repairing

Codex should not clone WinForms into Swift or the reverse. Consistency repairs that matter:

1. Same section names, landing view, and Agents placement (code or docs, not both stories).
2. Same empty-state next steps for ActivityWatch, unpaired Combined, and pairing pause.
3. Same pairing explanation in both wizards.
4. Same Refresh versus Reload verbs, or documented difference (native collects, web reads).
5. Join `includeUbuntu` behavior.
6. `peerQuota` on every UI that reads the snapshot, including legacy web.
7. Accessibility: if Windows will not get zoom and section keys, WINDOWS.md must say so as an accepted gap, not "feature parity remain unfinished" without a list.

Non-goals: identical pixels, identical fonts, bundling WebView2 into the NSIS payload, or a Linux GTK port as part of a UI repair sprint.
