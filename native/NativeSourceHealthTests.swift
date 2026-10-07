import Foundation

func runNativeSourceHealthTests() {
    let mixed = Snapshot(object: ["tokens": [
        ["host": "Windows", "status": "ok"],
        ["host": "Mac", "status": "unavailable"],
        ["host": "Ubuntu", "status": "ok"]
    ]])
    let actual = nativeCodexSourceCaption(mixed)
    precondition(actual == "1/2 native device records read", "Codex native record count: expected 1/2 native device records read, got \(actual)")
    let receiptCaption = nativeReceiptSourceCaption([["status": "failed"]])
    precondition(receiptCaption == "1 handoff receipt · 1 saved failure. Not a live agent monitor.",
                 "Receipt grammar: expected singular receipt and failure, got \(receiptCaption)")
    precondition(nativeCodexSourceCaption(nil) == "Unknown")
    precondition(nativeCodexSourceCaption(Snapshot(object: [:])) == "Unknown")
    let archive: JSONObject = ["host": "Ubuntu", "status": "ok",
        "days": [["date": "2026-08-01", "totalTokens": 42]]]
    let archived = Snapshot(object: ["tokens": [archive]])
    precondition(nativeCodexSourceCaption(archived) == "Unknown")
    precondition(text(archived.recordedDays("tokens", host: "Ubuntu").first?["date"]) == "2026-08-01")
    precondition(number(archived.recordedDays("tokens", host: "Ubuntu").first?["totalTokens"]) == 42)
    precondition(nativeHistoryDeviceLabel("Ubuntu") == "Archived Ubuntu")
    precondition(parseDate(archive["checkedAt"]) == nil)
    let statuses: [String?] = ["ok", "not-connected", "unavailable", "partial", "stale", "unsupported", "future-status", "", nil]
    for status in statuses {
        var row: JSONObject = ["host": "Mac"]
        if let status { row["status"] = status }
        let expected = status == "not-connected" ? "Unknown"
            : status == "ok" ? "1/1 native device records read" : "0/1 native device records read"
        precondition(nativeCodexSourceCaption(Snapshot(object: ["tokens": [row, archive]])) == expected)
    }
    for host in ["mac", "Windows ", "WSL", "Archived Ubuntu", "archivedUbuntu", "Unknown"] {
        precondition(nativeCodexSourceCaption(Snapshot(object: ["tokens": [["host": host, "status": "ok"]]])) == "Unknown")
    }
    let duplicates: [JSONObject] = [["host": "Mac", "status": "ok"], ["host": "Mac", "status": "unavailable"],
        ["host": "Windows", "status": "ok"], archive]
    let retained = Snapshot(object: ["tokens": duplicates,
        "providerTokenSources": [["provider": "claude-code", "host": "Mac", "status": "ok"]]])
    let before = try! JSONSerialization.data(withJSONObject: retained.object, options: .sortedKeys)
    precondition(nativeCodexSourceCaption(retained) == "2/3 native device records read")
    precondition(retained.sourceCounts.read == 4 && retained.sourceCounts.total == 5, "Global sourceCounts keeps its existing separate scope")
    precondition(try! JSONSerialization.data(withJSONObject: retained.object, options: .sortedKeys) == before)
    for (statuses, expected): ([String], String) in [
        ([], "0 handoff receipts · 0 saved failures. Not a live agent monitor."),
        (["ok"], "1 handoff receipt · 0 saved failures. Not a live agent monitor."),
        (["failed", "ok"], "2 handoff receipts · 1 saved failure. Not a live agent monitor."),
        (["failed", "failed"], "2 handoff receipts · 2 saved failures. Not a live agent monitor."),
        (["Failed", "unavailable", "future-status"], "3 handoff receipts · 0 saved failures. Not a live agent monitor.")
    ] {
        precondition(nativeReceiptSourceCaption(statuses.map { ["status": $0] }) == expected)
    }
    print("Native Source health count, receipt grammar, Unknown and retained-history regressions passed")
}
