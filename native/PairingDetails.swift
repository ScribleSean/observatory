import AppKit
import Foundation

struct WindowsPairingDetails: Decodable {
    let version: Int
    let kind: String
    let remoteNode: String
    let remoteScript: String
    let remoteRuntime: String

    static func parse(_ value: String) throws -> WindowsPairingDetails {
        let data = Data(value.utf8)
        guard data.count <= 8192,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(object.keys) == Set(["version", "kind", "remoteNode", "remoteScript", "remoteRuntime"]) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        let details = try JSONDecoder().decode(WindowsPairingDetails.self, from: data)
        guard details.version == 1, details.kind == "windows-installation" else { throw CocoaError(.fileReadCorruptFile) }
        // Validate only the three imported paths. The Mac's SSH alias and source
        // scope are separate user choices and cannot be set by pasted content.
        try PairingSetupRequest(transport: PairingTransport(kind: "ssh-windows", hostAlias: "validation-only",
            remoteNode: details.remoteNode, remoteScript: details.remoteScript, remoteRuntime: details.remoteRuntime),
            includeUbuntu: false).validate()
        return details
    }
}

@MainActor
final class PairingDetailsPasteAction: NSObject {
    private let read: @MainActor () -> String?
    private let apply: @MainActor (WindowsPairingDetails) -> Void
    private let onError: @MainActor () -> Void

    init(read: (@MainActor () -> String?)? = nil,
         apply: @escaping @MainActor (WindowsPairingDetails) -> Void,
         onError: (@MainActor () -> Void)? = nil) {
        self.read = read ?? { NSPasteboard.general.string(forType: .string) }
        self.apply = apply
        self.onError = onError ?? {
            let alert = NSAlert()
            alert.messageText = "Windows details could not be pasted"
            alert.informativeText = "Copy Windows details from the Windows app's Pairing details for Mac dialog, then transfer that text to this Mac. Existing fields were not changed."
            alert.runModal()
        }
    }

    @objc func paste() {
        guard let text = read(), let details = try? WindowsPairingDetails.parse(text) else { onError(); return }
        apply(details)
    }
}
