import AppKit
import WebKit

final class DashboardWebView: WKWebView {
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if event.modifierFlags.intersection([.command, .control, .option]) == .command,
           let key = event.charactersIgnoringModifiers,
           let next = DashboardZoom.shortcut(key, from: Double(pageZoom)) {
            pageZoom = CGFloat(next)
            return true
        }
        return super.performKeyEquivalent(with: event)
    }
}

final class BundledAssets: NSObject, WKURLSchemeHandler {
    private let resolver: AssetResolver
    init(root: URL) { resolver = AssetResolver(root: root) }
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard task.request.httpMethod == "GET", let url = task.request.url,
              let file = resolver.resolve(url),
              let attributes = try? file.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey]),
              attributes.isRegularFile == true, (attributes.fileSize ?? Int.max) <= 16_000_000,
              let data = try? Data(contentsOf: file) else {
            task.didFailWithError(NSError(domain: "Observatory", code: 404))
            return
        }
        let types = ["html": "text/html", "js": "text/javascript", "css": "text/css",
                     "svg": "image/svg+xml", "png": "image/png", "ico": "image/x-icon",
                     "woff2": "font/woff2", "woff": "font/woff", "ttf": "font/ttf", "json": "application/json"]
        let headers = ["Content-Type": types[file.pathExtension] ?? "application/octet-stream",
                       "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
                       "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'"]
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(data)
        task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

final class SnapshotBridge: NSObject, WKScriptMessageHandlerWithReply {
    let runtime: URL
    init(runtime: URL) { self.runtime = runtime }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, origin.protocol == "observatory", origin.host == "app",
              let name = message.body as? String,
              let file = dashboardSnapshotURL(runtime: runtime, name: name),
              let object = readObject(file) else {
            replyHandler(nil, "Local snapshot unavailable")
            return
        }
        replyHandler(object, nil)
    }
}

final class LocalNavigation: NSObject, WKNavigationDelegate, WKUIDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "observatory", url.host == "app" { decisionHandler(.allow); return }
        if action.navigationType == .linkActivated, url.scheme == "https",
           ["developers.openai.com", "github.com"].contains(url.host ?? "") {
            NSWorkspace.shared.open(url)
        }
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.navigationType == .linkActivated, let url = action.request.url, url.scheme == "https",
           ["developers.openai.com", "github.com"].contains(url.host ?? "") { NSWorkspace.shared.open(url) }
        return nil
    }
}

@MainActor
func makeDashboard(runtime: URL, resources: URL) -> WKWebView {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    config.setURLSchemeHandler(BundledAssets(root: resources.appendingPathComponent("Web")), forURLScheme: "observatory")
    config.userContentController.addScriptMessageHandler(SnapshotBridge(runtime: runtime), contentWorld: .page, name: "snapshot")
    let script = """
    (() => {
      const original = window.fetch.bind(window);
      window.fetch = (input, options) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (url.protocol === 'observatory:' && url.hostname === 'app' &&
            ['/local/usage.json', '/local/collector.json'].includes(url.pathname)) {
          const name = url.pathname.includes('collector') ? 'collector' : 'usage';
          return window.webkit.messageHandlers.snapshot.postMessage(name)
            .then(value => new Response(JSON.stringify(value), {status:200, headers:{'Content-Type':'application/json'}}));
        }
        return original(input, options);
      };
    })();
    """
    config.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    let web = DashboardWebView(frame: .zero, configuration: config)
    web.underPageBackgroundColor = .windowBackgroundColor
    web.allowsBackForwardNavigationGestures = false
    return web
}
