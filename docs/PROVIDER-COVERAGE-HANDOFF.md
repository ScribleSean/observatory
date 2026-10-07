# Provider coverage handoff

Current priorities follow the [personal-native scope](PRODUCT-DIRECTION.md) and [roadmap](ROADMAP.md): reliable Mac/Windows collection and unresolved native UI checks. WSL and Ubuntu tracking are out of scope. Broad provider expansion and consumer release work are not the immediate task.

## Historical provider record

The implementation and verification sections below retain the September 26, 2026 UTC handoff. They are not a new check of source, packages or installed apps.

[PR #2](https://github.com/ScribleSean/observatory/pull/2) added local Claude coverage. [PR #3](https://github.com/ScribleSean/observatory/pull/3) fixed unreadable-directory undercounts and merged at `eb01aa0`. [PR #4](https://github.com/ScribleSean/observatory/pull/4) integrated provider sharing, optional Antigravity allowances and corrected provider health accounting at `143bf69be01a94b3bd8dc11d32bf122ddf5654d8`. At that check, both development apps ran build 35, Mac from `ced669854940f5892570a6a7a8feb1689b903b80` and Windows from `7c7ae25541b8b6cc3c2529b6de5fc67de0f656a8`. Windows installation and readiness were accepted. Local scheduled Claude acceptance passed at 22:50 UTC. Claude sharing remained off on both devices.

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
- The release ledger distinguishes verified packages, installed applications and provider acceptance. Build 35 adds the client-error placeholder and sanitized-model reconciliation fixes, with legacy public order preserved. Both devices have installed it. Windows local scheduled Claude acceptance passed at 22:50 UTC.

## Verification and delivery boundaries

Reviewed source and synthetic checks cover protocol compatibility, consent races, replay freshness, revocation, provider isolation and stale or unavailable display states. These checks support the implemented capabilities, not complete installed acceptance.

The Mac runs build 35 from `ced6698`. Installed inventory, signatures, saved-state preservation and normal launch passed. Scheduled Claude and Antigravity checks passed, with private arithmetic and Codex separation verified. The 14:41 UTC check confirmed local provider readings, and the 14:44 UTC publication read all 15 configured sources. This does not establish coverage of every provider or combined totals. Missing readings remain Unknown. The [latest installed UI observation](UI-VERIFICATION.md#mac-build-35-installed-observation-september-26) covers selected navigation and Tokens controls, with broader checks unobserved.

Windows runs build 35 from `7c7ae25`, with installation and readiness accepted at 14:53:56 UTC and the exact live process independently verified at 14:55 UTC. Payload, saved-state and startup preservation passed, with protected recovery retained. Local scheduled Claude acceptance passed at 22:50 UTC, with local source health 8 of 8. The restarted process's effective directory override was not inspected. Claude sharing remains off on both devices, installed synchronization is unverified and combined Claude totals remain unavailable.

The [build 35 release evidence](RELEASE-0.3.13.md#build-35-preparation-september-26-utc) retains package pins, the earlier activation-helper failure and the bounded console-observer limitation. The two installed sources have identical production application code. The earlier direct candidate read does not establish Windows scheduled acceptance.

The later [Windows allowance helper and collector integration](RELEASE-0.3.13.md#later-windows-allowance-helper-source) remain outside the build-35 packages. All five native Windows integration cases passed with fictional processes. The production gate is closed, and live Windows Antigravity coverage remains unverified.

The [build 34 release evidence](RELEASE-0.3.13.md#build-34-integration-september-26-utc) is the canonical dated record for source checks, package and installation pins, scheduled verification, PR merges and the Windows fixture failure and corrected run. Earlier build 32 and 33 evidence remains scoped to those revisions. Source, package, installed and live verification remain separate.

## Current continuation rules

1. Keep personal snapshots and credentials out of Git and demo artifacts. Integrate only reviewed source. This handoff does not authorize publication.
2. Retain protected recovery and older recovery evidence. Preserve the recorded Mac source `ced6698` and Windows source `7c7ae25` as separate historical pins. Read back the actual installed targets before maintenance. Do not relabel artifacts or modify installed bundles in place.
3. Preserve the separate installation and scheduled local-Claude evidence. Complete the remaining bounded UI checks without treating observed controls as full visual or accessibility acceptance.
4. Retire WSL and Ubuntu tracking without stopping unrelated workloads or deleting original records. Do not attempt Ubuntu recovery to restore historical coverage. Verify the native-only collection and comparison scope separately.
5. If Claude sharing is needed, verify consent on both devices plus disable, stale-peer and reconnect behavior. Combined Claude totals remain unavailable until complete request-identity overlap evidence is implemented and verified.
6. Defer new provider work unless it serves a concrete personal need. A Cursor importer still needs an inspected supported export and reconciliation rule. ChatGPT token coverage remains unknown. Windows Antigravity execution still needs collector integration and installed verification before enabling it. A subscription, app presence or selected model is not proof of usage access. See [source coverage](SOURCE-COVERAGE.md).
7. Continue the unresolved native visual, motion, accessibility and installed failure/recovery [audit acceptance](AUDIT-STATUS.md). Do not repeat completed repairs or treat source tests as installed UI acceptance. Preserve signing, update-integrity and clean-machine gates without making consumer distribution the priority.

Historical WSL incident: on September 25, Ubuntu was running but even a harmless WSL command failed with `Wsl/Service/E_UNEXPECTED`. No workload was terminated. Mac and Windows records remained readable, while combined tokens were correctly withheld. This record is retained as evidence, not a recovery task.

The design direction remains Mono Charts, Apple and Hart. Prefer fewer visible controls and explanations, one restrained accent and honest gaps. Accuracy, efficient scans and preserved records take priority over decorative changes.
