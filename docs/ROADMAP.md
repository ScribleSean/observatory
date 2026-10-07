# Roadmap

Observatory is Sean's personal Windows and Mac app, built in public. Native collection, the application windows and tray/menu-bar panels are the priority. The source stays public. There is no consumer launch, hosted service or standalone Linux app in this plan.

This is planned work, not a list of newly verified capabilities. [Product direction](PRODUCT-DIRECTION.md) defines the scope. The dated [audit follow-up](AUDIT-STATUS.md) and [UI verification record](UI-VERIFICATION.md) retain completed repairs and open acceptance criteria.

## Now: reliable native collection

- Verify the published WSL and Ubuntu source retirement in the exact packaged and installed candidates. The [source repairs](AUDIT-STATUS.md#published-source-october-7) are already delivered. Preserve original records and recoverable settings. Do not stop WSL workloads or turn source retirement into Ubuntu recovery work.
- Verify both apps collect independently with the main window closed. Keep failed or stale reads visible, preserve observations and make refresh/retry work without enabling extra sources.
- Check source-health counts against configured native sources. Require authenticated exchange and complete overlap evidence for combined tokens or activity. Unknown is not zero.
- Reuse verified SSH pairing. Keep allowance-history and Claude sharing behind separate consent, preserving observation times, revocation and stale-peer handling.

Acceptance requires isolated disabled, unavailable, stale and recovery regressions, then scheduled collection from the exact installed candidate on both devices. Native collection must not launch WSL or depend on its records. This document claims no new completion.

## Next: finish the native UI and lifecycle checks

- Repair demonstrated defects and finish the unresolved audit checks. Do not redo completed repairs or mistake an inspection-tool failure for an app defect.
- Check every native view in both themes at normal and enlarged text sizes. Cover readable units, source labels, Unknown states, narrow layouts, inner scrolling and offscreen rows.
- Exercise keyboard focus, screen-reader output, reduced motion, saved-history paging, refresh failure/retry, and actual tray/menu-bar actions. Synthetic screenshots alone do not close these checks.
- Verify login startup, sleep/wake, offline recovery, quit/reopen and guarded update/rollback on Sean's devices. Measure idle and collection CPU/memory before claiming the app is lightweight.

Record revision-specific evidence for each affected path. Leave unobserved cases open. Use fictional captures and keep private usage out of reports.

## Later: only integrations useful to the personal workflow

- Explore iPhone integration through supported OS permissions and data access before choosing an implementation. Do not promise Screen Time export, background collection or feature parity.
- Integrate with Hermes `/usage` commands through supported commands or adapters. Establish the interface and preserve provenance, consent and credential ownership. Do not fork Hermes core.
- Add a provider adapter only for a concrete need and a verified data source, with fixtures, bounded reads and honest coverage. A selected model or subscription is not proof of usage access.

Consumer onboarding, new code/QR pairing, hosted accounts, broad provider expansion, workflow routing and dashboard customization are deferred. The existing fictional demo remains a development fixture. Public installer promotion is not a milestone.

## Gates that remain

Personal use does not waive reproducible builds, dependency notices, private-data scans, payload hashes, runtime locks or recoverable replacement. Keep signing limitations explicit and never bypass platform security. Clean-machine and distribution claims still require the [release checklist](RELEASE-CHECKLIST.md). This roadmap does not authorize publication.

Keep source, package, installation and live acceptance evidence distinct. Do not relabel artifacts or claim an installed version without checking the exact target. Unsupported telemetry is unavailable, not fabricated.

## Historical scope

The earlier roadmap recorded matching combined token totals from the build-25 Mac, Windows and WSL development pair after authenticated exchange and cross-device overlap checks. That remains historical development-pair evidence, not verification of the native-only scope, clean-machine compatibility or offline recovery. Historical release and audit records remain intact.
