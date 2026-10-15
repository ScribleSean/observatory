import AppKit
import WebKit

let viewerFactsScript = """
const deadline = Date.now() + 5000;
const ready = () => window.observatoryPanelReady === true || window.observatoryDashboardReady === true;
while (!ready() && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
await Promise.race([new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))), new Promise(r => setTimeout(r, 250))]);
const limitRows = Object.create(null);
for (const row of document.querySelectorAll('[data-provider][data-window]')) {
    const provider = row.dataset.provider;
    limitRows[provider] = (limitRows[provider] || 0) + 1;
}
return JSON.stringify({
    kind: "web", ready: ready(), page: location.pathname,
    skin: document.documentElement.dataset.skin || 'Unknown',
    theme: document.documentElement.dataset.theme || 'system',
    font: getComputedStyle(document.querySelector('main') || document.body).fontFamily,
    dark: matchMedia('(prefers-color-scheme: dark)').matches,
    sections: document.querySelectorAll('nav[aria-label="Sections"] a, nav[aria-label="Sections"] button').length,
    limitRows, limitRowsTotal: document.querySelectorAll('.ob-limit').length,
    buttons: document.querySelectorAll('.ob-actions button').length,
    textLength: document.body.innerText.length, width: innerWidth, height: innerHeight
});
"""

@MainActor
func describeViewer(_ web: WKWebView, completion: @escaping (String) -> Void) {
    let deadline = Date().addingTimeInterval(5)
    func describeWhenLoaded() {
        // Wait for navigation so the page commit does not discard the script.
        if web.isLoading || web.url == nil {
            guard Date() < deadline else { completion("{\"ready\":false}"); return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { describeWhenLoaded() }
            return
        }
        web.callAsyncJavaScript(viewerFactsScript, arguments: [:], in: nil, in: .page) { result in
            guard case .success(let value) = result, let facts = value as? String else {
                completion("{\"ready\":false}"); return
            }
            completion(facts)
        }
    }
    describeWhenLoaded()
}

@MainActor
func saveViewerPreview(_ web: WKWebView, to file: URL) {
    web.takeSnapshot(with: nil) { image, error in
        guard error == nil, let tiff = image?.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiff),
              let png = bitmap.representation(using: .png, properties: [:]) else { return }
        try? png.write(to: file, options: .atomic)
    }
}

enum WebDashboardPage {
    static let page = "dashboard.html"
    static let sections = [("limits", "Limits"), ("activity", "Activity"), ("tokens", "Tokens"),
                           ("dictation", "Dictation"), ("sources", "Sources"), ("settings", "Settings")]

    static func isBundled(resources: URL) -> Bool {
        let file = resources.appendingPathComponent("Web").appendingPathComponent(page)
        let attributes = try? file.resourceValues(forKeys: [.isRegularFileKey])
        return attributes?.isRegularFile == true
    }

    static func section(for tab: String) -> String {
        if tab == "allowances" { return "limits" }
        return sections.contains(where: { $0.0 == tab }) ? tab : "limits"
    }

    static func url(section: String) -> URL {
        precondition(sections.contains(where: { $0.0 == section }))
        return URL(string: "observatory://app/dashboard.html#\(section)")!
    }
}

@MainActor
func makeWebDashboard(runtime: URL, resources: URL, bridge: BridgeHandler? = nil) -> WKWebView {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    config.setURLSchemeHandler(BundledAssets(root: resources.appendingPathComponent("Web"), pages: ["dashboard.html"]), forURLScheme: "observatory")
    if let bridge { config.userContentController.add(bridge, contentWorld: .page, name: "bridge") }
    config.userContentController.addScriptMessageHandler(SnapshotBridge(runtime: runtime), contentWorld: .page, name: "snapshot")
    config.userContentController.addUserScript(WKUserScript(source: WebViewerPreferences.documentStartScript(
        skin: WebViewerPreferences.skin(runtime: runtime), theme: WebViewerPreferences.theme(runtime: runtime)),
        injectionTime: .atDocumentStart, forMainFrameOnly: true))
    config.userContentController.addUserScript(WKUserScript(source: snapshotFetchScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    let web = DashboardWebView(frame: .zero, configuration: config)
    let navigation = DashboardNavigation()
    navigation.onDocumentReplaced = { [weak bridge] in bridge?.documentReplaced() }
    web.navigationGuard = navigation
    web.navigationDelegate = navigation
    web.uiDelegate = navigation
    web.underPageBackgroundColor = .windowBackgroundColor
    web.allowsBackForwardNavigationGestures = false
    return web
}

final class DashboardNavigation: NSObject, WKNavigationDelegate, WKUIDelegate {
    var onDocumentReplaced: (() -> Void)?

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        (webView as? DashboardWebView)?.documentGeneration += 1
        onDocumentReplaced?()
    }

    static let fragments: Set<String> = ["limits", "activity", "tokens", "dictation", "sources", "settings", "setup"]

    static func allows(_ url: URL, mainFrame: Bool) -> Bool {
        mainFrame && url.scheme == "observatory" && url.host == "app" &&
            url.user == nil && url.password == nil && url.port == nil &&
            url.path(percentEncoded: true) == "/dashboard.html" && url.query == nil &&
            (url.fragment == nil || fragments.contains(url.fragment!)) &&
            !url.absoluteString.contains("%00") && !url.absoluteString.contains("\\")
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if Self.allows(url, mainFrame: action.targetFrame?.isMainFrame == true) { decisionHandler(.allow); return }
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        return nil
    }
}
