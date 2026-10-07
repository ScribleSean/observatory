import Foundation

// Keep the existing public error contract. Only numeric child metadata survives.
enum PairingProcessDiagnostics {
    static func check(_ process: Process, startedAt: DispatchTime) throws {
        guard process.terminationReason == .exit, process.terminationStatus == 0 else {
            let elapsed = (DispatchTime.now().uptimeNanoseconds - startedAt.uptimeNanoseconds) / 1_000_000
            throw CocoaError(.fileWriteUnknown, userInfo: [
                "childReason": process.terminationReason.rawValue,
                "childStatus": process.terminationStatus,
                "childElapsedMilliseconds": Int(elapsed)
            ])
        }
    }
}
