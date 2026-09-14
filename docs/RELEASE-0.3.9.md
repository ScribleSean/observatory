# Desktop 0.3.9 candidates

Verified September 14, 2026. This is an unpublished development candidate, not a clean-machine or production-signing certification.

- Version: 0.3.9, build 18.
- Clean source: `12f752ce75b8eb19530419fcca1ed1f7fa9994c0`.
- Platform: Apple Silicon, macOS 14 or later.
- Signing: ad hoc, not Developer ID signed or notarized.
- Unpacked application: 182,677,254 bytes.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Workspace-Observatory-0.3.9-macos-arm64.zip | 63,912,549 | `806c0fef5cdb1c69e16783286567e602c3496b364a333a1547411210a88f67e5` |
| Workspace-Observatory-0.3.9-macos-arm64.dmg | 70,978,843 | `b144e64dfcdea9b034e80cacf7e18a58c14bcdd159131380c4105adc129c71ad` |

The pinned runtime archives passed checksum verification. Runtime preparation retained provenance and dependency notices, and the resulting payload passed full-file verification for eleven binaries. The complete app passed native self-tests, sync-owner lifecycle, shutdown, synthetic collector, renderer, dashboard lifecycle and popup checks.

Packaging verified the full app manifest and nested signatures, then extracted the ZIP and repeated bundled collector, renderer and lifecycle checks. The DMG passed image integrity verification. Its read-only mounted app matched the manifest and passed deep signature verification. The mount detached successfully.

The artifacts and independent verification records are retained in local release storage, not published downloads. This rebuild did not replace either installed app or modify private data. The installed Mac build 18 retains source `08cc928`, while this candidate includes the subsequent documentation-only source change. Do not relabel either artifact or treat this same-build candidate as an automatic upgrade.

Clean-environment installation, production signing, automatic updates and remaining cross-device lifecycle checks are still open. See the [release checklist](RELEASE-CHECKLIST.md).

## Windows 0.3.9 candidate

Verified September 14, 2026 on the development Windows machine, from clean source `a56b1636d93aa3bf07fee0ff84167ff3f79ec58f`. This is separate from the Mac artifact source above.

- Installer: `Workspace-Observatory-0.3.9-windows-x64-setup.exe`.
- Installer size: 97,375,365 bytes.
- SHA-256: `a95c99a317cd57c0ef256b6d558ce34442f162ff30b78382edb041bcb6dacc59`.
- Package: 3,050 verified files, 258,541,110 bytes.
- Status: unsigned, unpublished and not applied to the ordinary installation.

The complete packaging workflow passed 470 source tests with 37 explicit skips and zero failures. Packaged native self-tests, isolated sharing bridge, sync-owner launch and shutdown, Python SQLite/timezone checks and Node checks passed. Independent manifest verification required clean source and matched every payload file.

A separately generated TEST-identity installer from the same candidate passed per-user installation, Start menu shortcut and quoted registration checks, all installed payload hashes and native self-tests. It rejected a running-app condition, existing-install overwrite and a linked payload directory. Uninstall preserved a synthetic saved-data sentinel and unrelated files and registry values, removed its own startup entry, and passed reinstall/uninstall checks. Test registration and installation were removed. The ordinary app was not replaced.

An initial full build had one unidentified test failure whose detailed output was truncated. A logged source-suite rerun and the subsequent complete packaging run both passed. No specific defect is claimed fixed by those reruns.

These checks do not establish ordinary desktop first launch, actual login startup, clean-machine compatibility, production signing or automatic updates. Windows visual parity remains pending Mac design review.

