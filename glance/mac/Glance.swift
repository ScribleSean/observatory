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
  let engine: String
  let name: String
  // Share used, 0 to 1, or nil when Unknown.
  let fraction: Double?
  let percent: String
  let resets: String?
  let tone: String
}

struct SessionRow: Identifiable, Equatable {
  let id: Int
  let title: String
  let machine: String
  let rate: String
}

struct FlagRow: Equatable {
  let count: Int
  let subject: String?
  let text: String
}

struct EngineRow: Identifiable, Equatable {
  let id: String
  let name: String
  let status: String
  let remaining: Double?
  // The hub's stored words for this engine (lib/forecast.mjs). The app shows them as they are.
  let headline: String?
  var window: String? = nil
  var resets: String? = nil
}

struct PanelState: Equatable {
  enum Notice: Equatable { case none, collecting, setupMissing, nodeMissing }
  // From glance.json (lib/glance-view.mjs), or worked out from combined.json when that file is missing.
  var headline: String?
  var headTone = "unknown"
  var headEngine: String?
  var used: String?
  var resets: String?
  var fraction: Double?
  var barText: String?
  var ring: Double?
  var limits: [LimitRow] = []
  var runningTitle: String?
  var runningSummary: String?
  var sessions: [SessionRow] = []
  var flag: FlagRow?
  var updatedText: String?
  // Read only from combined.json, the fallback.
  var sentence: String?
  var menu: String?
  var updated: Date?
  var notice: Notice = .none
  var refreshing = false
  var now = Date()

  static let low = 15.0
  static let glanceSchema = "observatory-glance/1"
  // Copies of lib/freshness.mjs. test/repo-rules.test.mjs checks they match.
  static let readingFresh: TimeInterval = 10 * 60
  static let deviceFresh: TimeInterval = 15 * 60

  var old: Bool { updated.map { now.timeIntervalSince($0) > Self.deviceFresh } ?? false }
  var empty: Bool { headline == nil && limits.isEmpty }

  static func date(_ value: Any?) -> Date? {
    guard let text = value as? String else { return nil }
    return ISO8601DateFormatter.withFractions.date(from: text) ?? ISO8601DateFormatter().date(from: text)
  }

  static func number(_ value: Any?) -> Double? {
    guard let value = value as? Double, value.isFinite, value >= 0 else { return nil }
    return value
  }

  static func share(_ value: Any?) -> Double? { number(value).flatMap { $0 <= 1 ? $0 : nil } }


  // Keep this pure rule in sync with lib/glance-limits.mjs and the Windows app.
  static func limitRemaining(_ row: [String: Any], now: Date) -> Double? {
    guard row["stale"] as? Bool == false,
          let remaining = row["remaining"] as? Double, remaining.isFinite, remaining >= 0, remaining <= 100,
          let checked = date(row["checkedAt"]),
          now >= checked, now.timeIntervalSince(checked) < readingFresh else { return nil }
    if let reset = date(row["resetsAt"]), reset <= now { return nil }
    return remaining
  }

  // glance.json: drawn as it is.
  static func parseGlance(_ json: [String: Any], now: Date) -> PanelState {
    var state = PanelState(now: now)
    state.updated = date(json["updatedAt"])
    state.updatedText = json["updated"] as? String
    // Nothing read yet: the first-run notice, the same as with no snapshot at all.
    if json["collecting"] as? Bool == true { state.notice = .collecting }
    let bar = json["bar"] as? [String: Any] ?? [:]
    state.ring = share(bar["ring"])
    state.barText = bar["showPercent"] as? Bool == true ? bar["text"] as? String : nil
    let head = json["headline"] as? [String: Any] ?? [:]
    state.headline = head["text"] as? String
    state.headTone = head["tone"] as? String ?? "unknown"
    state.headEngine = head["engine"] as? String
    state.used = head["used"] as? String
    state.resets = head["resets"] as? String
    state.fraction = share(head["fraction"])
    state.limits = (json["limits"] as? [[String: Any]] ?? []).enumerated().map { index, row in
      LimitRow(id: "\(index)", engine: row["engine"] as? String ?? "", name: row["name"] as? String ?? "Unknown",
               fraction: share(row["fraction"]), percent: row["percent"] as? String ?? "Unknown",
               resets: row["resets"] as? String, tone: row["tone"] as? String ?? "muted")
    }
    if let running = json["running"] as? [String: Any] {
      state.runningTitle = running["title"] as? String
      state.runningSummary = running["summary"] as? String
      state.sessions = (running["sessions"] as? [[String: Any]] ?? []).enumerated().map { index, row in
        SessionRow(id: index, title: row["title"] as? String ?? "Unknown", machine: row["machine"] as? String ?? "",
                   rate: row["rate"] as? String ?? "Unknown")
      }
    }
    if let flag = json["flag"] as? [String: Any], let text = flag["text"] as? String {
      state.flag = FlagRow(count: (flag["count"] as? Int) ?? 1, subject: flag["subject"] as? String, text: text)
    }
    return state
  }

  // combined.json, when glance.json is missing: the forecast and the limit rows, no sessions or flag.
  static func parse(_ json: [String: Any], now: Date) -> PanelState {
    var state = PanelState(now: now)
    state.updated = date(json["generatedAt"])
    guard let glance = json["glance"] as? [String: Any] else { state.notice = .collecting; return state }
    var engines: [EngineRow] = []
    if let forecast = glance["forecast"] as? [String: Any] {
      state.sentence = forecast["sentence"] as? String
      state.menu = forecast["menu"] as? String
      let scarce = (forecast["scarce"] as? [String: Any])?["engine"] as? String
      engines = (forecast["engines"] as? [[String: Any]] ?? []).map { row in
        EngineRow(id: row["engine"] as? String ?? "", name: row["name"] as? String ?? "Unknown", status: row["status"] as? String ?? "unknown",
                  remaining: (row["remaining"] as? Double).flatMap { $0.isFinite && $0 >= 0 && $0 <= 100 ? $0 : nil }, headline: row["headline"] as? String,
                  window: row["window"] as? String, resets: row["resets"] as? String)
      }
      // The stored words only. A combined.json from before they were stored reads Unknown.
      if let engine = engines.first(where: { $0.id == scarce }) {
        state.headline = engine.headline ?? "Unknown"
        state.resets = engine.resets
        state.headTone = engine.status
        state.headEngine = engine.id
      } else {
        state.headline = forecast["asOf"] is String ? state.sentence : "Unknown"
      }
    }
    let names = Dictionary(engines.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
    let lead = engines.first { $0.id == state.headEngine }
    for (index, row) in (glance["limits"] as? [[String: Any]] ?? []).enumerated() {
      let provider = row["provider"] as? String ?? "", window = row["window"] as? String ?? ""
      if window.isEmpty || row["absent"] is String { continue }
      let used = limitRemaining(row, now: now).map { (100 - $0).rounded() }
      if let lead, provider == lead.id, window == lead.window, state.fraction == nil {
        state.fraction = used.map { $0 / 100 }
        state.ring = state.fraction
        if let used, lead.status == "out" || lead.status == "runs-out" { state.barText = "\(Int(used))%" }
        continue
      }
      state.limits.append(LimitRow(id: "\(index)", engine: provider, name: (names[provider] ?? row["name"] as? String ?? "Unknown") + " " + window,
                                   fraction: used.map { $0 / 100 }, percent: used.map { "\(Int($0))%" } ?? "Unknown", resets: nil,
                                   tone: used == nil ? "muted" : row["spent"] as? Bool == true ? "out" : row["low"] as? Bool == true ? "low" : "normal"))
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
  // The live panel sits on the system popover material. A render to PNG has no window behind it.
  var opaque = false
  @Environment(\.colorScheme) private var scheme

  static let width: CGFloat = 336

  // The headline bar takes the forecast's tone: out reads as an error, runs-out as a warning.
  func tone(_ state: PanelState, _ palette: Palette) -> Color {
    let engine = (status: state.headTone, id: state.headEngine ?? "")
    return state.old ? palette.muted : engine.status == "out" ? palette.error : engine.status == "runs-out" ? palette.warning : palette.provider(engine.id)
  }

  func limitTone(_ row: LimitRow, _ palette: Palette) -> Color {
    row.tone == "out" ? palette.error : row.tone == "low" ? palette.warning : row.tone == "muted" ? palette.muted : palette.text
  }

  func bar(_ fraction: Double?, _ color: Color, _ palette: Palette, height: CGFloat) -> some View {
    GeometryReader { geometry in
      ZStack(alignment: .leading) {
        Capsule().fill(palette.track)
        if let fraction, fraction > 0 {
          Capsule().fill(color).frame(width: max(height, geometry.size.width * CGFloat(min(1, fraction))))
        }
      }
    }
    .frame(height: height)
  }

  var body: some View {
    let palette = Palette.of(scheme)
    let state = model.state
    VStack(alignment: .leading, spacing: 10) {
      switch state.notice {
      case .setupMissing: message("Settings are missing. Run npm run setup again.", palette)
      case .nodeMissing: message("Node was not found. Run npm run setup again.", palette)
      case .collecting: message("Collecting the first reading…", palette)
      case .none:
        if state.empty {
          message("Collecting the first reading…", palette)
        } else {
          content(state, palette).opacity(state.old ? 0.6 : 1)
        }
      }
      Divider()
      footer(state, palette)
    }
    .padding(.horizontal, 14)
    .padding(.top, 13)
    .padding(.bottom, 12)
    .frame(width: Self.width, alignment: .leading)
    .background(opaque ? palette.background : Color.clear)
    .foregroundStyle(palette.text)
    .font(.system(size: 13))
    .background(shortcuts)
  }

  @ViewBuilder func content(_ state: PanelState, _ palette: Palette) -> some View {
    VStack(alignment: .leading, spacing: 5) {
      Text(state.headline ?? "Unknown").font(.system(size: 14.5, weight: .semibold)).fixedSize(horizontal: false, vertical: true)
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text(state.used ?? "")
        Spacer(minLength: 8)
        if let resets = state.resets { Text(resets) }
      }
      .font(.system(size: 12)).foregroundStyle(palette.muted)
      bar(state.fraction, tone(state, palette), palette, height: 6).padding(.top, 3)
    }
    .accessibilityElement(children: .combine)
    if !state.limits.isEmpty {
      Divider()
      VStack(alignment: .leading, spacing: 7) {
        ForEach(state.limits) { row in
          HStack(spacing: 8) {
            Circle().fill(palette.provider(row.engine)).frame(width: 7, height: 7)
            Text(row.name).lineLimit(1).truncationMode(.tail).layoutPriority(1)
            Spacer(minLength: 0)
            bar(row.fraction, palette.provider(row.engine), palette, height: 4).frame(width: 48)
            Text(row.percent).monospacedDigit().foregroundStyle(limitTone(row, palette)).lineLimit(1).fixedSize().frame(minWidth: 36, alignment: .trailing)
            Text(row.resets ?? "").font(.system(size: 11.5)).foregroundStyle(palette.muted).lineLimit(1).fixedSize().frame(width: 70, alignment: .trailing)
          }
          .accessibilityElement(children: .combine)
        }
      }
    }
    if let title = state.runningTitle {
      Divider()
      VStack(alignment: .leading, spacing: 7) {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          Text(title).fontWeight(.semibold)
          Spacer(minLength: 8)
          Text(state.runningSummary ?? "")
        }
        .font(.system(size: 12)).foregroundStyle(palette.muted)
        ForEach(state.sessions) { session in
          HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("\(Text(session.title))  \(Text(session.machine).font(.system(size: 11.5)).foregroundColor(palette.muted))")
              .lineLimit(1).truncationMode(.tail)
            Spacer(minLength: 8)
            Text(session.rate).monospacedDigit()
          }
          .accessibilityElement(children: .combine)
        }
      }
    }
    if let flag = state.flag {
      Divider()
      HStack(alignment: .top, spacing: 9) {
        Text("\(flag.count)").font(.system(size: 10.5, weight: .semibold)).monospacedDigit()
          .foregroundStyle(scheme == .dark ? Color.black.opacity(0.8) : Color.white)
          .frame(width: 18, height: 18)
          .background(RoundedRectangle(cornerRadius: 5, style: .continuous).fill(palette.warning))
        if let subject = flag.subject {
          Text("\(Text(subject).fontWeight(.semibold)) \(flag.text)")
        } else {
          Text(flag.text)
        }
      }
      .fixedSize(horizontal: false, vertical: true)
      .accessibilityElement(children: .combine)
    }
  }

  func message(_ text: String, _ palette: Palette) -> some View {
    Text(text).foregroundStyle(palette.muted).fixedSize(horizontal: false, vertical: true).padding(.vertical, 4)
  }

  func footer(_ state: PanelState, _ palette: Palette) -> some View {
    HStack(spacing: 8) {
      Button("Open dashboard", action: model.openDashboard)
        .buttonStyle(Push(palette: palette)).keyboardShortcut("d")
      Spacer(minLength: 8)
      if state.refreshing { ProgressView().controlSize(.small).scaleEffect(0.7) }
      if state.old, let updated = state.updated {
        Text("Updated \(Format.age(state.now.timeIntervalSince(updated)))").foregroundStyle(palette.warning)
      } else if let text = state.updatedText {
        Text(text).foregroundStyle(palette.muted)
      }
    }
    .font(.system(size: 12))
  }

  // Refresh and Quit live in the right-click menu. Their keys still work while the panel is open.
  var shortcuts: some View {
    ZStack {
      Button("Refresh", action: model.refresh).keyboardShortcut("r")
      Button("Quit Observatory", action: model.quit).keyboardShortcut("q")
    }
    .opacity(0).frame(width: 0, height: 0).accessibilityHidden(true)
  }
}

// A macOS push button drawn in SwiftUI, so a render to PNG shows it too.
struct Push: ButtonStyle {
  let palette: Palette
  @Environment(\.colorScheme) private var scheme

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: 13))
      .padding(.horizontal, 11)
      .frame(minHeight: 24)
      .fixedSize()
      .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(scheme == .dark ? Color.white.opacity(0.14) : Color.white))
      .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(palette.hairline))
      .shadow(color: .black.opacity(scheme == .dark ? 0 : 0.08), radius: 0.5, y: 0.5)
      .opacity(configuration.isPressed ? 0.6 : 1)
      .contentShape(RoundedRectangle(cornerRadius: 6))
  }
}

// The menu bar glyph: a ring filled to the share used of the scarcer limit.
enum Ring {
  static func image(_ fraction: Double, size: CGFloat = 16) -> NSImage {
    let image = NSImage(size: NSSize(width: size, height: size), flipped: false) { rect in
      let line: CGFloat = 2.2
      let box = rect.insetBy(dx: line / 2 + 0.5, dy: line / 2 + 0.5)
      let track = NSBezierPath(ovalIn: box)
      track.lineWidth = line
      NSColor.black.withAlphaComponent(0.3).setStroke()
      track.stroke()
      let share = CGFloat(min(1, max(0, fraction)))
      if share > 0 {
        let arc = NSBezierPath()
        arc.appendArc(withCenter: NSPoint(x: rect.midX, y: rect.midY), radius: box.width / 2, startAngle: 90, endAngle: 90 - 360 * share, clockwise: true)
        arc.lineWidth = line
        arc.lineCapStyle = .round
        NSColor.black.setStroke()
        arc.stroke()
      }
      return true
    }
    image.isTemplate = true
    image.accessibilityDescription = "Observatory"
    return image
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
    // The system popover material, so the panel looks like the other menu bar extras in light and dark.
    let clip = NSVisualEffectView()
    clip.material = .popover
    clip.blendingMode = .behindWindow
    clip.state = .active
    clip.wantsLayer = true
    clip.layer?.cornerRadius = 12
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
    menu.addItem(withTitle: "Open dashboard", action: #selector(openFromMenu), keyEquivalent: "").target = self
    menu.addItem(withTitle: "Refresh", action: #selector(runTick), keyEquivalent: "").target = self
    menu.addItem(.separator())
    menu.addItem(withTitle: "Quit Observatory", action: #selector(quitFromMenu), keyEquivalent: "").target = self
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

  let menu = NSMenu()
  @objc func openFromMenu() { openDashboard() }
  @objc func quitFromMenu() { NSApp.terminate(nil) }

  func localFile(_ name: String) -> URL? {
    guard let settings else { return nil }
    return URL(fileURLWithPath: settings.dataFolder).appendingPathComponent("public/local/" + name)
  }

  static func json(_ file: URL?) -> [String: Any]? {
    guard let file, let data = try? Data(contentsOf: file) else { return nil }
    return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
  }

  // glance.json from the tick is drawn as it is. Without it (an older collector, or a failed glance step) the
  // panel falls back to the forecast in combined.json.
  static func state(glance: [String: Any]?, combined: () -> [String: Any]?, now: Date) -> PanelState? {
    if let glance, glance["schema"] as? String == PanelState.glanceSchema { return PanelState.parseGlance(glance, now: now) }
    return combined().map { PanelState.parse($0, now: now) }
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
    } else if let read = Self.state(glance: Self.json(localFile("glance.json")), combined: { Self.json(self.localFile("combined.json")) }, now: Date()) {
      state = read
    } else {
      state = PanelState(notice: .collecting)
    }
    if nodeMissing { state.notice = .nodeMissing }
    state.refreshing = tick?.isRunning == true
    model.state = state
    let current = state.notice == .none && !state.old && !state.empty
    item.button?.appearsDisabled = !current
    // A ring filled to the scarcer limit. The percent used shows beside it only while that limit is forecast to run
    // out before it resets. With no current share the telescope stands in, never an empty ring.
    item.button?.image = current && state.ring != nil ? Ring.image(state.ring ?? 0) : Brand.mark(size: 18)
    item.button?.title = current ? (state.barText.map { " " + $0 } ?? "") : ""
    item.button?.imagePosition = .imageLeading
    item.button?.toolTip = current ? state.headline ?? state.menu ?? "Observatory" : "Observatory: not updated recently"
    fitPanel()
  }

  var closedAt = Date.distantPast

  @objc func toggle() {
    if NSApp.currentEvent?.type == .rightMouseUp, let button = item.button {
      closePanel()
      menu.popUp(positioning: nil, at: NSPoint(x: 0, y: button.bounds.height + 5), in: button)
      return
    }
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

// `Observatory --render glance.json|combined.json out.png light|dark [now-iso]` draws the panel to a PNG
// without a menu bar, for checking the layout and for documentation screenshots.
@MainActor func render(_ arguments: [String]) -> Int32 {
  guard arguments.count >= 4, let data = FileManager.default.contents(atPath: arguments[1]),
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
    FileHandle.standardError.write("usage: --render glance.json out.png light|dark [now]\n".data(using: .utf8)!)
    return 2
  }
  let now = arguments.count > 4 ? PanelState.date(arguments[4]) ?? Date() : Date()
  let model = PanelModel()
  model.state = Glance.state(glance: json, combined: { json }, now: now) ?? PanelState(notice: .collecting)
  let scheme: ColorScheme = arguments[3] == "dark" ? .dark : .light
  let renderer = ImageRenderer(content: PanelView(model: model, opaque: true).environment(\.colorScheme, scheme))
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
