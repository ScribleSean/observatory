# Product direction

Updated September 13, 2026.

Observatory is one installable application for viewing supported usage across devices. The primary outcome is a working setup-to-history flow, not separate scripts or a polished but disconnected dashboard.

## First release priorities

1. Download the appropriate macOS or Windows build from the repository and install it without developer tooling.
2. Complete a first-run wizard covering collection permissions, available provider accounts, device connection and exactly which sanitized data will be shared. Unsupported integrations must not appear connected.
3. Manage connections in one settings area: inspect status, add accounts, reconnect, switch and remove accounts, select sampling cadence and control startup and sync.
4. Collect screen time and token records independently of the visible window. Retain actual provider-reported allowance observations for graphs, starting with a 15-minute baseline and allowing faster supported sampling.
5. Show a consistent history across paired devices, with deduplication, account/window identity, reset markers, freshness and honest gaps. Do not sum account-wide limits or infer percentages from token counts.
6. Provide a clean native main window, a compact Mac menu-bar or Windows system-tray overview, Start menu discovery on Windows and user-controlled login startup.

First-release sync uses direct encrypted device pairing, as selected on September 12, 2026. No Observatory account or hosted sync service is required. The setup wizard must explain device identity, connection requirements, the sanitized records being shared, connection status and how to revoke pairing. Existing SSH-based pairing remains the implementation starting point, not proof of a finished consumer setup flow.

The first-release network scope is the same local network or an existing trusted VPN. Offer optional Tailscale setup for devices on different networks, without making a Tailscale account mandatory for local pairing. The intended wizard has a local-network path and a Tailscale-assisted path. Neither path is implemented as a consumer-ready code/QR flow yet.

Initially prefer integration with the installed Tailscale client to avoid bundling another networking runtime. Guide users through its supported sign-in flow, then verify actual device reachability and permissions. Observatory must not collect Tailscale passwords, ask users to paste reusable authentication keys, enable public exposure, or silently alter network policies. Tailscale membership does not replace explicit Observatory device confirmation and data-sharing consent. Evaluate embedded networking separately against installer size, lifecycle and credential-storage requirements.

The source helper `scripts/tailscale-status.mjs` now reads the installed client's [machine-readable status](https://tailscale.com/docs/reference/tailscale-cli). It returns only a generic state and explicitly unverified peer reachability. It omits account identities, network addresses, peers and login URLs, writes no configuration, and has an eight-second execution bound. Missing installation, sign-in required, device approval required, stopped, starting, running, offline and unavailable states remain distinct. Five focused tests passed on both platforms, and read-only live checks reported running clients on the development pair.

Native Settings now includes an explicit **Check Tailscale** action and a link to the official setup guide in source. Checks are not automatic, and native wrappers validate the bounded response before showing fixed guidance. Both platforms compiled and passed native response tests for source `dc6eb85`. The Windows injected-callback UI test passed, including no automatic query and displaying the requested result. Its synthetic screenshot exposed a low-contrast guide link, corrected and reverified in `62f0860`. The Mac native subprocess bridge also passed against the real read-only helper in a temporary fixture. Full packaged button-to-helper and Mac rendered-interface verification remain open, and these controls are not in installed build 14. They do not establish peer reachability, sign users in automatically or enable code/QR pairing.

Provider authentication and Observatory device linking are separate flows. Connecting one provider must not silently authorize another service or a broader sync scope. Keep credentials on the owning device and use supported authentication mechanisms. Never sync raw transcripts or window titles. Do not introduce a hosted account service or paid services as part of this release.

### Local pairing integration gate

The shared TLS client and opt-in listener now support invitation-pinned device
claims in synthetic tests. Device identity generation and restricted-file
storage are also present in source. See [local pairing](LOCAL-PAIRING.md) for
the verified boundaries and remaining security work. These modules are not
enabled in the installed applications.

The collector now supports explicit TLS transport through `finalizePeerCollection`
while preserving the existing SSH path. The native application still does not
start a trusted TLS listener or establish the new setup flow. A successful
TLS claim therefore does not mean data sync is working. Before
the native wizard can replace the existing SSH setup, connect these steps:

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

## Deferred

Customizable widgets, rearranging the dashboard and choosing every glanceable metric are future work. Do not implement them until setup, collection, account management and synchronization work end to end. iOS is a later platform, subject to its supported permissions and collection capabilities.

## Current gaps

The desktop previews do not yet deliver this complete flow. Both development machines now have native main windows and compact menu-bar or system-tray panels. First-run consent wizards have passed isolated tests on both platforms. The September 12 Windows update preserved existing settings and its saved snapshot, completed collection after restart, and its native window was confirmed visible by the user. A legacy WebView2 fallback remains available.

Provider account management and the complete setup-to-sync experience remain unfinished. Native collectors exchange optional allowance history through a separate consent-gated endpoint and display it separately from local readings. Both installed development apps contain these controls. Actual SSH tests with fictional records passed bidirectional retention, duplicate delivery and disable behavior. Real paired consent through both interfaces remains unverified, so pairing alone must not be described as enabling allowance sharing.

The legacy Mac collector continues recording real allowance observations and configured cross-device sources. A compatibility adapter lets the newer Mac collector retain configured agent receipts and local-model results after migration. Native Mac Settings now includes explicit receipt and benchmark switches, defaulting off. They reuse legacy source locations, not new discovery, and discard disabled in-flight results without deleting original files. The records remain owner-local and are not added to peer payloads. Synthetic collector integration passed, but actual migration, source-location editing and cross-device workflow exchange remain unfinished. Migration must preserve records, explain coverage changes and retain a recoverable configuration. Verified development packages and installed updates do not establish a clean public release.

See [tracking reuse](TRACKING-REUSE.md) for the open-source review and measurement boundaries.

See [legacy Mac migration](MAC-MIGRATION.md) for the read-only source assessment and activation gates.

The newer Mac collector also preserves an explicitly selected legacy account client instead of discovering a replacement. A legacy configuration without an account selection remains disconnected. The native monitoring switch can disable this read, including discarding an in-flight response. Fresh installations may discover the installed Codex client only after monitoring is enabled. These compatibility paths do not themselves perform configuration migration.
