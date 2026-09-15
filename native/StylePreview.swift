import AppKit
import SwiftUI

@MainActor
func renderArchiveChartPreview(output: URL) throws {
    var pixels = Data(repeating: 0, count: 121 * 101)
    for x in 20...100 { pixels[50 * 121 + x] = x <= 40 || x >= 80 ? 1 : x % 7 < 3 ? 2 : 0 }
    for x in [20, 40, 80, 100] { pixels[50 * 121 + x] = 3 }
    let chart = ArchiveChart(version: 1, width: 121, height: 101, from: 1735689600000, to: 1735776000000,
        encoding: "ink-mask-u8", pixels: pixels.base64EncodedString(), scanned: 5, observations: 4, gaps: 1, segments: 1,
        firstAt: 1735704000000, lastAt: 1735761600000, minUsed: 50, maxUsed: 50)
    _ = try chart.validatedMask()
    for mode in ["light", "dark"] {
      for size in [NSSize(width: 720, height: 360), NSSize(width: 480, height: 420)] {
        let view = ArchiveChartView(chart: chart, windowLabel: "Example allowance · primary")
            .padding(24).frame(width: size.width, height: size.height)
            .background(ObservatoryTheme.background)
            .environment(\.colorScheme, mode == "light" ? .light : .dark)
        let hosting = NSHostingView(rootView: view)
        hosting.appearance = NSAppearance(named: mode == "light" ? .aqua : .darkAqua)
        hosting.frame = NSRect(origin: .zero, size: size)
        let window = NSWindow(contentRect: hosting.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = hosting
        hosting.layoutSubtreeIfNeeded()
        guard let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else { throw CocoaError(.fileWriteUnknown) }
        hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
        guard let data = bitmap.representation(using: .png, properties: [:]) else { throw CocoaError(.fileWriteUnknown) }
        let suffix = size.width == 720 ? "" : "-480"
        try data.write(to: output.appendingPathComponent("archive-mask-\(mode)\(suffix).png"), options: .withoutOverwriting)
        window.contentView = nil
      }
    }
    print("Synthetic archive light/dark gap fixtures rendered. No sources opened.")
}

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
        for scale in [1.0, 2.0] {
        selection.textScale = scale
        for section in scale == 1 ? ["allowances"] : NativeDashboardSelection.sections.map(\.0) {
        selection.section = section
        let sizes = scale == 1 ? [NSSize(width: 760, height: 560), NSSize(width: 1100, height: 820), NSSize(width: 1600, height: 1000)] : [NSSize(width: 760, height: 560)]
        for size in sizes {
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
        let suffix = scale == 2 ? "-200-\(section)" : size.width == 1100 ? "" : "-\(Int(size.width))"
        try data.write(to: output.appendingPathComponent("observatory-\(mode)\(suffix).png"), options: .withoutOverwriting)
        window.contentView = nil
        }
        }
        }
    }
    print("Synthetic native light and dark previews rendered. Collection stayed disabled.")
}
