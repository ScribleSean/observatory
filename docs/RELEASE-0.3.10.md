# macOS 0.3.10 candidate

Verified September 14, 2026. This candidate is retained locally, not published or installed.

- Version: 0.3.10, build 19.
- Clean source: `70744b1f6af986d5a18c15564c43f665ebd34f33`.
- Platform: Apple Silicon, macOS 14 or later.
- Signing: ad hoc, not Developer ID signed or notarized.
- Unpacked application: 182,975,623 bytes.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Workspace-Observatory-0.3.10-macos-arm64.zip | 63,987,697 | `583523583f8a275a8a7768f2eceb270e1c7967f7b4bcf2ec0d65137e508396df` |
| Workspace-Observatory-0.3.10-macos-arm64.dmg | 71,069,260 | `b9b06e9b52e078cc15aff44d9bfbf3a09f47830d30f9fdfd7c9c52a05c7f3584` |

## Changes and verification

The candidate adds the Mac saved-allowance-history sheet with separate account groups, local-calendar date filters, paginated readings, daily token reports, collection checks and storage information. It does not share archived records or expose a delete action. Account names are not retained.

The full build passed native self-tests, the bundled archive process test, sync-owner lifecycle, shutdown, synthetic collector, renderer, window lifecycle and popup checks. The archive test covers empty-store handling, account separation, reading pagination, daily reports, collection checks and rejection of a delete request. It caught canonical-path handling issues that were corrected before this build.

Packaging verified the full file manifest and nested signatures. ZIP extraction repeated bundled application checks, including the archive process test. DMG integrity and read-only mounted-content verification passed, and the test mount was detached. Independent artifact hashes were checked again against the retained receipts.

The archive sheet's visual and interactive verification is still pending. Build tests do not establish keyboard behavior, layout quality, clean-machine installation, actual login or sleep/wake. Neither development installation was replaced by this candidate.

Windows has no 0.3.10 installer candidate yet. Its [0.3.9 installer evidence](RELEASE-0.3.9.md#windows-039-candidate) is separate from source synchronization. See the [release checklist](RELEASE-CHECKLIST.md) for the remaining gates.
