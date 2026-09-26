import SwiftUI

struct UsageSharingConsent {
    var status: QuotaSharingStatus?

    func change(confirmed: Bool) -> (action: String, token: String?)? {
        guard let status else { return nil }
        if status.enabled { return ("disable", nil) }
        guard confirmed, status.canEnable, let token = status.token else { return nil }
        return ("enable", token)
    }
}

struct UsageSharingControls: View {
    @ObservedObject var store: ObservatoryStore
    let preview: Bool
    let channel: SharingChannel
    @State private var consent = UsageSharingConsent()
    @State private var message = "Sharing has not been checked."
    @State private var working = false
    @State private var confirming = false

    private var status: QuotaSharingStatus? { consent.status }
    private var quota: Bool { channel == .quota }
    private var title: String { quota ? "Codex allowances" : "Claude Code usage" }
    private var unavailable: Bool {
        preview || working || store.shuttingDown || store.refreshing || store.pairingMaintenance || store.collectionPausedForPairing
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).observatoryFont(.headline)
            Text(quota ? "Shares allowance history and dated account token totals. Accounts on different devices are kept separate." :
                "Shares recorded token usage by device. Prompts and request identifiers stay private. Device totals are not added together.")
                .observatoryFont(.callout).foregroundStyle(.secondary)
            Text(message).observatoryFont(.callout).accessibilityLabel("\(title): \(message)")
            ObservatoryAdaptiveRow {
                Button("Check status") { change("status") }
                    .accessibilityLabel("Check \(title) sharing")
                Button(status?.enabled == true ? "Stop sharing" : "Share with paired device") {
                    if let request = consent.change(confirmed: false) { change(request.action, token: request.token) } else { confirming = true }
                }
                .accessibilityLabel("\(status?.enabled == true ? "Stop sharing" : "Share") \(title)")
                .disabled(!(status?.enabled == true || status?.canEnable == true))
            }.disabled(unavailable)
        }
        .alert("Share \(title)?", isPresented: $confirming) {
            Button("Cancel", role: .cancel) {}
            Button("Enable sharing") {
                if let request = consent.change(confirmed: true) { change(request.action, token: request.token) }
            }
        } message: {
            Text("Share these usage records with the paired device? Enable sharing there separately. Credentials stay on their owning device.")
        }
    }

    private func change(_ action: String, token: String? = nil) {
        guard !unavailable, let resources = Bundle.main.resourceURL else { return }
        working = true
        store.pairingMaintenance = true
        Task { @MainActor in
            defer { working = false; store.pairingMaintenance = false }
            do {
                let result = try await QuotaSharing.run(runtime: store.runtime, resources: resources,
                    action: action, token: token, channel: channel)
                consent.status = result
                message = result.enabled ? "Enabled for this pair. This is consent, not proof of a completed exchange." :
                    result.reason == "pairing-unavailable" ? "Off. Pair this Mac first." :
                    result.canEnable ? "Off. A recent reading is available." :
                    quota ? "Off. Enable account monitoring and refresh before sharing." :
                    "Off. Enable Claude Code collection and refresh before sharing."
            } catch {
                consent.status = nil
                message = "Status could not be verified. Check again before retrying. A change may already have completed."
            }
        }
    }
}
