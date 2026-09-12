import AppKit

@MainActor
enum PairingSetupDialog {
    static func request(saved: PairingSetupStatus) -> PairingSetupRequest? {
        let alert = NSAlert()
        alert.messageText = saved.status == .paired ? "Verify paired Windows PC" : "Pair with Windows"
        alert.informativeText = "Use an existing SSH alias with trusted host-key and noninteractive key authentication. Both apps need the updated pairing tools. Pairing exchanges approved activity and AI-usage metadata, without enabling sources. A saved target is fixed for retries. Changing it requires repair."
        let form = NSView(frame: NSRect(x: 0, y: 0, width: 500, height: 312))
        func field(_ title: String, value: String?, placeholder: String, y: CGFloat) -> NSTextField {
            let label = NSTextField(labelWithString: title)
            label.frame = NSRect(x: 0, y: y + 27, width: 500, height: 18)
            let input = NSTextField(frame: NSRect(x: 0, y: y, width: 500, height: 24))
            input.placeholderString = placeholder
            input.stringValue = value ?? ""
            input.isEditable = saved.request == nil
            input.setAccessibilityLabel(title)
            form.addSubview(label)
            form.addSubview(input)
            return input
        }
        let target = saved.request?.transport
        let host = field("SSH alias", value: target?.hostAlias, placeholder: "my-windows", y: 224)
        let node = field("Windows bundled Node executable", value: target?.remoteNode,
            placeholder: "C:/Apps/Observatory/Runtime/node.exe", y: 168)
        let script = field("Windows exchange script", value: target?.remoteScript,
            placeholder: "C:/Apps/Observatory/Collector/scripts/peer-exchange.mjs", y: 112)
        let runtime = field("Windows app data directory", value: target?.remoteRuntime,
            placeholder: "C:/Users/Example/AppData/Local/Workspace Observatory", y: 56)
        let ubuntu = NSButton(checkboxWithTitle: "Include already-configured Ubuntu Codex metadata", target: nil, action: nil)
        ubuntu.frame = NSRect(x: 0, y: 10, width: 500, height: 24)
        ubuntu.state = saved.request?.includeUbuntu == true ? .on : .off
        ubuntu.isEnabled = saved.request == nil
        form.addSubview(ubuntu)
        let pasteAction = PairingDetailsPasteAction(apply: { details in
            node.stringValue = details.remoteNode
            script.stringValue = details.remoteScript
            runtime.stringValue = details.remoteRuntime
        })
        let paste = NSButton(title: "Paste Windows details", target: pasteAction, action: #selector(PairingDetailsPasteAction.paste))
        paste.frame = NSRect(x: 0, y: 280, width: 190, height: 28)
        paste.isEnabled = saved.request == nil
        paste.toolTip = "Read connection paths from the clipboard. Does not send a setup request."
        form.addSubview(paste)
        defer { withExtendedLifetime(pasteAction) {} }
        alert.accessoryView = form
        alert.addButton(withTitle: "Cancel")
        alert.addButton(withTitle: saved.status == .paired ? "Verify pairing" : saved.status == .pending ? "Retry setup" : "Pair devices")
        alert.window.initialFirstResponder = host
        while alert.runModal() == .alertSecondButtonReturn {
            let request = PairingSetupRequest(transport: PairingTransport(kind: "ssh-windows",
                hostAlias: host.stringValue.trimmingCharacters(in: .whitespacesAndNewlines),
                remoteNode: node.stringValue, remoteScript: script.stringValue, remoteRuntime: runtime.stringValue),
                includeUbuntu: ubuntu.state == .on)
            do { try request.validate(); return request }
            catch {
                let invalid = NSAlert()
                invalid.messageText = "Check the connection fields"
                invalid.informativeText = "Enter an SSH alias using letters, numbers, underscores or hyphens. Use full Windows drive paths. The executable must be node.exe and the script must be peer-exchange.mjs. No setup has been sent."
                invalid.runModal()
            }
        }
        return nil
    }

    static func progress() -> NSPanel {
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 400, height: 110),
            styleMask: [.titled], backing: .buffered, defer: false)
        panel.title = "Pairing with Windows"
        let label = NSTextField(wrappingLabelWithString: "Waiting for Windows to acknowledge setup. This can take up to 45 seconds.")
        label.frame = NSRect(x: 65, y: 32, width: 310, height: 48)
        let spinner = NSProgressIndicator(frame: NSRect(x: 23, y: 45, width: 26, height: 26))
        spinner.style = .spinning
        spinner.startAnimation(nil)
        panel.contentView?.addSubview(label)
        panel.contentView?.addSubview(spinner)
        panel.center()
        panel.makeKeyAndOrderFront(nil)
        return panel
    }
}
