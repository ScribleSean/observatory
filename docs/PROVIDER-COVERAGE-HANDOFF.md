# Provider coverage handoff

Updated September 26, 2026 UTC. [PR #2](https://github.com/ScribleSean/observatory/pull/2) added local Claude coverage. [PR #3](https://github.com/ScribleSean/observatory/pull/3) fixed unreadable-directory undercounts and merged at `eb01aa0`. [PR #4](https://github.com/ScribleSean/observatory/pull/4) integrated provider sharing, optional Antigravity allowances and corrected provider health accounting at `143bf69be01a94b3bd8dc11d32bf122ddf5654d8`. The development Mac now runs build 35 from `ced669854940f5892570a6a7a8feb1689b903b80`. Windows retains its verified build-34 payload from `80a7aa8397a208fad51599f990b094af3d29458f`, with the app stopped at the build-35 uninstall guard. Claude sharing remains off on both devices.

## Outcome and ownership

Observatory remains a usage dashboard. HAPI, Happy and other agent clients own their sessions. Their relay records are not additional usage when the same native Codex or Claude Code request is already recorded.

The token chart remains scoped to Codex. Source health adds optional Claude Code counters by device and explicit coverage for Codex, Claude Code, ChatGPT, Cursor and Antigravity. Antigravity allowances are separate percentages, not token history. Missing sources remain Unknown. Providers and devices are not summed without verified overlap handling.

## Implemented source

- `scripts/read-claude-usage.py` reads retained assistant usage metadata, reconciles repeated streaming snapshots and copied logs, and withholds incomplete reports.
- `scripts/provider-token-sources.mjs` validates the public numeric projection. `provider-token-sync.mjs` attaches local and optionally received Claude records after core peer merging. The separate channel preserves core protocol compatibility and never combines device totals.
- Native Settings adds `claude`, disabled by default. It reads only the local device. It does not sign in, invoke a model, collect transcripts or infer a WSL Claude installation.
- Native Usage sharing keeps Codex allowance and Claude consent separate. Both devices must explicitly enable Claude sharing. Replayed records retain their original times, failures become Unknown and old readings become stale. Credentials and request identities are not shared.
- The optional `antigravity` source defaults to off. Mac uses the installed CLI's non-model usage command with bounded output, process cleanup and consent rechecks. Windows returns unsupported without starting a process. No Antigravity token, history or peer coverage is claimed.
- The Mac Python wrapper includes provider tokens and allowances when calculating source health. A configured Claude failure can no longer disappear from the overall status.
- Native and web Source health show provider coverage. The existing Tokens view explicitly describes Codex. Shared typography and colors are retained.
- The release ledger distinguishes verified packages, installed applications and provider acceptance. Build 35 adds the client-error placeholder and sanitized-model reconciliation fixes, with legacy public order preserved. Mac has installed it, while Windows activation remains blocked.

## Verification and delivery boundaries

Reviewed source and synthetic checks cover protocol compatibility, consent races, replay freshness, revocation, provider isolation and stale or unavailable display states. These checks support the implemented capabilities, not complete installed acceptance.

The Mac runs build 35 from `ced6698`. The owner verified installed inventory, signatures, saved-state preservation and normal launch. Scheduled Claude and Antigravity checks passed, with private arithmetic and Codex separation verified. Latest source health is 11 of 15, with three Ubuntu gaps and the agent source unavailable. Missing readings remain Unknown. Normal Quit succeeded, but a later capture failure left new build-35 UI checks unobserved.

Windows retains the intact build-34 payload from `80a7aa` and its protected backup. The ordinary app is stopped while a temporary uninstaller child remains alive. Activation is held for normal manual cancellation and revalidation. The last scheduled local Claude reading was unavailable, so installed coverage has not passed. Claude peer sharing remains off and installed synchronization unverified. Combined Claude totals remain unavailable.

The [build 35 release evidence](RELEASE-0.3.13.md#build-35-preparation-september-26-utc) separates successful package gates from the current Windows activation-helper defect. Mac source `ced6698` and Windows candidate `7c7ae25` have identical production application code. Windows build 35 and its scheduled Claude acceptance remain pending. The direct candidate read and earlier [PR #8 screenshots](UI-VERIFICATION.md#windows-source-screenshot-review-september-26) do not establish those installed checks.

The later [Windows allowance helper and collector integration](RELEASE-0.3.13.md#later-windows-allowance-helper-source) remain outside the build-35 packages. All five native Windows integration cases passed with fictional processes. The production gate is closed, and live Windows Antigravity coverage remains unverified.

The [build 34 release evidence](RELEASE-0.3.13.md#build-34-integration-september-26-utc) is the canonical dated record for source checks, package and installation pins, scheduled verification, PR merges and the Windows fixture failure and corrected run. Earlier build 32 and 33 evidence remains scoped to those revisions. Source, package, installed and live verification remain separate.

## Exact next actions

1. Keep personal snapshots and credentials out of Git and public demo artifacts. Integrate only reviewed source and publish checkpoints for continuation.
2. Retain the protected Windows build-34 backup and recovery evidence. Preserve installed Mac source `ced6698`, installed Windows payload `80a7aa` and Windows candidate `7c7ae25` separately. Do not relabel artifacts or modify installed bundles in place.
3. Complete one normal manual Cancel or close of the Windows uninstaller, then revalidate the child exit, intact app and protected backup before the corrected maintained continuation. No forced stop, retry, install or relaunch is authorized while the child remains. Windows installed and scheduled Claude acceptance still need verification. Mac build-35 UI checks remain unobserved.
4. Restore Ubuntu collection only through an approved safe WSL recovery. On September 25, Ubuntu was running but even a harmless WSL command failed with `Wsl/Service/E_UNEXPECTED`. No workload was terminated. Mac and Windows records remained readable, while combined tokens were correctly withheld.
5. After Windows installation and local scheduled Claude acceptance pass, verify optional Claude sharing with both devices, including disable, stale-peer and reconnect behavior. Combined Claude totals remain unavailable until complete request-identity overlap evidence is implemented and verified.
6. Inspect a supported Cursor export before choosing a reconciliation rule. ChatGPT token coverage remains unknown. Complete Windows collector integration and installed verification before enabling Antigravity execution there. A subscription, app presence or selected model is not proof of a token export or API entitlement. See [source coverage](SOURCE-COVERAGE.md).
7. Continue the remaining [audit acceptance](AUDIT-STATUS.md): native visual consistency, motion and accessibility, installed failure recovery, signing, update feeds and clean-machine verification. Do not repeat already completed audit repairs or treat source tests as installed UI acceptance.

The design direction remains Mono Charts, Apple and Hart. Prefer fewer visible controls and explanations, one restrained accent and honest gaps. Accuracy, efficient scans and preserved records take priority over decorative changes.
