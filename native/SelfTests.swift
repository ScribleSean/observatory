import Foundation

func runSelfTests() {
    do {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("observatory-update-gate-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: directory) }
        let bundle = directory.appendingPathComponent("Workspace Observatory.app")
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
    do {
        let object: JSONObject = ["schema": 2, "collectedAt": "2026-09-12T12:00:00Z",
            "tokens": [["host": "Mac", "status": "ok", "days": [["date": "2026-09-01", "totalTokens": 42]]]]]
        let data = try JSONSerialization.data(withJSONObject: object)
        let snapshot = try SnapshotArchive.parse(data)
        precondition(snapshot.recordedDays("tokens", host: "Mac").count == 1)
        precondition((try? SnapshotArchive.parse(Data("{\"schema\":true}".utf8))) == nil)
        precondition((try? SnapshotArchive.parse(Data("{\"schema\":2,\"collectedAt\":\"invalid\"}".utf8))) == nil)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("observatory-archive-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("saved.json")
        try data.write(to: file)
        let loaded = try SnapshotArchive.read(file)
        precondition(number(loaded.recordedDays("tokens", host: "Mac").first?["totalTokens"]) == 42)
        let unchanged = try Data(contentsOf: file)
        precondition(unchanged == data)
        let link = directory.appendingPathComponent("linked.json")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: file)
        precondition((try? SnapshotArchive.read(link)) == nil)
        precondition((try? SnapshotArchive.read(directory)) == nil)
        let oversized = directory.appendingPathComponent("oversized.json")
        _ = FileManager.default.createFile(atPath: oversized.path, contents: nil)
        let handle = try FileHandle(forWritingTo: oversized)
        try handle.truncate(atOffset: UInt64(SnapshotArchive.maximumBytes + 1))
        try handle.close()
        precondition((try? SnapshotArchive.read(oversized)) == nil)
    } catch { preconditionFailure("Snapshot archive tests failed: \(error)") }
    let sharingOff = Data("{\"version\":1,\"enabled\":false,\"canEnable\":false,\"reason\":\"account-unavailable\",\"token\":null}".utf8)
    precondition((try? QuotaSharingStatus.parse(sharingOff))?.enabled == false)
    let invalidSharing = Data("{\"version\":1,\"enabled\":true,\"canEnable\":true,\"reason\":\"ready\",\"token\":\"private\"}".utf8)
    precondition((try? QuotaSharingStatus.parse(invalidSharing)) == nil)
    let countedModel: JSONObject = ["inputTokens": 10, "cacheReadTokens": 20, "cacheCreationTokens": 0, "outputTokens": 5, "totalTokens": 35]
    precondition(nativeSettingsCoverage(model: countedModel, profiles: [countedModel]).status == "matched")
    var largerModel = countedModel
    largerModel["totalTokens"] = 40
    precondition(nativeSettingsCoverage(model: largerModel, profiles: [countedModel]).status == "partial")
    var excessiveProfile = countedModel
    excessiveProfile["inputTokens"] = 11
    precondition(nativeSettingsCoverage(model: countedModel, profiles: [excessiveProfile]).profiles.isEmpty)
    var inferredModel = countedModel
    inferredModel["inferred"] = true
    precondition(nativeSettingsCoverage(model: inferredModel, profiles: [countedModel]).status == "missing")
    precondition(nativeSettingsCoverage(model: countedModel, profiles: [[:]]).status == "unreconciled")
    precondition(nativeCounters(["invalid": -1, "boolean": true, "AI apps": 60, "Editors": 120]).map(\.name) == ["Editors", "AI apps"])
    let periodActivity: [JSONObject] = [
        ["date": "2026-09-01", "seconds": 10, "categories": ["Editors": 10], "apps": ["Editors": ["VS Code": 10]]],
        ["date": "2026-09-06", "seconds": 20, "categories": ["AI apps": 20], "apps": ["AI apps": ["ChatGPT / Codex": 20]]],
        ["date": "2026-09-12", "seconds": 30, "categories": ["Editors": 30], "apps": ["Editors": ["VS Code": 30]]]
    ]
    let selectedWeek = nativePeriodDays(periodActivity, period: "week", anchor: "2026-09-12")
    precondition(selectedWeek.count == 2)
    precondition(number(nativePeriodSummary(selectedWeek, kind: "activity")?["seconds"]) == 50)
    precondition(number(nativePeriodSummary(periodActivity, kind: "activity")?["seconds"]) == 60)
    precondition(nativePeriodDays(periodActivity, period: "day", anchor: "2026-09-07").isEmpty)
    precondition(nativePeriodDays(periodActivity, period: "invalid", anchor: "2026-09-12").isEmpty)
    let unknownDay = nativePeriodSummary([["date": "2026-09-11", "totalTokens": 10], ["date": "2026-09-12"]], kind: "tokens")
    precondition(number(unknownDay?["totalTokens"]) == nil)
    var dailyModel = countedModel
    dailyModel["model"] = "fixture-model"
    let tokenDays: [JSONObject] = [["date": "2026-09-11", "models": [dailyModel]], ["date": "2026-09-12", "models": [dailyModel]]]
    var badProfile = dailyModel
    badProfile["date"] = "2026-09-11"
    badProfile["inputTokens"] = 11
    var goodProfile = dailyModel
    goodProfile["date"] = "2026-09-12"
    let reconciled = nativePeriodProfiles(model: dailyModel, days: tokenDays,
        settings: ["status": "ok", "profiles": [badProfile, goodProfile]])
    precondition(reconciled.count == 1 && text(reconciled.first?["date"]) == "2026-09-12")
    precondition(nativePeriodProfiles(model: dailyModel, days: tokenDays,
        settings: ["status": "ok", "snapshotStable": false, "profiles": [goodProfile]]).isEmpty)
    let dictationRows: [JSONObject] = [
        ["date": "2026-09-01", "transcriptions": 1, "words": 12, "audioSeconds": 60, "wordRecords": 1, "audioRecords": 1],
        ["date": "2026-09-06", "transcriptions": 2, "words": 0, "audioSeconds": 0, "wordRecords": 0, "audioRecords": 0],
        ["date": "2026-09-12", "transcriptions": 2, "words": 8, "audioSeconds": 30, "wordRecords": 1, "audioRecords": 1]
    ]
    let dictationSource: JSONObject = ["status": "ok", "days": dictationRows.reversed().map { $0 }]
    precondition(dictationDays(dictationSource, latestWeek: true).map { text($0["date"]) } == ["2026-09-06", "2026-09-12"])
    precondition(dictationDays(dictationSource, latestWeek: false).count == 3)
    precondition(dictationDays(["status": "unavailable", "days": dictationRows], latestWeek: false).isEmpty)
    precondition(dictationValue([dictationRows[1]], field: "words", wispr: true) == "Unknown")
    precondition(dictationValue([dictationRows[2]], field: "words", wispr: true) == "8 (partial)")
    precondition(dictationValue([dictationRows[1]], field: "words", wispr: false) == "0")
    let voiceFixture: JSONObject = ["host": "Mac", "source": "Wispr Flow", "status": "ok", "days": dictationRows]
    let voiceSources = nativeVoiceSources([voiceFixture], host: "All devices", tool: "All tools")
    precondition(voiceSources.count == 4 && voiceSources[0].days.count == 3)
    precondition(voiceSources[1].status == "Tracking not yet verified" && voiceSources[1].days.isEmpty)
    precondition(voiceSources[2].status == "not-connected")
    precondition(nativeVoiceSources([voiceFixture, voiceFixture], host: "Mac", tool: "Wispr Flow")[0].days.isEmpty)
    precondition(nativeVoiceSources([["host": "Mac", "source": "ChatGPT", "status": "ok", "days": dictationRows]], host: "Mac", tool: "ChatGPT")[0].days.isEmpty)
    precondition(nativePeriodDays(voiceSources[0].days, period: "day", anchor: "2026-09-06").count == 1)
    precondition(recordedSum([], field: "words") == nil)
    precondition(recordedSum([["words": 0], [:]], field: "words") == nil)
    precondition(recordedSum([["words": 0], ["words": 8]], field: "words") == 8)
    do {
        let runtime = FileManager.default.temporaryDirectory.appendingPathComponent("observatory-first-run-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: runtime) }
        precondition((try? FirstRunSetup.prepare(runtime: runtime)) == true)
        let disabled = try CollectorConfiguration.read(runtime: runtime)
        precondition(disabled.values.allSatisfy { !$0 })
        precondition((try? FirstRunSetup.required(runtime: runtime)) == true)
        precondition((try? FirstRunSetup.prepare(runtime: runtime)) == true)
        do {
            try FirstRunSetup.complete(sources: ["quota": true], runtime: runtime)
            preconditionFailure("Incomplete consent must be rejected")
        } catch {}
        precondition((try? FirstRunSetup.required(runtime: runtime)) == true)
        try FirstRunSetup.complete(sources: disabled, runtime: runtime)
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
    let nativeHistory = Snapshot(object: [
        "tokens": [["host": "Mac", "status": "ok", "days": [["date": "2026-09-12", "totalTokens": 20], ["date": "2026-09-10", "totalTokens": 10]]],
                   ["host": "Windows", "status": "unavailable", "days": [["date": "2026-09-12", "totalTokens": 999]]]],
        "combinedTokens": ["status": "ok", "days": [["date": "2026-09-12", "totalTokens": 999]]]
    ])
    precondition(nativeHistory.days("tokens", host: "Mac").map { text($0["date"]) } == ["2026-09-10", "2026-09-12"])
    precondition(number(nativeHistory.latest("tokens", host: "Mac")?["totalTokens"]) == 20)
    let archivedActivity = Snapshot(object: [
        "activity": [["host": "Mac", "status": "unavailable", "days": []]],
        "activityHistory": [
            ["host": "Mac", "status": "ok", "latestReadStatus": "unavailable", "days": [
                ["date": "2026-09-12", "seconds": 20], ["date": "2026-08-01", "seconds": 10]]],
            ["host": "Combined", "status": "ok", "latestReadStatus": "ok", "days": [["date": "2026-09-12", "seconds": 25]]]
        ]])
    precondition(archivedActivity.recordedDays("activity", host: "Mac").map { text($0["date"]) } == ["2026-08-01", "2026-09-12"])
    precondition(archivedActivity.latest("activity", host: "Mac") == nil)
    precondition(text(archivedActivity.activityArchive(host: "Mac")?["latestReadStatus"]) == "unavailable")
    precondition(number(archivedActivity.recordedDays("activity", host: "All").last?["seconds"]) == 25)
    precondition(archivedActivity.recordedDays("activity", host: "Ubuntu").isEmpty)
    precondition(nativeHistory.recordedDays("tokens", host: "Mac").count == 2)
    precondition(nativeHistory.days("tokens", host: "Windows").isEmpty)
    precondition(nativeHistory.days("tokens", host: "All").isEmpty)
    let pairingRequest = PairingSetupRequest(transport: PairingTransport(kind: "ssh-windows", hostAlias: "fixture-host",
        remoteNode: "C:/Fixture/Runtime/node.exe", remoteScript: "C:/Fixture/Collector/peer-exchange.mjs", remoteRuntime: "C:/Fixture/Data"), includeUbuntu: false)
    precondition((try? pairingRequest.validate()) != nil)
    let invalidPairingRequest = PairingSetupRequest(transport: PairingTransport(kind: "ssh-windows", hostAlias: "-oBad",
        remoteNode: "C:/Fixture/Runtime/node.exe", remoteScript: "C:/Fixture/Collector/peer-exchange.mjs", remoteRuntime: "C:/Fixture/Data"), includeUbuntu: false)
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
    for source in ["receipts", "benchmarks"] {
        precondition(CollectorConfiguration.defaults[source] == false)
        precondition((try? CollectorConfiguration.validate([source: true]))?[source] == true)
        precondition((try? CollectorConfiguration.validate([source: "true"])) == nil)
    }
    precondition(visibleQuotaWindows([["bucket": "codex"], ["bucket": "codex_bengalfox"], ["bucket": "SPARK"], ["bucket": "codex_spark"]]).count == 1)
    let quotaSamples: [JSONObject] = [
        ["checkedAt": "2026-09-09T12:00:00Z", "windows": [["bucket": "codex", "window": "primary", "remainingPercent": 80, "resetsAt": "2026-09-09T16:00:00Z"]]],
        ["checkedAt": "2026-09-09T12:05:00Z", "windows": [["bucket": "codex", "window": "primary", "remainingPercent": 75, "resetsAt": "2026-09-09T16:00:00Z"]]],
        ["checkedAt": "2026-09-09T12:10:00Z", "windows": [["bucket": "codex", "window": "primary", "remainingPercent": 95, "resetsAt": "2026-09-09T21:00:00Z"]]]
    ]
    precondition(quotaHistoryPoints(quotaSamples, bucket: "codex", window: "primary").map(\.segment) == [0, 0, 1])
    precondition(quotaHistoryPoints(quotaSamples, bucket: "spark", window: "primary").isEmpty)
    let paceWindow: JSONObject = ["bucket": "codex", "window": "primary"]
    let dueNow = parseDate("2026-09-09T12:00:00Z")!
    precondition(allowanceRefreshDue(["nextAttemptAt": "2026-09-09T12:00:00Z"], now: dueNow))
    precondition(allowanceRefreshDue(["nextAttemptAt": "2026-09-09T11:59:00Z"], now: dueNow))
    precondition(!allowanceRefreshDue(["nextAttemptAt": "2026-09-09T12:00:01Z"], now: dueNow))
    precondition(!allowanceRefreshDue(["nextAttemptAt": "invalid"], now: dueNow))
    precondition(!allowanceRefreshDue(nil, now: dueNow))
    let paceQuota: JSONObject = ["status": "ok", "checkedAt": "2026-09-09T12:00:00Z",
        "pace": [["bucket": "codex", "window": "primary", "asOf": "2026-09-09T12:00:00Z", "summary": "Synthetic pace"]]]
    precondition(quotaPaceText(paceQuota, window: paceWindow, now: parseDate("2026-09-09T12:01:00Z")!) == "Synthetic pace")
    precondition(quotaPaceText(paceQuota, window: paceWindow, now: parseDate("2026-09-09T12:10:00Z")!) == "Estimate unavailable until a fresh reading.")
    precondition(quotaPaceText(paceQuota, window: ["bucket": "other"], now: parseDate("2026-09-09T12:01:00Z")!) == "Not enough recent history to estimate time left.")
    let coverageWindow: JSONObject = ["bucket": "codex", "window": "primary", "remainingPercent": 40, "resetsAt": "2026-09-09T16:00:00Z"]
    for rate in [-1.0, 0, 10, 20, Double.infinity] {
        let coverageQuota: JSONObject = ["status": "ok", "checkedAt": "2026-09-09T12:00:00Z",
            "pace": [["bucket": "codex", "window": "primary", "asOf": "2026-09-09T12:00:00Z", "status": "projected", "percentagePointsPerHour": rate]]]
        let live = quotaLivePace(coverageQuota, window: coverageWindow, now: parseDate("2026-09-09T12:01:00Z")!)
        if rate == 20 {
            precondition(live?.remaining == "1h 59m" && live?.reset == "3h 59m")
            precondition(abs(live!.coverage - 119.0 / 239.0) < 0.000001)
            precondition(quotaLivePace(coverageQuota, window: coverageWindow, now: parseDate("2026-09-09T12:02:00Z")!)?.remaining == "1h 58m")
        } else if rate == 10 { precondition(live?.remaining == "Lasts until reset" && live?.coverage == 1) }
        else { precondition(live == nil) }
        precondition(quotaPaceCoverage(coverageQuota, window: coverageWindow, now: parseDate("2026-09-09T12:10:00Z")!) == nil)
        precondition(quotaPaceCoverage(coverageQuota, window: ["bucket": "other"], now: parseDate("2026-09-09T12:01:00Z")!) == nil)
    }
    var hourlyCalendar = Calendar(identifier: .gregorian)
    hourlyCalendar.timeZone = TimeZone(secondsFromGMT: 0)!
    let hourly = quotaHourlyPace(quotaHistoryPoints(quotaSamples, bucket: "codex", window: "primary"), calendar: hourlyCalendar)
    precondition(hourly.count == 1 && hourly[0].percentagePointsPerHour == 60 && hourly[0].observedMinutes == 5)
    let boundary = [QuotaHistoryPoint(id: 0, at: dueNow.addingTimeInterval(-60), used: 10, segment: 0),
                    QuotaHistoryPoint(id: 1, at: dueNow.addingTimeInterval(60), used: 12, segment: 0)]
    precondition(quotaHourlyPace(boundary, calendar: hourlyCalendar).isEmpty)
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
        try Data("{}".utf8).write(to: directory.appendingPathComponent("local.config.json"))
        let legacy = try CollectorConfiguration.prepare(runtime: directory)
        precondition(legacy == false)
        precondition(!FileManager.default.fileExists(atPath: config.path))
    } catch { preconditionFailure("Collector configuration self-test failed") }
    precondition(number(true) == nil)
    precondition(number(-1) == nil)
    precondition(number(Double.infinity) == nil)
    precondition(number(0) == 0)
    precondition(formatted(nil) == "Unknown")
    precondition(parseDate("2026-09-08T20:00:00.123Z") != nil)
    precondition(parseDate("2026-09-08T20:00:00Z") != nil)
    let source: JSONObject = ["host": "Mac", "status": "ok", "source": "Wispr Flow", "days": [
        ["date": "2026-09-08", "audioSeconds": 60], ["date": "2026-09-07", "audioSeconds": 20]]]
    let snapshot = Snapshot(object: ["dictation": [source], "activity": [["host": "Windows", "status": "unavailable"]]])
    precondition(number(snapshot.latest("dictation", host: "Mac", source: "Wispr Flow")?["audioSeconds"]) == 60)
    precondition(snapshot.latest("dictation", host: "Windows", source: "Wispr Flow") == nil)
    precondition(snapshot.latest("dictation", host: "Mac", source: "TypeWhisper") == nil)
    precondition(snapshot.sourceCounts.read == 1 && snapshot.sourceCounts.total == 2)
    let combined = Snapshot(object: [
        "combined": ["status": "ok", "days": [["date": "2026-09-08", "seconds": 90]]],
        "combinedTokens": ["status": "ok", "verification": ["status": "verified"],
                           "days": [["date": "2026-09-08", "totalTokens": 600]]],
        "dictation": [source]])
    precondition(number(combined.latest("activity", host: "All")?["seconds"]) == 90)
    precondition(number(combined.latest("tokens", host: "All")?["totalTokens"]) == 600)
    precondition(combined.latest("dictation", host: "All", source: "Wispr Flow") == nil)
    let unverified = Snapshot(object: ["combinedTokens": ["status": "ok",
        "days": [["date": "2026-09-08", "totalTokens": 600]]]])
    precondition(unverified.latest("tokens", host: "All") == nil)
    precondition(snapshot.latest("activity", host: "All") == nil)
    let unavailable = Snapshot(object: ["combined": ["status": "unavailable",
        "days": [["date": "2026-09-08", "seconds": 90]]]])
    precondition(unavailable.latest("activity", host: "All") == nil)
    let resolver = AssetResolver(root: URL(fileURLWithPath: "/tmp/observatory-test-assets"))
    precondition(resolver.resolve(URL(string: "observatory://app/index.html")!) != nil)
    precondition(resolver.resolve(URL(string: "observatory://app/assets/app.js")!) != nil)
    precondition(resolver.resolve(URL(string: "observatory://app/assets/InterTight.ttf")!) != nil)
    precondition(resolver.resolve(URL(string: "observatory://app/../InterTight.ttf")!) == nil)
    for url in ["https://app/index.html", "observatory://other/index.html", "observatory://app/../secret.json",
                "observatory://app/%2e%2e/secret.json", "observatory://app/local/usage.json",
                "observatory://app/.env", "observatory://app/native-runtime.json/../../secret.json",
                "observatory://user@app/index.html", "observatory://app:80/index.html"] {
        precondition(resolver.resolve(URL(string: url)!) == nil, "Unsafe asset URL accepted")
    }
    print("Native self-tests passed")
}

func runCollectorSelfTest() {
    do {
        guard let resources = Bundle.main.resourceURL else { throw CocoaError(.fileReadNoSuchFile) }
        let runtime = FileManager.default.temporaryDirectory.appendingPathComponent("observatory-collector-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: runtime) }
        _ = try CollectorConfiguration.prepare(runtime: runtime)
        try CollectorConfiguration.save(Dictionary(uniqueKeysWithValues: CollectorConfiguration.defaults.keys.map { ($0, false) }), runtime: runtime)
        let launch = try CollectorConfiguration.launch(runtime: runtime, resources: resources, local: true)
        let task = Process()
        task.executableURL = launch.executable
        task.arguments = launch.arguments
        task.currentDirectoryURL = runtime
        task.environment = ["PATH": "/usr/bin:/bin", "HOME": runtime.path]
        try task.run()
        task.waitUntilExit()
        precondition(task.terminationStatus == 0)
        let object = readObject(runtime.appendingPathComponent("public/local/usage.json"))
        precondition(number(object?["schema"]) == 2)
        let status = readObject(runtime.appendingPathComponent("public/local/collector.json"))
        precondition(number(status?["sourcesConfigured"]) == 0)
        let configFile = runtime.appendingPathComponent("collector.config.json")
        let originalConfig = try Data(contentsOf: configFile)
        let setupStatus = try PairingSetup.readStatus(runtime: runtime, resources: resources)
        precondition(setupStatus.status == .unpaired && setupStatus.request == nil)
        precondition(!FileManager.default.fileExists(atPath: runtime.appendingPathComponent("private-sync").path))
        try PairingMaintenance.runDisconnect(runtime: runtime, resources: resources)
        try PairingMaintenance.runDisconnect(runtime: runtime, resources: resources)
        precondition(FileManager.default.fileExists(atPath: runtime.appendingPathComponent("private-sync/revoked").path))
        let retainedConfig = try Data(contentsOf: configFile)
        precondition(retainedConfig == originalConfig)
        let disabledStatus = try PairingSetup.readStatus(runtime: runtime, resources: resources)
        precondition(disabledStatus.status == .needsRepair && disabledStatus.request == nil)
        try PairingMaintenance.runPrepareRepair(runtime: runtime, resources: resources)
        let retired = try FileManager.default.contentsOfDirectory(at: runtime, includingPropertiesForKeys: nil)
            .filter { $0.lastPathComponent.hasPrefix("private-sync-retired-") }
        precondition(retired.count == 1)
        precondition(FileManager.default.fileExists(atPath: retired[0].appendingPathComponent("revoked").path))
        precondition(!FileManager.default.fileExists(atPath: runtime.appendingPathComponent("private-sync").path))
        let repairedStatus = try PairingSetup.readStatus(runtime: runtime, resources: resources)
        precondition(repairedStatus.status == .unpaired && repairedStatus.request == nil)
        let configAfterRepair = try Data(contentsOf: configFile)
        precondition(configAfterRepair == originalConfig)
        print("Packaged repair preparation self-test passed with a retained disabled backup")
        print("Packaged pairing status self-test passed without exposing private credentials")
        print("Packaged pairing revocation self-test passed with temporary data")
        print("Packaged collector self-test passed with all sources disabled")
    } catch {
        FileHandle.standardError.write(Data("Packaged collector self-test error code: \((error as NSError).code)\n".utf8))
        preconditionFailure("Packaged collector self-test failed")
    }
}
