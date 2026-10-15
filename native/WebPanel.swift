import AppKit
import WebKit

// The shared panel page may ask the shell for exactly these four things.
// This is not a command channel. Any other value is ignored.
enum PanelAction: String, CaseIterable {
    case refresh
    case checkUpdates = "check-updates"
    case openSettings = "open-settings"
    case openDashboard = "open-dashboard"

    static func parse(_ body: Any) -> PanelAction? {
        guard let name = body as? String else { return nil }
        return PanelAction(rawValue: name)
    }
}

final class PanelActionBridge: NSObject, WKScriptMessageHandler {
    private let perform: (PanelAction) -> Void
    init(perform: @escaping (PanelAction) -> Void) { self.perform = perform }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, origin.protocol == "observatory", origin.host == "app",
              let action = PanelAction.parse(message.body) else { return }
        perform(action)
    }
}

@MainActor
final class WebPanelController: NSViewController {
    static let width: CGFloat = 388
    private(set) var contentHeight: CGFloat = 520
    private let web: WKWebView
    var webViewForTesting: WKWebView { web }
    private let navigation = LocalNavigation()
    private var loaded = false

    init(runtime: URL, resources: URL, perform: @escaping (PanelAction) -> Void) {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.setURLSchemeHandler(BundledAssets(root: resources.appendingPathComponent("Web"), pages: ["panel.html"]),
                                   forURLScheme: "observatory")
        config.userContentController.addScriptMessageHandler(SnapshotBridge(runtime: runtime), contentWorld: .page, name: "snapshot")
        config.userContentController.add(PanelActionBridge(perform: perform), contentWorld: .page, name: "panelAction")
        config.userContentController.addUserScript(WKUserScript(source: WebViewerPreferences.documentStartScript(
            skin: WebViewerPreferences.skin(runtime: runtime), theme: WebViewerPreferences.theme(runtime: runtime)),
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.addUserScript(WKUserScript(source: snapshotFetchScript,
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: Self.width, height: 520), configuration: config)
        web.allowsBackForwardNavigationGestures = false
        super.init(nibName: nil, bundle: nil)
        web.navigationDelegate = navigation
        web.uiDelegate = navigation
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("Not used") }

    override func loadView() { view = web }

    func loadIfNeeded() {
        guard !loaded else { return }
        loaded = true
        web.load(URLRequest(url: URL(string: "observatory://app/panel.html")!))
    }

    func applyPreferences(skin: String, theme: String?) {
        applyViewerPreferences(web, skin: skin, theme: theme)
    }

    func snapshotChanged() {
        guard loaded else { return }
        web.evaluateJavaScript("window.dispatchEvent(new Event('observatory:snapshot-changed'))")
    }

    func describe(_ completion: @escaping (String) -> Void) { describeViewer(web, completion: completion) }

    func savePreview(to file: URL) { saveViewerPreview(web, to: file) }

    // Reports the content height once the page says it has drawn. A page that
    // never becomes ready reports nil and keeps the previous height.
    func whenDrawn(deadline: Date = Date().addingTimeInterval(5), _ completion: @escaping (CGFloat?) -> Void) {
        // A call made while the page is still loading is dropped by WebKit
        // when the page commits. Wait for the load with a bounded deadline.
        if web.isLoading || web.url == nil {
            guard Date() < deadline else { completion(nil); return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.01) { [weak self] in
                guard let self else { completion(nil); return }
                self.whenDrawn(deadline: deadline, completion)
            }
            return
        }
        let script = """
        const deadline = Date.now() + 5000;
        while (window.observatoryPanelReady !== true && Date.now() < deadline) await new Promise(r => setTimeout(r, 5));
        await Promise.race([new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))), new Promise(r => setTimeout(r, 250))]);
        if (window.observatoryPanelReady !== true) return null;
        const root = document.getElementById('root');
        return Math.ceil(Math.max(root ? root.scrollHeight : 0, document.body.scrollHeight));
        """
        web.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { [weak self] result in
            guard let self, case .success(let value) = result, let height = (value as? NSNumber)?.doubleValue,
                  height.isFinite, height >= 120, height <= 4000 else { completion(nil); return }
            self.contentHeight = CGFloat(height)
            completion(self.contentHeight)
        }
    }
}
