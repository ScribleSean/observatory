# Product direction

Scope revised October 4, 2026. Earlier implementation notes below are historical evidence, not a new build or installed-app verification.

Observatory is Sean's personal screen-time and AI-usage app, built in public. The source stays public. The goal is a lean native Windows application with a tray panel and a Mac application with a menu-bar panel. Reliable collection and an interface he can use every day take priority over consumer onboarding, public installer marketing or a hosted service.

## Current priorities

1. Make native Windows and Mac collection dependable without an open dashboard or a WSL dependency. Keep source failures, freshness and retry behavior visible.
2. Verify the [published source retirement](AUDIT-STATUS.md#published-source-october-7) against the exact packaged and installed candidates. Preserve original logs, historical evidence and recoverable settings. Source publication does not establish that real settings or records have been migrated.
3. Fix demonstrated native UI defects and finish the unresolved audit checks, including tray/menu-bar actions, readable charts, keyboard access, enlarged layouts and failure recovery.
4. Preserve actual recorded history and source provenance. Keep account windows, reset markers and observation times distinct. Unknown is not zero. Do not infer allowances from tokens or sum device records without verified deduplication.
5. Keep source choices and sharing consent understandable in Settings. Reuse the installed providers' supported authentication. Account-manager expansion is not a prerequisite for using existing sources.
6. Verify login startup, sleep/wake, scheduled collection and recoverable app replacement on both devices. Keep privacy, integrity and reproducibility checks even when the only intended user is Sean.

The [roadmap](ROADMAP.md) turns these priorities into acceptance work. Standalone Linux support is out of scope. Do not install, restart or repair WSL as an Observatory task, and do not stop unrelated WSL workloads to retire a source.

## Local data and existing connections

Reuse [existing verified SSH pairing](PAIRING-MAINTENANCE.md) for optional Mac/Windows exchange over a trusted network. A configured VPN can provide reachability, not authentication or sharing consent. A new code/QR setup flow, bundled networking runtime and Observatory account service are not needed for the current goal.

Provider authentication and Observatory device linking are separate flows. Connecting one provider must not silently authorize another service or a broader sync scope. Keep credentials on the owning device, use supported sign-in mechanisms and preserve per-category consent and revocation. Never sync raw transcripts, prompts, window titles or recordings. Do not collect Tailscale passwords, reusable authentication keys or silently alter network policies.

Public source does not make local data public. Keep private configuration, snapshots and build caches out of Git and demo artifacts. The existing fictional demo remains useful for UI development, not a deployment target for personal records. This direction does not authorize publishing artifacts, changing repository visibility or adding paid services.

## Deferred integrations

iPhone integration is later work, subject to supported OS permissions and data access. Establish those limits before choosing collection or sharing behavior. Do not promise Screen Time export or desktop-equivalent background collection.

Integration with Hermes `/usage` commands is also later work. Reuse supported commands or adapters after establishing the interface. Preserve source identity, consent and credential ownership without a Hermes core fork or parallel authentication system.

Dashboard customization, workflow routing, broad provider coverage and consumer onboarding remain deferred while collection and native acceptance are unfinished.

## Historical implementation notes

The following September 2026 notes retain their original revision and verification limits. References to installed builds describe those checks, not today's installed state. They do not establish native-only collection or complete the roadmap above.

### Optional network status

The source helper `scripts/tailscale-status.mjs` now reads the installed client's [machine-readable status](https://tailscale.com/docs/reference/tailscale-cli). It returns only a generic state and explicitly unverified peer reachability. It omits account identities, network addresses, peers and login URLs, writes no configuration, and has an eight-second execution bound. Missing installation, sign-in required, device approval required, stopped, starting, running, offline and unavailable states remain distinct. Five focused tests passed on both platforms, and read-only live checks reported running clients on the development pair.

Native Settings now includes an explicit **Check Tailscale** action and a link to the official setup guide in source. Checks are not automatic, and native wrappers validate the bounded response before showing fixed guidance. Both platforms compiled and passed native response tests for source `dc6eb85`. The Windows injected-callback UI test passed, including no automatic query and displaying the requested result. Its synthetic screenshot exposed a low-contrast guide link, corrected and reverified in `62f0860`. The Mac native subprocess bridge also passed against the real read-only helper in a temporary fixture. Full packaged button-to-helper and Mac rendered-interface verification remain open, and these controls are not in installed build 14. They do not establish peer reachability, sign users in automatically or enable code/QR pairing.

### Deferred local pairing integration gate

The shared TLS client and opt-in listener now support invitation-pinned device
claims in synthetic tests. Device identity generation and restricted-file
storage are also present in source. See [local pairing](LOCAL-PAIRING.md) for
the verified boundaries and remaining security work. These modules are not
enabled in the installed applications.

The collector now supports explicit TLS transport through `finalizePeerCollection`
while preserving the existing SSH path. The native application still does not
start a trusted TLS listener or establish the new setup flow. A successful
TLS claim therefore does not mean data sync is working. Before
any future native flow can replace the existing SSH setup, connect these steps:

1. Explicit identity setup with the chosen key-protection policy and recovery
   behavior. Do not regenerate an established identity after a read failure.
2. Native invitation entry/display, cancellation and peer confirmation, with
   one listener owner and no credential-bearing URLs or logs.
3. Durable trust and complementary pairing configuration acknowledged by both
   devices. A lost acknowledgement must resume the same generation safely.
4. Authenticated TLS data exchange through the existing sanitization,
   revocation, locking, deduplication and per-category consent checks.
5. A verified saved observation received on the other device, followed by
   disconnect, restart and interrupted-setup recovery tests on both platforms.

Expose distinct states for awaiting confirmation, establishing trust and
active sync. Do not label a device as actively syncing solely because it is
reachable, connected to Tailscale, or has completed a TLS claim. Keep working
SSH configurations intact during this integration.

### September native and migration observations

The desktop previews did not deliver the earlier complete consumer setup flow. Both development machines had native main windows and compact menu-bar or system-tray panels. First-run consent wizards had passed isolated tests on both platforms. The September 12 Windows update preserved existing settings and its saved snapshot, completed collection after restart, and its native window was confirmed visible by the user. A legacy WebView2 fallback remained available.

Provider account management and the complete setup-to-sync experience remain unfinished. Native collectors exchange optional allowance history through a separate consent-gated endpoint and display it separately from local readings. Both installed development apps contain these controls. Actual SSH tests with fictional records passed bidirectional retention, duplicate delivery and disable behavior. Real paired consent through both interfaces remains unverified, so pairing alone must not be described as enabling allowance sharing.

The legacy Mac collector continues recording real allowance observations and configured cross-device sources. A compatibility adapter lets the newer Mac collector retain configured agent receipts and local-model results after migration. Native Mac Settings now includes explicit receipt and benchmark switches, defaulting off. They reuse legacy source locations, not new discovery, and discard disabled in-flight results without deleting original files. The records remain owner-local and are not added to peer payloads. Synthetic collector integration passed, but actual migration, source-location editing and cross-device workflow exchange remain unfinished. Migration must preserve records, explain coverage changes and retain a recoverable configuration. Verified development packages and installed updates do not establish a clean public release.

See [tracking reuse](TRACKING-REUSE.md) for the open-source review and measurement boundaries.

See [legacy Mac migration](MAC-MIGRATION.md) for the read-only source assessment and activation gates.

The newer Mac collector also preserves an explicitly selected legacy account client instead of discovering a replacement. A legacy configuration without an account selection remains disconnected. The native monitoring switch can disable this read, including discarding an in-flight response. Fresh installations may discover the installed Codex client only after monitoring is enabled. These compatibility paths do not themselves perform configuration migration.
