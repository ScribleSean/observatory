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

// What the icon shows once glance.json is old: its last value and when it was read.
struct StaleIcon: Equatable {
  let fraction: Double?
  let text: String
  let tip: String
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
  // The menu bar icon, as lib/glance-view.mjs decided it (glance.json "icon"). Off until a glance.json says otherwise.
  var icon = Mark.State.off
  var iconFraction: Double?
  var iconText = "Off"
  var iconTip = "Off"
  var iconStale: StaleIcon?
  var accent = false
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

  // The icon to draw now: as stored, or its stored stale form once glance.json is older than a snapshot may be.
  var shownIcon: (state: Mark.State, fraction: Double?, text: String, tip: String) {
    if old, let stale = iconStale { return (.stale, stale.fraction, stale.text, stale.tip) }
    return (icon, iconFraction, iconText, iconTip)
  }
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
    if let icon = json["icon"] as? [String: Any], let shape = Mark.State(rawValue: icon["state"] as? String ?? "") {
      state.icon = shape
      state.iconFraction = share(icon["fraction"])
      state.iconText = icon["text"] as? String ?? "Off"
      state.iconTip = icon["tip"] as? String ?? state.iconText
      if let stale = icon["stale"] as? [String: Any], let text = stale["text"] as? String {
        state.iconStale = StaleIcon(fraction: share(stale["fraction"]), text: text, tip: stale["tip"] as? String ?? text)
      }
      state.accent = icon["accent"] as? Bool == true
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

// The ring and dot: the mark, the app icons and the live menu bar icon, from one geometry (lib/glance-icon.mjs).
// The ring is the share of the Claude weekly limit used, from 12 o'clock clockwise. The center is the state, decided once
// by lib/glance-view.mjs: a dot on pace, a bar over pace, a hollow dot when stale, nothing when off.
// test/glance-icon.test.mjs checks these numbers and formulas against lib/glance-icon.mjs and glance/windows/Glance.cs.
enum Mark {
  enum State: String { case onPace = "on-pace", overPace = "over-pace", stale, off }

  static let trackAlpha: CGFloat = 0.28
  static let staleAlpha: CGFloat = 0.45
  static let textDim: CGFloat = 0.55
  static let minArc = 0.04
  static let gap: CGFloat = 5
  static let fontSize: CGFloat = 13
  static let tileRadius: CGFloat = 0.225
  static let accentDark: UInt32 = 0xd97f57
  static let accentLight: UInt32 = 0xb5562c
  static let tileDark: UInt32 = 0x161715
  static let tileLight: UInt32 = 0xefece7
  static let menuBarSide: CGFloat = 18

  static func color(_ hex: UInt32) -> NSColor {
    NSColor(srgbRed: CGFloat(hex >> 16 & 255) / 255, green: CGFloat(hex >> 8 & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: 1)
  }

  // Glance icon of side s: padding round(s/16), diameter s - 2p, stroke round(d/7), centerline radius (d - w)/2.
  static func glance(_ side: CGFloat) -> (p: CGFloat, d: CGFloat, w: CGFloat, r: CGFloat, c: CGFloat) {
    let p = (side / 16).rounded(), d = side - 2 * p, w = (d / 7).rounded()
    return (p, d, w, (d - w) / 2, side / 2)
  }

  // App icon of side s: the mark's diameter, stroke and dot radius. 32 and 16 sit on whole pixels.
  static func app(_ side: CGFloat) -> (d: CGFloat, w: CGFloat, dot: CGFloat) {
    if side == 16 { return (12, 2, 2) }
    if side == 32 { return (20, 3, 3) }
    return (side / 2, side / 14, side / 14)
  }

  static func circle(_ c: CGFloat, _ r: CGFloat) -> NSBezierPath {
    NSBezierPath(ovalIn: NSRect(x: c - r, y: c - r, width: 2 * r, height: 2 * r))
  }

  // The glance icon in a side by side box at the origin. `ink` is the track and the stale marks, `mark` the arc and center.
  static func drawGlance(side: CGFloat, state: State, fraction: Double?, ink: NSColor, mark: NSColor) {
    let g = glance(side)
    let track = circle(g.c, g.r)
    track.lineWidth = g.w
    ink.withAlphaComponent(trackAlpha).setStroke()
    track.stroke()
    if state == .off { return }
    let tint = state == .stale ? ink.withAlphaComponent(staleAlpha) : mark
    if let fraction {
      let share = CGFloat(min(1, max(minArc, fraction)))
      let arc = share >= 1 ? circle(g.c, g.r) : NSBezierPath()
      if share < 1 {
        arc.appendArc(withCenter: NSPoint(x: g.c, y: g.c), radius: g.r, startAngle: 90, endAngle: 90 - 360 * share, clockwise: true)
      }
      arc.lineWidth = g.w
      arc.lineCapStyle = .butt
      tint.setStroke()
      arc.stroke()
    }
    switch state {
    case .onPace:
      tint.setFill()
      circle(g.c, g.w).fill()
    case .overPace:
      tint.setFill()
      NSBezierPath(roundedRect: NSRect(x: g.c - g.w / 2, y: g.c - 1.5 * g.w, width: g.w, height: 3 * g.w), xRadius: g.w / 2, yRadius: g.w / 2).fill()
    case .stale:
      let hollow = circle(g.c, g.w)
      hollow.lineWidth = g.w / 2
      tint.setStroke()
      hollow.stroke()
    case .off: break
    }
  }

  // The menu bar item: the icon at 18 and the number beside it in one style. The template variant is black with alpha
  // only, so the system tints it for every menu bar. The accent variant picks its colors for the bar it is drawn on.
  static func menuBar(state: State, fraction: Double?, text: String, accent: Bool) -> NSImage {
    let side = menuBarSide
    let font = NSFont.monospacedDigitSystemFont(ofSize: fontSize, weight: .medium)
    let label = NSAttributedString(string: text, attributes: [.font: font])
    let width = (side + gap + label.size().width).rounded(.up)
    let live = state == .onPace || state == .overPace
    let image = NSImage(size: NSSize(width: width, height: side), flipped: false) { _ in
      let dark = NSAppearance.currentDrawing().bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
      let ink: NSColor = accent && dark ? .white : .black
      let tone = color(dark ? accentDark : accentLight)
      drawGlance(side: side, state: state, fraction: fraction, ink: ink, mark: accent && live ? tone : ink)
      let number = accent && state == .overPace ? tone : ink.withAlphaComponent(live ? 1 : textDim)
      let size = label.size()
      NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: number])
        .draw(at: NSPoint(x: side + gap, y: ((side - size.height) / 2).rounded()))
      return true
    }
    image.isTemplate = !accent
    image.accessibilityDescription = "Observatory"
    return image
  }

  // The app icon: a rounded tile and the mark, light or dark.
  static func drawApp(side: CGFloat, light: Bool) {
    color(light ? tileLight : tileDark).setFill()
    NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: side, height: side), xRadius: side * tileRadius, yRadius: side * tileRadius).fill()
    let g = app(side), tone = color(light ? accentLight : accentDark)
    let ring = circle(side / 2, (g.d - g.w) / 2)
    ring.lineWidth = g.w
    tone.setStroke()
    ring.stroke()
    tone.setFill()
    circle(side / 2, g.dot).fill()
  }

  // Draws into an exact pixel grid, so 16 and 32 land on whole pixels.
  static func png(pixels: Int, draw: () -> Void) -> Data? {
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4,
                                     hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
    rep.size = NSSize(width: pixels, height: pixels)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    draw()
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])
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
    item.button?.image = Mark.menuBar(state: .off, fraction: nil, text: "Off", accent: false)
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
    // The ring and its number, as glance.json says. The state is in the icon, so the button is never greyed out.
    let icon = state.shownIcon
    item.button?.image = Mark.menuBar(state: icon.state, fraction: icon.fraction, text: icon.text, accent: state.accent)
    item.button?.title = ""
    item.button?.imagePosition = .imageOnly
    item.button?.setAccessibilityLabel("Observatory, " + icon.tip)
    item.button?.toolTip = icon.tip + "\n" + (current ? state.headline ?? state.menu ?? "Observatory" : "Observatory: not updated recently")
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

// `Observatory --render-icon glance.json out.png [now-iso]` draws the menu bar item for that glance.json at 2x: the
// template image on a light and a dark bar (tinted the way the system tints it), then the accent variant on each.
@MainActor func renderIcon(_ arguments: [String]) -> Int32 {
  guard arguments.count >= 3, let data = FileManager.default.contents(atPath: arguments[1]),
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
    FileHandle.standardError.write("usage: --render-icon glance.json out.png [now]\n".data(using: .utf8)!)
    return 2
  }
  let now = arguments.count > 3 ? PanelState.date(arguments[3]) ?? Date() : Date()
  let state = Glance.state(glance: json, combined: { json }, now: now) ?? PanelState(notice: .collecting)
  let icon = state.shownIcon
  let bars: [(accent: Bool, dark: Bool)] = [(false, false), (false, true), (true, false), (true, true)]
  let images = bars.map { Mark.menuBar(state: icon.state, fraction: icon.fraction, text: icon.text, accent: $0.accent) }
  let cell = NSSize(width: (images.map(\.size.width).max() ?? 18) + 16, height: 26)
  let scale = 2
  guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(cell.width) * scale, pixelsHigh: Int(cell.height) * 4 * scale,
                                   bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                   bytesPerRow: 0, bitsPerPixel: 0) else { return 1 }
  rep.size = NSSize(width: cell.width, height: cell.height * 4)
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  for (index, bar) in bars.enumerated() {
    let row = NSRect(x: 0, y: CGFloat(3 - index) * cell.height, width: cell.width, height: cell.height)
    (bar.dark ? NSColor(white: 0.12, alpha: 1) : NSColor(white: 0.93, alpha: 1)).setFill()
    row.fill()
    let image = images[index], box = NSRect(x: 8, y: row.minY + 4, width: image.size.width, height: image.size.height)
    NSAppearance(named: bar.dark ? .darkAqua : .aqua)!.performAsCurrentDrawingAppearance {
      if image.isTemplate {
        // The system draws a template image in the bar's text color, keeping its alpha.
        let tinted = NSImage(size: image.size, flipped: false) { rect in
          image.draw(in: rect)
          (bar.dark ? NSColor.white : NSColor.black).set()
          rect.fill(using: .sourceAtop)
          return true
        }
        tinted.draw(in: box)
      } else {
        image.draw(in: box)
      }
    }
  }
  NSGraphicsContext.restoreGraphicsState()
  guard let png = rep.representation(using: .png, properties: [:]) else { return 1 }
  do { try png.write(to: URL(fileURLWithPath: arguments[2])) } catch { return 1 }
  return 0
}

// `Observatory --app-icons folder` writes icon-<side>-light.png and icon-<side>-dark.png. scripts/make-icons.mjs
// packs them into glance/icons (`npm run icons`).
@MainActor func appIcons(_ arguments: [String]) -> Int32 {
  guard arguments.count >= 2 else { return 2 }
  let folder = URL(fileURLWithPath: arguments[1])
  for side in [16, 24, 32, 48, 64, 128, 256, 512, 1024] {
    for light in [false, true] {
      guard let png = Mark.png(pixels: side, draw: { Mark.drawApp(side: CGFloat(side), light: light) }) else { return 1 }
      do { try png.write(to: folder.appendingPathComponent("icon-\(side)-\(light ? "light" : "dark").png")) } catch { return 1 }
    }
  }
  return 0
}

let arguments = CommandLine.arguments
if let flag = arguments.firstIndex(of: "--render-icon") {
  exit(MainActor.assumeIsolated { renderIcon(Array(arguments[flag...])) })
}
if let flag = arguments.firstIndex(of: "--app-icons") {
  exit(MainActor.assumeIsolated { appIcons(Array(arguments[flag...])) })
}
if let flag = arguments.firstIndex(of: "--render") {
  exit(MainActor.assumeIsolated { render(Array(arguments[flag...])) })
}
let app = NSApplication.shared
let delegate = Glance()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
