// Built locally by `npm run setup`. Settings come from glance.json beside the binary.
import AppKit
import SwiftUI

struct Settings: Decodable {
  let node: String
  let repo: String
  let config: String
  let dataFolder: String
  let port: Int
}

// MARK: Panel state, parsed from combined.json

struct LimitRow: Identifiable, Equatable {
  let id: String
  let provider: String
  let name: String
  let window: String
  let remaining: Double?
  let resetsAt: Date?
}

struct DeviceRow: Identifiable, Equatable {
  let id: String
  let name: String
  let fullName: String
  let seconds: Double?
  let tokens: Double?
  let usd: Double?
  let lastSeen: Date?
  let current: Bool
  let problem: String?
}

struct PanelState: Equatable {
  enum Notice: Equatable { case none, collecting, setupMissing, nodeMissing }
  var limits: [LimitRow] = []
  var devices: [DeviceRow] = []
  var updated: Date?
  var notice: Notice = .none
  var refreshing = false
  var now = Date()

  static let low = 15.0
  static let oldAfter: TimeInterval = 15 * 60
  static let deviceFresh: TimeInterval = 15 * 60

  var old: Bool { updated.map { now.timeIntervalSince($0) > Self.oldAfter } ?? false }

  static func date(_ value: Any?) -> Date? {
    guard let text = value as? String else { return nil }
    return ISO8601DateFormatter.withFractions.date(from: text) ?? ISO8601DateFormatter().date(from: text)
  }

  static func number(_ value: Any?) -> Double? {
    guard let value = value as? Double, value.isFinite, value >= 0 else { return nil }
    return value
  }

  // Keep this pure rule in sync with lib/glance-limits.mjs and the Windows app.
  static func limitRemaining(_ row: [String: Any], now: Date) -> Double? {
    guard row["stale"] as? Bool == false,
          let remaining = row["remaining"] as? Double, remaining.isFinite, remaining >= 0, remaining <= 100,
          let checked = date(row["checkedAt"]),
          now >= checked, now.timeIntervalSince(checked) < 600 else { return nil }
    if let reset = date(row["resetsAt"]), reset <= now { return nil }
    return remaining
  }

  static func parse(_ json: [String: Any], now: Date) -> PanelState {
    var state = PanelState(now: now)
    state.updated = date(json["generatedAt"])
    guard let glance = json["glance"] as? [String: Any] else { state.notice = .collecting; return state }
    let rows = glance["limits"] as? [[String: Any]] ?? []
    state.limits = rows.enumerated().map { index, row in
      LimitRow(id: "\(row["provider"] as? String ?? "")-\(row["windowId"] as? String ?? String(index))",
               provider: row["provider"] as? String ?? "",
               name: row["name"] as? String ?? "Unknown",
               window: row["window"] as? String ?? "",
               remaining: limitRemaining(row, now: now),
               resetsAt: date(row["resetsAt"]))
    }
    // Scarcest first. Unknown readings go last, in their original order.
    .enumerated().sorted { a, b in
      switch (a.element.remaining, b.element.remaining) {
      case let (x?, y?): return x == y ? a.offset < b.offset : x < y
      case (.some, nil): return true
      case (nil, .some): return false
      case (nil, nil): return a.offset < b.offset
      }
    }.map(\.element)
    var problems: [String: String] = [:]
    if let hub = json["hub"] as? [String: Any], let spokes = hub["spokes"] as? [[String: Any]] {
      for spoke in spokes {
        guard let host = spoke["host"] as? String else { continue }
        if let pull = spoke["pull"] as? String, pull != "ok" { problems[host] = "Could not read (\(pull))" }
        else if let push = spoke["push"] as? String, push != "ok", push != "skipped" { problems[host] = "Could not write back (\(push))" }
      }
    }
    let today = glance["today"] as? [[String: Any]] ?? []
    state.devices = today.enumerated().map { index, row in
      let host = row["host"] as? String ?? String(index)
      let seen = date(row["collectedAt"])
      let stale = (row["freshness"] as? [String: Any])?["stale"] as? Bool ?? true
      let current = !stale && seen.map { now.timeIntervalSince($0) <= deviceFresh } == true
      // Short platform labels keep each line on one row. The full name is in the tooltip.
      return DeviceRow(id: host, name: host == "Windows" ? "PC" : host == "Mac" ? "Mac" : row["name"] as? String ?? host,
                       fullName: row["name"] as? String ?? host,
                       seconds: number(row["seconds"]), tokens: number(row["tokens"]), usd: number(row["usd"]),
                       lastSeen: seen, current: current, problem: problems[host])
    }
    return state
  }
}

// MARK: Formatting

enum Format {
  static func duration(_ seconds: Double) -> String {
    let minutes = Int((seconds / 60).rounded())
    return minutes < 60 ? "\(minutes)m" : "\(minutes / 60)h \(minutes % 60)m"
  }

  static func compact(_ value: Double) -> String {
    for (divisor, suffix) in [(1e12, "T"), (1e9, "B"), (1e6, "M"), (1e3, "K")] where value >= divisor {
      let scaled = value / divisor
      return (scaled >= 100 ? String(Int(scaled.rounded())) : String(format: "%.1f", scaled)) + suffix
    }
    return String(Int(value.rounded()))
  }

  static func money(_ value: Double) -> String {
    value >= 10 ? "$\(Int(value.rounded()))" : String(format: "$%.2f", value)
  }

  static func clock(_ date: Date, now: Date) -> String {
    let formatter = DateFormatter()
    formatter.locale = .current
    formatter.setLocalizedDateFormatFromTemplate(date.timeIntervalSince(now) < 20 * 3600 ? "jmm" : "EEE jmm")
    return formatter.string(from: date)
  }

  static func age(_ seconds: TimeInterval) -> String {
    let minutes = Int(seconds / 60)
    if minutes < 60 { return "\(minutes) min ago" }
    if minutes < 48 * 60 { return "\(minutes / 60)h \(minutes % 60)m ago" }
    return "\(minutes / 1440)d ago"
  }

  static func today(_ device: DeviceRow) -> String {
    let parts = [device.seconds.map(duration),
                 device.tokens.map { compact($0) + " tokens" },
                 device.usd.map(money)].compactMap { $0 }
    return parts.isEmpty ? "Unknown" : parts.joined(separator: "  ·  ")
  }
}

// MARK: Look (mirrors app/design-tokens.css)

struct Palette {
  let background, surface, text, muted, track, claude, codex, warning, error, hairline: Color

  static func of(_ scheme: ColorScheme) -> Palette {
    func hex(_ value: UInt32) -> Color {
      Color(.sRGB, red: Double(value >> 16 & 255) / 255, green: Double(value >> 8 & 255) / 255, blue: Double(value & 255) / 255)
    }
    return scheme == .dark
      ? Palette(background: hex(0x1c1d1b), surface: hex(0x272825), text: hex(0xf0eee8), muted: hex(0xb3b7ac),
                track: hex(0x3b3e37), claude: hex(0xcb7550), codex: hex(0x4f95cf), warning: hex(0xe2b866),
                error: hex(0xe58a80), hairline: Color.white.opacity(0.08))
      : Palette(background: hex(0xedeae5), surface: hex(0xf4f1ec), text: hex(0x292d28), muted: hex(0x5b6056),
                track: hex(0xdadbd3), claude: hex(0xb5633c), codex: hex(0x2e6e9e), warning: hex(0x94620f),
                error: hex(0xa23b32), hairline: Color.black.opacity(0.08))
  }

  func provider(_ name: String) -> Color { name == "claude" ? claude : name == "codex" ? codex : muted }
}

enum Brand {
  // The one telescope mark, copied from public/brand/telescope.svg by setup.
  static let telescope: NSImage = {
    let image = Bundle.main.url(forResource: "telescope", withExtension: "svg").flatMap(NSImage.init(contentsOf:))
      ?? NSImage(systemSymbolName: "binoculars", accessibilityDescription: nil)
      ?? NSImage(size: NSSize(width: 18, height: 18))
    image.isTemplate = true
    image.accessibilityDescription = "Observatory"
    return image
  }()

  static func mark(size: CGFloat) -> NSImage {
    let copy = telescope.copy() as! NSImage
    copy.size = NSSize(width: size, height: size)
    copy.isTemplate = true
    return copy
  }
}

// MARK: Panel view

final class PanelModel: ObservableObject {
  @Published var state = PanelState()
  var refresh: () -> Void = {}
  var openDashboard: () -> Void = {}
  var quit: () -> Void = {}
}

struct PanelView: View {
  @ObservedObject var model: PanelModel
  @Environment(\.colorScheme) private var scheme

  static let width: CGFloat = 340

  var body: some View {
    let palette = Palette.of(scheme)
    let state = model.state
    VStack(alignment: .leading, spacing: 12) {
      header(state, palette)
      switch state.notice {
      case .setupMissing: message("Settings are missing. Run npm run setup again.", palette)
      case .nodeMissing: message("Node was not found. Run npm run setup again.", palette)
      case .collecting: message("Collecting the first reading…", palette)
      case .none:
        if !state.limits.isEmpty { card(palette) { limits(state, palette) } }
        if !state.devices.isEmpty { card(palette) { devices(state, palette) } }
      }
      footer(state, palette)
    }
    .padding(14)
    .frame(width: Self.width, alignment: .leading)
    .background(palette.background)
    .foregroundStyle(palette.text)
    .font(.system(size: 13))
  }

  func header(_ state: PanelState, _ palette: Palette) -> some View {
    HStack(spacing: 8) {
      Image(nsImage: Brand.mark(size: 18)).renderingMode(.template).foregroundStyle(palette.text)
      Text("Observatory").font(.system(size: 15, weight: .semibold)).tracking(-0.3)
      Spacer(minLength: 8)
      if state.refreshing {
        ProgressView().controlSize(.small).scaleEffect(0.8)
      } else if state.old, let updated = state.updated {
        Text("Updated \(Format.age(state.now.timeIntervalSince(updated)))")
          .font(.system(size: 11.5)).foregroundStyle(palette.warning)
      }
    }
    .padding(.horizontal, 2)
  }

  func card<Content: View>(_ palette: Palette, @ViewBuilder _ content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 12, content: content)
      .padding(14)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(palette.surface))
      .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(palette.hairline))
  }

  @ViewBuilder func limits(_ state: PanelState, _ palette: Palette) -> some View {
    // Limits without a current reading collapse into one quiet line instead of a row each.
    let unknown = state.limits.filter { $0.remaining == nil }
    ForEach(state.limits.filter { $0.remaining != nil }) { row in
      let tint = row.remaining.map { $0 <= 0.5 ? palette.error : $0 <= PanelState.low ? palette.warning : nil } ?? nil
      VStack(alignment: .leading, spacing: 6) {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          Circle().fill(palette.provider(row.provider)).frame(width: 7, height: 7).alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
          Text(row.name).fontWeight(.medium)
          Text(row.window).foregroundStyle(palette.muted)
          Spacer(minLength: 6)
          if let remaining = row.remaining {
            if remaining <= PanelState.low, let reset = row.resetsAt {
              Text("back \(Format.clock(reset, now: state.now))").font(.system(size: 12)).foregroundStyle(tint ?? palette.muted)
            }
            Text("\(Int(remaining.rounded()))%").font(.system(size: 13, weight: .semibold)).monospacedDigit()
              .foregroundStyle(tint ?? palette.text)
          }
        }
        GeometryReader { geometry in
          ZStack(alignment: .leading) {
            Capsule().fill(palette.track)
            Capsule().fill(tint ?? palette.provider(row.provider))
              .frame(width: geometry.size.width * CGFloat((row.remaining ?? 0) / 100))
          }
        }
        .frame(height: 5)
      }
      .accessibilityElement(children: .combine)
    }
    if !unknown.isEmpty {
      HStack(spacing: 6) {
        Circle().strokeBorder(palette.muted, lineWidth: 1.2).frame(width: 7, height: 7)
        Text(unknown.count == state.limits.count ? "No current limit reading"
             : "No current reading: " + unknown.map { "\($0.name) \($0.window)" }.joined(separator: ", "))
          .foregroundStyle(palette.muted).fixedSize(horizontal: false, vertical: true)
      }
    }
  }

  func devices(_ state: PanelState, _ palette: Palette) -> some View {
    ForEach(state.devices) { device in
      HStack(spacing: 6) {
        Text(device.name).fontWeight(.medium).lineLimit(1)
        Spacer(minLength: 8)
        if device.current {
          // One quiet mark per computer: a sync problem shows only while its data is otherwise current.
          if let problem = device.problem {
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 10)).foregroundStyle(palette.warning)
              .accessibilityLabel(problem)
          }
          Text(Format.today(device)).monospacedDigit().lineLimit(1)
        } else {
          Circle().strokeBorder(palette.muted, lineWidth: 1.2).frame(width: 7, height: 7)
          Text(device.lastSeen.map { "last seen \(Format.clock($0, now: state.now))" } ?? "Unknown")
            .foregroundStyle(palette.muted).lineLimit(1)
        }
      }
      .help([device.fullName, device.problem, device.current && device.usd != nil ? "Cost is an API-equivalent estimate" : nil]
        .compactMap { $0 }.joined(separator: "\n"))
    }
  }

  func message(_ text: String, _ palette: Palette) -> some View {
    card(palette) { Text(text).foregroundStyle(palette.muted).fixedSize(horizontal: false, vertical: true) }
  }

  func footer(_ state: PanelState, _ palette: Palette) -> some View {
    HStack(spacing: 8) {
      Button(action: model.openDashboard) {
        Text("Open dashboard").fontWeight(.medium).frame(maxWidth: .infinity)
      }
      .buttonStyle(Pill(palette: palette, prominent: true)).keyboardShortcut("d")
      Button(action: model.refresh) { Image(systemName: "arrow.clockwise") }
        .buttonStyle(Pill(palette: palette)).keyboardShortcut("r").disabled(state.refreshing)
        .help("Refresh").accessibilityLabel("Refresh")
      Button(action: model.quit) { Image(systemName: "power") }
        .buttonStyle(Pill(palette: palette)).keyboardShortcut("q")
        .help("Quit Observatory").accessibilityLabel("Quit Observatory")
    }
  }
}

struct Pill: ButtonStyle {
  let palette: Palette
  var prominent = false
  @Environment(\.isEnabled) private var enabled

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: 13))
      .padding(.horizontal, 12)
      .frame(minWidth: 34, minHeight: 30)
      .fixedSize(horizontal: !prominent, vertical: false)
      .background(Capsule().fill(palette.surface))
      .overlay(Capsule().strokeBorder(palette.hairline))
      .opacity(configuration.isPressed ? 0.6 : enabled ? 1 : 0.4)
      .contentShape(Capsule())
  }
}

// MARK: Floating panel window

final class FloatingPanel: NSPanel {
  init(content: NSView) {
    super.init(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
    isFloatingPanel = true
    level = .popUpMenu
    backgroundColor = .clear
    isOpaque = false
    hasShadow = true
    hidesOnDeactivate = false
    collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
    let clip = NSView()
    clip.wantsLayer = true
    clip.layer?.cornerRadius = 16
    clip.layer?.cornerCurve = .continuous
    clip.layer?.masksToBounds = true
    content.translatesAutoresizingMaskIntoConstraints = false
    clip.addSubview(content)
    NSLayoutConstraint.activate([
      content.leadingAnchor.constraint(equalTo: clip.leadingAnchor),
      content.trailingAnchor.constraint(equalTo: clip.trailingAnchor),
      content.topAnchor.constraint(equalTo: clip.topAnchor),
      content.bottomAnchor.constraint(equalTo: clip.bottomAnchor),
    ])
    contentView = clip
  }

  override var canBecomeKey: Bool { true }

  override func cancelOperation(_ sender: Any?) { close() }
}

// MARK: App

final class Glance: NSObject, NSApplicationDelegate, NSWindowDelegate {
  let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
  let model = PanelModel()
  var settings: Settings?
  var tick: Process?
  var server: Process?
  var panel: FloatingPanel?
  var hosting: NSHostingView<PanelView>?

  func applicationDidFinishLaunching(_ note: Notification) {
    stopOnTerminate()
    let file = Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/glance.json")
    if let data = try? Data(contentsOf: file) { settings = try? JSONDecoder().decode(Settings.self, from: data) }
    item.button?.image = Brand.mark(size: 18)
    item.button?.toolTip = "Observatory"
    item.button?.target = self
    item.button?.action = #selector(toggle)
    item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
    model.refresh = { [weak self] in self?.runTick() }
    model.openDashboard = { [weak self] in self?.closePanel(); self?.openDashboard() }
    model.quit = { NSApp.terminate(nil) }
    show()
    runTick()
    Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in self?.runTick() }
    Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in self?.show() }
  }

  func applicationWillTerminate(_ note: Notification) {
    stopProcesses()
  }

  func stopProcesses() {
    server?.terminate()
    // tick handles SIGTERM with the same grace period and tree cleanup as its deadline.
    if let running = tick, running.isRunning {
      running.terminate()
      running.waitUntilExit()
    }
  }

  // launchd stops the app with SIGTERM, which skips applicationWillTerminate.
  var termination: DispatchSourceSignal?
  func stopOnTerminate() {
    signal(SIGTERM, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    source.setEventHandler { [weak self] in
      self?.stopProcesses()
      exit(0)
    }
    source.resume()
    termination = source
  }

  var combinedFile: URL? {
    guard let settings else { return nil }
    return URL(fileURLWithPath: settings.dataFolder).appendingPathComponent("public/local/combined.json")
  }

  var nodeMissing = false

  func node(_ arguments: [String], done: ((Process) -> Void)? = nil) -> Process? {
    guard let settings else { return nil }
    let process = Process()
    process.executableURL = URL(fileURLWithPath: settings.node)
    process.arguments = arguments
    process.currentDirectoryURL = URL(fileURLWithPath: settings.repo)
    var environment = ProcessInfo.processInfo.environment
    environment["OBSERVATORY_CONFIG"] = settings.config
    process.environment = environment
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    process.terminationHandler = { finished in DispatchQueue.main.async { done?(finished) } }
    do { try process.run() } catch { nodeMissing = true; return nil }
    nodeMissing = false
    return process
  }

  var tickStarted = Date.distantPast

  @objc func runTick() {
    if let running = tick, running.isRunning {
      if Date().timeIntervalSince(tickStarted) < 270 { return }
      running.terminate()
      running.waitUntilExit()
    }
    tickStarted = Date()
    guard let settings else { return }
    tick = node([settings.repo + "/scripts/tick.mjs"]) { [weak self] finished in
      if self?.tick === finished { self?.tick = nil }
      self?.show()
    }
    show()
  }

  func show() {
    var state: PanelState
    if settings == nil {
      state = PanelState(notice: .setupMissing)
    } else if let file = combinedFile, let data = try? Data(contentsOf: file),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
      state = PanelState.parse(json, now: Date())
    } else {
      state = PanelState(notice: .collecting)
    }
    if nodeMissing { state.notice = .nodeMissing }
    state.refreshing = tick?.isRunning == true
    model.state = state
    // A quiet mark when nothing current is known: the icon dims.
    let current = state.notice == .none && !state.old && state.limits.contains { $0.remaining != nil }
    item.button?.appearsDisabled = !current
    item.button?.toolTip = current ? "Observatory" : "Observatory: not updated recently"
    fitPanel()
  }

  @objc func toggle() {
    if panel?.isVisible == true { closePanel(); return }
    show()
    if panel == nil {
      let view = NSHostingView(rootView: PanelView(model: model))
      hosting = view
      let window = FloatingPanel(content: view)
      window.delegate = self
      panel = window
    }
    fitPanel()
    panel?.makeKeyAndOrderFront(nil)
  }

  func fitPanel() {
    guard let panel, let hosting, let button = item.button, let buttonWindow = button.window else { return }
    let size = hosting.fittingSize
    let anchor = buttonWindow.convertToScreen(button.convert(button.bounds, to: nil))
    let screen = (buttonWindow.screen ?? NSScreen.main)?.visibleFrame ?? .zero
    var x = anchor.midX - size.width / 2
    x = min(max(x, screen.minX + 8), screen.maxX - size.width - 8)
    panel.setFrame(NSRect(x: x, y: anchor.minY - size.height - 6, width: size.width, height: size.height), display: true)
  }

  func closePanel() { panel?.orderOut(nil) }

  func windowDidResignKey(_ notification: Notification) { closePanel() }

  func openDashboard() {
    guard let settings, let url = URL(string: "http://127.0.0.1:\(settings.port)/") else { return }
    reachable(url) { [weak self] up in
      guard let self else { return }
      if up { NSWorkspace.shared.open(url); return }
      if self.server?.isRunning != true {
        self.server = self.node([settings.repo + "/serve-local.mjs", "--with-parent"]) { [weak self] finished in
          if self?.server === finished { self?.server = nil }
        }
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + 1) { NSWorkspace.shared.open(url) }
    }
  }

  func reachable(_ url: URL, done: @escaping (Bool) -> Void) {
    var request = URLRequest(url: url)
    request.httpMethod = "HEAD"
    request.timeoutInterval = 1
    URLSession.shared.dataTask(with: request) { _, response, _ in
      let up = (response as? HTTPURLResponse)?.statusCode == 200
      DispatchQueue.main.async { done(up) }
    }.resume()
  }
}

extension ISO8601DateFormatter {
  static let withFractions: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()
}

// `Observatory --render combined.json out.png light|dark [now-iso]` draws the panel to a PNG without
// a menu bar, for checking the layout and for documentation screenshots.
@MainActor func render(_ arguments: [String]) -> Int32 {
  guard arguments.count >= 4, let data = FileManager.default.contents(atPath: arguments[1]),
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
    FileHandle.standardError.write("usage: --render combined.json out.png light|dark [now]\n".data(using: .utf8)!)
    return 2
  }
  let now = arguments.count > 4 ? PanelState.date(arguments[4]) ?? Date() : Date()
  let model = PanelModel()
  model.state = PanelState.parse(json, now: now)
  let scheme: ColorScheme = arguments[3] == "dark" ? .dark : .light
  let renderer = ImageRenderer(content: PanelView(model: model).environment(\.colorScheme, scheme))
  renderer.scale = 2
  guard let image = renderer.nsImage, let tiff = image.tiffRepresentation,
        let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else { return 1 }
  do { try png.write(to: URL(fileURLWithPath: arguments[2])) } catch { return 1 }
  return 0
}

let arguments = CommandLine.arguments
if let flag = arguments.firstIndex(of: "--render") {
  exit(MainActor.assumeIsolated { render(Array(arguments[flag...])) })
}
let app = NSApplication.shared
let delegate = Glance()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
