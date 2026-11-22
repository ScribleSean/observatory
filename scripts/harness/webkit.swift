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
view.load(URLRequest(url: url))

// The script is the body of an async function, so it can wait for the page to draw before it measures.
DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
  view.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { outcome in
    switch outcome {
    case .success(let result): print(result)
    case .failure(let error): print("error: \(error)")
    }
    guard let out else { exit(0) }
    view.takeSnapshot(with: nil) { image, _ in
      if let image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
         let png = rep.representation(using: .png, properties: [:]) {
        try? png.write(to: URL(fileURLWithPath: out))
      }
      exit(0)
    }
  }
}
DispatchQueue.main.asyncAfter(deadline: .now() + 30) { print("error: timed out"); exit(1) }
app.run()
