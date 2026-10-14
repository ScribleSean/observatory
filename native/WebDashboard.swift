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
    ready: ready(), page: location.pathname.replace(/^\\//, ''),
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

    static func shownPage(resources: URL) -> String {
        // The viewer workstream adds the dashboard page. Until the bundle has it,
        // show the panel page through the same host, as WebDashboard.cs does.
        let file = resources.appendingPathComponent("Web").appendingPathComponent(page)
        let attributes = try? file.resourceValues(forKeys: [.isRegularFileKey])
        return attributes?.isRegularFile == true ? page : "panel.html"
    }

    static func section(for tab: String) -> String {
        if tab == "allowances" { return "limits" }
        return sections.contains(where: { $0.0 == tab }) ? tab : "limits"
    }

    static func url(page: String, section: String) -> URL {
        precondition(sections.contains(where: { $0.0 == section }))
        return URL(string: page == Self.page ? "observatory://app/dashboard.html#\(section)" : "observatory://app/panel.html")!
    }
}

@MainActor
func makeWebDashboard(runtime: URL, resources: URL, page: String) -> WKWebView {
    precondition(page == WebDashboardPage.page || page == "panel.html")
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    config.setURLSchemeHandler(BundledAssets(root: resources.appendingPathComponent("Web"), pages: [page]), forURLScheme: "observatory")
    // The page can only read the snapshot until the settings bridge is added.
    config.userContentController.addScriptMessageHandler(SnapshotBridge(runtime: runtime), contentWorld: .page, name: "snapshot")
    config.userContentController.addUserScript(WKUserScript(source: WebViewerPreferences.documentStartScript(
        skin: WebViewerPreferences.skin(), theme: WebViewerPreferences.theme()),
        injectionTime: .atDocumentStart, forMainFrameOnly: true))
    config.userContentController.addUserScript(WKUserScript(source: snapshotFetchScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    let web = DashboardWebView(frame: .zero, configuration: config)
    web.underPageBackgroundColor = .windowBackgroundColor
    web.allowsBackForwardNavigationGestures = false
    return web
}
