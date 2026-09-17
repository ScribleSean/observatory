# September 15 audit follow-up

Reviewed September 17 against source `34af7cbe`. The [audit reports in PR #1](https://github.com/ScribleSean/observatory/pull/1) remain open. They contain 19 backlog items, including acceptance criteria. This is a focused source review, not a complete runtime acceptance result.

## Repairs present in current source

- Item 1: Mac publishes the pairing-pause state and shows its message in the dashboard and compact panel. See `native/Store.swift`, `native/NativeDashboard.swift` and `native/Panel.swift`. The full failure, retry and quit interaction still needs acceptance review.
- Item 2: Both setup wizards describe the existing SSH prerequisites and label direct TLS pairing as a separate preview.
- Item 3: Mac setup and Settings explain the separate ActivityWatch installation and link to it. Complete cross-platform empty-state acceptance remains to be checked.
- Item 4: README and GUIDE identify Allowances as the landing view.
- Item 8: GUIDE starts with native setup and separates the legacy developer workflow.

## Confirmed remaining work

- Item 5: Native Mac and Windows expose Agents, while GUIDE records execution details under Sources in the web demo. Cross-platform placement is not yet consistent. The Windows guide's obsolete navigation description is corrected with this follow-up.
- Item 11: Mac, Windows and web still offer a ChatGPT dictation filter despite lacking verified voice tracking, and retain the speech-detection coming-soon copy. See `native/NativeRecordedUsage.swift`, `native/windows/NativeDictation.cs` and `app/dictation.tsx`.
- Item 12: `native/NativeDashboard.swift` still appends the development footer to every section.
- Item 13: `DirectPairingModel.finishJoining()` still sends `includeUbuntu: false`. The Mac join flow needs explicit scope parity or a documented restriction.
- Item 14: A foreground Mac launch blocked by `MacUpdateGate` still terminates without the requested explanatory alert in `native/main.swift`.

The remaining acceptance criteria have not all been rechecked. Do not close the audit as resolved or treat merging its report-only branch as implementing its findings. Production signing, update feeds, clean-machine checks and other explicitly excluded release work remain tracked in the [release checklist](RELEASE-CHECKLIST.md).
