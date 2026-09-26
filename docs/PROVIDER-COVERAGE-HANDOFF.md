# Provider coverage handoff

Updated September 26, 2026 UTC. [PR #2](https://github.com/ScribleSean/observatory/pull/2) added local Claude coverage. [PR #3](https://github.com/ScribleSean/observatory/pull/3) fixed unreadable-directory undercounts and merged at `eb01aa0`. [PR #4](https://github.com/ScribleSean/observatory/pull/4) integrated provider sharing, optional Antigravity allowances and corrected provider health accounting at `143bf69be01a94b3bd8dc11d32bf122ddf5654d8`. Both development apps now run build 35, Mac from `ced669854940f5892570a6a7a8feb1689b903b80` and Windows from `7c7ae25541b8b6cc3c2529b6de5fc67de0f656a8`. Windows installation and readiness are accepted, with local scheduled Claude acceptance still pending. Claude sharing remains off on both devices.

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
- The release ledger distinguishes verified packages, installed applications and provider acceptance. Build 35 adds the client-error placeholder and sanitized-model reconciliation fixes, with legacy public order preserved. Both devices have installed it, with Windows local scheduled Claude acceptance still pending.

## Verification and delivery boundaries

Reviewed source and synthetic checks cover protocol compatibility, consent races, replay freshness, revocation, provider isolation and stale or unavailable display states. These checks support the implemented capabilities, not complete installed acceptance.

The Mac runs build 35 from `ced6698`. Installed inventory, signatures, saved-state preservation and normal launch passed. Scheduled Claude and Antigravity checks passed, with private arithmetic and Codex separation verified. The 14:41 UTC check confirmed local provider readings, and the 14:44 UTC publication read all 15 configured sources. This does not establish coverage of every provider or combined totals. Missing readings remain Unknown. The [latest installed UI observation](UI-VERIFICATION.md#mac-build-35-installed-observation-september-26) covers selected navigation and Tokens controls, with broader checks unobserved.

Windows runs build 35 from `7c7ae25`, with installation and readiness accepted at 14:53:56 UTC and the exact live process independently verified at 14:55 UTC. Payload, saved-state and startup preservation passed, with protected recovery retained. Local scheduled Claude acceptance remains pending. Claude sharing remains off on both devices, installed synchronization is unverified and combined Claude totals remain unavailable.

The [build 35 release evidence](RELEASE-0.3.13.md#build-35-preparation-september-26-utc) retains package pins, the earlier activation-helper failure and the bounded console-observer limitation. The two installed sources have identical production application code. The earlier direct candidate read does not establish Windows scheduled acceptance.

The later [Windows allowance helper and collector integration](RELEASE-0.3.13.md#later-windows-allowance-helper-source) remain outside the build-35 packages. All five native Windows integration cases passed with fictional processes. The production gate is closed, and live Windows Antigravity coverage remains unverified.

The [build 34 release evidence](RELEASE-0.3.13.md#build-34-integration-september-26-utc) is the canonical dated record for source checks, package and installation pins, scheduled verification, PR merges and the Windows fixture failure and corrected run. Earlier build 32 and 33 evidence remains scoped to those revisions. Source, package, installed and live verification remain separate.

## Exact next actions

1. Keep personal snapshots and credentials out of Git and public demo artifacts. Integrate only reviewed source and publish checkpoints for continuation.
2. Retain current protected recovery and older recovery evidence. Preserve installed Mac source `ced6698` and Windows source `7c7ae25` separately. Do not relabel artifacts or modify installed bundles in place.
3. Verify Windows local Claude through ordinary scheduled collection. Installation and readiness do not establish provider coverage. Complete the remaining bounded UI checks without treating observed controls as full visual or accessibility acceptance.
4. Preserve existing WSL workloads. Any needed Ubuntu recovery requires an approved safe procedure. On September 25, Ubuntu was running but even a harmless WSL command failed with `Wsl/Service/E_UNEXPECTED`. No workload was terminated. Mac and Windows records remained readable, while combined tokens were correctly withheld.
5. After Windows local scheduled Claude acceptance passes, verify optional Claude sharing with both devices, including disable, stale-peer and reconnect behavior. Combined Claude totals remain unavailable until complete request-identity overlap evidence is implemented and verified.
6. Inspect a supported Cursor export before choosing a reconciliation rule. ChatGPT token coverage remains unknown. Complete Windows collector integration and installed verification before enabling Antigravity execution there. A subscription, app presence or selected model is not proof of a token export or API entitlement. See [source coverage](SOURCE-COVERAGE.md).
7. Continue the remaining [audit acceptance](AUDIT-STATUS.md): native visual consistency, motion and accessibility, installed failure recovery, signing, update feeds and clean-machine verification. Do not repeat already completed audit repairs or treat source tests as installed UI acceptance.

The design direction remains Mono Charts, Apple and Hart. Prefer fewer visible controls and explanations, one restrained accent and honest gaps. Accuracy, efficient scans and preserved records take priority over decorative changes.
