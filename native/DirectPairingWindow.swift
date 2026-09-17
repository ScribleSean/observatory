import AppKit
import SwiftUI

protocol DirectPairingBridge: AnyObject {
    func send(_ command: [String: Any], completion: @escaping TLSSetupProcess.Completion)
    func prepareIdentity(storageConsent: Bool, completion: @escaping TLSSetupProcess.Completion)
    func close()
}
extension TLSSetupProcess: DirectPairingBridge { }

@MainActor
final class DirectPairingModel: ObservableObject {
    @Published var address = ""
    @Published var peerAddress = ""
    @Published var port = "43128"
    @Published var peerPort = "43128"
    @Published var includeUbuntu = false
    @Published var storageConsent = false
    @Published var invitation = ""
    @Published private(set) var message = "Choose Host on one device and Join on the other. Use a local network or trusted VPN."
    @Published private(set) var peerFingerprint: String?
    @Published private(set) var busy = false
    @Published private(set) var hosting = false
    @Published private(set) var joining = false
    private let bridge: DirectPairingBridge
    private var timer: Timer?
    private var closed = false
    private var polling = false
    private var generation = 0

    init(bridge: DirectPairingBridge, polling: Bool = true) {
        self.bridge = bridge
        if polling {
            timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
                Task { @MainActor [weak self] in self?.poll() }
            }
        }
    }

    func shutdown() {
        guard !closed else { return }
        closed = true; timer?.invalidate(); timer = nil; bridge.close()
    }

    private func handle(_ result: Result<TLSSetupReply, Error>) -> TLSSetupReply? {
        guard !closed else { return nil }
        guard case let .success(reply) = result else {
            message = "Setup could not be verified. Saved data was preserved. Close this window before retrying."
            return nil
        }
        switch reply.status {
        case "identity-recovery-required": message = "Identity recovery is required. Existing pairing or identity files will not be replaced."
        case "hosting": hosting = true; invitation = reply.invitation ?? ""; message = "Share this invitation privately with the other device. It expires within ten minutes."
        case "confirming": message = "A device claimed the invitation. Confirm only if you are pairing that device now."
        case "awaiting-confirmation": joining = true; message = "Confirm this device on the host, then choose Finish joining."
        case "configuration-ready": peerFingerprint = nil; message = "Configuration saved. Waiting for the other device to finish joining."
        case "local-ready": message = "Saved locally, but acknowledgement was not verified. Retry Finish joining with the same invitation."
        case "acknowledged": peerFingerprint = nil; message = "Pairing setup acknowledged. This does not verify live data sync or source availability."
        case "cancelled": hosting = false; joining = false; invitation = ""; peerFingerprint = nil; message = "Setup cancelled. Saved state was retained."
        case "inactive": message = "The invitation is inactive. Close and reopen setup to retry."
        case "unavailable": message = "Setup unavailable. Check the addresses, source scope and existing pairing state. No saved state was replaced."
        default: break
        }
        if reply.status == "confirming" { peerFingerprint = reply.peerCertificateSha256 }
        return reply
    }

    private func perform(_ command: [String: Any]) {
        guard !busy, !closed else { return }
        busy = true; generation += 1; let token = generation
        bridge.send(command) { [weak self] result in
            Task { @MainActor in guard let self, !self.closed, self.generation == token else { return }; self.busy = false; _ = self.handle(result) }
        }
    }

    private func withIdentity(_ action: @escaping @MainActor () -> Void) {
        guard !busy, !closed else { return }
        busy = true; generation += 1; let token = generation
        bridge.send(["action": "identity-status"]) { [weak self] result in
            Task { @MainActor in
                guard let self, !self.closed, self.generation == token else { return }
                guard let reply = self.handle(result) else { self.busy = false; return }
                if reply.status == "identity-ready" { self.busy = false; action(); return }
                guard reply.status == "identity-required", self.storageConsent else {
                    self.busy = false
                    if reply.status == "identity-required" { self.message = "Review and accept the identity storage policy before creating an identity." }
                    return
                }
                self.bridge.prepareIdentity(storageConsent: true) { [weak self] result in
                    Task { @MainActor in
                        guard let self, !self.closed, self.generation == token else { return }; self.busy = false
                        if self.handle(result)?.status == "identity-ready" { action() }
                    }
                }
            }
        }
    }

    func host() {
        guard !hosting, !joining, let value = Int(port), (1024...65535).contains(value), !address.isEmpty else {
            message = "Enter this device's numeric private-network address and a port from 1024 to 65535."; return
        }
        withIdentity { [weak self] in guard let self else { return }; self.perform(["action": "host-start", "address": self.address, "port": 0]) }
    }

    func confirmHost() {
        guard hosting, let fingerprint = peerFingerprint, let local = Int(port), let remote = Int(peerPort),
              (1024...65535).contains(local), (1024...65535).contains(remote), !peerAddress.isEmpty else {
            message = "Wait for a device claim and enter the other device's private-network address and sync port."; return
        }
        perform(["action": "host-confirm", "peerCertificateSha256": fingerprint,
                 "localEndpoint": ["kind": "tls", "address": address, "port": local],
                 "peerEndpoint": ["kind": "tls", "address": peerAddress, "port": remote], "includeUbuntu": includeUbuntu])
    }

    func join() {
        guard !hosting, !joining, invitation.utf8.count <= 2048, invitation.hasPrefix("observatory-pair:v1:") else {
            message = "Paste a complete invitation from the other device."; return
        }
        withIdentity { [weak self] in guard let self else { return }; self.perform(["action": "join-claim", "invitation": self.invitation]) }
    }

    func finishJoining() { if joining { perform(["action": "join-confirm", "includeUbuntu": false]) } }

    func cancel() {
        guard !closed else { return }
        generation += 1; let token = generation
        bridge.send(["action": "cancel"]) { [weak self] result in
            Task { @MainActor in guard let self, !self.closed, self.generation == token else { return }; self.busy = false; _ = self.handle(result) }
        }
    }

    func poll() {
        guard !closed, !polling, !busy, hosting else { return }
        polling = true; let token = generation
        bridge.send(["action": "status"]) { [weak self] result in
            Task { @MainActor in
                guard let self, !self.closed else { return }; self.polling = false
                if self.generation == token { _ = self.handle(result) }
            }
        }
    }

    func copyInvitation() {
        guard hosting, !invitation.isEmpty else { return }
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(invitation, forType: .string)
    }
}

private struct DirectPairingView: View {
    @ObservedObject var model: DirectPairingModel
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Direct device pairing").font(.title2.weight(.semibold))
            Text("Pairing is separate from provider sign-in. This setup does not enable allowance sharing or prove that data sync is running.")
                .font(.callout).foregroundStyle(.secondary)
            Toggle("Allow a device identity stored in a permission-restricted file", isOn: $model.storageConsent)
            Text("The key is not stored in Keychain or encrypted separately by Observatory. A valid existing identity is reused without creating another.")
                .font(.caption).foregroundStyle(.secondary)
            GroupBox("Host on this Mac") {
                VStack(alignment: .leading, spacing: 10) {
                    HStack { TextField("This Mac's private IP", text: $model.address); TextField("Sync port", text: $model.port).frame(width: 90) }
                    HStack { TextField("Windows private IP", text: $model.peerAddress); TextField("Peer sync port", text: $model.peerPort).frame(width: 90) }
                    Toggle("Include Ubuntu Codex records on Windows", isOn: $model.includeUbuntu)
                        .disabled(model.joining)
                    Text("This option applies when hosting on this Mac. When this Mac joins an invitation, choose Ubuntu scope on the Windows host.")
                        .font(.caption).foregroundStyle(.secondary)
                    HStack {
                        Button("Create invitation", action: model.host).disabled(model.hosting || model.joining)
                        Button("Confirm this device", action: model.confirmHost).disabled(model.peerFingerprint == nil)
                    }
                }.padding(6)
            }.disabled(model.busy)
            GroupBox("Invitation") {
                VStack(alignment: .leading, spacing: 8) {
                    TextField("Paste an invitation, or create one above", text: $model.invitation).textFieldStyle(.roundedBorder)
                    HStack {
                        Button("Copy invitation", action: model.copyInvitation).disabled(!model.hosting)
                        Button("Join", action: model.join).disabled(model.hosting || model.joining)
                        Button("Finish joining", action: model.finishJoining).disabled(!model.joining)
                    }
                    Text("Share privately. Clipboard managers may retain copied invitations.").font(.caption).foregroundStyle(.secondary)
                }.padding(6)
            }.disabled(model.busy)
            if let fingerprint = model.peerFingerprint {
                Text("Claimed device: \(fingerprint)").font(.caption.monospaced()).textSelection(.enabled)
            }
            Text(model.message).font(.callout).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            Button("Cancel setup", action: model.cancel)
        }.padding(22).frame(minWidth: 560, minHeight: 540)
    }
}

@MainActor
final class DirectPairingWindowController: NSWindowController, NSWindowDelegate {
    private let model: DirectPairingModel
    private let onClose: () -> Void
    init(bridge: DirectPairingBridge, onClose: @escaping () -> Void) {
        model = DirectPairingModel(bridge: bridge); self.onClose = onClose
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 620, height: 600),
                              styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        super.init(window: window)
        window.title = "Observatory pairing"; window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 600, height: 600)
        window.contentView = NSHostingView(rootView: DirectPairingView(model: model))
        window.delegate = self; window.center()
    }
    required init?(coder: NSCoder) { fatalError("Not supported") }
    func windowWillClose(_ notification: Notification) { model.shutdown(); onClose() }
}
