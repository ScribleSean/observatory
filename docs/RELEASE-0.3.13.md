# Observatory 0.3.13 candidate

Status: preparation only. Build 24 is not published or installed.

## Changes

- Shared native navigation and styling, clearer saved allowance history entry,
  and improved narrow-window layouts.
- Saved allowance-used charts with Day, Week and All retained periods. Dashed
  connectors disclose missing observations; reset boundaries remain separate.
- Compact counts advance through K, M, B and T. Long durations display days
  with remaining hours and minutes. Unknown data remains unknown.
- Opening the Mac menu-bar popup does not activate the dashboard. Tests cover
  opening without a dashboard and keeping an existing hidden dashboard hidden.

## Evidence before packaging

The preceding source checkpoint passed 535 JavaScript tests on Mac, with seven
skips. The complete Windows development build passed native self-tests and 503
JavaScript tests, with 39 platform-specific skips. No test failures were reported.
Mac synthetic popup checks verify accessible filter defaults and explicit
dashboard/Settings handoff. These checks do not establish every accessibility,
integration or clean-install requirement.

## Candidate package evidence

Build 24 packages use clean source `acdf876864d8c96d76ef1bfa26d9540f40886f67`.
The Mac build, ZIP extraction, native checks and read-only mounted DMG verification
passed. The Windows self-contained payload manifest, runtime and native bridge
checks passed. Its packaged synthetic dashboard test wrote a passing receipt.
The separate test-identity installer passed install/uninstall/reinstall, shortcut
and registration checks, linked-directory rejection, existing-install refusal,
and preservation of saved data and unrelated files/registry values. Test-owned
installation files and registrations were removed. The ordinary app was untouched.
The packaged native collector also completed against a fresh runtime with every
source disabled, retained the consent configuration and reported partial coverage.
This verifies the packaged collector path, not live provider reads.

On September 15, read-only npm advisory queries for production dependencies and
the complete lockfile reported zero known vulnerabilities. The Windows NuGet
query included transitive dependencies, used the existing restore without
restoring packages, and returned no vulnerable entries from nuget.org. Lockfile
SHA-256 values were `caa344b6249b32dfb35f7ed21ec1b035b6eae662e97f239476cdf313bdfa0095`
for npm and `da81446ea7bfe69b9216e393c5dea8e305bc66b43cae4a6afa88d44936ed615f`
for NuGet. These checks do not clear every bundled native library, system webview
or application security boundary.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| macOS arm64 ZIP | 64,238,790 | `79b4058dc3992431fba1e9dfe240fc34ae5875e3641cdae5fbc10ef37c504ae6` |
| macOS arm64 DMG | 71,397,416 | `8e8e709271bbdcc38d018865dc7d2539e0e08c346d750bbe75644a5d11472191` |
| Windows x64 setup EXE | 97,448,151 | `e6f4974ead5b958dd93b5efea1080358c2e250788bafdfddebe5f5e747983896` |

The Mac app is ad-hoc signed, not notarized. The Windows installer is unsigned.
Windows update activation and normal update-startup checks explicitly skipped
because they require a disposable hosted runner. Passing package checks does not
establish these skipped cases or installed update behavior.

## Gates remaining

- Disposable-runner update activation and normal update-startup checks.
- Upgrade verification against installed Mac build 22 and Windows build 23,
  preserving private data and a recoverable previous application.
- Installed interface and collection checks, signing/distribution limitations,
  clean-machine and lifecycle coverage described in the release checklist.

No raw messages, transcripts, credentials or private snapshots belong in an
artifact or its verification report. Synthetic fixtures are used for UI checks.
