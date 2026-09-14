# macOS 0.3.11 candidate

Verified September 14, 2026. Retained locally, not published or installed.

- Version: 0.3.11, build 20.
- Clean source: `65232ed25af91c0c8f2bae0d925cb97ac330f47d`.
- Platform: Apple Silicon, macOS 14 or later.
- Signing: ad hoc, not Developer ID signed or notarized.
- Unpacked application: 183,020,791 bytes.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Workspace-Observatory-0.3.11-macos-arm64.zip | 63,998,109 | `011f1e46a816bb343d603aa8a2486192ae4e80bd9cd2fb2b03ffd89542a45e4c` |
| Workspace-Observatory-0.3.11-macos-arm64.dmg | 71,055,632 | `1094df8a5f8b7585b83355dd0f59903daaa411622cd9bd06b382917eabd828ee` |

## Changes and verification

This candidate includes the saved allowance history browser introduced in [0.3.10](RELEASE-0.3.10.md). It fixes the reproduced SwiftUI layout warnings when loading history after editing a date. Filters remain editable during reads. Changing filters or closing the sheet invalidates pending replies so old results cannot be displayed under a new selection.

Native regression tests cover request invalidation and supersession. A synthetic preview repeated date editing, empty and populated reads, and final-page navigation without the previously observed warnings. See [UI verification](UI-VERIFICATION.md) for the scope and remaining accessibility checks.

The clean build passed native self-tests, bundled archive process checks, sync-owner lifecycle, shutdown, synthetic collection, renderer, window lifecycle and popup checks. ZIP extraction repeated the native, archive, collector, renderer and window-lifecycle checks. Packaging verified the full file manifest and nested signatures. DMG integrity and read-only mounted-content verification passed. The test mount was detached and temporary distribution copies were removed. Independent manifest, checksum and ZIP verification receipts are retained with the artifacts.

## Remaining gates

The development Mac installation has not been replaced. Its original independent verification manifest is unavailable, so the normal verified replacement route is blocked. A separately approved recovery procedure is required. A manifest derived from the installed app must not be presented as its original independent receipt.

Light-mode, enlarged-text and full keyboard/screen-reader checks remain incomplete for the history sheet. Clean-machine installation, login, sleep/wake, production signing and notarization are not established by these package tests. Archived-history sharing and deletion are not included.

There is no Windows 0.3.11 installer candidate. The [Windows 0.3.9 candidate](RELEASE-0.3.9.md#windows-039-candidate) remains separate from source synchronization and the ordinary installed app. See the [release checklist](RELEASE-CHECKLIST.md) for the wider release gates.
