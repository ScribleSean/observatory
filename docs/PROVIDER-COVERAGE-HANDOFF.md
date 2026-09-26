# Provider coverage handoff

Updated September 26, 2026 UTC. [PR #2](https://github.com/ScribleSean/observatory/pull/2) added local Claude coverage. [PR #3](https://github.com/ScribleSean/observatory/pull/3) fixed unreadable-directory undercounts and is merged at `eb01aa0`. Build 34 integrates provider sharing, optional Antigravity allowances and corrected provider health accounting. Both installed development apps remain build 31. This handoff contains source and verification context only.

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
- The release and audit ledgers record the verified Windows build 31 installation. Both development devices now match on build 31.

## Verification and delivery boundaries

The integrated build 34 source passed 631 JavaScript tests with 15 platform skips, TypeScript and the production web build. Independent reviews covered optional protocol compatibility, consent races, replay freshness, revocation and provider isolation. Mac compilation, native self-tests and the isolated provider bridge passed. Windows cross-compilation passed, while Windows runtime fixtures and final hosted package checks remain pending. Fictional browser checks covered fresh, stale and unavailable Antigravity readings, original observation times and Source health navigation.

These provider changes are source changes. Installed build 31 does not contain them. The standalone Claude reader and Antigravity usage command were checked against local metadata, but that does not establish installed collection or cross-device synchronization. Source, package, installed and live verification remain separate. Build 32 was withdrawn before replacement after the undercount defect was found. Build 33 corrects that defect but predates the integrated provider-health correction and sharing controls.

## Exact next actions

1. Keep personal snapshots and credentials out of Git and public demo artifacts. Integrate only reviewed source and publish checkpoints for continuation.
2. The shared desktop build number is now 34. Package both platforms from the same verified revision, then perform the existing recoverable installation procedure. Earlier package results remain evidence for their exact source only. Do not modify an installed app bundle in place or enable an unknown configuration key in the build 31 strict Mac validator.
3. Enable Claude collection on the development devices after installing compatible builds. Verify scheduled collection, Source health counts and a restart while preserving saved data. Check custom `CLAUDE_CONFIG_DIR` inheritance instead of assuming a desktop app sees shell settings.
4. Restore Ubuntu collection only through an approved safe WSL recovery. On September 25, Ubuntu was running but even a harmless WSL command failed with `Wsl/Service/E_UNEXPECTED`. No workload was terminated. Mac and Windows records remained readable, while combined tokens were correctly withheld.
5. Verify optional Claude sharing with both installed devices, including disable, stale-peer and reconnect behavior. Combined Claude totals remain unavailable until complete request-identity overlap evidence is implemented and verified.
6. Inspect a supported Cursor export before choosing a reconciliation rule. ChatGPT token coverage remains unknown. Verify Windows process-tree containment before enabling Antigravity execution there. A subscription, app presence or selected model is not proof of a token export or API entitlement. See [source coverage](SOURCE-COVERAGE.md).
7. Continue the remaining [audit acceptance](AUDIT-STATUS.md): native visual consistency, motion and accessibility, installed failure recovery, signing, update feeds and clean-machine verification. Do not repeat already completed audit repairs or treat source tests as installed UI acceptance.

The design direction remains Mono Charts, Apple and Hart. Prefer fewer visible controls and explanations, one restrained accent and honest gaps. Accuracy, efficient scans and preserved records take priority over decorative changes.
