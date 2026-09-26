# Provider coverage handoff

Updated September 26, 2026 UTC. [PR #2](https://github.com/ScribleSean/observatory/pull/2) is merged on main at `2292d0d`. Build 32 preparation continues from that source. This handoff contains source and verification context only.

## Outcome and ownership

Observatory remains a usage dashboard. HAPI, Happy and other agent clients own their sessions. Their relay records are not additional usage when the same native Codex or Claude Code request is already recorded.

The token dashboard previously covered Codex only. The change adds optional local Claude Code counters and explicit coverage for Codex, Claude Code, ChatGPT, Cursor and Antigravity. Missing sources remain Unknown. Providers and devices are not summed without verified overlap handling.

## Implemented source

- `scripts/read-claude-usage.py` reads retained assistant usage metadata, reconciles repeated streaming snapshots and copied logs, and withholds incomplete reports.
- `scripts/provider-token-sources.mjs` validates the public numeric projection. Native collectors attach it after peer merging, outside the existing Codex payload.
- Native Settings adds `claude`, disabled by default. It reads only the local device. It does not sign in, invoke a model, collect transcripts or infer a WSL Claude installation.
- Native and web Source health show provider coverage. The existing Tokens view explicitly describes Codex. Shared typography and colors are retained.
- The release and audit ledgers record the verified Windows build 31 installation. Both development devices now match on build 31.

## Verification and delivery boundaries

The integrated regression run passed 573 tests with 15 platform skips and no failures. TypeScript, the production web build, Mac compilation and Mac native self-tests passed. A browser check with fictional records found no rendering errors or horizontal overflow at desktop and 390-pixel widths. The PR checks provide the final Windows compile and native fixture evidence.

These provider changes are source changes. Installed build 31 does not contain them. The standalone Claude reader was checked against local numeric metadata, but that does not establish installed collection or cross-device synchronization. Source, package, installed and live verification remain separate.

## Exact next actions

1. The provider PR checks passed and the PR is merged. Keep personal snapshots and credentials out of Git and public demo artifacts.
2. The shared desktop build number is now 32. Package both platforms from the same verified revision, then perform the existing recoverable installation procedure. Do not modify a build 31 app bundle in place or enable an unknown configuration key in its strict Mac validator.
3. Enable Claude collection on the development devices after installing compatible builds. Verify scheduled collection, Source health counts and a restart while preserving saved data. Check custom `CLAUDE_CONFIG_DIR` inheritance instead of assuming a desktop app sees shell settings.
4. Restore Ubuntu collection only through an approved safe WSL recovery. On September 25, Ubuntu was running but even a harmless WSL command failed with `Wsl/Service/E_UNEXPECTED`. No workload was terminated. Mac and Windows records remained readable, while combined tokens were correctly withheld.
5. Design Claude peer synchronization with explicit protocol compatibility and request-identity overlap checks. The current peer payload deliberately does not export these records.
6. Add ChatGPT, Cursor and Antigravity adapters only from inspected supported usage records. A subscription, app presence or selected model is not proof of a token export or API entitlement. See [source coverage](SOURCE-COVERAGE.md).
7. Continue the remaining [audit acceptance](AUDIT-STATUS.md): native visual consistency, motion and accessibility, installed failure recovery, signing, update feeds and clean-machine verification. Do not repeat already completed audit repairs or treat source tests as installed UI acceptance.

The design direction remains Mono Charts, Apple and Hart. Prefer fewer visible controls and explanations, one restrained accent and honest gaps. Accuracy, efficient scans and preserved records take priority over decorative changes.
