# Observatory 0.3.13 candidate

Status: preparation only. Build 24 is not published or installed.

## Changes

- Shared native navigation and styling, clearer saved allowance history entry,
  and improved narrow-window layouts.
- Saved allowance-used charts with Day, Week and All retained periods. Dashed
  connectors disclose missing observations; reset boundaries remain separate.
- Compact counts advance through K, M, B and T. Long durations display days
  with remaining hours and minutes. Unknown data remains unknown.
- Opening the Mac menu-bar popup does not activate the dashboard. Tests cover
  opening without a dashboard and keeping an existing hidden dashboard hidden.

## Evidence before packaging

The preceding source checkpoint passed 535 JavaScript tests on Mac, with seven
skips. The complete Windows development build passed native self-tests and 503
JavaScript tests, with 39 platform-specific skips. No test failures were reported.
Mac synthetic popup checks verify accessible filter defaults and explicit
dashboard/Settings handoff. These checks do not establish every accessibility,
integration or clean-install requirement.

Earlier 0.3.12 candidate ZIP/DMG verification does not validate these artifacts.
Record build-24 artifact hashes and package results after verification. Do not
publish older build-23 artifacts under this version.

## Gates remaining

- Fresh Mac and Windows candidate builds, payload manifests and runtime checks.
- ZIP/DMG extraction and mounted-image checks; Windows installer staging checks.
- Upgrade verification against installed Mac build 22 and Windows build 23,
  preserving private data and a recoverable previous application.
- Installed interface and collection checks, signing/distribution limitations,
  clean-machine and lifecycle coverage described in the release checklist.

No raw messages, transcripts, credentials or private snapshots belong in an
artifact or its verification report. Synthetic fixtures are used for UI checks.
