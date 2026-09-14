# macOS 0.3.9 candidate

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

