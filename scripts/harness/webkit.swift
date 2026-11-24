// Loads a page in an offscreen WKWebView, the engine Safari uses, runs a script in it (the body of an async
// function) and prints what it returns.
// Optionally writes a snapshot of the window. macOS only. test/webkit-layout.test.mjs and test/layout.test.mjs
// build and run it.
// Usage: webkit <url> <width> <height> <script> [out.png]
//        webkit --batch <jobs.json> <script>
// A batch runs the script in one page after another, each in a new view, and prints one line per page. The jobs
// file is a list of {"url", "width", "height", "scheme"}, scheme being "light" or "dark" (dark by default).
import AppKit
import WebKit

struct Job: Decodable { let url: String; let width: Double; let height: Double; let scheme: String? }

let args = CommandLine.arguments
func usage() -> Never {
  FileHandle.standardError.write("usage: webkit <url> <width> <height> <script> [out.png]\n       webkit --batch <jobs.json> <script>\n".data(using: .utf8)!)
  exit(2)
}

func fail(_ message: String) -> Never {
  print("error: \(message)")
  FileHandle.standardError.write("webkit: \(message)\n".data(using: .utf8)!)
  exit(1)
}

// Measures once the page has finished loading, never on a timer, so a slow machine cannot measure mid-navigation.
// The script is the body of an async function, so it can wait for the page to draw before it measures.
final class Loader: NSObject, WKNavigationDelegate {
  let url: URL, script: String, out: String?, done: () -> Void
  init(url: URL, script: String, out: String?, done: @escaping () -> Void) { self.url = url; self.script = script; self.out = out; self.done = done }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { outcome in
      switch outcome {
      case .success(let result): print(result)
      case .failure(let error): fail("the script failed: \(error.localizedDescription)")
      }
      guard let out = self.out else { return self.done() }
      webView.takeSnapshot(with: nil) { image, _ in
        if let image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
           let png = rep.representation(using: .png, properties: [:]) {
          try? png.write(to: URL(fileURLWithPath: out))
        }
        self.done()
      }
    }
  }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    fail("navigation to \(url.absoluteString) failed: \(error.localizedDescription)")
  }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    fail("could not load \(url.absoluteString): \(error.localizedDescription)")
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
// The view, window and loader of the page being measured: kept here so they live until it is done.
var current: (WKWebView, NSWindow, Loader)?

/// Opens one page in a new offscreen view. `scheme` sets light or dark; nil leaves the system's.
func open(_ url: URL, width: Double, height: Double, scheme: String?, script: String, out: String?, done: @escaping () -> Void) {
  let view = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height), configuration: WKWebViewConfiguration())
  let window = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
  if let scheme { window.appearance = NSAppearance(named: scheme == "light" ? .aqua : .darkAqua) }
  window.contentView = view
  let loader = Loader(url: url, script: script, out: out, done: done)
  view.navigationDelegate = loader
  current = (view, window, loader)
  view.load(URLRequest(url: url))
}

if args.count == 4, args[1] == "--batch" {
  guard let data = FileManager.default.contents(atPath: args[2]), let jobs = try? JSONDecoder().decode([Job].self, from: data) else { fail("could not read the jobs in \(args[2])") }
  var next = 0
  var watchdog: DispatchWorkItem?
  func step() {
    watchdog?.cancel()
    guard next < jobs.count else { exit(0) }
    let job = jobs[next]
    next += 1
    guard let url = URL(string: job.url) else { fail("not an address: \(job.url)") }
    // The script waits at most 15 s for the page to draw. This stops a page that never finishes loading.
    let timer = DispatchWorkItem { fail("\(job.url) at \(Int(job.width)) timed out after 45 s") }
    watchdog = timer
    DispatchQueue.main.asyncAfter(deadline: .now() + 45, execute: timer)
    open(url, width: job.width, height: job.height, scheme: job.scheme ?? "dark", script: args[3], out: nil) { DispatchQueue.main.async { step() } }
  }
  step()
} else {
  guard args.count >= 5, let url = URL(string: args[1]), let width = Double(args[2]), let height = Double(args[3]) else { usage() }
  open(url, width: width, height: height, scheme: nil, script: args[4], out: args.count > 5 ? args[5] : nil) { exit(0) }
  // The script waits at most 15 s for the plots. This stops a page that never finishes loading.
  DispatchQueue.main.asyncAfter(deadline: .now() + 45) { fail("timed out after 45 s") }
}
app.run()
