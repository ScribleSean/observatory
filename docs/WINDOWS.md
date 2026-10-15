# Observatory on Windows

This guide installs a downloaded release on a Windows PC. Building the app from source is described [further down](#build-from-source).

## Install a release

### What you need

- Windows on an x64 PC. Other architectures are not supported.
- Microsoft Edge WebView2 Runtime. Windows 11 includes it, and most Windows 10 PCs already have it. The installer does not add it.
- [ActivityWatch](https://activitywatch.net/), installed and running, if you want screen time. Observatory does not install it.
- Codex or Claude Code installed and used on this PC, if you want their tokens and limits.
- [Tailscale](https://tailscale.com/), installed and signed in, only if you want to pair this PC with a Mac. It is not needed on a single device.

No administrator rights are needed. The installer installs for the current user only.

### Download and check the file

Each release has two assets and one checksum file:

| File | What it is |
| --- | --- |
| `Observatory-<version>-windows-x64-setup.exe` | The Windows installer |
| `Observatory-<version>-macos-arm64.zip` | The Mac app |
| `SHA256SUMS.txt` | The SHA-256 checksum of each asset |

Download the installer and `SHA256SUMS.txt` into the same folder. In PowerShell, from that folder, compare the installer with its listed checksum:

```powershell
$installer = Get-ChildItem .\Observatory-*-windows-x64-setup.exe
$expected = ((Select-String -Path .\SHA256SUMS.txt -SimpleMatch $installer.Name).Line -split '\s+')[0]
(Get-FileHash $installer.FullName -Algorithm SHA256).Hash -eq $expected
```

The last line prints `True` when the two match. If it prints `False`, or the first line finds more than one installer, delete the extra downloads and start again. Do not run an installer whose checksum does not match. A matching checksum shows that the file arrived intact. It does not prove who built it, because the checksum file comes from the same release page.

### Run an unsigned installer

Observatory builds are not signed with a code-signing certificate. Your browser may warn that the file is not commonly downloaded, and Microsoft Defender SmartScreen usually stops the installer the first time with a message that it prevented an unrecognized app from starting. This is expected for an unsigned app.

The supported way through:

1. In the browser, choose to keep the download if it asks.
2. When SmartScreen shows its message, choose More info.
3. Check that the app name matches the installer file name and that the publisher reads Unknown publisher.
4. Choose Run anyway.

Do not turn off SmartScreen or Microsoft Defender to avoid the warning. If your organization's policy blocks unsigned apps, there is no supported way to install Observatory on that PC. The exact wording of the warnings for this release is added here after the release assets exist.

### Install

Run the installer and follow its steps. It installs into `%LOCALAPPDATA%\Programs\Observatory`, adds Observatory to the Start menu and registers an uninstall entry for the current user. It does not change system runtimes, and it does not install ActivityWatch, Tailscale or WebView2.

### Start the app

Start Observatory from the Start menu. Its telescope icon appears in the system tray, possibly under the hidden-icons arrow. Click the icon for the panel. Choose Open Observatory for the full window. Closing the window leaves the tray app running and collecting. To stop it, right-click the tray icon and choose Quit Observatory.

Do not start Observatory from inside a packaged app such as Claude desktop, for example from a terminal running in a Claude desktop session. Windows can show such a process a different set of folder permissions, and Observatory then refuses its private folders and reads fewer sources. Issue 58 records what was observed. Start it from the Start menu instead. If you must start it from a terminal inside such an app, start it as an independent process through Windows Management Instrumentation:

```powershell
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='"' + $env:LOCALAPPDATA + '\Programs\Observatory\WorkspaceObservatory.exe" --background'}
```

`--background` starts the tray app without opening the window. The executable keeps its earlier internal name, `WorkspaceObservatory.exe`.

### First run

On first launch the window opens on a setup screen with three steps:

1. Choose what to collect. Every source starts off. Turn on the ones this PC should read: screen time from ActivityWatch, Codex tokens, Claude Code tokens, Wispr Flow dictation, Codex limits and Claude Code limits. Claude Code limits show notes about how they are read, and you must accept them first.
2. Other devices. Pairing is optional and is done later in Settings.
3. Finish. Collection starts with the sources you turned on.

Nothing is collected before you finish. If you close the window early, collection stays paused, including after a restart, until you finish setup. You can change sources later in Settings. Each section shows Unknown until a source it needs has been read.

### Where data lives

Settings, snapshots and history live in `%LOCALAPPDATA%\Observatory`. The app keeps them outside the install folder, so replacing or uninstalling the app leaves them in place. The folder holds private folders with restricted permissions. Do not move it, link it elsewhere or share it.

Original records stay with the tools that wrote them: ActivityWatch, Codex, Claude Code and Wispr Flow. Observatory only reads them.

### Replace with a newer release

There are no automatic updates. Check for updates says that updates are not available in this build. The installer refuses to install over an existing copy, so replace it in this order:

1. Download and check the new installer as described above.
2. Right-click the tray icon and choose Quit Observatory.
3. Uninstall Observatory from Settings, Apps, Installed apps. Your data folder is kept.
4. Run the new installer and start Observatory from the Start menu.

The new copy opens with your settings and history and does not show the setup screen again.

Builds up to 0.3.14 build 41 were named Workspace Observatory and kept their data in `%LOCALAPPDATA%\Workspace Observatory`. The renamed app does not read that folder and installs beside the earlier app instead of replacing it. Moving that data is a one-time step run from a checkout with `native/windows/migrate-data.ps1`. It copies the data into the new folder and keeps the earlier folder and the earlier app until you remove them.

### Remove

1. If you turned on Claude Code limits, turn them off in Settings.
2. If Start at login is on, turn it off in Settings under Startup.
3. Right-click the tray icon and choose Quit Observatory.
4. Uninstall Observatory from Settings, Apps, Installed apps.

Uninstalling removes only the files the installer recorded and this installation's registrations. It leaves your data. To remove it too, move `%LOCALAPPDATA%\Observatory` to the Recycle Bin. Removing Observatory does not uninstall ActivityWatch, Tailscale or any provider app, and it does not touch their records.

## Build from source

The rest of this guide is for building, packaging and testing the app from a checkout.

### Build on Windows

Use a Windows-local checkout, .NET 10 SDK, Python 3 with the `py` launcher and PowerShell. From the checkout root:

```powershell
.\native\windows\build.ps1
```

Pass `-Dotnet C:\path\to\dotnet.exe` for a private SDK installation. The script uses the Node version pinned in [`native/windows/runtime-assets.json`](../native/windows/runtime-assets.json). It downloads the archive from nodejs.org when needed, checks its SHA-256 digest and keeps the runtime and npm cache under `%LOCALAPPDATA%\WorkspaceObservatoryBuild\cache`. It does not replace the system Node installation. Dependencies and compiled output stay in the Windows checkout.

The icon is committed as a small generated asset. Its source is the canonical [telescope mark](../public/brand/telescope.svg). Regenerating that asset currently uses the Mac icon tool, but ordinary Windows builds do not require a Mac.

The build runs native snapshot and startup-contract tests plus the JavaScript and reader test suite. Six POSIX runner tests skip on Windows because the Windows app uses its native collector, not the `flock` and process-group runner. This does not prove the interface works on a signed-in desktop. Run the executable from `native\windows\bin\Release\net10.0-windows` to inspect the tray and window.

To run the app with collection on against a separate folder, pass `--runtime C:\absolute\new-folder`. The app refuses a relative path, a linked path, and the real data folders and anything inside them.

### Prepare a package candidate

```powershell
.\native\windows\package.ps1
```

This runs the development build and publishes a fresh candidate under `native\windows\release\candidate-ID\Workspace Observatory`. The package folder keeps its earlier internal name. It bundles Node, Python, timezone data and .NET, so the packaged app does not require separate installations of those runtimes. Microsoft Edge WebView2 Runtime remains a system prerequisite.

Runtime archives have pinned download URLs and SHA-256 digests. The package includes dependency notices and a file-hash manifest. Packaging rejects known private data filenames, linked entries, debug symbols, Python bytecode-cache directories and detected build-machine paths. The manifest records the source revision and whether the checkout had uncommitted changes. A dirty candidate is not a versioned release.

Recheck an existing candidate without replacing its manifest:

```powershell
node .\native\windows\verify-manifest.mjs 'C:\absolute\path\Workspace Observatory'
```

This rejects modified, additional or missing payload files, invalid Windows paths, linked entries and dirty-source manifests. For development candidates only, add `--allow-dirty`. File verification still applies. The manifest is an integrity inventory, not a publisher signature or a substitute for the package privacy inspection.

Installer-tool preparation uses the pinned NSIS archive in `native/windows/installer-tool.json`. Its SHA-256 was computed after matching the official release listing's SHA-1 over an HTTPS download. It is not a vendor-published SHA-256. The compiler stays in the Windows build cache and is not installed system-wide.

To verify only that download, run `native/windows/installer.ps1 -VerifyCompilerOnly`. This mode checks the pinned checksum without extracting or executing the archive. Compiler downloads use Windows system curl with HTTPS-only redirects and bounded timeouts. A failed or mismatched response is never used as a compiler.

`-SkipWebBuild` is a development shortcut for packaging-only changes after a successful web build. Do not use it for release verification. `package.ps1 -BuildPython C:\path\to\python.exe` selects the build interpreter explicitly. Its default remains the Windows Python launcher, with `-3` added only for `py.exe`. This interpreter prepares the pinned packaged Python runtime, rather than replacing it.

The manually dispatched `Clean Windows package` workflow uses a fresh standard Windows runner, an explicit build Python and the complete packaging command without `-SkipWebBuild`. It exercises dependency restoration, the web build, source tests, runtime preparation and packaged checks. It does not install the application, collect live records, use signing secrets or publish artifacts.

### Build and test the installer

From a clean checkout matching the package manifest's source revision:

```powershell
.\native\windows\installer.ps1 -PackageDirectory 'C:\absolute\path\Workspace Observatory'
```

This verifies the existing package and builds a per-user NSIS installer, `Observatory-<version>-windows-x64-setup.exe`, with a SHA-256 sidecar. The printed executable lives in a separate `artifacts` directory with its build metadata and NSIS license. Only that artifact directory is intended for distribution. The parent compiler-work directory contains generated build paths and must not be published. Warnings are compilation failures. The installer and package source revisions must match and both must be clean.

For isolated development verification, add `-TestIdentity`, then pass the printed executable path to:

```powershell
.\native\windows\test-installer.ps1 -InstallerPath 'C:\absolute\path\TEST-setup.exe'
```

The integration test accepts only the test identity and refuses pre-existing test registrations or folders. It checks installation, every payload hash, the Start menu shortcut, native self-tests, refusal to overwrite an existing install, running-app refusal, rejection of linked payload directories, uninstall and reinstall, and preservation of saved data, unrelated files, registration values and another startup owner.

### Guarded upgrade and rollback

For a guarded development upgrade or rollback, verify the exact candidate, quit normally and protect current saved state and recovery under the [runtime backup locks](UPDATES.md#runtime-backup-coordination). The maintained [installer test](../native/windows/test-installer.ps1) and [receipt lifecycle check](../native/windows/check-installer-receipt-cycle.mjs) copy `Uninstall.exe` outside the install root and pass raw `/S _?=<exactroot>`. Keep `_?=` last and its value unquoted, including paths with spaces, so the caller waits for the real uninstaller. Confirm that exit before running the ordinary installer and verifying payload, saved state, startup and readiness. Stop if an app or uninstaller process is unresolved or a preservation guard fails. Do not move the install folder aside or retry to bypass a guard. The tests cover same-schema reinstall, not future data migrations.

An SSH peer exchange started by the paired Mac can still update saved peer state after the app quits. Preserve valid newer observations rather than restoring an older database solely because its bytes changed. A consistent backup or comparison needs the [runtime backup coordination](UPDATES.md#runtime-backup-coordination) described in the update guide.

### Login startup

Start at login, in Settings under Startup, adds or removes only this installation's entry in the current user's Windows Run key. No administrator rights or Windows service are needed. The entry starts the app with `--background`, so the tray app starts without opening the window. Windows Settings, Task Manager or organizational policy may separately disable startup, so an enabled entry does not prove launch occurred. Turn it off before moving or removing the app folder. Another installation's entry is not silently replaced. See Microsoft's [Run-key documentation](https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys) for platform behaviour.

### Historical package evidence

These results apply only to the named revisions and are kept as dated evidence. They do not verify a later build.

- The [September 15 clean package and installer run for 5907e8a](https://github.com/ScribleSean/observatory/actions/runs/34967825472) passed. All 522 source tests ran across the main suite and a separate ACL-heavy allowance TLS test, with 483 passes, 39 skips and zero failures. The clean package contained 3,051 verified files totaling 258,580,858 unpacked bytes. The unsigned 0.3.12 TEST-identity installer passed installation, payload hashes, shortcut and registration checks, running-app and overwrite refusal, linked-directory rejection, uninstall and reinstall, and saved-data preservation.
- The [clean Windows package run for f980326](https://github.com/ScribleSean/observatory/actions/runs/34738823435) passed on September 13, 2026 UTC, with 345 passing source tests and 26 explicit skips, and verified all 3,027 manifest files, totaling 257,766,732 bytes.
- The [full installer run for 04b6fa6](https://github.com/ScribleSean/workspace-observatory/actions/runs/34740480607) passed on September 13, 2026 UTC and exercised the 0.3.3 TEST-identity installer.
- The September 12 native-default candidate at `d5a2317` passed the full Windows build with 250 JavaScript and reader tests passed, 14 skipped and zero failed. Package verification covered 1,025 files and 234,884,445 bytes. The unsigned installer was 93,988,602 bytes. These sizes include bundled runtimes and are not CPU or memory measurements.

These builds used the earlier Windows Forms interface, which was removed in October 2026. The tag `archive/pre-viewer-removal` marks the last commit that has it. Builds since then show the shared web pages that the Mac app also uses.
