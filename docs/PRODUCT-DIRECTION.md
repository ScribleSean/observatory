# Product direction

Updated September 12, 2026.

Workspace Observatory is one installable application for viewing supported usage across devices. The primary outcome is a working setup-to-history flow, not separate scripts or a polished but disconnected dashboard.

## First release priorities

1. Download the appropriate macOS or Windows build from the repository and install it without developer tooling.
2. Complete a first-run wizard covering collection permissions, available provider accounts, device connection and exactly which sanitized data will be shared. Unsupported integrations must not appear connected.
3. Manage connections in one settings area: inspect status, add accounts, reconnect, switch and remove accounts, select sampling cadence and control startup and sync.
4. Collect screen time and token records independently of the visible window. Retain actual provider-reported allowance observations for graphs, starting with a 15-minute baseline and allowing faster supported sampling.
5. Show a consistent history across paired devices, with deduplication, account/window identity, reset markers, freshness and honest gaps. Do not sum account-wide limits or infer percentages from token counts.
6. Provide a clean native main window, a compact Mac menu-bar or Windows system-tray overview, Start menu discovery on Windows and user-controlled login startup.

First-release sync uses direct encrypted device pairing, as selected on September 12, 2026. No Observatory account or hosted sync service is required. The setup wizard must explain device identity, connection requirements, the sanitized records being shared, connection status and how to revoke pairing. Existing SSH-based pairing remains the implementation starting point, not proof of a finished consumer setup flow.

Provider authentication and Observatory device linking are separate flows. Connecting one provider must not silently authorize another service or a broader sync scope. Keep credentials on the owning device and use supported authentication mechanisms. Never sync raw transcripts or window titles. Do not introduce a hosted account service or paid services as part of this release.

## Deferred

Customizable widgets, rearranging the dashboard and choosing every glanceable metric are future work. Do not implement them until setup, collection, account management and synchronization work end to end. iOS is a later platform, subject to its supported permissions and collection capabilities.

## Current gaps

The desktop previews do not yet deliver this complete flow. Both development machines now have native main windows and compact menu-bar or system-tray panels. First-run consent wizards have passed isolated tests on both platforms. The September 12 Windows update preserved existing settings and its saved snapshot, completed collection after restart, and its native window was confirmed visible by the user. A legacy WebView2 fallback remains available.

Provider account management and the complete setup-to-sync experience remain unfinished. Native collectors exchange optional allowance history through a separate consent-gated endpoint and display it separately from local readings. Both installed development apps contain these controls. Actual SSH tests with fictional records passed bidirectional retention, duplicate delivery and disable behavior. Real paired consent through both interfaces remains unverified, so pairing alone must not be described as enabling allowance sharing.

The legacy Mac collector continues recording real allowance observations and configured cross-device sources. A new compatibility adapter lets the newer Mac collector retain explicitly configured agent receipts and local-model results after migration. It remains owner-local and does not add these records to peer payloads. Synthetic collector integration passed, but actual migration, source-management controls and cross-device workflow exchange remain unfinished. Migration must preserve records, explain coverage changes and retain a recoverable configuration. Verified development packages and installed updates do not establish a clean public release.

See [tracking reuse](TRACKING-REUSE.md) for the open-source review and measurement boundaries.
