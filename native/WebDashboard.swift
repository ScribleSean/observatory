import AppKit
import WebKit

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
