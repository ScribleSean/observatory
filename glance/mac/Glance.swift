// Observatory menu bar item. It runs the five-minute tick, shows the glance
// block from combined.json, and opens the read-only dashboard in the browser.
// Built locally by `npm run setup`. Settings come from glance.json beside the binary.
import AppKit

struct Settings: Decodable {
  let node: String
  let repo: String
  let config: String
  let dataFolder: String
  let port: Int
}

final class Glance: NSObject, NSApplicationDelegate, NSMenuDelegate {
  let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
  var settings: Settings?
  var tick: Process?
  var server: Process?
  var lastTitle = "…"

  func applicationDidFinishLaunching(_ note: Notification) {
    let file = Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/glance.json")
    if let data = try? Data(contentsOf: file) { settings = try? JSONDecoder().decode(Settings.self, from: data) }
    item.button?.image = NSImage(systemSymbolName: "binoculars", accessibilityDescription: "Observatory")
    item.button?.imagePosition = .imageLeading
    let menu = NSMenu()
    menu.delegate = self
    item.menu = menu
    show()
    runTick()
    // Collect and combine every five minutes. Reread the file more often,
    // because the hub may write a new combined.json at any time.
    Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in self?.runTick() }
    Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in self?.show() }
  }

  func applicationWillTerminate(_ note: Notification) {
    server?.terminate()
  }

  var combinedFile: URL? {
    guard let settings else { return nil }
    return URL(fileURLWithPath: settings.dataFolder).appendingPathComponent("public/local/combined.json")
  }

  func node(_ arguments: [String], done: (() -> Void)? = nil) -> Process? {
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
    process.terminationHandler = { _ in DispatchQueue.main.async { done?() } }
    do { try process.run() } catch { return nil }
    return process
  }

  @objc func runTick() {
    if tick?.isRunning == true { return }
    guard let settings else { return }
    tick = node([settings.repo + "/scripts/tick.mjs"]) { [weak self] in self?.tick = nil; self?.show() }
    show()
  }

  func menuWillOpen(_ menu: NSMenu) { show() }

  func show() {
    guard let menu = item.menu else { return }
    menu.removeAllItems()
    var title = "?"
    var stale = true
    func line(_ text: String) {
      let row = NSMenuItem(title: text, action: nil, keyEquivalent: "")
      row.isEnabled = false
      menu.addItem(row)
    }
    if settings == nil {
      line("glance.json is missing. Run npm run setup again.")
    } else if let file = combinedFile, let data = try? Data(contentsOf: file),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let glance = json["glance"] as? [String: Any] {
      title = glance["title"] as? String ?? title
      for text in glance["lines"] as? [String] ?? [] {
        if text.isEmpty { menu.addItem(.separator()) } else { line(text) }
      }
      menu.addItem(.separator())
      if let generated = json["generatedAt"] as? String, let at = ISO8601DateFormatter.withFractions.date(from: generated) {
        let age = Date().timeIntervalSince(at)
        stale = age > 15 * 60
        line(stale ? "Combined \(Glance.span(age)) ago, not updated recently" : "Combined \(Glance.span(age)) ago")
      } else {
        line("Combined: Unknown time")
      }
      if let hub = json["hub"] as? [String: Any], let spokes = hub["spokes"] as? [[String: Any]] {
        for spoke in spokes where (spoke["pull"] as? String) != "ok" {
          line("\(spoke["name"] as? String ?? "Spoke"): \(spoke["pull"] as? String ?? "Unknown")")
        }
      }
    } else {
      line("No combined.json yet. The first collection is running.")
    }
    if tick?.isRunning == true { line("Refreshing…") }
    menu.addItem(.separator())
    let open = NSMenuItem(title: "Open dashboard", action: #selector(openDashboard), keyEquivalent: "d")
    open.target = self
    menu.addItem(open)
    let refresh = NSMenuItem(title: "Refresh", action: #selector(runTick), keyEquivalent: "r")
    refresh.target = self
    refresh.isEnabled = tick?.isRunning != true
    menu.addItem(refresh)
    menu.addItem(NSMenuItem(title: "Quit Observatory", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
    // Short title: one number, the lowest limit left. The menu has the rest.
    lastTitle = title
    item.button?.title = stale ? " \(title)?" : " \(title)"
    item.button?.toolTip = stale ? "Observatory: not updated recently" : "Observatory: lowest limit left"
  }

  static func span(_ seconds: TimeInterval) -> String {
    let minutes = Int(seconds / 60)
    if minutes < 1 { return "less than a minute" }
    if minutes < 60 { return "\(minutes) min" }
    return "\(minutes / 60) h \(minutes % 60) min"
  }

  @objc func openDashboard() {
    guard let settings, let url = URL(string: "http://127.0.0.1:\(settings.port)/") else { return }
    reachable(url) { [weak self] up in
      guard let self else { return }
      if up { NSWorkspace.shared.open(url); return }
      if self.server?.isRunning != true {
        self.server = self.node([settings.repo + "/serve-local.mjs"]) { [weak self] in self?.server = nil }
      }
      // Give the server a moment to listen before the browser asks.
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

let app = NSApplication.shared
let delegate = Glance()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
