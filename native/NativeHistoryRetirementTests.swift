import Foundation

private func nativeScopeFixture() throws -> JSONObject {
    try SnapshotArchive.parse(Data(#"""
        {"schema":2,"collectedAt":"2026-09-12T12:00:00Z",
         "tokens":[{"host":"Mac","status":"ok","days":[{"date":"2026-09-12","totalTokens":10}]},
                   {"host":"Windows","status":"ok","days":[{"date":"2026-09-12","totalTokens":20}]}],
         "settings":[{"host":"Mac","status":"ok"},{"host":"Windows","status":"ok"}],
         "combinedTokens":{"status":"ok","verification":{"status":"verified"},
                           "days":[{"date":"2026-09-12","totalTokens":30}]},
         "activity":[{"host":"Mac","status":"ok","days":[{"date":"2026-09-12","seconds":600}]},
                     {"host":"Windows","status":"ok","days":[{"date":"2026-09-12","seconds":1200}]}],
         "combined":{"status":"ok","days":[{"date":"2026-09-12","seconds":1800}]},
         "activityHistory":[{"host":"Mac","status":"ok","days":[{"date":"2026-09-01","seconds":3000}]},
                            {"host":"Windows","status":"ok","days":[{"date":"2026-09-01","seconds":6000}]},
                            {"host":"Combined","status":"ok","days":[{"date":"2026-09-01","seconds":9000}]}]}
        """#.utf8)).object
}

private func testMalformedNativeAggregateProvenance() throws {
    var failures: [String] = []
    var count = 0
    func fragment(_ json: String) throws -> Any {
        try JSONSerialization.jsonObject(with: Data(json.utf8), options: .fragmentsAllowed)
    }
    func verify(_ name: String, _ object: JSONObject, _ kind: String, _ allowed: Bool, history: Double? = nil) throws {
        count += 1
        let before = try JSONSerialization.data(withJSONObject: object, options: .sortedKeys)
        let imported = try SnapshotArchive.parse(before)
        let metric = kind == "tokens" ? "totalTokens" : "seconds"
        func check(_ value: Bool, _ message: String) {
            if !value { failures.append(name + ": " + message) }
        }
        check(imported.hasNativeAggregateScope(kind) == allowed, "Incorrect native scope decision.")
        let latest = imported.latest(kind, host: "All")
        let days = imported.recordedDays(kind, host: "All")
        if allowed {
            check(number(latest?[metric]) == (kind == "tokens" ? 30 : 1800), "Verified native latest total was changed.")
            check(number(days.last?[metric]) == (history ?? (kind == "tokens" ? 30 : 9000)),
                  "Verified native archive total was changed.")
        } else {
            check(latest == nil && days.isEmpty, "Malformed provenance leaked into native All.")
        }
        // The other category remains readable, including older per-device archive records.
        let other = kind == "tokens" ? "activity" : "tokens"
        let otherMetric = kind == "tokens" ? "seconds" : "totalTokens"
        check(number(imported.recordedDays(other, host: "Mac").last?[otherMetric]) == (kind == "tokens" ? 3000 : 10),
              "Unrelated per-device history was lost.")
        let after = try JSONSerialization.data(withJSONObject: imported.object, options: .sortedKeys)
        check(before == after, "Scope validation rewrote imported evidence.")
    }

    for key in ["tokens", "settings", "activity", "activityHistory"] {
        let kind = ["tokens", "settings"].contains(key) ? "tokens" : "activity"
        try verify(key + "/native", nativeScopeFixture(), kind, true)
        var absent = try nativeScopeFixture()
        absent.removeValue(forKey: key)
        try verify(key + "/absent", absent, kind, key != "tokens", history: key == "activityHistory" ? 1800 : nil)
        var empty = try nativeScopeFixture()
        empty[key] = [Any]()
        try verify(key + "/empty", empty, kind, key != "tokens", history: key == "activityHistory" ? 1800 : nil)
        for shape in ["null", "{}", #""invalid""#, "7", "true", #"{"host":"Ubuntu","status":"ok"}"#] {
            var malformed = try nativeScopeFixture()
            malformed[key] = try fragment(shape)
            try verify(key + "/shape/" + shape, malformed, kind, false)
        }
        for member in ["null", #""invalid""#, "7", "true", "[]"] {
            var mixed = try nativeScopeFixture()
            mixed[key] = (mixed[key] as! [Any]) + [try fragment(member)]
            try verify(key + "/mixed/" + member, mixed, kind, false)
            var retired = try nativeScopeFixture()
            retired[key] = [["host": "Ubuntu", "status": "ok"], try fragment(member)] as [Any]
            retired["combinedTokens"] = ["status": "ok", "verification": ["status": "verified"],
                "days": [["date": "2026-09-12", "totalTokens": 60]]]
            try verify(key + "/retired-mixed/" + member, retired, kind, false)
        }
        for explicitEmpty in [false, true] {
            var placeholder: JSONObject = ["host": "Ubuntu", "status": "not-connected"]
            if explicitEmpty {
                for field in ["days", "profiles", "tools"] { placeholder[field] = [Any]() }
            }
            var object = try nativeScopeFixture()
            object[key] = (object[key] as! [Any]) + [placeholder]
            try verify(key + "/empty-placeholder/\(explicitEmpty)", object, kind, true)
        }
        for (field, evidence) in [
            ("days", #"[{"date":"2026-09-01","totalTokens":30,"seconds":30}]"#),
            ("profiles", #"[{"model":"fixture","totalTokens":30}]"#),
            ("tools", #"[{"tool":"Codex","totalTokens":30}]"#)] {
            for value in [evidence, "null", "{}", #""invalid""#, "7", "true"] {
                var object = try nativeScopeFixture()
                let placeholder: JSONObject = ["host": "Ubuntu", "status": "not-connected", field: try fragment(value)]
                object[key] = (object[key] as! [Any]) + [placeholder]
                try verify(key + "/placeholder/" + field + "/" + value, object, kind, false)
            }
        }
    }
    print("Native scope provenance fixtures: \(count), failures: \(failures.count).")
    precondition(failures.isEmpty, failures.joined(separator: "\n"))
}

func runNativeHistoryRetirementTests() {
    do {
        try testMalformedNativeAggregateProvenance()
        let mixedData = Data(#"""
            {"schema":2,"collectedAt":"2026-09-12T12:00:00Z","tokens":[
              {"host":"Mac","status":"ok","days":[{"date":"2026-09-12","totalTokens":10}]},
              {"host":"Windows","status":"ok","days":[{"date":"2026-09-12","totalTokens":20}]},
              {"host":"Ubuntu","status":"ok","days":[{"date":"2026-09-12","totalTokens":30}]}],
             "combinedTokens":{"host":"All","status":"ok","verification":{"status":"verified"},
              "days":[{"date":"2026-09-12","totalTokens":60}]}}
            """#.utf8)
        let mixed = try SnapshotArchive.parse(mixedData)
        let before = try JSONSerialization.data(withJSONObject: mixed.object, options: .sortedKeys)
        precondition(mixed.latest("tokens", host: "All") == nil, "Mixed-scope verified totals must not become native All")
        precondition(mixed.recordedDays("tokens", host: "All").isEmpty)
        for (host, total) in [("Mac", 10.0), ("Windows", 20.0), ("Ubuntu", 30.0)] {
            precondition(number(mixed.latest("tokens", host: host)?["totalTokens"]) == total)
            precondition(number(mixed.recordedDays("tokens", host: host).last?["totalTokens"]) == total)
        }
        precondition(nativeHistoryDevices(mixed, key: "tokens") == ["All", "Mac", "Windows", "Ubuntu"])
        precondition(nativeHistoryDeviceLabel("Ubuntu") == "Archived Ubuntu")
        precondition(nativeArchivedHistoryNotice.contains("Read-only") && nativeArchivedHistoryNotice.contains("not collecting"))
        let after = try JSONSerialization.data(withJSONObject: mixed.object, options: .sortedKeys)
        precondition(before == after, "History scope checking must not rewrite stored records")
        var past = mixed.object
        past["tokens"] = rows(past["tokens"]).map { row -> JSONObject in
            var source = row
            source["days"] = rows(row["days"]) + [["date": "2026-09-01", "totalTokens": 7]]
            return source
        }
        let pastBefore = try JSONSerialization.data(withJSONObject: past, options: .sortedKeys)
        for host in ["Mac", "Windows", "Ubuntu"] {
            let days = Snapshot(object: past).recordedDays("tokens", host: host)
            precondition(days.map { text($0["date"]) } == ["2026-09-01", "2026-09-12"])
            precondition(number(nativePeriodDays(days, period: "day", anchor: "2026-09-01").first?["totalTokens"]) == 7)
        }
        let pastAfter = try JSONSerialization.data(withJSONObject: past, options: .sortedKeys)
        precondition(pastBefore == pastAfter, "Past-date navigation must not reorder stored rows")

        var native = mixed.object
        native["tokens"] = rows(native["tokens"]).filter { text($0["host"]) != "Ubuntu" }
        native["combinedTokens"] = ["status": "ok", "verification": ["status": "verified"],
            "days": [["date": "2026-09-12", "totalTokens": 30]]]
        precondition(number(Snapshot(object: native).latest("tokens", host: "All")?["totalTokens"]) == 30)
        precondition(number(Snapshot(object: native).recordedDays("tokens", host: "All").last?["totalTokens"]) == 30)
        precondition(nativeHistoryDevices(Snapshot(object: native), key: "tokens") == ["All", "Mac", "Windows"])
        var unknownScope = native
        unknownScope.removeValue(forKey: "tokens")
        precondition(Snapshot(object: unknownScope).latest("tokens", host: "All") == nil)
        precondition(Snapshot(object: unknownScope).recordedDays("tokens", host: "All").isEmpty)
        native["combinedTokens"] = ["status": "ok", "verification": ["status": "overlap"],
            "days": [["date": "2026-09-12", "totalTokens": 30]]]
        precondition(Snapshot(object: native).recordedDays("tokens", host: "All").isEmpty)
        native.removeValue(forKey: "combinedTokens")
        precondition(Snapshot(object: native).latest("tokens", host: "All") == nil, "Do not invent a smaller sum")

        let ubuntuData = Data(#"{"schema":2,"collectedAt":"2026-09-12T12:00:00Z","tokens":[{"host":"Ubuntu","status":"ok","days":[{"date":"2026-09-12","totalTokens":42}]}]}"#.utf8)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("observatory-retired-history-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("ubuntu-only.json")
        try ubuntuData.write(to: file)
        let ubuntu = try SnapshotArchive.read(file)
        precondition(nativeHistoryDevices(ubuntu, key: "tokens").contains("Ubuntu"))
        precondition(number(ubuntu.recordedDays("tokens", host: "Ubuntu").last?["totalTokens"]) == 42)
        precondition(ubuntu.recordedDays("tokens", host: "All").isEmpty && ubuntu.recordedDays("tokens", host: "Mac").isEmpty)
        precondition(nativeHistoryDevices(ubuntu, key: "activity") == ["All", "Mac", "Windows"])
        let saved = try Data(contentsOf: file)
        precondition(saved == ubuntuData, "Opening archived history must preserve exact original bytes")

        for day: JSONObject in [["date": "invalid", "totalTokens": 42], ["date": "2026-02-30", "totalTokens": 42],
                                ["date": "2026-09-12", "totalTokens": -1], ["date": "2026-09-12", "totalTokens": true],
                                ["date": "2026-09-12", "totalTokens": "42"], ["date": "2026-09-12"]] {
            let invalid = Snapshot(object: ["tokens": [["host": "Ubuntu", "status": "ok", "days": [day]]]])
            precondition(!nativeHistoryDevices(invalid, key: "tokens").contains("Ubuntu"))
        }
        let absent = Snapshot(object: ["tokens": [["host": "Ubuntu", "status": "unavailable", "days": [["date": "2026-09-12", "totalTokens": 42]]]]])
        precondition(!nativeHistoryDevices(absent, key: "tokens").contains("Ubuntu"))
        let activity = Snapshot(object: [
            "activity": [["host": "Ubuntu", "status": "ok", "days": [["date": "2026-09-12", "seconds": 42]]]],
            "combined": ["status": "ok", "days": [["date": "2026-09-12", "seconds": 42]]],
            "activityHistory": [["host": "Combined", "status": "ok", "days": [["date": "2026-09-12", "seconds": 42]]]]])
        precondition(activity.latest("activity", host: "All") == nil && activity.recordedDays("activity", host: "All").isEmpty)
        precondition(number(activity.recordedDays("activity", host: "Ubuntu").last?["seconds"]) == 42)
        print("Native historical scope and archived read-only device history passed")
    } catch { preconditionFailure("Native retired history fixture failed: \(error)") }
}
