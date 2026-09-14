import SwiftUI
import ServiceManagement

struct NativeSettingsActions {
    var pair: () -> Void
    var disconnect: () -> Void
    var repair: () -> Void
    var toggleLogin: () -> Void
    var loginSettings: () -> Void
    var preview: Bool
    var directPair: (() -> Void)? = nil
}

struct NativeSettings: View {
    @ObservedObject var store: ObservatoryStore
    let actions: NativeSettingsActions
    @State private var draft: [String: Bool] = [:]
    @State private var original: [String: Bool] = [:]
    @State private var message = ""
    @State private var loaded = false
    @State private var sharing: QuotaSharingStatus?
    @State private var sharingMessage = "Check sharing status to review this Mac's consent."
    @State private var sharingBusy = false
    @State private var confirmSharing = false
    private var busy: Bool { store.shuttingDown || store.refreshing || store.pairingMaintenance || store.collectionPausedForPairing || sharingBusy }
    private let sources = [("activity", "ActivityWatch screen time"), ("codex", "Saved Codex usage and settings"),
                           ("wispr", "Wispr Flow statistics")]

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            settingsSection("About Observatory") {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Version \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "Unknown") (build \(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "Unknown"))")
                    Text(actions.preview ? "Isolated preview. This is not the installed app." : "This identifies the running app. Building or downloading an update does not change this version.")
                        .observatoryFont(.callout).foregroundStyle(.secondary)
                }.padding(8).frame(maxWidth: .infinity, alignment: .leading)
            }
            settingsSection("Collection on this Mac") {
                VStack(alignment: .leading, spacing: 12) {
                    if !store.localCollection {
                        Text("This installation uses an existing cross-device configuration. It has been preserved. Migration to these controls is not yet available.")
                    } else {
                        ForEach(sources, id: \.0) { key, title in
                            Toggle(title, isOn: binding(key)).disabled(!loaded || busy)
                        }
                        Text("Reads usage metadata. Prompts, window titles, transcripts and audio are not included in dashboard snapshots. ActivityWatch must be running separately.")
                            .observatoryFont(.callout).foregroundStyle(.secondary)
                    }
                }.padding(8).frame(maxWidth: .infinity, alignment: .leading)
            }
            settingsSection("Accounts") {
                VStack(alignment: .leading, spacing: 12) {
                    LabeledContent("Codex", value: text((store.snapshot?.object["quota"] as? JSONObject)?["status"], fallback: "Not checked"))
                    Text("Uses the existing sign-in in the installed Codex app. Sign in or switch accounts there. Observatory does not copy that login to another device.")
                    if store.localCollection {
                        Toggle("Monitor Codex account limits online", isOn: binding("quota")).disabled(!loaded || busy)
                        Text("Turning monitoring off clears retained allowance history, but does not sign out of Codex or remove saved token logs.")
                            .observatoryFont(.callout).foregroundStyle(.secondary)
                    }
                    Text("Adding other providers and signing in directly from Observatory are not available yet.")
                        .observatoryFont(.callout).foregroundStyle(.secondary)
                }.padding(8).frame(maxWidth: .infinity, alignment: .leading)
            }
            if store.localCollection {
                settingsSection("Configured workflows") {
                    VStack(alignment: .leading, spacing: 12) {
                        Toggle("Read configured agent receipts", isOn: binding("receipts")).disabled(!loaded || busy)
                        Toggle("Read configured Ubuntu benchmarks", isOn: binding("benchmarks")).disabled(!loaded || busy)
                        Text("Uses only paths and the SSH connection already configured in a legacy installation. Without that configuration, the source stays disconnected. Benchmark reads may connect to Ubuntu. These records stay local to this dashboard and are not shared through device pairing.")
                            .observatoryFont(.callout).foregroundStyle(.secondary)
                        Text("Turning a workflow source off stops its reads and removes it from the current view. Original receipt files are not deleted.")
                            .observatoryFont(.callout).foregroundStyle(.secondary)
                    }.padding(8).frame(maxWidth: .infinity, alignment: .leading)
                }
                ObservatoryAdaptiveRow {
                    Button("Save collection settings", action: save).disabled(!loaded || busy || draft == original)
                    Button("Reload saved settings", action: load).disabled(busy)
                }
            }
            if !message.isEmpty { Text(message).observatoryFont(.callout).accessibilityLabel(message) }
            settingsSection("Device connection") {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Device pairing is separate from provider sign-in. Pairing shares supported sanitized usage records, not provider credentials.")
                    TailscaleReadinessView(enabled: !busy && !actions.preview)
                    if let directPair = actions.directPair {
                        Button("Direct device pairing…", action: directPair).disabled(busy || actions.preview)
                    }
                    ObservatoryAdaptiveRow {
                        Button("Pair with Windows…", action: actions.pair)
                        Button("Disconnect…", action: actions.disconnect)
                        Button("Repair…", action: actions.repair)
                    }.disabled(busy || actions.preview)
                    if actions.preview { Text("Device changes are disabled in this preview.").observatoryFont(.caption).foregroundStyle(.secondary) }
                }.padding(8).frame(maxWidth: .infinity, alignment: .leading)
            }
            settingsSection("Allowance history sharing") {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Optional. Both devices must enable sharing. Exchanges include allowance percentages, observation times and dated account token totals. Credentials stay on their own device. Different devices' account totals are never added together.")
                    Text(sharingMessage).observatoryFont(.callout).accessibilityLabel(sharingMessage)
                    ObservatoryAdaptiveRow {
                        Button("Check sharing status") { changeSharing("status") }
                            .disabled(busy || actions.preview)
                        Button(sharing?.enabled == true ? "Disable allowance sharing" : "Enable allowance sharing") {
                            if sharing?.enabled == true { changeSharing("disable") } else { confirmSharing = true }
                        }.disabled(busy || actions.preview || !(sharing?.enabled == true || sharing?.canEnable == true))
                    }
                    if actions.preview { Text("Sharing changes are disabled in this isolated preview.").observatoryFont(.caption) }
                }.padding(8).frame(maxWidth: .infinity, alignment: .leading)
            }
            settingsSection("Startup") {
                VStack(alignment: .leading, spacing: 12) {
                    Text(actions.preview ? "Login changes are disabled in this isolated preview." : "Launch at login uses macOS Login Items. System approval may be required.")
                    ObservatoryAdaptiveRow {
                        Button(SMAppService.mainApp.status == .enabled ? "Turn off launch at login" : "Turn on launch at login", action: actions.toggleLogin)
                        Button("Open Login Items", action: actions.loginSettings)
                    }.disabled(actions.preview)
                }.padding(8).frame(maxWidth: .infinity, alignment: .leading)
            }
        }.onAppear(perform: load)
        .alert("Enable allowance sharing?", isPresented: $confirmSharing) {
            Button("Cancel", role: .cancel) {}
            Button("Enable sharing") { changeSharing("enable") }
        } message: {
            Text("Share this account's allowance history and dated token totals with the paired device? Enable sharing on the other device separately. Account changes revoke this consent.")
        }
    }

    private func changeSharing(_ action: String) {
        guard !busy, !actions.preview, let resources = Bundle.main.resourceURL else { return }
        let token = action == "enable" ? sharing?.token : nil
        sharingBusy = true
        store.pairingMaintenance = true
        Task { @MainActor in
            defer { sharingBusy = false; store.pairingMaintenance = false }
            do {
                let result = try await QuotaSharing.run(runtime: store.runtime, resources: resources, action: action, token: token)
                sharing = result
                sharingMessage = result.enabled ? "Sharing is enabled for this account and paired device. This is consent, not proof of a completed exchange." :
                    result.reason == "pairing-unavailable" ? "Sharing is off. Pair this Mac first." :
                    result.canEnable ? "Sharing is off. A recent account reading is available." :
                    "Sharing is off. Enable account monitoring and refresh the account before sharing."
            } catch {
                sharing = nil
                sharingMessage = "Sharing could not be verified. Check status before retrying. A setting change may already have completed."
            }
        }
    }

    private func settingsSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).observatoryFont(.headline).accessibilityAddTraits(.isHeader)
            content()
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .contain)
    }

    private func binding(_ key: String) -> Binding<Bool> {
        Binding(get: { draft[key] == true }, set: { draft[key] = $0 })
    }
    private func load() {
        loaded = false
        guard store.localCollection else { return }
        do {
            original = try CollectorConfiguration.read(runtime: store.runtime)
            draft = original
            loaded = true
            message = ""
        } catch { message = "Settings could not be read. Existing configuration has not been changed." }
    }
    private func save() {
        guard loaded, !busy, store.localCollection else { return }
        do {
            guard try CollectorConfiguration.saveIfUnchanged(draft, expected: original, runtime: store.runtime) else {
                message = "Settings changed elsewhere. Reload saved settings before editing again."
                return
            }
            original = draft
            message = actions.preview ? "Saved preview settings. Real collection is disabled in this preview." : "Saved. Collection will use these settings."
            store.refresh()
        } catch { message = "Settings could not be saved. Reload to check the current configuration." }
    }
}
