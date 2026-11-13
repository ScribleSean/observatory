import AppKit
import SwiftUI

struct Settings: Decodable {
  let node: String
  let repo: String
  let config: String
  let dataFolder: String
  let port: Int
}


struct LimitRow: Identifiable, Equatable {
  let id: String
  let provider: String
  let name: String
  let window: String
  let remaining: Double?
  let resetsAt: Date?
  // Set when the provider reports no such limit, shown in place of Unknown.
  var absent: String? = nil
}

struct EngineRow: Identifiable, Equatable {
  let id: String
  let name: String
  let status: String
  let remaining: Double?
  let phrase: String
  // "Off" or a request count, shown instead of a share left.
  var figure: String? = nil
  var detail: String? = nil
}

struct PanelState: Equatable {
  enum Notice: Equatable { case none, collecting, setupMissing, nodeMissing }
  var sentence: String?
  var menu: String?
  var scarce: String?
  var engines: [EngineRow] = []
  var limits: [LimitRow] = []
  var updated: Date?
  var notice: Notice = .none
  var refreshing = false
  var now = Date()

  static let low = 15.0
  // Copies of lib/freshness.mjs. test/repo-rules.test.mjs checks they match.
  static let readingFresh: TimeInterval = 10 * 60
  static let deviceFresh: TimeInterval = 15 * 60

  var old: Bool { updated.map { now.timeIntervalSince($0) > Self.deviceFresh } ?? false }

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
          now >= checked, now.timeIntervalSince(checked) < readingFresh else { return nil }
    if let reset = date(row["resetsAt"]), reset <= now { return nil }
    return remaining
  }

  static func parse(_ json: [String: Any], now: Date) -> PanelState {
    var state = PanelState(now: now)
    state.updated = date(json["generatedAt"])
    guard let glance = json["glance"] as? [String: Any] else { state.notice = .collecting; return state }
    // The forecast is worked out once by the collector, so the panel, the menu bar and the dashboard agree.
    // An old forecast stays visible but dimmed, under the "Updated … ago" warning.
    if let forecast = glance["forecast"] as? [String: Any] {
      state.sentence = forecast["sentence"] as? String
      state.menu = forecast["menu"] as? String
      state.scarce = (forecast["scarce"] as? [String: Any])?["engine"] as? String
      state.engines = (forecast["engines"] as? [[String: Any]] ?? []).map { row in
        EngineRow(id: row["engine"] as? String ?? "", name: row["name"] as? String ?? "Unknown", status: row["status"] as? String ?? "unknown",
                  remaining: (row["remaining"] as? Double).flatMap { $0.isFinite && $0 >= 0 && $0 <= 100 ? $0 : nil }, phrase: row["phrase"] as? String ?? "",
                  figure: row["figure"] as? String, detail: row["detail"] as? String)
      }
      // The scarcer engine leads; the rest keep the collector's order.
      state.engines = state.engines.filter { $0.id == state.scarce } + state.engines.filter { $0.id != state.scarce }
    }
    let rows = glance["limits"] as? [[String: Any]] ?? []
    state.limits = rows.enumerated().map { index, row in
      LimitRow(id: "\(row["provider"] as? String ?? "")-\(row["window"] as? String ?? "")-\(index)",
               provider: row["provider"] as? String ?? "",
               name: row["name"] as? String ?? "Unknown",
               window: row["window"] as? String ?? "",
               remaining: limitRemaining(row, now: now),
               resetsAt: date(row["resetsAt"]),
               absent: row["absent"] as? String)
    }
    return state
  }
}


enum Format {
  static func span(_ seconds: TimeInterval) -> String {
    let minutes = Int((max(0, seconds) / 60).rounded())
    if minutes < 60 { return "\(minutes)m" }
    let hours = minutes / 60
    if hours < 48 { return "\(hours)h \(minutes % 60)m" }
    return "\(hours / 24)d \(hours % 24)h"
  }

  static func age(_ seconds: TimeInterval) -> String {
    span(seconds) + " ago"
  }
}

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
  // The one telescope mark, copied from public/brand/telescope.svg by setup. The same drawing is kept here
  // for a binary run outside its bundle, such as --render. test/repo-rules.test.mjs checks the two match.
  static let svg = ##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#f5f5f5" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m5 10 11-6 3 5-11 6z"/><path d="m16 3 4 7M5.8 12 3 13.5M12 13v3m-5 5 5-5 5 5m-5-5v6"/></svg>"##
  static let telescope: NSImage = {
    let image = Bundle.main.url(forResource: "telescope", withExtension: "svg").flatMap(NSImage.init(contentsOf:))
      ?? NSImage(data: Data(svg.utf8))
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


final class PanelModel: ObservableObject {
  @Published var state = PanelState()
  var refresh: () -> Void = {}
  var openDashboard: () -> Void = {}
  var quit: () -> Void = {}
}

struct PanelView: View {
  @ObservedObject var model: PanelModel
  @Environment(\.colorScheme) private var scheme

  static let width: CGFloat = 320
  // Three tiles need more room than two.
  static func width(_ engines: Int) -> CGFloat { engines > 2 ? 440 : width }

  func tone(_ engine: EngineRow, _ palette: Palette, old: Bool) -> Color {
    old || engine.status == "off" || (engine.remaining == nil && engine.figure == nil) ? palette.muted : engine.status == "out" ? palette.error : engine.status == "runs-out" ? palette.warning : palette.text
  }

  static func capital(_ text: String) -> String { text.prefix(1).uppercased() + text.dropFirst() }

  func number(_ engine: EngineRow) -> String { engine.figure ?? engine.remaining.map { "\(Int($0.rounded()))%" } ?? "Unknown" }

  func phrase(_ engine: EngineRow) -> String {
    let text = Self.capital(engine.phrase.replacingOccurrences(of: " at this pace", with: ""))
    return engine.detail.map { text + " · " + $0 } ?? text
  }

  func bar(_ engine: EngineRow, _ palette: Palette) -> some View {
    GeometryReader { geometry in
      ZStack(alignment: .leading) {
        Capsule().fill(palette.track)
        if let remaining = engine.remaining {
          Capsule().fill(palette.provider(engine.id)).frame(width: max(2, geometry.size.width * CGFloat(remaining / 100)))
        }
      }
    }
    .frame(height: 5)
  }

  // One tile per engine with a large number and its part of the sentence. The scarcer engine leads.
  func tiles(_ state: PanelState, _ palette: Palette) -> some View {
    HStack(alignment: .top, spacing: 10) {
      ForEach(state.engines) { engine in
        VStack(alignment: .leading, spacing: 8) {
          HStack(spacing: 6) {
            Circle().fill(palette.provider(engine.id)).frame(width: 7, height: 7)
            Text(engine.name).fontWeight(.medium)
          }
          Text(number(engine)).font(.system(size: 30, weight: .semibold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
            .foregroundStyle(tone(engine, palette, old: state.old))
          bar(engine, palette).opacity(state.old ? 0.45 : 1)
          Text(phrase(engine)).font(.system(size: 12))
            .foregroundStyle(engine.id == state.scarce && !state.old ? palette.text : palette.muted).fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(palette.surface))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(engine.id == state.scarce ? palette.muted.opacity(0.5) : palette.hairline))
        .accessibilityElement(children: .combine)
      }
    }
  }

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
        if state.engines.isEmpty {
          message("Collecting the first reading…", palette)
        } else {
          tiles(state, palette)
        }
      }
      footer(state, palette)
    }
    .padding(14)
    .frame(width: Self.width(state.engines.count), alignment: .leading)
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

  func message(_ text: String, _ palette: Palette) -> some View {
    card(palette) { Text(text).foregroundStyle(palette.muted).fixedSize(horizontal: false, vertical: true) }
  }

  func footer(_ state: PanelState, _ palette: Palette) -> some View {
    HStack(spacing: 8) {
      Button(action: model.openDashboard) {
        Text("Open dashboard").frame(maxWidth: .infinity)
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
      .frame(minWidth: 30, minHeight: 26)
      .fixedSize(horizontal: !prominent, vertical: false)
      .background(Capsule().fill(palette.surface))
      .overlay(Capsule().strokeBorder(palette.hairline))
      .opacity(configuration.isPressed ? 0.6 : enabled ? 1 : 0.4)
      .contentShape(Capsule())
  }
}


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

  override func cancelOperation(_ sender: Any?) { orderOut(nil) }
}


final class Glance: NSObject, NSApplicationDelegate, NSWindowDelegate {
  let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
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
    // Off and a request count are definite readings too, not only a share left.
    let current = state.notice == .none && !state.old && (state.limits.contains { $0.remaining != nil } || state.engines.contains { $0.status != "unknown" })
    item.button?.appearsDisabled = !current
    // The menu bar shows the engine closest to running out.
    item.button?.title = current ? (state.menu.map { " " + $0 } ?? "") : ""
    item.button?.imagePosition = .imageLeading
    item.button?.toolTip = current ? state.sentence ?? "Observatory" : "Observatory: not updated recently"
    fitPanel()
  }

  var closedAt = Date.distantPast

  @objc func toggle() {
    if panel?.isVisible == true { closePanel(); return }
    // Clicking the icon while open first takes focus from the panel, which closes it. Don't reopen on that same click.
    if Date().timeIntervalSince(closedAt) < 0.3 { return }
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

  func windowDidResignKey(_ notification: Notification) {
    closePanel()
    closedAt = Date()
  }

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
