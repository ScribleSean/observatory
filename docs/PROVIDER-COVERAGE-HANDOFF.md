# Provider coverage handoff

Updated September 26, 2026 UTC. [PR #2](https://github.com/ScribleSean/observatory/pull/2) added local Claude coverage. [PR #3](https://github.com/ScribleSean/observatory/pull/3) fixed unreadable-directory undercounts and merged at `eb01aa0`. [PR #4](https://github.com/ScribleSean/observatory/pull/4) integrated provider sharing, optional Antigravity allowances and corrected provider health accounting at `143bf69be01a94b3bd8dc11d32bf122ddf5654d8`. The development Mac now runs build 34 from `d1505872c503eec47c784602415998154c757fc2`. Windows remains build 31 while a corrected build-34 package run targets `80a7aa8397a208fad51599f990b094af3d29458f`. These revisions have the same production application code, with later test and CI changes on the Windows candidate.

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
- The release ledger distinguishes installed Mac build 34, installed Windows build 31 and the pending corrected Windows build-34 candidate.

## Verification and delivery boundaries

The release coordinator's integrated build-34 checks passed 631 JavaScript tests with 15 platform skips, TypeScript and the production web build. All four PR #4 native and update checks passed, followed by six passing independent integration cases. Reviews covered optional protocol compatibility, consent races, replay freshness, revocation and provider isolation. Mac compilation, native self-tests, the isolated provider bridge and Windows cross-compilation passed. Fictional browser checks covered fresh, stale and unavailable Antigravity readings, original observation times and Source health navigation.

The [Mac hosted package](https://github.com/ScribleSean/observatory/actions/runs/36212101287) passed at `d150587`. The release coordinator independently verified its full manifest, clean-source and build-34 metadata, deep strict signatures and native self-tests. After the Mac owner verified staging and performed the guarded installation, the coordinator reverified every installed file and matched the installation receipt hash. The Mac owner reported preserving all 17,756 saved files and retaining build 31 for recovery.

The Mac owner verified the first scheduled Claude reading at 03:01:21–03:01:39 UTC, including reconciled arithmetic, one local Claude source counted and an unchanged Codex projection. That collection read 10 of 14 sources, with Ubuntu and the legacy Documents receipt source unavailable, without established upgrade causality.

After enabling Antigravity under the collector lock, the Mac owner verified its scheduled 03:06:18–03:06:33 UTC run, a zero-turn, zero-model envelope, schema, ranges and reset timestamps. The coordinator independently matched the verification receipt hash. Provider allowances remained separate from token and Codex quota arrays, and Claude remained readable. Current source health is 12 of 15, including one successful Antigravity source. The legacy receipt source recovered through normal collection. Three Ubuntu gaps remain, with no WSL action taken. Restart and navigation remain unverified after a UI automation stream failure.

The Windows owner reported passing fresh web, TypeScript, native build, self-tests and reader regressions. The [original hosted run](https://github.com/ScribleSean/observatory/actions/runs/36212105943) failed one new synthetic integration fixture, with 564 passes and 53 skips. It produced no package candidate or installer lifecycle result. The original fixture also passes locally on Windows. The test-only [PR #6](https://github.com/ScribleSean/observatory/pull/6) correction passed targeted Mac and Windows checks and merged separately at `9b21fa8a55056b2c24169a9ccdf975faa63e75e3`. The original hosted interpreter state remains unverified. A production reader defect has not been established.

The [corrected Windows package run](https://github.com/ScribleSean/observatory/actions/runs/36213635154) is in progress at `80a7aa8397a208fad51599f990b094af3d29458f`, including artifact retention from merged [PR #5](https://github.com/ScribleSean/observatory/pull/5), `978a0a0`. All four PR #5 checks passed, while retained uploads remain unverified. Keep the installed Mac's `d150587` identity separate from this candidate. Exact hashes and verification boundaries are in the [build 34 release evidence](RELEASE-0.3.13.md#build-34-integration-september-26-utc).

Installed Windows build 31 does not contain these provider changes. The Mac scheduled Claude result establishes local collection, not installed peer synchronization. Source, package, installed and live verification remain separate. Build 32 was withdrawn before replacement after the undercount defect was found. Build 33 corrects that defect but predates the integrated provider-health correction and sharing controls.

## Exact next actions

1. Keep personal snapshots and credentials out of Git and public demo artifacts. Integrate only reviewed source and publish checkpoints for continuation.
2. Finish the corrected Windows package run at `80a7aa`, verify retained artifacts, then use the existing recoverable installation procedure. No additional local Windows rebuild is planned if those hosted artifacts pass. Preserve installed Mac source `d150587`, the PR #4 merge identity and the Windows candidate identity separately. Their production application code and build number match, but test and CI revisions differ. Do not relabel artifacts or modify installed bundles in place.
3. Complete Mac restart and navigation verification. After Windows installation, enable Claude collection and verify scheduled collection, Source health counts and restart while preserving saved data. The Mac's scheduled Claude and Antigravity checks have passed. Check custom `CLAUDE_CONFIG_DIR` inheritance instead of assuming a desktop app sees shell settings.
4. Restore Ubuntu collection only through an approved safe WSL recovery. On September 25, Ubuntu was running but even a harmless WSL command failed with `Wsl/Service/E_UNEXPECTED`. No workload was terminated. Mac and Windows records remained readable, while combined tokens were correctly withheld.
5. Verify optional Claude sharing with both installed devices, including disable, stale-peer and reconnect behavior. Combined Claude totals remain unavailable until complete request-identity overlap evidence is implemented and verified.
6. Inspect a supported Cursor export before choosing a reconciliation rule. ChatGPT token coverage remains unknown. Verify Windows process-tree containment before enabling Antigravity execution there. A subscription, app presence or selected model is not proof of a token export or API entitlement. See [source coverage](SOURCE-COVERAGE.md).
7. Continue the remaining [audit acceptance](AUDIT-STATUS.md): native visual consistency, motion and accessibility, installed failure recovery, signing, update feeds and clean-machine verification. Do not repeat already completed audit repairs or treat source tests as installed UI acceptance.

The design direction remains Mono Charts, Apple and Hart. Prefer fewer visible controls and explanations, one restrained accent and honest gaps. Accuracy, efficient scans and preserved records take priority over decorative changes.
