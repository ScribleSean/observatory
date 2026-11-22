// Loads a page in an offscreen WKWebView, the engine Safari uses, runs a script in it (the body of an async
// function) and prints what it returns.
// Optionally writes a snapshot of the window. macOS only. test/webkit-layout.test.mjs builds and runs it.
// Usage: webkit <url> <width> <height> <script> [out.png]
import AppKit
import WebKit

let args = CommandLine.arguments
guard args.count >= 5, let url = URL(string: args[1]), let width = Double(args[2]), let height = Double(args[3]) else {
  FileHandle.standardError.write("usage: webkit <url> <width> <height> <script> [out.png]\n".data(using: .utf8)!)
  exit(2)
}
let script = args[4], out = args.count > 5 ? args[5] : nil
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let view = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height), configuration: WKWebViewConfiguration())
let window = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
window.contentView = view

func fail(_ message: String) -> Never {
  print("error: \(message)")
  FileHandle.standardError.write("webkit: \(message)\n".data(using: .utf8)!)
  exit(1)
}

// Measures once the page has finished loading, never on a timer, so a slow machine cannot measure mid-navigation.
// The script is the body of an async function, so it can wait for the page to draw before it measures.
final class Loader: NSObject, WKNavigationDelegate {
  let url: URL, script: String, out: String?
  init(url: URL, script: String, out: String?) { self.url = url; self.script = script; self.out = out }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { outcome in
      switch outcome {
      case .success(let result): print(result)
      case .failure(let error): fail("the script failed: \(error.localizedDescription)")
      }
      guard let out = self.out else { exit(0) }
      webView.takeSnapshot(with: nil) { image, _ in
        if let image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
           let png = rep.representation(using: .png, properties: [:]) {
          try? png.write(to: URL(fileURLWithPath: out))
        }
        exit(0)
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
let loader = Loader(url: url, script: script, out: out)
view.navigationDelegate = loader
view.load(URLRequest(url: url))

// The script waits at most 15 s for the plots. This stops a page that never finishes loading.
DispatchQueue.main.asyncAfter(deadline: .now() + 45) { fail("timed out after 45 s") }
app.run()
