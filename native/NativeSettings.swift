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
    var checkUpdates: (() -> Void)? = nil
}

struct NativeSettings: View {
    @ObservedObject var store: ObservatoryStore
    let actions: NativeSettingsActions
    @State private var draft: [String: Bool] = [:]
    @State private var original: [String: Bool] = [:]
    @State private var message = ""
    @State private var loaded = false
    private var busy: Bool { store.shuttingDown || store.refreshing || store.pairingMaintenance || store.collectionPausedForPairing }
    private let sources = [("activity", "ActivityWatch screen time"), ("codex", "Saved Codex usage and settings"), ("claude", "Recorded Claude Code requests"),
                           ("wispr", "Wispr Flow statistics")]

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            settingsSection("Device connection") {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Pair over an existing trusted SSH connection. Provider credentials stay on their owning device.")
                    ObservatoryAdaptiveRow {
                        Button("Pair with Windows…", action: actions.pair)
                        Button("Disconnect…", action: actions.disconnect)
                        Button("Repair…", action: actions.repair)
                    }.disabled(store.shuttingDown || store.refreshing || store.pairingMaintenance || actions.preview)
                    if actions.preview { Text("Device changes are disabled in this preview.").observatoryFont(.caption).foregroundStyle(.secondary) }
                }.padding(8).frame(maxWidth: .infinity, alignment: .leading)
            }
            settingsSection("About Observatory") {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Version \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "Unknown") (build \(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "Unknown"))")
                    Text(actions.preview ? "Isolated preview. This is not the installed app." : "This identifies the running app. Building or downloading an update does not change this version.")
                        .observatoryFont(.callout).foregroundStyle(.secondary)
                    Button("Check for updates…") { actions.checkUpdates?() }
                        .disabled(actions.preview || busy || actions.checkUpdates == nil)
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
                        ActivityWatchHelp()
                    }
                }.padding(8).frame(maxWidth: .infinity, alignment: .leading)
            }
            settingsSection("Accounts") {
                VStack(alignment: .leading, spacing: 12) {
                    ObservatoryValueRow("Codex", value: text((store.snapshot?.object["quota"] as? JSONObject)?["status"], fallback: "Not checked"))
                    Text("Uses the existing sign-in in the installed Codex app. Sign in or switch accounts there. Observatory does not copy that login to another device.")
                    if store.localCollection {
                        Toggle("Monitor Codex account limits online", isOn: binding("quota")).disabled(!loaded || busy)
                        Text("Turning Codex monitoring off stops new checks and clears the current Codex allowance view. Previously saved Codex readings remain in the local archive. This does not sign out of Codex or remove saved token logs.")
                            .observatoryFont(.callout).foregroundStyle(.secondary)
                        Toggle("Monitor Antigravity account limits online", isOn: binding("antigravity")).disabled(!loaded || busy)
                        Text("Uses the installed Antigravity CLI's existing sign-in. Reads current limits during full source collection. Turning it off stops new reads. Antigravity history and allowance sharing are not connected.")
                            .observatoryFont(.callout).foregroundStyle(.secondary)
                    }
                    Text("Other account sign-ins remain in their owning applications. Claude Code can be read locally from recorded request metadata when enabled above.")
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
            settingsSection("Connection diagnostics and previews") {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Device pairing is separate from provider sign-in. Pairing shares supported sanitized usage records, not provider credentials.")
                    TailscaleReadinessView(enabled: !busy && !actions.preview)
                    if let directPair = actions.directPair {
                        Button("Direct device pairing…", action: directPair).disabled(busy || actions.preview)
                    }
                    if actions.preview { Text("Device changes are disabled in this preview.").observatoryFont(.caption).foregroundStyle(.secondary) }
                }.padding(8).frame(maxWidth: .infinity, alignment: .leading)
            }
            settingsSection("Usage sharing") {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Optional for each source. Both devices must enable it separately. Credentials stay on their owning device.")
                        .observatoryFont(.callout).foregroundStyle(.secondary)
                    UsageSharingControls(store: store, preview: actions.preview, channel: .quota)
                    Divider()
                    UsageSharingControls(store: store, preview: actions.preview, channel: .providerTokens)
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
