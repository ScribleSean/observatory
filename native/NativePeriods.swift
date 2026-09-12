import Foundation

func nativePeriodDays(_ days: [JSONObject], period: String, anchor: String) -> [JSONObject] {
    guard ["day", "week", "all"].contains(period), !days.isEmpty else { return [] }
    let sorted = days.sorted { text($0["date"]) < text($1["date"]) }
    guard sorted.allSatisfy({ parseDate(text($0["date"]) + "T12:00:00Z") != nil }) else { return [] }
    if period == "all" { return sorted }
    guard let end = parseDate(anchor + "T12:00:00Z") else { return [] }
    let start = end.addingTimeInterval(period == "week" ? -6 * 86400 : 0)
    return sorted.filter {
        guard let date = parseDate(text($0["date"]) + "T12:00:00Z") else { return false }
        return date >= start && date <= end
    }
}

private func summedMap(_ maps: [JSONObject]) -> JSONObject {
    var result: JSONObject = [:]
    for key in Set(maps.flatMap(\.keys)) {
        let values = maps.map { map -> JSONObject in ["value": map[key] ?? 0] }
        result[key] = recordedSum(values, field: "value") as Any? ?? NSNull()
    }
    return result
}

private func savedEstimateTotal(_ records: [JSONObject]) -> JSONObject? {
    let estimates = records.compactMap { $0["apiEstimate"] as? JSONObject }
    guard estimates.count == records.count, !estimates.isEmpty else { return nil }
    var result: JSONObject = [:]
    for field in ["usd", "coveredTokens", "excluded"] {
        result[field] = recordedSum(estimates, field: field) as Any? ?? NSNull()
    }
    result["checked"] = Set(estimates.map { text($0["checked"]) }).sorted().joined(separator: ", ")
    return result
}

private struct NativeModelKey: Hashable {
    let name: String
    let inferred: Bool
}

func nativePeriodSummary(_ days: [JSONObject], kind: String) -> JSONObject? {
    guard !days.isEmpty else { return nil }
    if days.count == 1 { return days[0] }
    var result: JSONObject = ["date": text(days.last?["date"]), "recordedDays": days.count,
                              "startDate": text(days.first?["date"]), "endDate": text(days.last?["date"])]
    if kind == "activity" {
        for field in ["seconds", "trackedSeconds"] { result[field] = recordedSum(days, field: field) as Any? ?? NSNull() }
        let categories = days.compactMap { $0["categories"] as? JSONObject }
        if categories.count == days.count { result["categories"] = summedMap(categories) }
        let appDays = days.compactMap { $0["apps"] as? JSONObject }
        // A missing app breakdown is not an empty day. Withhold the range
        // breakdown rather than imply that partial app counters cover it all.
        if appDays.count == days.count {
            var apps: JSONObject = [:]
            for category in Set(appDays.flatMap(\.keys)) {
                apps[category] = summedMap(appDays.map { $0[category] as? JSONObject ?? [:] })
            }
            result["apps"] = apps
        }
    } else {
        let fields = ["inputTokens", "cacheReadTokens", "cacheCreationTokens", "outputTokens", "reasoningOutputTokens", "totalTokens"]
        for field in fields { result[field] = recordedSum(days, field: field) as Any? ?? NSNull() }
        var grouped: [NativeModelKey: [JSONObject]] = [:]
        for model in days.flatMap({ rows($0["models"]) }) {
            grouped[NativeModelKey(name: text(model["model"]), inferred: model["inferred"] as? Bool == true), default: []].append(model)
        }
        result["models"] = grouped.map { key, models -> JSONObject in
            var model: JSONObject = ["model": key.name, "inferred": key.inferred]
            for field in fields { model[field] = recordedSum(models, field: field) as Any? ?? NSNull() }
            model["apiEstimate"] = savedEstimateTotal(models)
            return model
        }.sorted { text($0["model"]) < text($1["model"]) }
        result["apiEstimate"] = savedEstimateTotal(days)
    }
    return result
}

func nativePeriodProfiles(model: JSONObject, days: [JSONObject], settings: JSONObject?) -> [JSONObject] {
    guard text(settings?["status"]) == "ok", settings?["snapshotStable"] as? Bool != false else { return [] }
    let profiles = rows(settings?["profiles"])
    // Reconcile against each day's counters first. A surplus on one date must
    // not be hidden by unused capacity on another date in a period total.
    return days.flatMap { day -> [JSONObject] in
        guard let daily = rows(day["models"]).first(where: {
            text($0["model"]) == text(model["model"]) && ($0["inferred"] as? Bool == true) == (model["inferred"] as? Bool == true)
        }) else { return [] }
        let matching = profiles.filter { text($0["date"]) == text(day["date"]) && text($0["model"]) == text(model["model"]) }
        return nativeSettingsCoverage(model: daily, profiles: matching).profiles
    }
}
