import AppKit
import WebKit

@MainActor
private final class SmokeBridgeHost: BridgeHost {
    let sessionOpen = false
    let pairingBlocked = false
    private(set) var actions: [String] = []

    func perform(action: String, args: [String: BridgeValue], completion: @escaping (BridgeCode, Any?) -> Void) {
        actions.append(action)
        switch action {
        case "status": completion(.done, ["smoke": true])
        case "refresh":
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { completion(.done, nil) }
        default: completion(.unavailable, nil)
        }
    }
    func documentEnded() {}
}

// Exercises the bundled renderer and narrow data bridge with synthetic data, without a window.
@MainActor
final class WebSmokeTest: NSObject, WKNavigationDelegate {
    private var web: WKWebView?
    private var panel: WebPanelController?
    private var panelActions: [String] = []
    private var timer: Timer?
    private let runtime = FileManager.default.temporaryDirectory.appendingPathComponent("observatory-smoke-\(UUID().uuidString)")
    func start() {
        do {
            let local = runtime.appendingPathComponent("public/local")
            try FileManager.default.createDirectory(at: local, withIntermediateDirectories: true)
            let synthetic: JSONObject = ["schema": 2, "collectedAt": "2026-09-08T12:00:00Z", "demo": true,
                "activity": [], "tokens": [], "agents": [], "dictation": [], "smokeTest": true]
            try JSONSerialization.data(withJSONObject: synthetic).write(to: local.appendingPathComponent("usage.json"))
            try JSONSerialization.data(withJSONObject: ["state": "ok"]).write(to: local.appendingPathComponent("collector.json"))
            guard let resources = Bundle.main.resourceURL else { finish(false); return }
            let testResources = runtime.appendingPathComponent("resources")
            try FileManager.default.createDirectory(at: testResources, withIntermediateDirectories: true)
            try FileManager.default.copyItem(at: resources.appendingPathComponent("Web"), to: testResources.appendingPathComponent("Web"))
            for base in [runtime, testResources.appendingPathComponent("Web"), testResources.appendingPathComponent("Web/assets")] {
                let directory = base.appendingPathComponent("private-sync")
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                for name in ["pairing.json", "setup.pending.json"] {
                    try Data("{\"privateCanary\":true}".utf8).write(to: directory.appendingPathComponent(name))
                }
            }
            try Data("// synthetic private canary".utf8).write(to: runtime.appendingPathComponent("private-sync/secret.js"))
            try FileManager.default.createSymbolicLink(at: testResources.appendingPathComponent("Web/assets/private-linked"),
                withDestinationURL: runtime.appendingPathComponent("private-sync"))
            timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: false) { [weak self] _ in
                MainActor.assumeIsolated { self?.finish(false) }
            }
            Task {
                do {
                    guard try await checkPanel(resources: testResources) else { finish(false); return }
                    guard try await checkDashboard(resources: testResources) else { finish(false); return }
                    let view = makeDashboard(runtime: runtime, resources: testResources)
                    view.frame = NSRect(x: 0, y: 0, width: 1100, height: 760)
                    view.navigationDelegate = self
                    web = view
                    view.load(URLRequest(url: URL(string: "observatory://app/index.html")!))
                } catch { finish(false) }
            }
        } catch { finish(false) }
    }
    private func waitUntilReady(_ view: WKWebView, flag: String) async throws -> Bool {
        let deadline = Date().addingTimeInterval(10)
        while Date() < deadline {
            if !view.isLoading, view.url != nil {
                let ready = try await view.callAsyncJavaScript("return document.readyState === 'complete' && window[flag] === true;",
                    arguments: ["flag": flag], in: nil, contentWorld: .page)
                if ready as? Bool == true { return Date() < deadline }
            }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        return false
    }
    private func waitForPanelAction(_ view: WKWebView) async throws -> Bool {
        _ = try await view.callAsyncJavaScript("return true;", arguments: [:], in: nil, contentWorld: .page)
        let deadline = Date().addingTimeInterval(2)
        while panelActions.isEmpty && Date() < deadline {
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        return panelActions == ["refresh"]
    }
    private func checkHost(_ view: WKWebView, blockedPages: [String], panelHost: Bool) async throws -> Bool {
        let value = try await view.callAsyncJavaScript("""
        const response = await fetch('./local/usage.json');
        const object = await response.json();
        let privateDenied = true;
        for (const path of [...blockedPages, './other.html',
          './private-sync/pairing.json', './private-sync/setup.pending.json',
          './assets/private-sync/pairing.json', './assets/private-sync/setup.pending.json',
          './assets/private-linked/secret.js',
          './assets/%2e%2e/private-sync/setup.pending.json', './local/../private-sync/pairing.json']) {
          try { const r = await fetch(path); if (r.ok) privateDenied = false; } catch {}
        }
        for (const name of ['private-sync/pairing', '../private-sync/setup.pending', 'setup.pending', 'pairing']) {
          try { await window.webkit.messageHandlers.snapshot.postMessage(name); privateDenied = false; } catch {}
        }
        const handlers = window.webkit.messageHandlers;
        if (panelHost) return object.smokeTest === true && privateDenied && handlers.panelAction !== undefined && handlers.bridge === undefined;
        let quitDenied = false;
        try { await handlers.snapshot.postMessage('quit'); } catch { quitDenied = true; }
        return object.smokeTest === true && privateDenied && handlers.panelAction === undefined && handlers.bridge !== undefined && quitDenied;
        """, arguments: ["blockedPages": blockedPages, "panelHost": panelHost], in: nil, contentWorld: .page)
        return value as? Bool == true
    }
    private func checkPanel(resources: URL) async throws -> Bool {
        panel = WebPanelController(runtime: runtime, resources: resources) { [weak self] action in
            self?.panelActions.append(action.rawValue)
        }
        defer {
            panel?.webViewForTesting.stopLoading()
            panel?.webViewForTesting.configuration.userContentController.removeAllScriptMessageHandlers()
            panel = nil
        }
        guard let panel else { return false }
        panel.view.frame = NSRect(x: 0, y: 0, width: 388, height: 520)
        panel.loadIfNeeded()
        let view = panel.webViewForTesting
        guard try await waitUntilReady(view, flag: "observatoryPanelReady"),
              try await checkHost(view, blockedPages: ["./index.html", "./dashboard.html"], panelHost: true) else { return false }
        _ = try await view.callAsyncJavaScript("""
        for (const value of ['quit', 'Refresh', 'refresh ', 'open-dashboard:settings', {action: 'refresh'}, 42, 'refresh']) {
          window.webkit.messageHandlers.panelAction.postMessage(value);
        }
        return true;
        """, arguments: [:], in: nil, contentWorld: .page)
        return try await waitForPanelAction(view)
    }
    private func checkDashboard(resources: URL) async throws -> Bool {
        guard WebDashboardPage.isBundled(resources: resources) else { return false }
        let host = SmokeBridgeHost()
        let bridge = BridgeHandler(host: host)
        let view = makeWebDashboard(runtime: runtime, resources: resources, bridge: bridge)
        installBridgeListener(view)
        web = view
        defer {
            view.stopLoading()
            view.configuration.userContentController.removeAllScriptMessageHandlers()
            web = nil
        }
        view.frame = NSRect(x: 0, y: 0, width: 1100, height: 760)
        view.load(URLRequest(url: WebDashboardPage.url(section: "activity")))
        guard try await waitUntilReady(view, flag: "observatoryDashboardReady"),
              try await checkHost(view, blockedPages: ["./index.html", "./panel.html"], panelHost: false) else { return false }
        guard try await checkBridge(view, host: host, bridge: bridge, resources: resources) else { return false }
        for url in ["https://example.com/", "observatory://app/index.html", "observatory://app/panel.html",
                    "observatory://app/dashboard.html?demo", "observatory://other/dashboard.html"] {
            _ = try await view.callAsyncJavaScript("location.href = url;", arguments: ["url": url], in: nil, contentWorld: .page)
            try await Task.sleep(nanoseconds: 300_000_000)
            guard view.url?.path == "/dashboard.html", view.url?.query == nil, view.url?.host == "app" else { return false }
            let ready = try await view.callAsyncJavaScript("return window.observatoryDashboardReady === true;",
                arguments: [:], in: nil, contentWorld: .page)
            guard ready as? Bool == true else { return false }
        }
        _ = try await view.callAsyncJavaScript("location.hash = 'setup';", arguments: [:], in: nil, contentWorld: .page)
        try await Task.sleep(nanoseconds: 300_000_000)
        guard view.url?.fragment == "setup" else { return false }
        _ = try await view.callAsyncJavaScript("location.hash = 'bogus';", arguments: [:], in: nil, contentWorld: .page)
        try await Task.sleep(nanoseconds: 300_000_000)
        guard view.url?.fragment == "setup" else { return false }
        _ = try await view.callAsyncJavaScript("""
        const form = document.createElement('form');
        form.method = 'get';
        form.action = './dashboard.html';
        const input = document.createElement('input');
        input.name = 'q';
        input.value = 'synthetic';
        form.append(input);
        document.body.append(form);
        form.submit();
        form.remove();
        """, arguments: [:], in: nil, contentWorld: .page)
        try await Task.sleep(nanoseconds: 300_000_000)
        guard view.url?.path == "/dashboard.html", view.url?.query == nil,
              try await waitUntilReady(view, flag: "observatoryDashboardReady") else { return false }
        let before = view.url
        let popupDenied = try await view.callAsyncJavaScript("""
        const anchor = document.createElement('a');
        anchor.href = 'https://github.com/';
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        return window.open('https://github.com/') === null;
        """, arguments: [:], in: nil, contentWorld: .page)
        try await Task.sleep(nanoseconds: 300_000_000)
        return popupDenied as? Bool == true && view.url == before
    }

    private func installBridgeListener(_ view: WKWebView) {
        view.configuration.userContentController.addUserScript(WKUserScript(source: """
        window.smokeBridgeResults = [];
        window.addEventListener('observatory:bridge-result', event => window.smokeBridgeResults.push(event.detail));
        """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }
    private func bridgeCheck(_ view: WKWebView, script: String) async throws -> Bool {
        let value = try await view.callAsyncJavaScript("""
        const results = window.smokeBridgeResults;
        const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
        const post = (id, action = 'status') => window.webkit.messageHandlers.bridge.postMessage(JSON.stringify({id, action, args: {}}));
        const none = async () => {
          const count = results.length;
          await pause(600);
          return results.length === count;
        };
        const expect = async (id, code = 'done') => {
          const deadline = Date.now() + 2000;
          while (!results.some(result => result.id === id) && Date.now() < deadline) await pause(20);
          if (Date.now() >= deadline || !results.some(result => result.id === id)) return false;
          await pause(600);
          const matches = results.filter(result => result.id === id);
          if (matches.length !== 1) return false;
          const result = matches[0];
          return result.ok === (code === 'done') && result.code === code
            && Object.keys(result).sort().join(',') === (code === 'done' ? 'code,id,ok,value' : 'code,id,ok')
            && (code !== 'done' || (result.value?.smoke === true && Object.keys(result.value).join(',') === 'smoke'));
        };
        \(script)
        """, arguments: [:], in: nil, contentWorld: .page)
        return value as? Bool == true
    }
    private func checkBridge(_ view: WKWebView, host: SmokeBridgeHost, bridge: BridgeHandler, resources: URL) async throws -> Bool {
        guard try await bridgeCheck(view, script: """
        post(1);
        if (!await expect(1)) return false;
        post(2, 'unknown-action');
        if (!await expect(2, 'refused')) return false;
        post(3, 'complete-setup');
        if (!await expect(3, 'refused')) return false;
        window.webkit.messageHandlers.bridge.postMessage({id: 4, action: 'status', args: {}});
        window.webkit.messageHandlers.bridge.postMessage('not json');
        window.webkit.messageHandlers.bridge.postMessage('{"id":5,"id":6,"action":"status","args":{}}');
        return await none() && results.length === 3;
        """), host.actions == ["status"] else { return false }
        guard try await bridgeCheck(view, script: """
        const frame = document.createElement('iframe');
        document.body.append(frame);
        try {
          const handler = frame.contentWindow.webkit?.messageHandlers?.bridge;
          if (handler) handler.postMessage(JSON.stringify({id: 10, action: 'status', args: {}}));
          return await none() && !results.some(result => result.id === 10);
        } finally { frame.remove(); }
        """), host.actions == ["status"] else { return false }
        for (path, id) in [("/other.html", 11), ("/dashboard.html?demo", 12)] {
            _ = try await view.callAsyncJavaScript("history.pushState(null, '', path);", arguments: ["path": path], in: nil, contentWorld: .page)
            guard try await bridgeCheck(view, script: "post(\(id)); return await none() && !results.some(result => result.id === \(id));"),
                  host.actions == ["status"] else { return false }
            _ = try await view.callAsyncJavaScript("history.replaceState(null, '', '/dashboard.html#activity');",
                arguments: [:], in: nil, contentWorld: .page)
        }
        guard try await bridgeCheck(view, script: "post(13); return await expect(13);"),
              host.actions == ["status", "status"], let dashboard = view as? DashboardWebView else { return false }
        let generation = dashboard.documentGeneration
        _ = try await view.callAsyncJavaScript("""
        setTimeout(() => {
          window.webkit.messageHandlers.bridge.postMessage(JSON.stringify({id: 14, action: 'refresh', args: {}}));
          location.reload();
        }, 0);
        return true;
        """, arguments: [:], in: nil, contentWorld: .page)
        let deadline = Date().addingTimeInterval(2)
        while dashboard.documentGeneration == generation && Date() < deadline {
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        guard dashboard.documentGeneration != generation,
              try await waitUntilReady(view, flag: "observatoryDashboardReady") else { return false }
        try await Task.sleep(nanoseconds: 1_000_000_000)
        guard try await bridgeCheck(view, script: "return !results.some(result => result.id === 14);"),
              host.actions == ["status", "status", "refresh"] else { return false }
        let second = makeWebDashboard(runtime: runtime, resources: resources, bridge: bridge)
        installBridgeListener(second)
        defer {
            second.stopLoading()
            second.configuration.userContentController.removeAllScriptMessageHandlers()
        }
        second.frame = view.frame
        second.load(URLRequest(url: WebDashboardPage.url(section: "activity")))
        guard try await waitUntilReady(second, flag: "observatoryDashboardReady"),
              try await bridgeCheck(view, script: "post(20); return await expect(20);"),
              try await bridgeCheck(second, script: "return await none() && !results.some(result => result.id === 20);") else { return false }
        return host.actions == ["status", "status", "refresh", "status"]
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task {
          do {
            let value = try await webView.callAsyncJavaScript("""
            const response = await fetch('./local/usage.json');
            const object = await response.json();
            let privateDenied = true;
            for (const path of ['./private-sync/pairing.json', './private-sync/setup.pending.json',
              './assets/private-sync/pairing.json', './assets/private-sync/setup.pending.json',
              './assets/private-linked/secret.js',
              './assets/%2e%2e/private-sync/setup.pending.json', './local/../private-sync/pairing.json']) {
              try { const r = await fetch(path); if (r.ok) privateDenied = false; } catch {}
            }
            for (const name of ['private-sync/pairing', '../private-sync/setup.pending', 'setup.pending', 'pairing']) {
              try { await window.webkit.messageHandlers.snapshot.postMessage(name); privateDenied = false; } catch {}
            }
            let denied = false;
            try { await window.webkit.messageHandlers.snapshot.postMessage('../native-runtime'); }
            catch { denied = true; }
            // React mounts asynchronously. Verify the primitive's actual semantics,
            // not only the CSS orientation attribute on its wrapper.
            let views;
            for (let attempt = 0; attempt < 100; attempt++) {
              views = document.querySelector('[role="tablist"][aria-label="Usage views"]');
              if (views?.getAttribute('aria-orientation') === 'vertical') break;
              await new Promise(resolve => setTimeout(resolve, 50));
            }
            return object.smokeTest === true && denied && privateDenied && window.observatoryBundleReady === true
              && views?.getAttribute('aria-orientation') === 'vertical';
            """, arguments: [:], in: nil, contentWorld: .page)
            guard value as? Bool == true else { finish(false); return }
            let local = runtime.appendingPathComponent("public/local")
            let privateDirectory = runtime.appendingPathComponent("private-sync")
            let collector = local.appendingPathComponent("collector.json")
            try FileManager.default.removeItem(at: collector)
            try FileManager.default.createSymbolicLink(at: collector, withDestinationURL: privateDirectory.appendingPathComponent("pairing.json"))
            let fileDenied = try await webView.callAsyncJavaScript("""
            try { await window.webkit.messageHandlers.snapshot.postMessage('collector'); return false; }
            catch { return true; }
            """, arguments: [:], in: nil, contentWorld: .page)
            guard fileDenied as? Bool == true else { finish(false); return }
            try FileManager.default.removeItem(at: local)
            try Data("{\"privateCanary\":true}".utf8).write(to: privateDirectory.appendingPathComponent("usage.json"))
            try FileManager.default.createSymbolicLink(at: local, withDestinationURL: privateDirectory)
            let parentDenied = try await webView.callAsyncJavaScript("""
            try { await fetch('./local/usage.json'); return false; }
            catch { return true; }
            """, arguments: [:], in: nil, contentWorld: .page)
            finish(parentDenied as? Bool == true)
          } catch { finish(false) }
        }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finish(false) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finish(false) }
    private func finish(_ passed: Bool) {
        timer?.invalidate()
        web?.stopLoading()
        web?.configuration.userContentController.removeAllScriptMessageHandlers()
        web = nil
        panel?.webViewForTesting.stopLoading()
        panel?.webViewForTesting.configuration.userContentController.removeAllScriptMessageHandlers()
        panel = nil
        try? FileManager.default.removeItem(at: runtime)
        print(passed ? "Native renderer and data bridge passed (panel host, dashboard host with settings bridge, legacy host)" : "Native renderer or data bridge failed")
        exit(passed ? 0 : 1)
    }
}
