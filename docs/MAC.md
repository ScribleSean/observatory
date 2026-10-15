# Observatory on a Mac

This guide installs a downloaded release on a Mac. Building the app from source is described [further down](#build-from-source).

## Install a release

### What you need

- A Mac with Apple Silicon and macOS 14 or later. Intel Macs are not supported.
- [ActivityWatch](https://activitywatch.net/), installed and running, if you want screen time. Observatory does not install it.
- Codex or Claude Code installed and used on this Mac, if you want their tokens and limits.
- [Tailscale](https://tailscale.com/), installed and signed in, only if you want to pair this Mac with a Windows PC. It is not needed on a single device.

### Download and check the file

Each release has two assets and one checksum file:

| File | What it is |
| --- | --- |
| `Observatory-<version>-macos-arm64.zip` | The Mac app |
| `Observatory-<version>-windows-x64-setup.exe` | The Windows installer |
| `SHA256SUMS.txt` | The SHA-256 checksum of each asset |

Download the ZIP and `SHA256SUMS.txt` into the same folder. In Terminal, from that folder, compare the ZIP with its listed checksum:

```sh
grep macos-arm64.zip SHA256SUMS.txt | shasum -a 256 -c
```

The command prints the file name followed by `OK` when the two match. If it prints `FAILED`, delete the download and do not open it. A matching checksum shows that the file arrived intact. It does not prove who built it, because the checksum file comes from the same release page.

### Open an unsigned app

Observatory builds are not signed by an identified Apple developer and are not notarized. The first time you open a downloaded copy, macOS refuses to open it and says it cannot verify that the app is free of malware. This is expected for an unsigned app.

The supported way through is Apple's own:

1. Try to open `Observatory.app` once and close the warning.
2. Open System Settings, then Privacy & Security.
3. Under Security, find the message about Observatory and choose Open Anyway.
4. Confirm with your password or Touch ID, then choose Open.

You do this once per downloaded copy. Apple describes the steps in [Open a Mac app from an unknown developer](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac). Do not turn off Gatekeeper or remove the download's quarantine attribute to avoid the warning. The exact wording of the warning for this release is added here after the release assets exist.

### Install

1. Double-click the ZIP to unpack it. Finder creates `Observatory.app` beside it.
2. Move `Observatory.app` into your Applications folder.
3. Open it from Applications or Launchpad, then follow the steps above if macOS shows the warning.

The telescope icon appears in the menu bar. Click it for the panel. Choose Open Observatory for the full window. Closing the window leaves the menu-bar app running and collecting. To stop it, right-click the menu-bar icon and choose Quit Observatory.

### First run

On first launch the window opens on a setup screen with three steps:

1. Choose what to collect. Every source starts off. Turn on the ones this Mac should read: screen time from ActivityWatch, Codex tokens, Claude Code tokens, Wispr Flow dictation, Codex limits and Claude Code limits. Claude Code limits show notes about how they are read, and you must accept them first.
2. Other devices. Pairing is optional and is done later in Settings.
3. Finish. Collection starts with the sources you turned on.

Nothing is collected before you finish. If you close the window early, collection stays paused and the setup screen returns the next time you open the window. You can change sources later in Settings. Each section shows Unknown until a source it needs has been read.

macOS may ask whether Observatory can read files that belong to another app. Approve only the access you intend to give. Because builds are signed ad hoc, a new copy of the app can ask again. See [Mac folder permissions](MAC-PERMISSIONS.md).

### Where data lives

Settings, snapshots and history live in `~/Library/Application Support/Observatory`. The app keeps them outside the app bundle, so replacing or removing the app leaves them in place. The folder holds private files with restricted permissions. Do not move it, link it elsewhere or share it.

Original records stay with the tools that wrote them: ActivityWatch, Codex, Claude Code and Wispr Flow. Observatory only reads them.

### Start the app from a terminal

Open the app from Applications for normal use. If you start it from a terminal that runs inside another tool's session, such as Claude Code or Claude desktop, the app inherits that session's environment. Start it with a minimal environment instead:

```sh
env -i HOME="$HOME" USER="$USER" PATH=/usr/bin:/bin:/usr/sbin:/sbin /usr/bin/open -n -g /Applications/Observatory.app
```

Change the path if the app is in `~/Applications`. The `-g` flag starts the app without bringing it to the front.

### Replace with a newer release

There are no automatic updates. Check for updates says that updates are not available in this build. To move to a newer release:

1. Download and check the new ZIP as described above.
2. Right-click the menu-bar icon and choose Quit Observatory.
3. Move the old `Observatory.app` to the Trash. Keep it there until the new copy works.
4. Unpack the new ZIP, move `Observatory.app` into Applications and open it. macOS shows the unsigned-app warning again for the new copy.

Your data folder is kept, so the new copy opens with your settings and history and does not show the setup screen again.

Builds up to 0.3.14 build 41 were named Workspace Observatory and kept their data in `~/Library/Application Support/Workspace Observatory`. The renamed app does not read that folder. Moving that data is a one-time developer step, described under [Moving data from Workspace Observatory](#moving-data-from-workspace-observatory).

### Remove

1. If you turned on Claude Code limits, turn them off in Settings.
2. If Start at login is on, turn it off in Settings under Startup.
3. Right-click the menu-bar icon and choose Quit Observatory.
4. Move `Observatory.app` to the Trash.

This leaves your data. To remove it too, move `~/Library/Application Support/Observatory` to the Trash. Removing Observatory does not uninstall ActivityWatch, Tailscale or any provider app, and it does not touch their records.

## Build from source

The rest of this guide is for building, packaging and testing the app from a checkout. You need an Apple Silicon Mac with Xcode or the Command Line Tools, and Node.js 22.13 or later.

### SDK

Mac builds 39, 40 and 41 were compiled with the macOS 26.5 SDK from the Command Line Tools, selected by setting `SDKROOT`, and later builds use the same setting:

```sh
SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk node native/build.mjs --runtime-dir /absolute/extracted-runtime --web-dir /absolute/web-bundle
```

Builds with other installed SDKs were not checked. The app's minimum system version stays macOS 14.

### Preparing the runtime

`native/mac/runtime-assets.json` pins official Node and Astral Python archive URLs and SHA-256 checksums. Download those archives into a build cache, then prepare a runtime-only payload:

```sh
python3 native/mac/prepare-runtime.py --cache /absolute/build-cache --output /absolute/new-runtime.tar.gz
```

The builder requires a `tar` implementation with Zstandard support to read the matching Python build's license metadata. It verifies the three archive checksums before preparing a new output file. Node's npm and development files are excluded, as are Python bytecode caches. Python's bundled package notices and 14 dependency notices are retained. One documented upstream manifest reference to zlib-ng is omitted because this exact build links macOS system zlib instead. Missing notices from other builds fail preparation.

The manually dispatched `Clean Mac runtime` workflow runs the preparation tests on a fresh standard Mac runner, downloads the pinned archives into a new temporary cache, verifies their hashes and prepares the runtime archive. It does not execute downloaded binaries, build or install the application, use signing keys or publish artifacts. The optional `build_app` input extends a run with the complete web and native build, isolated native checks and ZIP extraction verification on an arm64 runner. Its result must be verified separately from a runtime-only run.

### Building the app

Extract the prepared payload into a new directory. Build the web assets with `npm ci` and `npm run build:web`, or transfer a verified web bundle from another build machine. Then run `native/build.mjs` with the SDK line above.

The web directory must include its generated `assets/third-party-licenses.txt`. The builder checks runtime file hashes, preserves relative symlinks, signs the bundled Mach-O binaries and checks the final app. The runtime manifest records the input files before local signing, not hashes of the signed binaries. Signing is ad hoc, not an Apple Developer ID signature or notarization. No paid signing service is used.

The build runs `--test-collector`, `--test-web`, `--test-lifecycle` and `--test-popup` on the built executable. They check the bundled collector, the shared web pages, three open and close cycles of the main window, and the menu-bar panel. They do not measure memory, idle CPU, login startup or sleep and wake behaviour.

### Isolated checks

For an isolated interface check, launch the built executable with `--preview`. Add `--show` for the panel or `--preview-setup` for the setup screen. Temporary settings have every source disabled. Preview source choices affect only that temporary folder, and real collection, pairing and login changes are disabled. Quit the preview when finished.

To run the app with collection on against a separate folder, pass `--runtime /absolute/new-folder`. The app refuses a relative path, a linked path, the real data folder and anything inside it.

For UI automation, compile a separate test executable with Swift's `-D OBSERVATORY_PREVIEW_ONLY` flag and use a distinct test bundle identifier. This build accepts only `--self-test`, `--preview`, `--preview --preview-setup`, `--test-popup`, `--test-popup --force-offscreen-popup` or `--test-quota-archive`. Missing or different arguments exit before opening a runtime. This protects against inspection tools relaunching a closed test app without its arguments. Do not use a normal release executable as an unattended preview harness. The native compilation workflow builds this guarded variant separately and runs `node native/verify-preview-guard.mjs <preview-executable>` to verify that missing and unsafe arguments are refused.

### Distribution packaging

These procedures keep integrity and reproducibility checks for local packages. They do not publish anything. From a clean checkout matching the app's embedded source revision:

```sh
node native/mac/package.mjs --bundle /absolute/Observatory.app --output /absolute/new-distribution
```

The packager checks every bundled file, scans for private filenames and build paths, verifies signatures, and runs the native, bundled-collector and web tests. It creates `Observatory-<version>-macos-arm64.zip`, extracts it into a new location and repeats those checks. It saves `app-manifest.json`, `zip-SHA256SUMS.txt` and `zip-verification.json` immediately after ZIP verification, before attempting the DMG. These files describe the ZIP only, not a clean-machine install or publisher authentication.

To produce and verify only the ZIP, add `--zip-only`. This mode removes its temporary copies after ZIP verification and never creates or mounts a disk image. Omit the flag to prepare both formats.

DMG creation is bounded to two minutes. macOS may request authorization. Handle authentication prompts yourself and never share a password with an agent. A failed DMG attempt leaves the verified ZIP and temporary copies intact, exits with failure, and does not produce a successful full-release receipt. Any partial DMG must not be distributed. Successful DMG creation additionally requires an integrity check, read-only mount, exact app manifest and signature checks, and successful detach. Only then are the full `SHA256SUMS.txt` and `release-info.json` written.

### Guarded replacement

`native/mac/replace-app.mjs` replaces an installed app with a staged candidate beside it, after both package receipts and signatures are checked and no copy of the app is running. The previous bundle is kept. Back up the data folder and match it by checksum before replacing an app you use. See [desktop updates](UPDATES.md).

### Moving data from Workspace Observatory

`node native/mac/migrate-data.mjs status` reports whether `~/Library/Application Support/Workspace Observatory` has been copied to `~/Library/Application Support/Observatory`. With every copy of the app quit, `node native/mac/migrate-data.mjs copy --confirm-app-quit` copies it, checks every file by SHA-256 and never changes the earlier folder. Keep the earlier folder until the new app has run with your data. `replace-app.mjs` accepts a one-time install from `Workspace Observatory.app` to `Observatory.app` and keeps the earlier bundle.

### Independent local collector

The unpaired local path in `scripts/collect-mac.mjs` collects this Mac's ActivityWatch activity, saved Codex token and settings records, and optional Wispr Flow statistics. It does not require another computer. ActivityWatch must already be running locally. The Python readers use only the standard library. Pairing is a separate choice, not enabled by the manual example below.

Prepare a separate private runtime directory outside the checkout. Put `collector.config.json` there:

```json
{
  "activity": true,
  "codex": true,
  "wispr": false,
  "typewhisper": false,
  "quota": false
}
```

Only these boolean source settings are accepted. This manual example opts into activity and saved Codex records. It is not the fresh-app default. Dictation and online account monitoring are opt-in. Run one collection with absolute paths to the runtime directory, Node, Python and collector script:

```sh
python3 scripts/run-collector.py \
  --runtime /absolute/private/runtime \
  --collector /absolute/checkout/scripts/collect-mac.mjs \
  --node /absolute/path/to/node \
  --python /absolute/path/to/python3
```

This is a one-shot command, not a new background service. The POSIX runner serializes collection and stops its own child process group on timeout or termination. The script can stay inside a read-only application bundle while writable settings, snapshots and lock files remain in the private runtime directory. It does not copy private records into the bundle or checkout.

Snapshots include only the existing allowlisted usage fields. Raw prompts, tool arguments, window titles, transcripts and audio do not enter the output. The unpaired example does not establish remote coverage or a combined total. Those require authenticated private exchange and complete deduplication evidence. Read failures are unavailable, not fabricated zeroes.

### Historical build and collector checks

These results apply only to the named revisions and are kept as dated evidence. They do not verify a later build.

- The [September 15 clean build for 2bdddc7](https://github.com/ScribleSean/observatory/actions/runs/34965810055) passed complete application and extracted ZIP verification. The source suite reported 515 passes, seven skips and zero failures. The 0.3.12 ZIP was 64,912,222 bytes, with 184,465,141 unpacked bytes. Its SHA-256 was `15316398a0a798184f0ed6f01452f0d7aba6877dd204fd65d61918ed7bfa333f`. The workflow did not retain a downloadable artifact, install the app, produce a DMG or notarize the build.
- Runtime-only verification passed on [source `2a29da3`](https://github.com/ScribleSean/observatory/actions/runs/34738671031), producing a 61,556,651-byte archive with SHA-256 `3c9c9581711fb02f5dbc78554343279914d62d86817e2e724e5e093ce08e9709` and 14 dependency notices.
- Full application and ZIP verification passed on [source `3ebf3ef`](https://github.com/ScribleSean/observatory/actions/runs/34740025534), with 366 passing source tests, no failures and five explicit skips. The archive was 63,842,120 bytes, SHA-256 `fe0d343a117bd0cf36fd3617b3667d5ee096c0408d518058e9c29fa9858c2a27`, with 181,335,679 unpacked bytes. It was not uploaded or installed.
- The local collector was tested in an isolated directory on the development Mac. ActivityWatch, saved Codex usage and Wispr all returned valid metadata, and the snapshot passed the private-field shape check. These checks did not modify the installed app, its login registration or its settings, and they do not establish clean-machine compatibility.

These builds used the earlier SwiftUI interface, which was removed in October 2026. The tag `archive/pre-viewer-removal` marks the last commit that has it. Builds since then show the shared web pages that the Windows app also uses.
