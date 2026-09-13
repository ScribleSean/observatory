# Mac development candidate

The Apple Silicon source build uses a SwiftUI main window and menu-bar panel. The 0.3.3 development candidate bundles Node and Python and can run the local collector without a checkout or separately installed runtimes. It is not yet a published, clean-install-verified release. Earlier installed previews can retain their legacy cross-device configuration and external runtimes.

Fresh installations keep all sources off until the first-run wizard is completed. The wizard covers privacy, source choices and optional device pairing. Settings can later change the local sources and optional Codex account-limit monitoring. Changes apply to the next collection. Existing cross-device configuration is preserved, but migration to the native source controls remains unfinished.

## Main window and fallback

Normal launch opens the native dashboard after setup. Closing the window leaves the menu-bar collector running. **Open Observatory** reopens it, and Command-comma opens native Settings. The window supports resizing and remembers its frame for the installed app. `--background` suppresses the initial main window, while `--show` opens the compact popup. Actual login and sleep/wake behavior still require release verification.

The main window includes activity and token day/week/all-retained views, allowance graphs, dictation, agent and tool records, source health and Settings. Provider account additions and unified allowance history remain unfinished. The explicit `--legacy-dashboard` executable argument selects the older WebKit dashboard as a fallback.

### Legacy dashboard enlargement

With the legacy dashboard open, use **View > Zoom In**, **Zoom Out**, **Actual Size**, or **200%**. The keyboard shortcuts are Command-equals (or Command-plus), Command-minus, and Command-zero. Zoom is bounded from 75% to 200%. The menu disables further changes at either limit. These web-only controls are disabled for the native dashboard.

This scales the web page's text and controls, not macOS system fonts or the menu-bar panel. Zoom applies to the open dashboard and resets to 100% after it is closed and reopened. It does not change collection settings. See [native UI verification](UI-VERIFICATION.md) for the tested layouts and remaining limits.

## Building the candidate

`native/mac/runtime-assets.json` pins official Node and Astral Python archive URLs and SHA-256 checksums. Download those archives into a build cache, then prepare a runtime-only payload:

```sh
python3 native/mac/prepare-runtime.py --cache /absolute/build-cache --output /absolute/new-runtime.tar.gz
```

The builder requires a `tar` implementation with Zstandard support to read the matching Python build's license metadata. It verifies the three archive checksums before preparing a new output file. Node's npm and development files are excluded, as are Python bytecode caches. Python's bundled package notices and 14 dependency notices are retained. One documented upstream manifest reference to zlib-ng is omitted because this exact build links macOS system zlib instead. Missing notices from other builds fail preparation.

The manually dispatched `Clean Mac runtime` workflow runs the preparation tests on a fresh standard Mac runner, downloads the pinned archives into a new temporary cache, verifies their hashes and prepares the runtime archive. It does not execute downloaded binaries, build or install the application, use signing keys or publish artifacts. Its result covers runtime preparation only, not a clean application build or first launch.

Runtime-only verification passed on [source `2a29da3`](https://github.com/ScribleSean/workspace-observatory/actions/runs/34738671031), producing a 61,556,651-byte archive with SHA-256 `3c9c9581711fb02f5dbc78554343279914d62d86817e2e724e5e093ce08e9709` and 14 dependency notices. The optional `build_app` input extends later runs with the complete dashboard/native build, isolated native checks and ZIP extraction verification. It requires an arm64 runner. This opt-in mode executes the verified runtime and uses ad hoc local signing, but still does not install or publish the app. Its result must be verified separately from the runtime-only run.

Full application and ZIP verification passed on [source `3ebf3ef`](https://github.com/ScribleSean/workspace-observatory/actions/runs/34740025534). There were 366 passing source tests, no failures and five explicit skips. Native popup tests passed offscreen fallback, dashboard handoff and reopening/closing the usage panel while retaining the dashboard. The ZIP and extracted application passed their checks. The archive was 63,842,120 bytes, SHA-256 `fe0d343a117bd0cf36fd3617b3667d5ee096c0408d518058e9c29fa9858c2a27`, with 181,335,679 unpacked bytes. The temporary hosted artifact was not uploaded or installed, no DMG was requested, and notarization and clean interactive first launch remain separate gates.

Extract the prepared payload into a new directory. Build the web assets with the pinned project dependencies, or transfer a verified web bundle from another build machine. On an Apple Silicon Mac with Xcode tools:

```sh
node native/build.mjs --runtime-dir /absolute/extracted-runtime --web-dir /absolute/web-bundle
```

The web directory must include its generated `assets/third-party-licenses.txt`. The builder checks runtime file hashes, preserves relative symlinks, signs all 11 bundled Mach-O binaries, and checks the final app. The runtime manifest records the input files before local signing, not hashes of the signed binaries. Signing is ad hoc, not an Apple Developer ID signature or notarization. No paid signing service is used. Downloaded-app Gatekeeper handling and public distribution are still pending.

The candidate passes configuration and first-run consent tests, an isolated bundled-collector test with all sources disabled and no developer tools on PATH, signature verification, and the WebKit renderer/data-bridge test. A separate earlier live collection using only the packaged runtimes read ActivityWatch, Codex tokens/settings, Wispr successfully. Native Settings was checked in an isolated preview: Save persists the choice, Reload discards unsaved changes, and preview collection remains disabled. This is development-machine evidence, not a clean-machine installation test.

For an isolated native UI check, launch the built executable with `--preview`. Add `--show` for the popup, `--preview-setup` for the wizard, or `--legacy-dashboard` for the fallback. Temporary settings have every source disabled. Preview source choices affect only that temporary folder, and real collection, pairing and login changes are disabled. Quit the preview when finished.

The build runs `--test-lifecycle` and `--test-popup` for both native and legacy modes. It verifies three open/close cycles release their content views, native Settings navigation reuses the main window, and popup handoff preserves the dashboard. The menu-bar app remains running after the window closes. These checks do not measure total helper memory, idle CPU, login startup or sleep/wake behavior.

## Distribution packaging

From a clean checkout matching the app's embedded source revision:

```sh
node native/mac/package.mjs --bundle '/absolute/Workspace Observatory.app' --output /absolute/new-distribution
```

The packager checks every bundled file, scans for private filenames and build paths, verifies signatures, and runs the native, bundled-collector and WebKit tests. It creates a ZIP, extracts it into a new location and repeats those checks. It saves `app-manifest.json`, `zip-SHA256SUMS.txt` and `zip-verification.json` immediately after ZIP verification, before attempting the DMG. These files describe the ZIP only, not a clean-machine install or publisher authentication.

To produce and verify only the ZIP, add `--zip-only`. This explicit mode removes its temporary copies after ZIP verification and never invokes disk-image creation or mounting. It does not satisfy the separate DMG release gate. Omit the flag to prepare both formats.

DMG creation is bounded to two minutes. macOS may request authorization. Handle authentication prompts yourself and never share a password with an agent. A failed DMG attempt leaves the verified ZIP and temporary copies intact, exits with failure, and does not produce a successful full-release receipt. Any partial DMG must not be distributed. Successful DMG creation additionally requires an integrity check, read-only mount, exact app manifest and signature checks, and successful detach. Only then are the full `SHA256SUMS.txt` and `release-info.json` written.

## Independent local collector

`scripts/collect-mac.mjs` collects this Mac's ActivityWatch activity, saved Codex token/settings records, and optional Wispr Flow statistics. It does not call SSH, inspect Windows/Ubuntu records, or publish combined cross-device totals. ActivityWatch must already be running locally. The Python readers use only the standard library.

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

Snapshots include only the existing allowlisted usage fields. Raw prompts, tool arguments, window titles, transcripts and audio do not enter the output. Remote devices remain disconnected, and combined totals remain unavailable until private sync and deduplication are implemented. Read failures are unavailable, not fabricated zeroes.

## Verified scope

The local collector was tested in an isolated directory on the development Mac. ActivityWatch, saved Codex usage, Wispr all returned valid metadata. The snapshot passed the private-field shape check. Regression tests cover disabled readers, output filtering, shared token/settings reads, invalid counters, and ActivityWatch interval normalization. POSIX runner tests cover failure, timeout, overlapping runs and separation of bundle code from writable state.

These checks did not modify the installed app, its login registration, its existing settings or its legacy cross-device collector. Public release packaging, clean-machine compatibility, and installed-app migration remain pending. Do not replace the working cross-device collector until optional device sync has been verified.
