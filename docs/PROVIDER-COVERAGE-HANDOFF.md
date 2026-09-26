# Provider coverage handoff

Updated September 26, 2026 UTC. [PR #2](https://github.com/ScribleSean/observatory/pull/2) added local Claude coverage. [PR #3](https://github.com/ScribleSean/observatory/pull/3) fixed unreadable-directory undercounts and merged at `eb01aa0`. [PR #4](https://github.com/ScribleSean/observatory/pull/4) integrated provider sharing, optional Antigravity allowances and corrected provider health accounting at `143bf69be01a94b3bd8dc11d32bf122ddf5654d8`. The development Mac now runs build 34 from `d1505872c503eec47c784602415998154c757fc2`. Windows now runs build 34 from `80a7aa8397a208fad51599f990b094af3d29458f`, with the owner's final installation and readiness checks passed. These revisions have the same production application code, with later test and CI changes in the Windows package.

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
- The release ledger distinguishes verified packages, installed applications and provider acceptance. Both devices run build 34. Build 35 source adds the client-error placeholder and sanitized-model reconciliation fixes, with legacy public order preserved.

## Verification and delivery boundaries

Reviewed source and synthetic checks cover protocol compatibility, consent races, replay freshness, revocation, provider isolation and stale or unavailable display states. These checks support the implemented capabilities, not complete installed acceptance.

The Mac runs build 34 from `d150587`, with independently verified installed inventory and preserved saved data. Scheduled Claude and Antigravity checks passed. Claude is counted once, and provider allowances remain separate from tokens and Codex quota. Latest source health is 12 of 15, with three Ubuntu gaps. Missing readings remain Unknown. Restart and navigation are still unverified after a UI automation stream failure.

Windows runs build 34 from `80a7aa`. Its package passed independent artifact checks, and the owner's final installation receipt confirms exact installed files, ordinary app readiness and saved-data preservation against the reconciled baseline. The original backup and accepted newer peer observation were retained. The scheduled local Claude reading was unavailable, so optional coverage has not passed. Health correctly reports 4 of 8 sources, including one configured but unread Claude source. Codex and privacy isolation passed. Claude peer sharing remains off and installed synchronization unverified. Combined Claude totals remain unavailable.

The [build 35 package gates](RELEASE-0.3.13.md#build-35-preparation-september-26-utc) record a passing staged Mac candidate and a Windows package failure. Both activations remain held. The successful direct candidate read and earlier [PR #8 screenshots](UI-VERIFICATION.md#windows-source-screenshot-review-september-26) do not establish installed Claude or UI acceptance. The last installed Windows Claude reading remains unavailable.

The [build 34 release evidence](RELEASE-0.3.13.md#build-34-integration-september-26-utc) is the canonical dated record for source checks, package and installation pins, scheduled verification, PR merges and the Windows fixture failure and corrected run. Earlier build 32 and 33 evidence remains scoped to those revisions. Source, package, installed and live verification remain separate.

## Exact next actions

1. Keep personal snapshots and credentials out of Git and public demo artifacts. Integrate only reviewed source and publish checkpoints for continuation.
2. Retain the reconciled Windows saved-state baseline, newer peer observation and original recovery evidence. Preserve installed Mac source `d150587` and Windows source `80a7aa` separately; do not relabel artifacts or modify installed bundles in place.
3. Keep both build-35 activations held while the coordinator diagnoses the Windows hosted pairing timeout. Verify the required package and lifecycle gates before a guarded upgrade and ordinary scheduled Claude acceptance. Preserve saved data. The Mac's build-34 Claude and Antigravity checks passed. Mac restart and navigation remain open.
4. Restore Ubuntu collection only through an approved safe WSL recovery. On September 25, Ubuntu was running but even a harmless WSL command failed with `Wsl/Service/E_UNEXPECTED`. No workload was terminated. Mac and Windows records remained readable, while combined tokens were correctly withheld.
5. Verify optional Claude sharing with both installed devices, including disable, stale-peer and reconnect behavior. Combined Claude totals remain unavailable until complete request-identity overlap evidence is implemented and verified.
6. Inspect a supported Cursor export before choosing a reconciliation rule. ChatGPT token coverage remains unknown. Verify Windows process-tree containment before enabling Antigravity execution there. A subscription, app presence or selected model is not proof of a token export or API entitlement. See [source coverage](SOURCE-COVERAGE.md).
7. Continue the remaining [audit acceptance](AUDIT-STATUS.md): native visual consistency, motion and accessibility, installed failure recovery, signing, update feeds and clean-machine verification. Do not repeat already completed audit repairs or treat source tests as installed UI acceptance.

The design direction remains Mono Charts, Apple and Hart. Prefer fewer visible controls and explanations, one restrained accent and honest gaps. Accuracy, efficient scans and preserved records take priority over decorative changes.
