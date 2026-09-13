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
    let window: JSONObject = ["bucket": "Example allowance", "window": "Seven-day", "remainingPercent": 72,
                              "durationMinutes": 10080, "resetsAt": reset]
    let history: [JSONObject] = (0...288).map { index in
        ["checkedAt": formatter.string(from: now.addingTimeInterval(Double(index - 288) * 300)),
         "windows": [window.merging(["remainingPercent": 96 - Double(index) / 12]) { _, new in new }]]
    }
    let quota: JSONObject = ["status": "ok", "checkedAt": formatter.string(from: now), "windows": [window],
                             "history": history, "pace": [["bucket": "Example allowance", "window": "Seven-day",
                              "status": "resets-first", "asOf": formatter.string(from: now), "percentagePointsPerHour": 1]]]
    store.snapshot = Snapshot(object: ["schema": 2, "collectedAt": formatter.string(from: now), "demo": true,
                                       "quota": quota, "activity": [], "tokens": [], "dictation": [], "agents": []])
    let selection = NativeDashboardSelection()
    let actions = NativeSettingsActions(pair: {}, disconnect: {}, repair: {}, toggleLogin: {}, loginSettings: {}, preview: true)
    let suite = "observatory-style-preview-\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: suite)!
    defer { defaults.removePersistentDomain(forName: suite) }
    for mode in ["light", "dark"] {
        defaults.set(mode, forKey: "observatoryAppearance")
        for size in [NSSize(width: 760, height: 560), NSSize(width: 1100, height: 820), NSSize(width: 1600, height: 1000)] {
        let view = NativeDashboard(store: store, selection: selection, settingsActions: actions)
            .defaultAppStorage(defaults).frame(width: size.width, height: size.height)
        let hosting = NSHostingView(rootView: view)
        hosting.frame = NSRect(origin: .zero, size: size)
        let window = NSWindow(contentRect: hosting.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = hosting
        hosting.layoutSubtreeIfNeeded()
        guard let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else { throw CocoaError(.fileWriteUnknown) }
        hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
        guard let data = bitmap.representation(using: .png, properties: [:]) else { throw CocoaError(.fileWriteUnknown) }
        let suffix = size.width == 1100 ? "" : "-\(Int(size.width))"
        try data.write(to: output.appendingPathComponent("observatory-\(mode)\(suffix).png"), options: .withoutOverwriting)
        window.contentView = nil
        }
    }
    print("Synthetic native light and dark previews rendered. Collection stayed disabled.")
}
