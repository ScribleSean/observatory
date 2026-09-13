import Foundation

private final class PairingTestBridge: DirectPairingBridge {
    var commands: [String] = []
    var holdIdentity = false
    var held: TLSSetupProcess.Completion?
    var prepared = 0
    var closed = 0
    func send(_ command: [String: Any], completion: @escaping TLSSetupProcess.Completion) {
        let action = command["action"] as! String; commands.append(action)
        if action == "identity-status" && holdIdentity { held = completion; return }
        let status = action == "identity-status" ? "identity-required" : action == "host-start" ? "hosting" :
            action == "status" ? "confirming" : action == "host-confirm" ? "configuration-ready" : "cancelled"
        completion(.success(TLSSetupReply(id: 1, status: status,
            invitation: status == "hosting" ? "observatory-pair:v1:synthetic-preview" : nil,
            peerCertificateSha256: status == "confirming" ? String(repeating: "a", count: 64) : nil)))
    }
    func prepareIdentity(storageConsent: Bool, completion: @escaping TLSSetupProcess.Completion) {
        precondition(storageConsent); prepared += 1
        completion(.success(TLSSetupReply(id: 1, status: "identity-ready", invitation: nil, peerCertificateSha256: nil)))
    }
    func close() { closed += 1 }
}

@MainActor
func testDirectPairingModel() async {
    func settle() async { try? await Task.sleep(nanoseconds: 30_000_000) }
    let bridge = PairingTestBridge(), model = DirectPairingModel(bridge: PairingTestBridge(), polling: false)
    model.shutdown()
    let subject = DirectPairingModel(bridge: bridge, polling: false)
    subject.address = "10.0.0.2"; subject.peerAddress = "10.0.0.3"
    subject.host(); await settle()
    precondition(bridge.prepared == 0 && !bridge.commands.contains("host-start"))
    subject.storageConsent = true; subject.host(); await settle()
    precondition(subject.hosting && bridge.prepared == 1)
    subject.poll(); await settle(); precondition(subject.peerFingerprint != nil)
    subject.confirmHost(); await settle(); precondition(subject.peerFingerprint == nil)
    subject.shutdown(); subject.shutdown(); precondition(bridge.closed == 1)
    let late = PairingTestBridge(); late.holdIdentity = true
    let cancelled = DirectPairingModel(bridge: late, polling: false)
    cancelled.address = "10.0.0.2"; cancelled.host(); await settle(); cancelled.cancel(); await settle()
    late.held?(.success(TLSSetupReply(id: 1, status: "identity-ready", invitation: nil, peerCertificateSha256: nil)))
    await settle(); precondition(!late.commands.contains("host-start")); cancelled.shutdown()
}
