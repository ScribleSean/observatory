import SwiftUI
import ServiceManagement

struct NativeSettingsActions {
    var pair: () -> Void
    var disconnect: () -> Void
    var repair: () -> Void
    var toggleLogin: () -> Void
    var loginSettings: () -> Void
    var preview: Bool
}

struct NativeSettings: View {
    @ObservedObject var store: ObservatoryStore
    let actions: NativeSettingsActions
    @State private var draft: [String: Bool] = [:]
    @State private var original: [String: Bool] = [:]
    @State private var message = ""
    @State private var loaded = false
    private var busy: Bool { store.refreshing || store.pairingMaintenance || store.collectionPausedForPairing }
    private let sources = [("activity", "ActivityWatch screen time"), ("codex", "Saved Codex usage and settings"),
                           ("wispr", "Wispr Flow statistics"), ("typewhisper", "TypeWhisper statistics")]

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            settingsSection("Collection on this Mac") {
                VStack(alignment: .leading, spacing: 12) {
                    if !store.localCollection {
                        Text("This installation uses an existing cross-device configuration. It has been preserved. Migration to these controls is not yet available.")
                    } else {
                        ForEach(sources, id: \.0) { key, title in
                            Toggle(title, isOn: binding(key)).disabled(!loaded || busy)
                        }
                        Text("Reads usage metadata. Prompts, window titles, transcripts and audio are not included in dashboard snapshots. ActivityWatch must be running separately.")
                            .font(.callout).foregroundStyle(.secondary)
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
                            .font(.callout).foregroundStyle(.secondary)
                    }
                    Text("Adding other providers and signing in directly from Observatory are not available yet.")
                        .font(.callout).foregroundStyle(.secondary)
                }.padding(8).frame(maxWidth: .infinity, alignment: .leading)
            }
            if store.localCollection {
                HStack {
                    Button("Save collection settings", action: save).disabled(!loaded || busy || draft == original)
                    Button("Reload saved settings", action: load).disabled(busy)
                }
            }
            if !message.isEmpty { Text(message).font(.callout).accessibilityLabel(message) }
            settingsSection("Device connection") {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Device pairing is separate from provider sign-in. Pairing shares supported sanitized usage records, not provider credentials. Account-limit history is not synchronized yet.")
                    HStack {
                        Button("Pair with Windows…", action: actions.pair)
                        Button("Disconnect…", action: actions.disconnect)
                        Button("Repair…", action: actions.repair)
                    }.disabled(busy || actions.preview)
                    if actions.preview { Text("Device changes are disabled in this preview.").font(.caption).foregroundStyle(.secondary) }
                }.padding(8).frame(maxWidth: .infinity, alignment: .leading)
            }
            settingsSection("Startup") {
                VStack(alignment: .leading, spacing: 12) {
                    Text(actions.preview ? "Login changes are disabled in this isolated preview." : "Launch at login uses macOS Login Items. System approval may be required.")
                    HStack {
                        Button(SMAppService.mainApp.status == .enabled ? "Turn off launch at login" : "Turn on launch at login", action: actions.toggleLogin)
                        Button("Open Login Items", action: actions.loginSettings)
                    }.disabled(actions.preview)
                }.padding(8).frame(maxWidth: .infinity, alignment: .leading)
            }
        }.onAppear(perform: load)
    }

    private func settingsSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline).accessibilityAddTraits(.isHeader)
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
