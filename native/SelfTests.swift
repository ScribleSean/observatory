import Foundation
import Darwin

func runSelfTests() {
    runRuntimeSetupSelfTests()
    runBridgeSelfTests()
    runBridgeActionSelfTests()
    MacUpdateTrust.selfTest()
    let emptyArchive = Data(#"{"version":1,"accounts":[],"next":null,"storageBytes":0,"storageLimitBytes":8589934592}"#.utf8)
    precondition((try? ArchiveReply.parse(emptyArchive))?.accounts?.count == 0)
    precondition((try? ArchiveReply.parse(Data(#"{"version":1,"records":[],"next":null}"#.utf8)))?.records?.count == 0)
    let resetArchive = try? ArchiveReply.parse(Data(#"{"version":1,"records":[{"checkedAt":"2026-09-15T12:00:00Z","windows":[{"bucket":"codex","window":"primary","remainingPercent":70,"resetsAt":"2026-09-15T16:00:00Z"}]}],"next":null}"#.utf8))
    precondition(resetArchive?.records?.first?.windows?.first?.resetsAt == "2026-09-15T16:00:00Z")
    let maskChart: JSONObject = ["version": 1, "width": 2, "height": 2, "from": 0, "to": 1000,
        "encoding": "ink-mask-u8", "pixels": Data([0, 3, 0, 0]).base64EncodedString(), "scanned": 1, "observations": 1,
        "gaps": 0, "segments": 1, "firstAt": 500, "lastAt": 500, "minUsed": 50, "maxUsed": 50]
    let rasterReply = try? ArchiveReply.parse(JSONSerialization.data(withJSONObject: ["version": 1, "chart": maskChart]))
    precondition(rasterReply?.chart?.observations == 1 && (try? rasterReply?.chart?.validatedMask()) != nil)
    for changes: JSONObject in [["width": 1025], ["pixels": "AA=="], ["pixels": Data([0, 4, 0, 0]).base64EncodedString()],
                               ["observations": 0], ["firstAt": 2000], ["maxUsed": 101]] {
        let bad = maskChart.merging(changes) { _, new in new }
        precondition((try? ArchiveReply.parse(JSONSerialization.data(withJSONObject: ["version": 1, "chart": bad]))) == nil)
    }
    for invalid in [#"{"version":2,"records":[]}"#, #"{"version":1,"records":[],"accounts":[]}"#,
                    #"{"version":1,"records":[],"next":"raw-account"}"#,
                    #"{"version":1,"records":[{"checkedAt":"not-a-date"}]}"#] {
        precondition((try? ArchiveReply.parse(Data(invalid.utf8))) == nil)
    }
    do {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("observatory-update-gate-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: directory) }
        let bundle = directory.appendingPathComponent("Observatory.app")
        let lock = directory.appendingPathComponent(".observatory-install.lock")
        precondition(!MacUpdateGate.isBlocked(bundle: bundle))
        try Data().write(to: lock, options: .withoutOverwriting)
        precondition(MacUpdateGate.isBlocked(bundle: bundle))
        try FileManager.default.removeItem(at: lock)
        precondition(!MacUpdateGate.isBlocked(bundle: bundle))
        try FileManager.default.createSymbolicLink(at: lock, withDestinationURL: directory.appendingPathComponent("missing"))
        precondition(MacUpdateGate.isBlocked(bundle: bundle))
    } catch { preconditionFailure("Mac update gate self-test failed: \(error)") }
    TLSSetupReply.selfTest()
    for status in TailscaleReadiness.messages.keys {
        let value = Data("{\"version\":1,\"status\":\"\(status)\",\"peerReachability\":\"not-checked\"}".utf8)
        precondition((try? TailscaleReadiness.parse(value)) == TailscaleReadiness.messages[status])
    }
    for invalid in ["{}", "{\"version\":true,\"status\":\"running\",\"peerReachability\":\"not-checked\"}",
                    "{\"version\":1,\"status\":\"running\",\"peerReachability\":\"connected\"}"] {
        precondition((try? TailscaleReadiness.parse(Data(invalid.utf8))) == nil)
    }
    let sharingOff = Data("{\"version\":1,\"enabled\":false,\"canEnable\":false,\"reason\":\"account-unavailable\",\"token\":null}".utf8)
    precondition((try? QuotaSharingStatus.parse(sharingOff))?.enabled == false)
    let invalidSharing = Data("{\"version\":1,\"enabled\":true,\"canEnable\":true,\"reason\":\"ready\",\"token\":\"private\"}".utf8)
    precondition((try? QuotaSharingStatus.parse(invalidSharing)) == nil)
    do {
        try ProviderTokenSharingTests.parseSelfTest()
    } catch { preconditionFailure("Provider sharing consent self-test failed") }
    do {
        let runtime = FileManager.default.temporaryDirectory.appendingPathComponent("observatory-first-run-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: runtime) }
        precondition((try? FirstRunSetup.prepare(runtime: runtime)) == true)
        let disabled = try CollectorConfiguration.read(runtime: runtime)
        precondition(disabled.values.allSatisfy { !$0 })
        precondition((try? FirstRunSetup.required(runtime: runtime)) == true)
        precondition((try? FirstRunSetup.prepare(runtime: runtime)) == true)
        precondition(try! FirstRunSetup.markComplete(runtime: runtime))
        precondition((try? FirstRunSetup.required(runtime: runtime)) == false)
        precondition((try? FirstRunSetup.prepare(runtime: runtime)) == false)
        precondition((try? CollectorConfiguration.read(runtime: runtime)) == disabled)
        let marker = runtime.appendingPathComponent("setup-state.json")
        try Data("invalid".utf8).write(to: marker)
        precondition((try? FirstRunSetup.required(runtime: runtime)) == nil)
    } catch { preconditionFailure("First-run persistence checks failed") }
    do {
        let runtime = FileManager.default.temporaryDirectory.appendingPathComponent("observatory-existing-setup-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: runtime) }
        _ = try CollectorConfiguration.prepare(runtime: runtime)
        let file = runtime.appendingPathComponent("collector.config.json")
        let before = try Data(contentsOf: file)
        precondition((try? FirstRunSetup.prepare(runtime: runtime)) == false)
        precondition((try? Data(contentsOf: file)) == before)
        precondition(!FileManager.default.fileExists(atPath: runtime.appendingPathComponent("setup-state.json").path))
        try FileManager.default.createSymbolicLink(atPath: runtime.appendingPathComponent("setup-state.json").path,
                                                   withDestinationPath: runtime.appendingPathComponent("missing-state").path)
        precondition((try? FirstRunSetup.required(runtime: runtime)) == nil)
    } catch { preconditionFailure("Existing setup preservation checks failed") }
    MainActor.assumeIsolated {
        let runtime = FileManager.default.temporaryDirectory.appendingPathComponent("observatory-setup-gate-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: runtime) }
        let pending = ObservatoryStore(runtime: runtime)
        precondition(pending.collectionAllowed && pending.setupRequired)
        pending.refresh()
        precondition(!pending.refreshing && pending.lastAttempt == "setup-required")
        precondition(!FileManager.default.fileExists(atPath: runtime.appendingPathComponent("public/local/usage.json").path))
    }
    MainActor.assumeIsolated {
        let runtime = FileManager.default.temporaryDirectory.appendingPathComponent("observatory-preview-settings-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: runtime) }
        let preview = ObservatoryStore(runtime: runtime, collectionAllowed: false)
        // Even a configuration enabling sources must not start collection in a preview.
        try! CollectorConfiguration.save(CollectorConfiguration.defaults, runtime: runtime)
        precondition((try? CollectorConfiguration.read(runtime: runtime))?["codex"] == true)
        preview.refresh()
        precondition(!preview.refreshing && preview.lastAttempt == "preview-collection-disabled")
        precondition(!FileManager.default.fileExists(atPath: runtime.appendingPathComponent("public/local/usage.json").path))
        do {
            let baseline = try CollectorConfiguration.read(runtime: runtime)
            var draft = baseline
            draft["quota"] = true
            let saved = try CollectorConfiguration.saveIfUnchanged(draft, expected: baseline, runtime: runtime)
            precondition(saved && (try? CollectorConfiguration.read(runtime: runtime)) == draft)
            // An editor holding the old version must not overwrite a newer save.
            let staleSave = try CollectorConfiguration.saveIfUnchanged(baseline, expected: baseline, runtime: runtime)
            precondition(!staleSave && (try? CollectorConfiguration.read(runtime: runtime)) == draft)
            let invalidSave = try? CollectorConfiguration.saveIfUnchanged(["unknown-source": true], expected: draft, runtime: runtime)
            precondition(invalidSave == nil && (try? CollectorConfiguration.read(runtime: runtime)) == draft)
            // Reloading the saved version allows a deliberate subsequent edit.
            let reloadedSave = try CollectorConfiguration.saveIfUnchanged(baseline, expected: draft, runtime: runtime)
            precondition(reloadedSave && (try? CollectorConfiguration.read(runtime: runtime)) == baseline)
            preview.refresh()
            precondition(!preview.refreshing && preview.lastAttempt == "preview-collection-disabled")
        } catch { preconditionFailure("Synthetic settings save checks failed") }
    }
    let pairingRequest = PairingSetupRequest(transport: PairingTransport(kind: "ssh-windows", hostAlias: "fixture-host",
        remoteNode: "C:/Fixture/Runtime/node.exe", remoteScript: "C:/Fixture/Collector/peer-exchange.mjs", remoteRuntime: "C:/Fixture/Data"))
    precondition((try? pairingRequest.validate()) != nil)
    let invalidPairingRequest = PairingSetupRequest(transport: PairingTransport(kind: "ssh-windows", hostAlias: "-oBad",
        remoteNode: "C:/Fixture/Runtime/node.exe", remoteScript: "C:/Fixture/Collector/peer-exchange.mjs", remoteRuntime: "C:/Fixture/Data"))
    precondition((try? invalidPairingRequest.validate()) == nil)
    let windowsDetails = """
    {"version":1,"kind":"windows-installation","remoteNode":"C:/Fixture/Runtime/node.exe","remoteScript":"C:/Fixture/Collector/scripts/peer-exchange.mjs","remoteRuntime":"C:/Fixture/Data"}
    """
    precondition((try? WindowsPairingDetails.parse(windowsDetails))?.remoteRuntime == "C:/Fixture/Data")
    for invalid in [windowsDetails.replacingOccurrences(of: "windows-installation", with: "unknown"),
                    windowsDetails.replacingOccurrences(of: "node.exe", with: "other.exe"),
                    windowsDetails.replacingOccurrences(of: "C:/Fixture/Data", with: "C:/Fixture/../Data"),
                    windowsDetails.replacingOccurrences(of: "\"version\":1", with: "\"version\":true"),
                    windowsDetails.replacingOccurrences(of: "\"version\":1", with: "\"version\":1,\"hostAlias\":\"not-imported\""),
                    String(repeating: " ", count: 8193), "null", "[]"] {
        precondition((try? WindowsPairingDetails.parse(invalid)) == nil)
    }
    MainActor.assumeIsolated {
        var reads = 0, applied = 0, failures = 0
        var pasted: String? = windowsDetails
        let action = PairingDetailsPasteAction(read: { reads += 1; return pasted },
            apply: { _ in applied += 1 }, onError: { failures += 1 })
        precondition(reads == 0 && applied == 0)
        action.paste()
        precondition(reads == 1 && applied == 1 && failures == 0)
        pasted = "invalid"
        action.paste()
        precondition(reads == 2 && applied == 1 && failures == 1)
    }
    for (index, level) in DashboardZoom.levels.enumerated() {
        precondition(DashboardZoom.step(from: level, increasing: true) == DashboardZoom.levels[min(index + 1, DashboardZoom.levels.count - 1)])
        precondition(DashboardZoom.step(from: level, increasing: false) == DashboardZoom.levels[max(index - 1, 0)])
    }
    precondition(DashboardZoom.step(from: .nan, increasing: true) == 1)
    precondition(DashboardZoom.step(from: .infinity, increasing: false) == 1)
    precondition(DashboardZoom.step(from: 1.3, increasing: true) == 1.5)
    precondition(DashboardZoom.step(from: 1.3, increasing: false) == 1.25)
    precondition(DashboardZoom.shortcut("=", from: 1) == 1.25)
    precondition(DashboardZoom.shortcut("+", from: 1) == 1.25)
    precondition(DashboardZoom.shortcut("-", from: 1) == 0.75)
    precondition(DashboardZoom.shortcut("0", from: 2) == 1)
    precondition(DashboardZoom.shortcut("c", from: 1) == nil)
    precondition((try? CollectorConfiguration.validate([:])) == CollectorConfiguration.defaults)
    precondition((try? CollectorConfiguration.validate(["wispr": true]))?["wispr"] == true)
    precondition((try? CollectorConfiguration.validate(["quota": true]))?["quota"] == true)
    precondition(CollectorConfiguration.defaults["quota"] == false)
    precondition(CollectorConfiguration.defaults["claude"] == false)
    // A saved key for a removed source is still accepted and is no longer kept.
    precondition(CollectorConfiguration.defaults["antigravity"] == nil)
    precondition((try? CollectorConfiguration.validate(["antigravity": true])).map { $0["antigravity"] == nil } == true)
    precondition((try? CollectorConfiguration.validate(["antigravity": "true"])) == nil)
    precondition((try? CollectorConfiguration.validate(["claude": true]))?["claude"] == true)
    precondition((try? CollectorConfiguration.validate(["claude": "true"])) == nil)
    for source in ["receipts", "benchmarks"] {
        precondition(CollectorConfiguration.defaults[source] == false)
        precondition((try? CollectorConfiguration.validate([source: true]))?[source] == true)
        precondition((try? CollectorConfiguration.validate([source: "true"])) == nil)
    }
    let dueNow = parseDate("2026-09-09T12:00:00Z")!
    precondition(allowanceRefreshDue(["nextAttemptAt": "2026-09-09T12:00:00Z"], now: dueNow))
    precondition(allowanceRefreshDue(["nextAttemptAt": "2026-09-09T11:59:00Z"], now: dueNow))
    precondition(!allowanceRefreshDue(["nextAttemptAt": "2026-09-09T12:00:01Z"], now: dueNow))
    precondition(!allowanceRefreshDue(["nextAttemptAt": "invalid"], now: dueNow))
    precondition(!allowanceRefreshDue(nil, now: dueNow))
    precondition((try? CollectorConfiguration.validate(["codex": 1])) == nil)
    precondition((try? CollectorConfiguration.validate(["remote": true])) == nil)
    precondition((try? CollectorConfiguration.validate(["wispr": "true"])) == nil)
    do {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("observatory-config-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let prepared = try CollectorConfiguration.prepare(runtime: directory)
        let initial = try CollectorConfiguration.read(runtime: directory)
        precondition(prepared && initial == CollectorConfiguration.defaults)
        try CollectorConfiguration.save(["activity": false, "codex": false, "wispr": true, "typewhisper": false], runtime: directory)
        let updated = try CollectorConfiguration.read(runtime: directory)
        precondition(updated["wispr"] == true)
        precondition(updated["typewhisper"] == nil)
        let config = directory.appendingPathComponent("collector.config.json")
        try Data("{\"codex\":1}".utf8).write(to: config)
        precondition((try? CollectorConfiguration.prepare(runtime: directory)) == nil)
        try FileManager.default.removeItem(at: config)
        let legacyFile = directory.appendingPathComponent("local.config.json")
        let legacyBytes = Data("{}".utf8)
        try legacyBytes.write(to: legacyFile)
        let legacy = try CollectorConfiguration.prepare(runtime: directory)
        precondition(legacy)
        let migrated = try CollectorConfiguration.read(runtime: directory)
        precondition(migrated == CollectorConfiguration.defaults)
        let preparedLegacyBytes = try Data(contentsOf: legacyFile)
        precondition(preparedLegacyBytes == legacyBytes)
        // Retain legacy configuration, but never launch its old collector code.
        let resources = directory.appendingPathComponent("fixture-resources")
        for relative in ["Runtime/python/bin/python3", "Runtime/node/bin/node", "Collector/scripts/run-collector.py",
                         "Collector/scripts/collect-mac.mjs"] {
            let file = resources.appendingPathComponent(relative)
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data("synthetic launch fixture, never executed".utf8).write(to: file)
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: file.path)
        }
        let launch = try CollectorConfiguration.launch(runtime: directory, resources: resources)
        precondition(launch.executable == resources.appendingPathComponent("Runtime/python/bin/python3"))
        precondition(launch.arguments.contains(resources.appendingPathComponent("Collector/scripts/collect-mac.mjs").path))
        precondition(!launch.arguments.contains { $0.contains("collect-dashboard.mjs") })
        precondition(launch.arguments.contains(directory.path))
        precondition(!launch.arguments.contains(directory.appendingPathComponent("scripts/run-collector.py").path))
        let quotaLaunch = try CollectorConfiguration.launch(runtime: directory, resources: resources, quotaOnly: true)
        precondition(quotaLaunch.executable == launch.executable)
        precondition(quotaLaunch.arguments == launch.arguments + ["--quota-only"])
        let retainedLegacy = try Data(contentsOf: legacyFile)
        precondition(retainedLegacy == legacyBytes)
    } catch { preconditionFailure("Collector configuration self-test failed") }
    precondition(number(true) == nil)
    precondition(number(-1) == nil)
    precondition(number(Double.infinity) == nil)
    precondition(number(0) == 0)
    precondition(parseDate("2026-09-08T20:00:00.123Z") != nil)
    precondition(parseDate("2026-09-08T20:00:00Z") != nil)
    let assetRoot = URL(fileURLWithPath: "/tmp/observatory-test-assets")
    let panel = AssetResolver(root: assetRoot, pages: ["panel.html"])
    let dashboard = AssetResolver(root: assetRoot, pages: ["dashboard.html"])
    let unsafeURLs = ["https://app/index.html", "observatory://other/index.html", "observatory://app/../secret.json",
                      "observatory://app/%2e%2e/secret.json", "observatory://app/local/usage.json",
                      "observatory://app/.env", "observatory://app/native-runtime.json/../../secret.json",
                      "observatory://user@app/index.html", "observatory://app:80/index.html"]
    for (name, resolver) in [("panel", panel), ("dashboard", dashboard)] {
        precondition(!resolver.pages.contains("index.html"), "Host page set contains the removed page")
        precondition(resolver.resolve(URL(string: "observatory://app/index.html")!) == nil, "Host served the removed page")
        precondition(resolver.resolve(URL(string: "observatory://app/" + name + ".html")!) != nil, "Host page refused")
        precondition(resolver.resolve(URL(string: "observatory://app/assets/InterTight.ttf")!) != nil, "Host font refused")
        precondition(resolver.resolve(URL(string: "observatory://app/../InterTight.ttf")!) == nil, "Unsafe font URL accepted")
        precondition(resolver.resolve(URL(string: "observatory://app/assets/app.js")!) != nil, "Host script refused")
        for page in ["index.html", "panel.html", "dashboard.html", "other.html", "local/usage.json"] where page != name + ".html" {
            precondition(resolver.resolve(URL(string: "observatory://app/" + page)!) == nil, "Host served an unlisted page")
        }
        for url in ["observatory://app/", "observatory://app"] {
            precondition(resolver.resolve(URL(string: url)!) == nil, "Host served the root index page")
        }
        for url in unsafeURLs + ["observatory://app/assets/../panel.html", "observatory://app/assets/%2e%2e/dashboard.html",
                                 "observatory://app/dashboard.html/../index.html", "observatory://app/assets/x.json"] {
            precondition(resolver.resolve(URL(string: url)!) == nil, "Host accepted an unsafe asset URL")
        }
    }
    for path in ["index.html/", "index.html?x", "%69ndex.html", "INDEX.html", "Dashboard.html",
                 "assets%2F..%2Findex.html", "//index.html", "./index.html", "index.html%00", "panel.html;x", "assets/x.html"] {
        precondition(dashboard.resolve(URL(string: "observatory://app/" + path)!) == nil,
                     "Dashboard accepted a refused path: \(path)")
    }
    for resolver in [panel, dashboard] {
        precondition(resolver.resolve(URL(string: "observatory://app/assets/x.html")!) == nil,
                     "Host served HTML under assets")
    }
    let empty = AssetResolver(root: assetRoot, pages: [])
    for page in ["index.html", "panel.html", "dashboard.html"] {
        precondition(empty.resolve(URL(string: "observatory://app/" + page)!) == nil, "Empty page set served a page")
    }
    precondition(PanelAction.allCases.map(\.rawValue) == ["refresh", "check-updates", "open-settings", "open-dashboard"])
    for name in PanelAction.allCases.map(\.rawValue) { precondition(PanelAction.parse(name)?.rawValue == name) }
    let refused: [Any] = ["", "Refresh", "refresh ", "quit", "open-dashboard:settings", ["refresh"], ["panelAction": "refresh"], 1, NSNull()]
    for value in refused { precondition(PanelAction.parse(value) == nil, "Unknown panel action accepted") }
    do {
        // Checked on plain values so the test writes no preferences file.
        precondition(WebViewerPreferences.skin(stored: nil) == "sage", "Missing skin must use Sage")
        precondition(WebViewerPreferences.theme(stored: nil) == nil, "Missing theme must follow the system")
        for skin in ["almanac", "amber-crt"] {
            precondition(WebViewerPreferences.skin(stored: skin) == skin, "Bundled skin must be retained")
        }
        for skin in ["Almanac", "", "sage\"", "../sage", "</script>"] {
            precondition(WebViewerPreferences.skin(stored: skin) == "sage", "Invalid skin must use Sage")
        }
        for theme in ["light", "dark"] {
            precondition(WebViewerPreferences.theme(stored: theme) == theme, "Explicit theme must be retained")
        }
        for theme in ["Light", "auto", ""] {
            precondition(WebViewerPreferences.theme(stored: theme) == nil, "Invalid theme must follow the system")
        }
        let script = WebViewerPreferences.documentStartScript(skin: "almanac", theme: "dark")
        precondition(script.contains("dataset.skin = \"almanac\""), "Script must set the selected skin")
        precondition(script.contains("dataset.theme = \"dark\""), "Script must set the selected theme")
        let invalid = WebViewerPreferences.documentStartScript(skin: "x\"; alert(1)", theme: "dark\"")
        precondition(invalid.contains("dataset.skin = \"sage\""), "Invalid script skin must use Sage")
        precondition(!invalid.contains("alert"), "Script must exclude free text")
        precondition(!invalid.contains("dark\""), "Script must exclude the invalid theme")
        precondition(!invalid.contains("dataset.theme"), "Invalid theme must not set an attribute")
        precondition(!WebViewerPreferences.documentStartScript(skin: "sage", theme: nil).contains("dataset.theme"),
                     "System theme must not set an attribute")
    }
    let dashboardURL = URL(string: "observatory://app/dashboard.html")!
    precondition(DashboardNavigation.allows(dashboardURL, mainFrame: true), "Dashboard navigation refused its page")
    for fragment in ["limits", "activity", "tokens", "dictation", "sources", "settings", "setup"] {
        precondition(DashboardNavigation.allows(URL(string: "observatory://app/dashboard.html#" + fragment)!, mainFrame: true),
                     "Dashboard navigation refused fragment: \(fragment)")
    }
    precondition(!DashboardNavigation.allows(dashboardURL, mainFrame: false), "Dashboard navigation accepted a subframe")
    let refusedNavigation = [
        "observatory://app/dashboard.html?demo", "observatory://app/dashboard.html?",
        "observatory://app/dashboard.html?x#limits", "observatory://app/dashboard.html/",
        "observatory://app/dashboard.html%2F", "observatory://app/%64ashboard.html",
        "observatory://app/Dashboard.html", "observatory://app/DASHBOARD.HTML",
        "observatory://APP/dashboard.html", "observatory://app//dashboard.html",
        "observatory://app/./dashboard.html", "observatory://app/assets/../dashboard.html",
        "observatory://app/dashboard.html#", "observatory://app/dashboard.html#Limits",
        "observatory://app/dashboard.html#unknown", "observatory://app/dashboard.html#limits%00",
        "observatory://app/index.html", "observatory://app/panel.html", "observatory://app/",
        "observatory://app", "https://app/dashboard.html", "https://example.com/",
        "observatory://other/dashboard.html", "observatory://user@app/dashboard.html",
        "observatory://app:80/dashboard.html", "about:blank"
    ]
    for value in refusedNavigation {
        precondition(!DashboardNavigation.allows(URL(string: value)!, mainFrame: true),
                     "Dashboard navigation accepted a refused URL: \(value)")
    }
    print("Native self-tests passed")
}

func runCollectorSelfTest() {
    let startedAt = DispatchTime.now()
    var currentPhase = "resources"
    func phase(_ label: String) {
        currentPhase = label
        let elapsed = (DispatchTime.now().uptimeNanoseconds - startedAt.uptimeNanoseconds) / 1_000_000
        try? FileHandle.standardError.write(contentsOf: Data("collector-self-test phase=\(label) elapsed_ms=\(elapsed)\n".utf8))
    }
    do {
        phase("resources")
        guard let resources = Bundle.main.resourceURL else { throw CocoaError(.fileReadNoSuchFile) }
        let runtime = FileManager.default.temporaryDirectory.appendingPathComponent("observatory-collector-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: runtime) }
        phase("prepare")
        _ = try CollectorConfiguration.prepare(runtime: runtime)
        phase("save-disabled")
        try CollectorConfiguration.save(Dictionary(uniqueKeysWithValues: CollectorConfiguration.defaults.keys.map { ($0, false) }), runtime: runtime)
        phase("collector-launch")
        let launch = try CollectorConfiguration.launch(runtime: runtime, resources: resources)
        let task = Process()
        task.executableURL = launch.executable
        task.arguments = launch.arguments
        task.currentDirectoryURL = runtime
        task.environment = ["PATH": "/usr/bin:/bin", "HOME": runtime.path]
        try task.run()
        phase("collector-wait")
        task.waitUntilExit()
        phase("collector-check")
        precondition(task.terminationStatus == 0)
        let object = readObject(runtime.appendingPathComponent("public/local/usage.json"))
        precondition(number(object?["schema"]) == 2)
        let status = readObject(runtime.appendingPathComponent("public/local/collector.json"))
        precondition(number(status?["sourcesConfigured"]) == 0)
        phase("config-before")
        let configFile = runtime.appendingPathComponent("collector.config.json")
        let originalConfig = try Data(contentsOf: configFile)
        phase("status-initial")
        let setupStatus = try PairingSetup.readStatus(runtime: runtime, resources: resources)
        precondition(setupStatus.status == .unpaired && setupStatus.request == nil)
        precondition(!FileManager.default.fileExists(atPath: runtime.appendingPathComponent("private-sync").path))
        phase("revoke-first")
        try PairingMaintenance.runDisconnect(runtime: runtime, resources: resources)
        phase("revoke-second")
        try PairingMaintenance.runDisconnect(runtime: runtime, resources: resources)
        phase("revoked-check")
        precondition(FileManager.default.fileExists(atPath: runtime.appendingPathComponent("private-sync/revoked").path))
        let retainedConfig = try Data(contentsOf: configFile)
        precondition(retainedConfig == originalConfig)
        phase("status-revoked")
        let disabledStatus = try PairingSetup.readStatus(runtime: runtime, resources: resources)
        precondition(disabledStatus.status == .needsRepair && disabledStatus.request == nil)
        phase("repair")
        try PairingMaintenance.runPrepareRepair(runtime: runtime, resources: resources)
        phase("repair-check")
        let retired = try FileManager.default.contentsOfDirectory(at: runtime, includingPropertiesForKeys: nil)
            .filter { $0.lastPathComponent.hasPrefix("private-sync-retired-") }
        precondition(retired.count == 1)
        precondition(FileManager.default.fileExists(atPath: retired[0].appendingPathComponent("revoked").path))
        precondition(!FileManager.default.fileExists(atPath: runtime.appendingPathComponent("private-sync").path))
        phase("status-repaired")
        let repairedStatus = try PairingSetup.readStatus(runtime: runtime, resources: resources)
        precondition(repairedStatus.status == .unpaired && repairedStatus.request == nil)
        phase("config-check")
        let configAfterRepair = try Data(contentsOf: configFile)
        precondition(configAfterRepair == originalConfig)
        print("Packaged repair preparation self-test passed with a retained disabled backup")
        print("Packaged pairing status self-test passed without exposing private credentials")
        print("Packaged pairing revocation self-test passed with temporary data")
        phase("sharing")
        let sharingFinished = DispatchSemaphore(value: 0)
        Task.detached {
            do { try await ProviderTokenSharingTests.bridgeSelfTest(resources: resources) }
            catch { preconditionFailure("Packaged provider sharing bridge failed") }
            sharingFinished.signal()
        }
        precondition(sharingFinished.wait(timeout: .now() + 90) == .success, "Packaged provider sharing bridge timed out")
        print("Packaged collector self-test passed with all sources disabled")
        phase("complete")
    } catch {
        let failure = error as NSError
        let reason = failure.userInfo["childReason"] as? Int ?? -1
        let status = failure.userInfo["childStatus"] as? Int32 ?? -1
        let elapsed = failure.userInfo["childElapsedMilliseconds"] as? Int ?? -1
        try? FileHandle.standardError.write(contentsOf: Data("collector-self-test phase=\(currentPhase) code=\(failure.code) child_reason=\(reason) child_status=\(status) child_elapsed_ms=\(elapsed)\n".utf8))
        preconditionFailure("Packaged collector self-test failed")
    }
}

func runRuntimeSetupSelfTests() {
    let files = FileManager.default
    let resolved = realpath(files.temporaryDirectory.path, nil)!
    let root = URL(fileURLWithPath: String(cString: resolved)).appendingPathComponent("observatory-runtime-" + UUID().uuidString)
    free(resolved)
    try! files.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    defer { try? files.removeItem(at: root) }
    let real = root.appendingPathComponent("real-assets")
    try! files.createDirectory(at: real, withIntermediateDirectories: false)
    let legacy = root.appendingPathComponent("Workspace Observatory")
    try! files.createDirectory(at: legacy, withIntermediateDirectories: false)
    func parse(_ args: [String], user: uid_t = getuid()) -> RuntimeOption {
        RuntimeOption.parse(arguments: ["Observatory"] + args, realDataFolder: real, legacyDataFolder: legacy, userID: user)
    }
    func refused(_ args: [String], user: uid_t = getuid()) {
        guard case .refused = parse(args, user: user) else { preconditionFailure("Unsafe runtime accepted") }
    }
    func throwsError(_ action: () throws -> Void) {
        do { try action(); preconditionFailure("Unsafe setup accepted") } catch {}
    }
    refused(["--runtime", legacy.path])
    refused(["--runtime", legacy.path + "/child"])
    refused(["--runtime", "/.nofollow" + legacy.path])
    throwsError { _ = try RuntimeOption.createAndLock(legacy, realDataFolder: real, legacyDataFolder: legacy) }
    precondition(parse([]) == .none)
    refused(["--runtime"])
    precondition(parse(["--runtime=" + root.path + "/fresh"]) ==
        .refused("Use --runtime followed by the folder as a separate argument."))
    let missingReal = root.appendingPathComponent("missing/data")
    guard case .refused = RuntimeOption.parse(arguments: ["--runtime", root.path],
        realDataFolder: missingReal, userID: getuid()) else { preconditionFailure("Real data ancestor accepted") }
    refused(["--runtime", "/.nofollow" + real.path])
    refused(["--runtime", "/.nofollow" + real.path + "/child"])
    var uppercaseRoot = stat()
    if stat(root.path.uppercased(), &uppercaseRoot) == 0 {
        let folded = root.appendingPathComponent("real-a\u{017F}sets")
        refused(["--runtime", folded.path])
        refused(["--runtime", folded.path + "/child"])
    }
    let absentReal = root.appendingPathComponent("absent-assets")
    var aliases = ["/System/Volumes/Data" + absentReal.path, "/.nofollow" + absentReal.path]
    if stat(root.path.uppercased(), &uppercaseRoot) == 0 {
        aliases.append(root.appendingPathComponent("absent-a\u{017F}sets").path)
    }
    for alias in aliases {
        guard case .runtime(let folder, _) = RuntimeOption.parse(arguments: ["--runtime", alias],
            realDataFolder: absentReal, userID: getuid()) else { continue }
        do {
            let locked = try RuntimeOption.createAndLock(folder, realDataFolder: absentReal)
            close(locked.descriptor)
            preconditionFailure("Real data alias created and locked")
        } catch RuntimeOption.LockError.realDataFolder {} catch { preconditionFailure("Unexpected alias failure") }
        precondition(!files.fileExists(atPath: absentReal.path))
    }
    throwsError { _ = try RuntimeOption.createAndLock(real, realDataFolder: real) }
    precondition(files.fileExists(atPath: real.path))
    precondition(!files.fileExists(atPath: real.appendingPathComponent(".observatory.lock").path))
    refused(["--runtime", "--preview"])
    refused(["--runtime", "relative/path"])
    refused(["--runtime", root.path + "/./fresh"])
    refused(["--runtime", root.path + "/../fresh"])
    refused(["--runtime", root.path])
    var dataVolume = stat()
    var temporaryVolume = stat()
    if stat("/System/Volumes/Data", &dataVolume) == 0, stat(root.path, &temporaryVolume) == 0,
       dataVolume.st_dev == temporaryVolume.st_dev {
        refused(["--runtime", "/System/Volumes/Data" + real.path])
        refused(["--runtime", "/System/Volumes/Data" + real.path + "/child"])
    }
    refused(["--runtime", real.path])
    refused(["--runtime", real.path + "/child"])
    refused(["--runtime", real.path.uppercased() + "/child"])
    refused(["--runtime", root.path + "/missing/child"])
    let linked = root.appendingPathComponent("linked")
    try! files.createSymbolicLink(at: linked, withDestinationURL: real)
    refused(["--runtime", linked.path])
    refused(["--runtime", linked.path + "/child"])
    let writable = root.appendingPathComponent("writable")
    try! files.createDirectory(at: writable, withIntermediateDirectories: false)
    precondition(chmod(writable.path, 0o770) == 0)
    refused(["--runtime", writable.path])
    refused(["--runtime", writable.path + "/child"])
    refused(["--runtime", root.path], user: getuid() == 0 ? 1 : 0)
    for flag in ["--preview", "--preview-setup", "--test-lifecycle", "--test-popup", "--preview-pace", "--enable-login", "--self-test"] {
        refused(["--runtime", root.path + "/fresh", flag])
    }
    let swapped = root.appendingPathComponent("swapped")
    try! files.createDirectory(at: swapped, withIntermediateDirectories: false)
    let directory = open(swapped.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
    precondition(directory >= 0)
    defer { close(directory) }
    let identity = FileIdentity.at(swapped.path)!
    precondition(FileIdentity.matches(descriptor: directory, path: swapped.path, expected: identity))
    try! files.moveItem(at: swapped, to: root.appendingPathComponent("original"))
    try! files.createDirectory(at: swapped, withIntermediateDirectories: false)
    precondition(!FileIdentity.matches(descriptor: directory, path: swapped.path, expected: identity))
    let fresh = root.appendingPathComponent("fresh")
    func accepted(_ path: String) -> String? { if case .runtime(let url, _) = parse(["--runtime", path]) { return url.path } else { return nil } }
    precondition(accepted(fresh.path) == fresh.path)
    let lock = try! RuntimeOption.createAndLock(fresh, realDataFolder: real)
    // An existing folder keeps its /private path. Standardizing would rewrite it to the /tmp or /var link.
    precondition(accepted(fresh.path) == fresh.path && accepted(fresh.path + "/") == fresh.path)
    defer { close(lock.descriptor) }
    precondition(chmod(fresh.path, 0o755) == 0)
    precondition(accepted(fresh.path) == fresh.path)
    precondition(chmod(fresh.path, 0o700) == 0)
    do {
        let second = try RuntimeOption.createAndLock(fresh, realDataFolder: real)
        close(second.descriptor)
        preconditionFailure("Second runtime lock accepted")
    } catch RuntimeOption.LockError.inUse {} catch { preconditionFailure("Unexpected lock failure") }
    precondition((try! files.attributesOfItem(atPath: fresh.path))[.posixPermissions] as? Int == 0o700)
    precondition(try! FirstRunSetup.prepare(runtime: fresh))
    let marker = fresh.appendingPathComponent("setup-state.json")
    let config = fresh.appendingPathComponent("collector.config.json")
    let sourceBytes = try! Data(contentsOf: config)
    precondition((try! JSONSerialization.jsonObject(with: Data(contentsOf: marker)) as! JSONObject)["completed"] as? Bool == false)
    precondition(try! FirstRunSetup.markComplete(runtime: fresh))
    let completed = try! Data(contentsOf: marker)
    precondition(completed == Data(#"{"completed":true,"version":1}"#.utf8))
    precondition((try! files.attributesOfItem(atPath: marker.path))[.posixPermissions] as? Int == 0o600)
    precondition(try! Data(contentsOf: config) == sourceBytes)
    let before = try! files.attributesOfItem(atPath: marker.path)
    precondition(try! !FirstRunSetup.markComplete(runtime: fresh))
    precondition(try! Data(contentsOf: marker) == completed)
    precondition((try! files.attributesOfItem(atPath: marker.path))[.modificationDate] as? Date == before[.modificationDate] as? Date)
    try! files.removeItem(at: marker)
    try! files.createSymbolicLink(at: marker, withDestinationURL: config)
    throwsError { _ = try FirstRunSetup.markComplete(runtime: fresh) }
    precondition((try? FirstRunSetup.required(runtime: fresh)) != false)
    try! files.removeItem(at: marker)
    try! Data(repeating: 32, count: 4097).write(to: marker)
    throwsError { _ = try FirstRunSetup.markComplete(runtime: fresh) }
    let empty = root.appendingPathComponent("empty")
    try! files.createDirectory(at: empty, withIntermediateDirectories: false)
    throwsError { _ = try FirstRunSetup.markComplete(runtime: empty) }
    precondition(!files.fileExists(atPath: empty.appendingPathComponent("setup-state.json").path))
    for argument: Any in [true, 1, "synthetic", NSNull(), ["nested": false], [false]] {
        let data = try! JSONSerialization.data(withJSONObject: ["id": 3, "action": "complete-setup", "args": ["extra": argument]])
        let message = String(data: data, encoding: .utf8)!
        guard case .refused = BridgeContract.validate(message) else { preconditionFailure("Complete setup arguments accepted") }
    }
    precondition(WebDashboardPage.url(section: "setup").fragment == "setup")
    precondition(!WebDashboardPage.sections.contains { $0.0 == "setup" })
    MainActor.assumeIsolated {
        let blockedStore = ObservatoryStore(runtime: root.appendingPathComponent("blocked"), collectionAllowed: false)
        blockedStore.runtimeIdentityValid = { false }
        blockedStore.refresh()
        precondition(blockedStore.lastAttempt == "runtime-unavailable" && !blockedStore.refreshing)
        blockedStore.lastAttempt = "synthetic"
        blockedStore.refreshAllowancesIfDue()
        precondition(blockedStore.lastAttempt == "runtime-unavailable" && !blockedStore.refreshing)
        var hookCalls = 0
        let isolatedHooks = MacBridgeHooks(openDashboard: { _ in hookCalls += 1 },
            checkForUpdates: { hookCalls += 1; return false },
            directPairingOpen: { hookCalls += 1; return false },
            applyViewerPreferences: { _, _ in hookCalls += 1 })
        let isolatedHost = MacBridgeHost(store: blockedStore, resources: root, preview: false,
            handler: BridgeHandler(), hooks: isolatedHooks, isolatedRuntime: true)
        for action in ["pairing-identity-create", "pairing-host-start", "pairing-host-confirm",
                       "pairing-join-claim", "pairing-join-confirm", "pairing-copy-invitation", "pairing-cancel",
                       "set-sharing", "set-limits-consent", "pairing-disconnect", "pairing-repair-prepare"] {
            var replied = false
            isolatedHost.perform(action: action, args: ["enabled": .bool(true)]) { code, value in
                precondition(code == .unavailable && value == nil)
                replied = true
            }
            precondition(replied && !isolatedHost.sessionOpen && hookCalls == 0)
        }
        let writeFiles = ["viewer.json", "device.json", "setup-state.json", "collector.config.json"]
        let beforeWrites = writeFiles.map { try? Data(contentsOf: blockedStore.runtime.appendingPathComponent($0)) }
        let writeActions: [(String, [String: BridgeValue])] = [
            ("set-source", ["source": .string("codex"), "enabled": .bool(true)]),
            ("set-skin", ["skin": .string("sage")]),
            ("set-appearance", ["mode": .string("dark")]),
            ("set-device-name", ["name": .string("Synthetic Mac")]),
            ("complete-setup", [:]), ("export-data", [:])]
        for (action, args) in writeActions {
            var replied = false
            isolatedHost.perform(action: action, args: args) { code, value in
                precondition(code == .unavailable && value == nil)
                replied = true
            }
            precondition(replied && hookCalls == 0)
            precondition(writeFiles.map { try? Data(contentsOf: blockedStore.runtime.appendingPathComponent($0)) } == beforeWrites)
        }
        let resources = root.appendingPathComponent("resources")
        for path in ["Collector/scripts/claude-limits-consent.mjs", "Runtime/node/bin/node"] {
            let file = resources.appendingPathComponent(path)
            try! files.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try! Data().write(to: file)
            if path.hasSuffix("/node") { precondition(chmod(file.path, 0o700) == 0) }
        }
        for isolated in [false, true] {
            let hooks = MacBridgeHooks(openDashboard: { _ in }, checkForUpdates: { false },
                directPairingOpen: { false }, applyViewerPreferences: { _, _ in })
            let host = MacBridgeHost(store: blockedStore, resources: resources, preview: !isolated,
                handler: BridgeHandler(), hooks: hooks, isolatedRuntime: isolated)
            for action in ["set-limits-consent", "set-sharing", "pairing-identity-create", "pairing-host-start",
                           "pairing-host-confirm", "pairing-join-claim", "pairing-join-confirm"] {
                var replied = false
                host.perform(action: action, args: ["enabled": .bool(false)]) { code, value in
                    precondition(code == .unavailable && value == nil)
                    replied = true
                }
                // Refuse synchronously before any queued script task can run.
                precondition(replied)
            }
        }
        for paused in [false, true] {
            let store = ObservatoryStore(runtime: root.appendingPathComponent(UUID().uuidString), collectionAllowed: false)
            store.collectionPausedForPairing = paused
            let handler = BridgeHandler()
            let hooks = MacBridgeHooks(openDashboard: { _ in }, checkForUpdates: { preconditionFailure("Isolated update invoked") },
                directPairingOpen: { false }, applyViewerPreferences: { _, _ in })
            let host = MacBridgeHost(store: store, resources: nil, preview: true, handler: handler, hooks: hooks, isolatedRuntime: true)
            for action in ["set-startup", "check-updates", "set-limits-consent", "set-sharing",
                           "pairing-identity-create", "pairing-host-start", "pairing-host-confirm", "pairing-join-claim", "pairing-join-confirm"] {
                host.perform(action: action, args: [:]) { code, value in
                    precondition(code == .unavailable && value == nil)
                }
            }
            host.perform(action: "complete-setup", args: [:]) { code, value in
                precondition(code == .done && value == nil)
            }
            precondition(!store.setupRequired && !store.refreshing)
            precondition(store.lastAttempt == (paused ? "pairing-paused" : "preview-collection-disabled"))
            store.lastAttempt = "synthetic-unchanged"
            host.perform(action: "complete-setup", args: [:]) { code, value in
                precondition(code == .done && value == nil)
            }
            precondition(store.lastAttempt == "synthetic-unchanged")
        }
    }
    print("Runtime refusals, simulated owner mismatch, exclusive lock and setup completion checks passed")
}
