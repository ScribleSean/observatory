# Feature inventory

This report compares README and docs claims to implemented surfaces in native Mac SwiftUI, native Windows, the shared React dashboard, collectors, and pairing. It is a static source audit. Items that need a signed-in desktop or two-device network are labeled as hypotheses.

Product version in source is `0.3.12` build `23` (`native/Release.props`). `package.json` still reports `0.1.0`. Public installers are not published (`README.md` lines 37 to 42).

## Claimed product vs shipped navigation

README (`README.md` lines 14 to 23) describes four views: Screen time, AI usage, Workflows, Dictation. GUIDE (`docs/GUIDE.md` lines 13 to 19) uses Activity, Tokens, Agents, Dictation, Sources.

Implemented navigation on all three UIs is six items: Allowances, Activity, Tokens, Dictation, Sources, Settings.

| Claimed view | Where it actually lives | Status |
| --- | --- | --- |
| Screen time / Activity | Native `activity` section. Web `TabsContent value="activity"`. | Implemented when ActivityWatch returns records. Combined Mac plus Windows totals need pairing plus a verified merge. |
| AI usage / Tokens | Native `tokens` section. Web tokens tab. | Implemented from saved Codex logs. Combined All-host totals require collector-verified deduplication. |
| Account limits | Native and web **Allowances** (default section). | Codex quota reader exists. Other providers are not connected. Peer quota renders in native UIs only. |
| Workflows / Agents | Nested under **Sources** (`DisclosureGroup` on Mac, **Show execution details** on Windows, `<details>` on web). | Partial. Mac can attach legacy receipts and benchmarks. Windows native collector never collects them. |
| Dictation | Dedicated section on all three UIs. | Wispr metadata only. ChatGPT is a filter that always reports unverified. |
| Sources health | Dedicated **Sources** section. | Implemented. Coarse labels can collapse distinct failures into Unavailable. |
| Settings | Native collection, pairing, login, Tailscale check. Web Settings tab is appearance plus a pointer to native settings. | Provider account management is not implemented. |

Evidence:

```132:139:app/page.tsx
const views = [
  { id: 'allowances', label: 'Allowances', icon: Gauge },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'tokens', label: 'Tokens', icon: Layers3 },
  { id: 'dictation', label: 'Dictation', icon: Mic },
  { id: 'sources', label: 'Sources', icon: Database },
  { id: 'settings', label: 'Settings', icon: Settings },
];
```

```7:11:native/NativeDashboard.swift
    static let sections = [("allowances", "Allowances", "gauge.with.dots.needle.50percent"),
                           ("activity", "Activity", "waveform.path"), ("tokens", "Tokens", "square.stack.3d.up"),
                           ("dictation", "Dictation", "mic"),
                           ("sources", "Sources", "externaldrive.connected.to.line.below"), ("settings", "Settings", "gearshape")]
```

```43:43:native/windows/NativeDashboard.cs
        sections.Items.AddRange(["Allowances", "Activity", "Tokens", "Dictation", "Sources", "Settings"]);
```

`docs/WINDOWS.md` line 23 still lists Agents as a peer of those sections. The Windows sidebar has six items. Agents are behind Sources.

## What works in source

### First-run consent

Both platforms persist a pending setup marker and keep sources off until the wizard finishes.

- Mac: `FirstRunSetup.prepare` writes `setup-state.json` with `completed: false` and saves every collector key as false (`native/FirstRunSetup.swift` lines 22 to 32). Incomplete setup survives restart.
- Windows: `FirstRunSetup.Prepare` / `AllowsCollection` (`native/windows/FirstRunSetup.cs` lines 32 to 43). Collector start is gated in `Program.cs`.
- Wizard copy states that enabling a source does not prove it is available (`native/SetupWizard.swift` line 24, `native/windows/SetupWizard.cs` line 66).

### Local collection

| Source | Mac `collect-mac.mjs` | Windows `collect-windows.mjs` | Legacy `collect-dashboard.mjs` (`npm run collect`) |
| --- | --- | --- | --- |
| ActivityWatch | Local HTTP API | Local PowerShell aggregator | Mac local API plus Windows over SSH |
| Saved Codex tokens/settings | Local Python cache plus logs | Local Python plus optional WSL Ubuntu | ccusage over SSH for Mac, Ubuntu, optional Windows path |
| Codex quota | Optional `quota` flag plus legacy client path | Optional `quota` plus WSL or native client discovery | `codexExecutable` in `local.config.json` |
| Wispr | `wispr: true` | `wispr: true` | `dictation.mac` / `dictation.windows` in `local.config.json` |
| Agent receipts | Optional `receipts` plus existing `local.config.json` | Not collected | Always if receipt directory is configured |
| Local-model benchmarks | Optional `benchmarks` plus Ubuntu SSH from legacy config | Not collected | If `localModelResults` is configured |
| Peer merge | `finalizePeerCollection` | `finalizePeerCollection` | Same-run SSH combine on the Mac hub |

Native collectors schedule every 300 seconds (`collect-mac.mjs` line 64, `collect-windows.mjs` line 60, Mac `Store.start` 300s timer at `native/Store.swift` lines 42 to 44, Windows collector timer 300000 ms).

### Compact overview and main window

- Mac menu-bar panel: `ObservatoryPanel` in `native/Panel.swift`. Left click toggles. Open Observatory opens the native dashboard (`native/main.swift` line 92 of panel, `open("allowances")`).
- Windows tray: left click opens `UsagePopup`. Double click opens the main window. Tray menu includes Open Observatory, Refresh sources, Configure local collection, pairing actions (`native/windows/Program.cs` lines 184 to 219).
- Closing the main window leaves collection running (documented and implemented).

### Missing-data rules that are implemented

Combined token totals require `verification.status == "verified"` (Mac `Snapshot`, Windows `NativeHistory.Days` / `Snapshot.Latest`). Dictation never sums devices. API dollar figures are labeled hypothetical. Quota pace is withheld when the reading is older than ten minutes on Windows (`AllowancePaceText`).

### Pairing primitives present in source

SSH setup from Mac (`PairingSetup`, `PairingSetupDialog`). Windows path export (`PairingDetails`). Disconnect and repair menus. Direct TLS window (`DirectPairingWindow` on both platforms). Trusted sync process launched when a TLS trust file exists. Quota sharing consent endpoint.

These modules are not a finished consumer pairing product. See `docs/LOCAL-PAIRING.md` and the UX report.

## Incomplete, stubbed, or dead UI

### Provider accounts

Product direction (`docs/PRODUCT-DIRECTION.md` lines 9 to 14) requires managing connections in one settings area, including add, reconnect, switch, and remove accounts.

Native Settings shows Codex quota status from the snapshot and a monitor toggle. Copy states other providers and in-app sign-in are not available (`native/NativeSettings.swift` lines 51 to 61). Windows footer: "Provider sign-ins remain in their owning applications." (`native/windows/NativeDashboard.cs` line 109). Web Settings defers to native (`app/page.tsx` lines 373 to 376).

### Unified allowance history

README and MAC.md say provider account additions and unified allowance history remain unfinished. Native Allowances can show local `quota` plus separate `peerQuota`. Web `Allowances` reads only `data.quota` (`app/page.tsx` line 372). `peerQuota` is ignored in the React dashboard.

### Workflows / Agents as a first-class view

README Workflows row is not a nav item. Hash `#agents` redirects to Sources in the web app (`app/page.tsx` around lines 216 to 217). Mac maps `agents` deep links to `sources` (`native/main.swift`). Windows has no Agents sidebar item despite WINDOWS.md.

Windows `collect-windows.mjs` has no `legacy-workflows` import. Paired merge constructs `agents:[]` and `agentSource` not-connected (`scripts/peer-payload.mjs` lines 103 to 105). Mac re-attaches workflows after merge (`collect-mac.mjs` lines 86 to 94). Windows paired snapshots therefore lack receipts unless some other path writes them.

### ChatGPT dictation

UI offers a ChatGPT tool filter on web, Mac, and Windows. `scripts/voice-overview.mjs` lines 17 to 19 always return `status:'not-supported'` for ChatGPT. Native Windows hardcodes "Tracking not yet verified" (`NativeDictation.cs` line 33).

"More local speech detection coming soon." appears in `app/dictation.tsx` line 56, `native/NativeRecordedUsage.swift` line 99, `native/windows/NativeDictation.cs` line 60.

### All voice time row

Always Unknown. Web uses `voiceSeconds:null` (`voice-overview.mjs` lines 42 to 43). Mac `ObservatoryValueRow("All voice time", value: "Unknown")` (`NativeRecordedUsage.swift` lines 93 to 94). Windows label at `NativeDictation.cs` line 45.

### typewhisper

Accepted on Mac config read and ignored (`CollectorConfiguration.validate`, `native/CollectorConfiguration.swift` lines 15 to 20). Not in the wizard or Settings. Retired, not a user-facing feature.

### Web Settings tab

Theme toggle duplicates the header sun/moon control. Connections copy tells users to use the native app. No source toggles, pairing, or login controls exist in React.

### Legacy dashboard gaps

`--legacy-dashboard` remains. Mac `openDashboard` safe tabs for WebKit omit allowances and settings (`native/main.swift` around lines 633 to 634). Panel Open Observatory still requests allowances in native mode.

Windows `--test-first-run` still drives the legacy `Dashboard` WebView2 path (`Program.cs` lines 126 to 129), not `SetupWizard`.

### Automatic updates

`docs/UPDATES.md` states automatic production updates are not implemented. Settings shows a running version label. Sparkle/WinSparkle primitives and `update-appcast.mjs` exist. Installed apps do not check feeds. Windows installer refuses an existing install, which blocks a default WinSparkle upgrade flow.

### Public Linux desktop app

README lists Ubuntu/WSL as configured token and workflow sources, with a standalone desktop app planned. There is no native Linux shell in `native/`.

### Unused UI toolkit surface

`package.json` includes `recharts` and a large `components/ui/` set (carousel, calendar, sidebar, command, and others). Dashboard charts are custom SVG (`app/allowances.tsx`, `app/dictation.tsx`) and native Charts/GDI+. Hypothesis: most shadcn primitives are unused by Observatory views. Confirm with an import graph before deleting.

## Documentation claims that do not match current code

| Document | Claim | Code |
| --- | --- | --- |
| `docs/GUIDE.md` line 5 | Lightweight Mac menu-bar app and local dashboard. Primary framing is still the web workflow. | Native apps are the product README describes. |
| `docs/GUIDE.md` line 27 | Activity opens in Day view. | Default tab/section is Allowances (`useState('allowances')` in `app/page.tsx` line 175, Mac `section = "allowances"`, Windows `SelectedIndex = 0`). |
| `docs/GUIDE.md` line 60 | Current collector runs on macOS with SSH aliases for Windows and Ubuntu. | Native Windows collects standalone (`collect-windows.mjs`). Native Mac does not SSH unless legacy `local.config.json` remains. |
| `docs/GUIDE.md` lines 112 to 114 | Native Mac uses SwiftUI for the menu-bar panel and WebKit for detail views. | Default is native SwiftUI `NativeDashboard`. WebKit is `--legacy-dashboard`. |
| `docs/WINDOWS.md` line 23 | Agents is a top-level native section. | Six sidebar items. Agents nested under Sources. |
| `docs/WINDOWS.md` line 51 | Reload snapshot reads the saved snapshot and does not start collection. | Native button is **Refresh sources** and awaits `collector.Refresh()` (`NativeDashboard.cs` lines 93 to 101). Web **Reload snapshot** is read-only (`app/page.tsx` lines 303 to 312). |
| `docs/PRODUCT-DIRECTION.md` line 18 | Wizard should offer local-network and Tailscale-assisted paths. Neither is a consumer-ready code/QR flow. | Wizard step 3 still describes SSH (`SetupWizard.swift` lines 27 to 29, `SetupWizard.cs` lines 70 to 72). Direct TLS is a separate Settings window. |
| README pairing paragraph | First release uses direct device pairing. Current flow requires verified SSH. | Accurate if read fully. Wizard welcome copy says "direct encrypted device pairing" (`SetupWizard.swift` line 18) before the SSH requirement appears on step 3. |

## Feature flags and preview isolation (working)

Preview modes disable collection, pairing, and login. Mac `--preview` uses a temporary runtime (`native/main.swift` lines 40 to 49). Preview-only binaries refuse unexpected arguments (`docs/MAC.md`, `native/verify-preview-guard.mjs`). Windows `--test-native-dashboard` uses fictional in-memory records.

These are development gates, not user features.

## Suggested Codex follow-ups (inventory only)

Prioritized backlog with acceptance criteria lives in `00-codex-handoff.md`. Inventory repairs that are documentation or IA, not new product work:

1. Align README four-pillar table, GUIDE five-view table, and the six-section native/web chrome.
2. State that Workflows are Sources nested details, Mac-legacy-optional, and absent from the Windows native collector.
3. State that Allowances is the default landing view.
4. Split GUIDE into demo/web-legacy versus native app so SSH hub instructions are not the implied first path.
5. Remove or hide ChatGPT dictation until a reader exists.
6. Document that web Allowances does not show `peerQuota`.
