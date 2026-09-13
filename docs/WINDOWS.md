# Windows development preview

The native Windows tray app collects on Windows without a running Mac or open terminal. Current builds use a .NET Windows Forms main window by default. The legacy dashboard remains available through the installed Microsoft Edge WebView2 Runtime, with no HTTP server or network listener. The native-default build was installed on the development machine on September 12.

This is a development preview. A per-user installer is implemented and tested, but no public binary release is available yet. Windows x64 is the tested build target. Other Windows architectures are not verified.

## Open the app

Installed builds appear as **Workspace Observatory** in the Start menu. Launching the app opens its main window. Launching it again requests the existing window instead of starting another collector in the same Windows session.

The telescope icon lives in the **system tray**, possibly under the hidden-icons arrow. Click it for a compact usage overview, then choose **Open Observatory** for the full window. Closing the main window leaves the tray app running. Use **Quit Observatory** in the tray menu to stop it.

The compact overview does not embed full history charts or require scrolling on the tested desktop. Retired Spark / Bengal-fox allowance windows are excluded. This does not remove historical model-token records. The installed main window uses native controls, with the legacy dashboard available as a fallback.

## Native main-window preview

Current source builds open native Windows controls for Activity, Tokens, Allowances, Dictation, Agents, Sources and Settings by default. Use `--legacy-dashboard` for the previous embedded dashboard. The older `--native-dashboard` argument remains accepted but is no longer needed. Quit any running Observatory instance before changing modes. The single-instance activation mechanism opens the existing instance and does not change its display mode.

Activity and Tokens offer Day, Week and All retained periods. A week ends on the selected recorded date. Missing dates are not filled with zeros, and all-device token totals require a collector-verified deduplication result. Allowances reuse the saved account-history charts and exclude retired Spark windows. Refresh sources invokes the existing collector without changing its configuration. The view reads sanitized snapshots, not raw logs.

Activity also offers a recorded-date detail selector with hourly activity, category totals and recognized app labels. Hours use New York clock time, including the collector's shared cell for repeated daylight-saving hours. Missing hourly arrays remain unavailable. Device overlap stays separate from app attribution, and foreground AI-app time is not presented as model execution time.

Tokens offers a model/date detail selector with token classes, saved API-cost comparisons and recorded reasoning/speed profiles. Every selected date reconciles separately against its model counters. Inferred models, unstable settings and profiles exceeding any reported counter are withheld. Partial profile coverage shows the remaining unreconciled tokens. Saved comparisons are hypothetical API pricing, not subscription bills, and this view does not fetch new prices.

Dictation opens across tools and devices, with Day, Week and All retained periods. Sources share one selected date range. Wispr word and audio coverage remain explicit. ChatGPT tracking is unverified. Device totals are not summed because imported or synchronized records may overlap. Only sanitized recording metadata is read. More local speech detection is planned.

Agents separates saved handoff receipts, local benchmarks and per-device tool requests. Failed handoff token counters remain unknown. Local timing and GPU-memory fields preserve missing values, and tool rows retain exact names and namespaces. The view does not sum cumulative receipt counters or claim that requests succeeded. Synthetic desktop checks cover failed and successful reported counters, missing local timing, exact tool labels and unavailable hosts.

Source settings are editable in the native Settings section. The system-tray configuration command uses the same editor in current source builds. It loads existing choices, saves only on request, preserves unrelated configuration fields and rejects stale edits or saves during collection. Disabling account monitoring requires confirmation before its retained readings are cleared by collection.

Unsaved source choices survive section changes, Settings-page navigation and refreshes within the same window. Reload saved settings asks before discarding a changed draft and provides recovery after a stale-save conflict. Drafts are not persisted after the window closes. Temporary-configuration desktop tests cover draft retention and simulated cancel/confirm paths for reload and account-monitoring opt-out. These tests do not delete real account history or automate the production confirmation dialog.

Settings also has a This device page for login registration, pairing details, disconnection and repair preparation. These controls reuse the tray handlers, including the disconnect and repair confirmations. The view rejects overlapping device operations. Synthetic desktop checks verified startup-state rereading and callback dispatch without touching real startup or pairing state. Actual login launch and real pairing operations remain separate verification gates. Provider sign-in management is not implemented.

The native default is installed on the development machine, not a published release. Full accessibility review and feature parity remain unfinished. Empty history is explained separately from recorded zero usage, and an unknown quota observation time is identified. It does not add account-history synchronization or provider sign-ins.

For an isolated desktop check, run `WorkspaceObservatory.exe --test-native-dashboard C:\absolute\path\to\empty-test-directory`. The directory must already exist, be empty and not be linked. The test uses in-memory fictional records, an inert refresh callback and captures only its own form. It does not start a collector or modify installed settings. On September 12 the Windows build and desktop test passed period totals, missing-data handling, unverified combined-token suppression, retired-allowance filtering, source rows, refresh and repeated reload checks. Activity and Allowances captures were visually inspected. These checks do not establish installed native-window behavior or complete native feature parity.

## First collection

Fresh installations show a native first-run wizard before collection. All sources remain off until setup is completed. Review privacy, choose sources and optionally inspect device-pairing details. Closing incomplete setup leaves collection paused, including after restart. Existing configured installations keep their settings and skip the wizard.

Later, right-click the Observatory system-tray icon and choose **Configure local collection**. Ubuntu collection starts the installed WSL distribution. Neither optional sources nor Mac pairing are required for Windows data.

After collection finishes, choose **Reload snapshot** in the dashboard. Reload reads the saved snapshot. It does not enable or start collection. New source builds show setup instructions when Windows confirms that collection is unconfigured. Older previews can instead show a reload error with an empty dashboard. A configured installation with no readable snapshot still shows a load error rather than being labelled unconfigured.

For renderer verification, `WorkspaceObservatory.exe --test-first-run C:\absolute\path\to\empty-test-runtime` checks the setup instructions. A separate synthetic runtime containing `collector.config.json` but no snapshot checks the load-error state. Both cases passed on the signed-in Windows desktop on September 9. The ordinary `--test-web` check still requires a valid snapshot. These checks do not enable collection or verify the configuration prompts.

## Pairing details

The tray menu's **Pairing details for Mac…** shows paths from the running source build. **Copy Windows details** exports those paths only after a click and is disabled if bundled pairing tools are missing. The Mac setup form can import the text through **Paste Windows details**. An existing verified SSH alias remains a separate requirement. This does not enable SSH or transfer clipboard contents between devices automatically. See [pairing maintenance](PAIRING-MAINTENANCE.md) for the full flow and privacy limits.

The Windows details dialog and explicit copy handler passed a synthetic desktop test without accessing the owner's clipboard. The test capture remains pending visual review. The Mac parser separately rejects unsupported versions, unexpected fields and invalid paths. Real cross-device clipboard transfer has not been verified. The September 12 development-machine installation includes these controls.

## Build on Windows

Use a Windows-local checkout, .NET 10 SDK, Python 3 with the `py` launcher and PowerShell. From the checkout root:

```powershell
.\native\windows\build.ps1
```

Pass `-Dotnet C:\path\to\dotnet.exe` for a private SDK installation. The script downloads a pinned Node 22 archive from nodejs.org, checks its SHA-256 digest and keeps the runtime and npm cache under `%LOCALAPPDATA%\WorkspaceObservatoryBuild\cache`. It does not replace the system Node installation. Dependencies and compiled output stay in the Windows checkout.

The icon is committed as a small generated asset. Its source is the canonical [telescope mark](../public/brand/telescope.svg). Regenerating that asset currently uses the Mac icon tool, but ordinary Windows builds do not require a Mac.

The build runs native snapshot and startup-contract tests plus the JavaScript and reader test suite. Six POSIX runner tests explicitly skip on Windows because the Windows app uses its native collector, not the `flock` and process-group runner. This does not prove the UI works on a signed-in desktop. Run the executable from `native\windows\bin\Release\net10.0-windows` to inspect the tray and dashboard.

## Prepare a package candidate

### Voice source coverage

Wispr is the supported voice metadata reader. Retired speech-source configuration is ignored without deleting original application data or saved archives. Update both paired apps together because the supported peer payload has changed. ChatGPT voice collection is not yet verified.

### Build commands

```powershell
.\native\windows\package.ps1
```

This runs the development build and publishes a fresh candidate under `native\windows\release\candidate-ID\Workspace Observatory`. It bundles Node, Python, timezone data and .NET, so the packaged app does not require separate installations of those runtimes. Microsoft Edge WebView2 Runtime remains a system prerequisite.

Runtime archives have pinned download URLs and SHA-256 digests. The package includes dependency notices and a file-hash manifest. Packaging rejects known private data filenames, linked entries, debug symbols, Python bytecode-cache directories and detected build-machine paths. The manifest records the source revision and whether the checkout had uncommitted changes. A dirty candidate is not a versioned release.

Recheck an existing candidate without replacing its manifest:

```powershell
node .\native\windows\verify-manifest.mjs 'C:\absolute\path\Workspace Observatory'
```

This rejects modified, additional or missing payload files, invalid Windows paths, linked entries and dirty-source manifests. For development candidates only, add `--allow-dirty`; file verification still applies. The manifest is an integrity inventory, not a publisher signature or a substitute for the package privacy inspection.

Installer-tool preparation uses the pinned NSIS archive in `native/windows/installer-tool.json`. Its SHA-256 was computed after matching the official release listing's SHA-1 over an HTTPS download. It is not a vendor-published SHA-256. The compiler stays in the Windows build cache and is not installed system-wide.

`-SkipWebBuild` is an explicit development shortcut for packaging-only changes after a successful dashboard build. Do not use it for final release verification. Windows downloads, dependency caches and output stay on the Windows machine.

`package.ps1 -BuildPython C:\path\to\python.exe` selects the build interpreter explicitly. Its default remains the Windows Python launcher, with `-3` added only for `py.exe`. Both paths disable bytecode writes. This interpreter prepares the pinned packaged Python runtime, rather than replacing it.

The manually dispatched `Clean Windows package` workflow uses a fresh standard Windows runner, an explicit build Python and the complete packaging command without `-SkipWebBuild`. It exercises dependency restoration, dashboard build, source tests, runtime preparation and packaged checks. It does not install the application, collect live records, use signing secrets or publish artifacts. A successful run is clean-build evidence, not a clean first-launch or release-publication result.

The tested candidate is about 224 MiB unpacked, including its private runtimes. This is a disk-size measurement, not a memory or CPU claim. Candidates are unsigned and may trigger Windows security warnings.

## Build and test the installer

From a clean checkout matching the package manifest's source revision:

```powershell
.\native\windows\installer.ps1 -PackageDirectory 'C:\absolute\path\Workspace Observatory'
```

This verifies the existing package and builds a per-user NSIS installer with a SHA-256 sidecar. The printed executable lives in a separate `artifacts` directory with its build metadata and NSIS license. Only that artifact directory is intended for distribution. The parent compiler-work directory contains generated build paths and must not be published. Warnings are compilation failures. The installer and package source revisions must match and both must be clean.

For isolated development verification, add `-TestIdentity`, then pass the printed executable path to:

```powershell
.\native\windows\test-installer.ps1 -InstallerPath 'C:\absolute\path\TEST-setup.exe'
```

The integration test accepts only the test identity and refuses pre-existing test registrations or folders. On the development Windows machine it verified installation, every payload hash, the Start menu shortcut, native self-tests, refusal to overwrite an existing install, running-app refusal, rejection of linked payload directories, uninstall, and reinstall. It also verified preservation of saved data, unrelated files and registration values, and another startup owner. Its temporary installation was removed afterward. These are one-machine checks, not proof of clean-machine compatibility.

## Install, remove, update or roll back

The installer uses `%LOCALAPPDATA%\Programs\Workspace Observatory` and adds a Start menu shortcut plus the current user's uninstall registration. It requires no administrator privileges. Source collection and login startup stay opt-in. It does not install ActivityWatch, WSL or WebView2, and it does not change system runtimes.

Quit the app through its tray menu before removing it in Windows Settings. Uninstall deletes only the package's recorded files and this installation's registrations. Saved settings and snapshots under `%LOCALAPPDATA%\Workspace Observatory` remain. Unrelated files keep their folders from being removed; linked install directories are refused.

There is no automatic updater. To update, uninstall the current version and install the new one. To return to an earlier compatible build, uninstall and reinstall that earlier build. Re-enable login startup afterward if wanted. Keep a private backup of saved data before changing versions. The current test covers reinstalling the same schema, not compatibility with future data migrations. If unrelated files keep an old install folder in place, move that folder aside before reinstalling rather than deleting its contents.

## Configure sources

Choose **Configure local collection** from the telescope tray menu. ActivityWatch must already be installed and running for screen time. Saved native Windows Codex records are read locally. Ubuntu collection is optional and starts the installed `Ubuntu` WSL distribution in the background during collection. Windows collection does not require WSL. Wispr Flow statistics are separately opt-in.

The app also offers optional [account limits and token history](USAGE-LIMITS.md). The Settings editor's Account client selection chooses the native Windows Codex client or Ubuntu's existing client. Older builds used separate prompts. Selecting Ubuntu may start WSL and uses Ubuntu's signed-in account, even when Ubuntu log collection is off. Closing without saving leaves settings unchanged. The tested Ubuntu route reads limits and daily totals successfully. The native Windows client could not be launched on the tested machine and is not yet verified for account usage. The September 12 development-machine update preserved its existing monitoring-off choice.

The plain development executable requires a working Python 3 installation with timezone data and a Node installation. Package candidates use their bundled copies instead. Local settings and snapshots live under `%LOCALAPPDATA%\Workspace Observatory`, outside the source checkout. Collection runs every five minutes while the configured app is running.

Only allowlisted metadata enters snapshots. Prompts, tool arguments, window titles, transcripts and recordings are excluded. Unsupported or disconnected sources remain unavailable. Combined cross-device token totals are not published by this collector until private sync and deduplication are implemented.

## Login startup

**Register start at login** adds or removes only this installation's entry in the current user's Windows Run key. No administrator privileges or Windows service is needed. The checked menu state means the entry matches this installation. Windows Settings, Task Manager or organizational policy may separately disable startup, so a checked entry does not prove launch occurred.

Login registration uses `--background`, which starts the system-tray app without opening the main window. Start menu launches omit that argument and open the window.

Disable registration before moving or removing the app folder. Another installation's entry is not silently replaced. Actual logout/login and reboot behavior still need release testing. See Microsoft's [Run-key documentation](https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys) for platform behavior.

## Verification and remaining gates

On the development Windows machine, the native build and snapshot tests pass. The packaged app collected native Windows activity, saved Codex usage, Wispr statistics and optional Ubuntu Codex usage using its bundled runtimes. A signed-in desktop smoke test loaded the packaged React dashboard with fictional records and fetched its local snapshot through WebView2. The Activity view was visually inspected at the tested window size. These checks cover one configured machine, not clean-install compatibility or a full visual and accessibility review.

For a synthetic desktop test, prepare a new private test directory with `node native/windows/prepare-demo-runtime.mjs ABSOLUTE_NEW_DIRECTORY`. Run the packaged executable with `--test-web ABSOLUTE_NEW_DIRECTORY` from the signed-in desktop. The test captures only the WebView and only for a snapshot marked as synthetic. It does not capture other windows or the desktop. The result and WebView cache belong in that test directory, never in a release package.

Development builds also accept `--test-usage-popup C:\absolute\path\to\empty-test-directory`. This test requires an existing empty directory and refuses a linked directory. It uses in-memory synthetic quota data, starts no collectors, and captures only its own form and graph controls. On September 9 it passed window selection, reload, saved/unavailable states, accessible chart summaries and inert refresh/navigation callbacks. The captures were visually reviewed. This is not a test of clicking the real tray icon or of an installed release.

The September 12 native-default candidate at `d5a2317` passed the full Windows build with 250 JavaScript/reader tests passed, 14 skipped and zero failed. Packaged native-dashboard, wizard and compact-tray tests passed. Package verification covered 1,025 files and 234,884,445 bytes, about 224 MiB unpacked. The unsigned installer is 93,988,602 bytes. These sizes include bundled runtimes and are not CPU or memory measurements.

The isolated TEST installer passed install/uninstall, overwrite refusal, linked-path refusal and preservation checks. The ordinary build was then installed on the development machine with a recoverable application backup. Installed payload hashes, Start search registration, existing login registration and unchanged configuration/snapshot hashes were verified. Collection completed after restart. The user confirmed the native sidebar window was visible, although the process API returned no main-window handle. This does not prove every source, actual login launch or peer synchronization.

Remaining work includes native accessibility and feature-parity review, provider account management, unified account history, final public-release checks, clean-environment checks, login and sleep/wake testing, CPU and memory measurements, and completion of the consumer pairing flow. Do not publish local snapshots or build caches as release artifacts.
