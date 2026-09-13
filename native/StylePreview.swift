import AppKit
import SwiftUI

// Synthetic offscreen previews. Never opens a source or starts collection.
@MainActor
func renderStylePreview(output: URL) throws {
    let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("observatory-style-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: temporary) }
    let store = ObservatoryStore(runtime: temporary, collectionAllowed: false)
    let now = Date()
    let formatter = ISO8601DateFormatter()
    let reset = formatter.string(from: now.addingTimeInterval(4 * 3600))
    let window: JSONObject = ["bucket": "Example allowance", "window": "Five-hour", "remainingPercent": 72,
                              "durationMinutes": 300, "resetsAt": reset]
    let history: [JSONObject] = (0...24).map { index in
        ["checkedAt": formatter.string(from: now.addingTimeInterval(Double(index - 24) * 300)),
         "windows": [window.merging(["remainingPercent": 96 - index]) { _, new in new }]]
    }
    let quota: JSONObject = ["status": "ok", "checkedAt": formatter.string(from: now), "windows": [window],
                             "history": history, "pace": [["bucket": "Example allowance", "window": "Five-hour",
                              "status": "resets-first", "asOf": formatter.string(from: now), "percentagePointsPerHour": 12]]]
    store.snapshot = Snapshot(object: ["schema": 2, "collectedAt": formatter.string(from: now), "demo": true,
                                       "quota": quota, "activity": [], "tokens": [], "dictation": [], "agents": []])
    let selection = NativeDashboardSelection()
    let actions = NativeSettingsActions(pair: {}, disconnect: {}, repair: {}, toggleLogin: {}, loginSettings: {}, preview: true)
    let defaults = UserDefaults(suiteName: "observatory-style-preview-\(UUID().uuidString)")!
    for mode in ["light", "dark"] {
        defaults.set(mode, forKey: "observatoryAppearance")
        let view = NativeDashboard(store: store, selection: selection, settingsActions: actions)
            .defaultAppStorage(defaults).frame(width: 1100, height: 820)
        let hosting = NSHostingView(rootView: view)
        hosting.frame = NSRect(x: 0, y: 0, width: 1100, height: 820)
        let window = NSWindow(contentRect: hosting.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = hosting
        hosting.layoutSubtreeIfNeeded()
        guard let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else { throw CocoaError(.fileWriteUnknown) }
        hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
        guard let data = bitmap.representation(using: .png, properties: [:]) else { throw CocoaError(.fileWriteUnknown) }
        try data.write(to: output.appendingPathComponent("observatory-\(mode).png"), options: .withoutOverwriting)
        window.contentView = nil
    }
    print("Synthetic native light and dark previews rendered. Collection stayed disabled.")
}
