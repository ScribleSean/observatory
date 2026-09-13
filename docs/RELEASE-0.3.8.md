# 0.3.8 candidate evidence

Prepared September 13, 2026. Version 0.3.8, build 14. Both packages embed clean source `40d2fb77d0ab5e4e2cbcdf642dbb114c853b97b6`. This is preparation evidence, not a published release or installation guarantee.

This candidate contains the Observatory branding, allowance pace and reset-time comparison, due-aware allowance-only collection, hourly caching of daily account usage, and Windows allowance-attempt status recovery. The allowance scheduler retains the provider cooldown and checks due state separately from full source scans. An installed independent refresh has been observed on each platform. Sustained timing and performance remain unverified.

## Artifacts

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Mac ARM64 ZIP | 63,076,733 | `844bf071f1330a941932c3cdc423188e1fd41a5a1556184a8325598402e92671` |
| Mac ARM64 DMG | 70,088,359 | `150e438766df2105f8d4a71bde3ea8664ca6f5fbb5be285058806d71f89d3fdb` |
| Windows x64 setup EXE | 97,008,298 | `bfcce64a15af47ff7d9a08ed8da943464d04c43c8cf29772f57c278519d2ec2f` |

The Mac bundle is 180,648,946 bytes unpacked. The Windows package is 257,786,595 bytes across 3,030 verified manifest entries. These are file sizes, not memory measurements. Artifact and internal installation names retain the former Workspace Observatory spelling for compatibility.

## Completed checks

- Mac source suite: 390 tests passed, five platform/tool skips, no failures. TypeScript checking passed.
- Mac fresh dashboard build, native self-tests, packaged disabled-source collector, renderer bridge, window lifecycle and menu-bar popup checks passed with synthetic data.
- Mac ZIP extraction, relocated runtime checks, signatures, DMG checksum and read-only mounted-content verification passed.
- Windows source suite: 365 tests passed, 30 explicit skips, no failures. Native compilation and self-tests passed.
- Windows fresh dashboard build, packaged sharing bridge with isolated data, Python SQLite/timezone checks, package privacy checks and full manifest verification passed.
- The Windows installer compiled successfully and its checksum was recorded. Its subsequent development-machine installation is recorded below.

## Subsequent clean-runner verification

The [clean Windows installer run for source `892503f`](https://github.com/ScribleSean/observatory/actions/runs/34747078437) passed on September 13, 2026. This later source includes the running-version label. It produced a fresh runner package with 3,030 verified files and 257,787,107 unpacked bytes, after 365 passing tests and 30 explicit skips.

Its TEST-identity installer passed per-user installation, every payload hash, shortcut and quoted registration checks, native self-tests, running-app refusal, existing-install overwrite refusal, linked-directory rejection, data-preserving uninstall, and reinstall/uninstall while retaining an unrelated startup owner. The run also checked the installer compiler archive and corrupt-cache rejection.

This run did not execute the earlier local installer listed above, change an ordinary app registration, publish an artifact or verify interactive first launch, login startup or sleep/wake. Keep the two artifact identities separate.

## Installed background refresh evidence

On September 13, the installed Mac performed an allowance-only refresh at 08:35:31 UTC, about 24.5 seconds after its deadline. The full snapshot timestamp and a hash of its non-allowance data stayed unchanged across that refresh.

The installed Windows full scan finished at 08:37:45 UTC. Its separate allowance-only attempt completed successfully at 08:38:13 UTC, with the quota observation at 08:38:11 UTC and the next deadline five minutes later. The full snapshot retained its 08:37:42 UTC collection timestamp. These observations were read-only and did not trigger manual refreshes.

This is evidence of an independent timer-driven cycle on each platform, not proof of sustained cadence, low resource use or sleep/wake recovery.

## Remaining release gates

Both local candidates were subsequently installed on the development machines with recoverable previous-app backups and unchanged private-data inventories during replacement. The Mac reopened visibly and read all 13 configured sources. Windows restored its login registration, reopened a responsive desktop process and read all seven configured sources. Both retained recent peer records. These checks apply to the `40d2fb7` artifacts listed above, not a later source build.

The Mac candidate is ad hoc signed and not notarized. The Windows installer is unsigned. Neither candidate is published. Verify interactive first launch in clean environments, actual login startup, sleep/wake, background collection cadence, resource use and broader supported-source behavior before distribution. Earlier checks of other versions are not substitutes. Ad hoc Mac builds have changing designated requirements, so folder permission grants may not persist across updates. Stable signing remains required.

Broader release requirements remain in the [release checklist](RELEASE-CHECKLIST.md). No private user records are included in these artifacts.
