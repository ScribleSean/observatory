import SwiftUI

struct SetupWizard: View {
    let runtime: URL
    let pairingAllowed: Bool
    let finish: (Bool) -> Void
    @State private var step = 0
    @State private var sources = Dictionary(uniqueKeysWithValues: CollectorConfiguration.defaults.keys.map { ($0, false) })
    @State private var failure = ""
    private let titles = ["Welcome to Observatory", "Choose what to collect", "Connect your devices"]
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Step \(step + 1) of 3").font(.caption).foregroundStyle(.secondary)
            Text(titles[step]).font(.largeTitle.bold())
            if step == 0 {
                Text("Track screen time and AI usage across your devices. You choose which sources are enabled. Collection stays off until you finish setup.")
                Text("Dashboard snapshots exclude prompts, window titles, transcripts, audio and credentials. Provider sign-ins stay on their owning device.")
                Text("This release uses direct encrypted device pairing. There is no Observatory account or hosted sync service.")
            } else if step == 1 {
                ForEach([("activity", "ActivityWatch screen time"), ("codex", "Saved Codex usage and settings"),
                         ("quota", "Codex account limits online"), ("wispr", "Wispr Flow statistics")], id: \.0) { key, title in
                    Toggle(title, isOn: Binding(get: { sources[key] == true }, set: { sources[key] = $0 }))
                }
                Text("ActivityWatch must already be running. Account monitoring uses the installed Codex sign-in and reads online limits without making model requests. Other sources need their applications and local records. Enabling a source does not prove it is available.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            } else {
                Text("Pair with Windows to share supported sanitized usage records directly. Provider credentials are never transferred. Account-limit history is not synchronized yet.")
                Text("The current connection requires an existing SSH alias, trusted host key and key-based sign-in. The pairing dialog shows the destination and scope before sending setup. Automatic discovery is not available yet.")
                Text("You can finish on this Mac now and pair later. Canceling pairing does not mark a device connected.")
            }
            if !failure.isEmpty { Text(failure).foregroundStyle(.red) }
            Spacer()
            HStack {
                if step > 0 { Button("Back") { step -= 1 } }
                Spacer()
                if step < 2 {
                    Button("Continue") { step += 1 }.keyboardShortcut(.defaultAction)
                } else {
                    Button("Finish on this Mac") { complete(pair: false) }
                    Button("Finish and pair Windows…") { complete(pair: true) }.disabled(!pairingAllowed)
                }
            }
        }.padding(30).frame(width: 600, height: 500)
    }
    private func complete(pair: Bool) {
        do {
            try FirstRunSetup.complete(sources: sources, runtime: runtime)
            finish(pair)
        } catch { failure = "Setup could not be saved. Collection remains paused. Try again after checking the local configuration." }
    }
}
