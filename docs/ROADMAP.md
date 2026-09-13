# Roadmap

Observatory is building toward one trustworthy view of screen time and AI usage across devices. The first audience is developers who work with AI. The product is local-first, with optional private device pairing and no required hosted account.

These are planned milestones, not shipped capabilities or promised dates. See the [README](../README.md) for current platform status.

## 1. Reproducible desktop preview

- Preserve the native Mac experience and add a Windows tray app with the same dashboard purpose.
- Package required runtimes and provide clear first-run source setup.
- On Windows, optionally start a selected installed Ubuntu distribution and its collector without an open terminal. Windows collection must still work without WSL.
- Verify install, startup, sleep/wake, updates, rollback and uninstall on clean environments.
- Publish versioned installers, checksums, changelogs and clear signing status.

## 2. Independent collection and private sync

- First-release direction agreed September 9: both the Mac and Windows apps show combined data from the two devices. This remains an implementation target, not a shipped capability.
- Record on each device while offline, without another computer acting as coordinator.
- Pair trusted devices over optional Tailscale transport.
- Exchange sanitized records with authentication, stable identities and deduplication.
- Make retention, deletion, revocation and stale sources understandable.

## 3. Broader integration coverage

- Reuse maintained open-source adapters where their licenses and privacy boundaries fit.
- Add tested provider usage, coding-agent and local-model integrations through a small adapter contract.
- Keep reported tokens, quotas, billed cost, estimates and workflow events separate.
- Expand native Linux support and publish a tested platform and integration matrix.

## 4. Optional workflow instrumentation

Explore opt-in workflow event ingestion and request routing only after observation is dependable. A router measures traffic explicitly sent through it. It cannot reveal arbitrary subscription activity or replace operating-system screen-time collection.

## Release standards

Private data never enters demo builds or release artifacts. Unsupported telemetry is unavailable, not fabricated. Performance claims require measured idle and collection behavior. Every supported integration needs fixtures, coverage limits and failure handling. Security warnings and signing limitations must be disclosed, not bypassed.
