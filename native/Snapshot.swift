import Foundation
import CoreFoundation

typealias JSONObject = [String: Any]

func number(_ value: Any?) -> Double? {
    guard let value = value as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID() else { return nil }
    let result = value.doubleValue
    return result.isFinite && result >= 0 ? result : nil
}

func rows(_ value: Any?) -> [JSONObject] { value as? [JSONObject] ?? [] }
func visibleQuotaWindows(_ value: Any?) -> [JSONObject] {
    rows(value).filter { !["codex_bengalfox", "codex_spark", "spark"].contains(text($0["bucket"]).lowercased()) }
}
func text(_ value: Any?, fallback: String = "Unknown") -> String { value as? String ?? fallback }

func readObject(_ url: URL) -> JSONObject? {
    guard let size = try? url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey]),
          size.isRegularFile == true, let count = size.fileSize, count <= 16_000_000,
          let data = try? Data(contentsOf: url),
          let value = try? JSONSerialization.jsonObject(with: data) as? JSONObject else { return nil }
    return value
}

func dashboardSnapshotURL(runtime: URL, name: String) -> URL? {
    guard ["usage", "collector"].contains(name) else { return nil }
    let base = runtime.standardizedFileURL.resolvingSymlinksInPath()
    let file = base.appendingPathComponent("public/local/\(name).json").standardizedFileURL
    guard file.resolvingSymlinksInPath().path == file.path else { return nil }
    return file
}

func parseDate(_ value: Any?) -> Date? {
    guard let value = value as? String else { return nil }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: value) { return date }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: value)
}

func formatted(_ value: Double?, compact: Bool = false) -> String {
    guard let value, value.isFinite else { return "Unknown" }
    if compact {
        for (divisor, suffix) in [(1e12, "T"), (1e9, "B"), (1e6, "M"), (1e3, "K")] {
            if abs(value) >= divisor - divisor / 20000 {
                return (value / divisor).formatted(.number.precision(.fractionLength(0...1))) + suffix
            }
        }
    }
    return value.formatted(.number.precision(.fractionLength(0...1)))
}

func formattedDuration(_ seconds: Double?) -> String {
    guard let seconds, seconds.isFinite, seconds >= 0 else { return "Unknown" }
    if seconds < 3600 { return "\(formatted(seconds / 60)) min" }
    let minutes = floor(seconds / 60)
    let days = floor(minutes / 1440), hours = floor(minutes.truncatingRemainder(dividingBy: 1440) / 60)
    let remainder = minutes.truncatingRemainder(dividingBy: 60)
    return (days > 0 ? "\(formatted(days))d " : "") + "\(formatted(hours))h \(formatted(remainder))m"
}

struct Snapshot {
    let object: JSONObject
    var collectedAt: Date? { parseDate(object["collectedAt"]) }
    var quotaWindows: [JSONObject] {
        guard let quota = object["quota"] as? JSONObject, text(quota["status"]) == "ok" else { return [] }
        return visibleQuotaWindows(quota["windows"])
    }
    var sourceCounts: (read: Int, total: Int) {
        var sources = ["activity", "tokens", "settings", "dictation", "providerTokenSources"].flatMap { rows(object[$0]) }
        sources += ["quota", "localModel", "agentSource"].compactMap { object[$0] as? JSONObject }
        sources = sources.filter { text($0["status"]) != "not-connected" }
        return (sources.filter { text($0["status"]) == "ok" }.count, sources.count)
    }
    func latest(_ key: String, host: String, source: String? = nil) -> JSONObject? {
        days(key, host: host, source: source).last
    }
    func activityArchive(host: String) -> JSONObject? {
        let name = host == "All" ? "Combined" : host
        return rows(object["activityHistory"]).first { text($0["host"]) == name }
    }
    func recordedDays(_ key: String, host: String) -> [JSONObject] {
        // Archived activity is already sanitized and overlap-deduplicated by
        // the collector. Keep its source status separate from saved records.
        if key == "activity", let archive = activityArchive(host: host) {
            guard text(archive["status"]) == "ok" else { return [] }
            return rows(archive["days"]).sorted { text($0["date"]) < text($1["date"]) }
        }
        return days(key, host: host)
    }
    func days(_ key: String, host: String, source: String? = nil) -> [JSONObject] {
        let selected: JSONObject?
        if host == "All" {
            // Reuse collector-verified aggregates. Never sum device snapshots here.
            if key == "activity" { selected = object["combined"] as? JSONObject }
            else if key == "tokens" {
                let combined = object["combinedTokens"] as? JSONObject
                guard let verification = combined?["verification"] as? JSONObject,
                      text(verification["status"]) == "verified" else { return [] }
                selected = combined
            } else { return [] }
        } else {
            selected = rows(object[key]).first(where: {
                text($0["host"]) == host && (source == nil || text($0["source"]) == source)
            })
        }
        guard let item = selected, text(item["status"]) == "ok" else { return [] }
        return rows(item["days"]).sorted { text($0["date"]) < text($1["date"]) }
    }
}

struct AssetResolver {
    let root: URL
    func resolve(_ url: URL) -> URL? {
        guard url.scheme == "observatory", url.host == "app", url.user == nil, url.password == nil,
              url.port == nil else { return nil }
        let path = url.path == "/" || url.path.isEmpty ? "index.html" : String(url.path.dropFirst())
        guard path == "index.html" || path.hasPrefix("assets/") else { return nil }
        guard !path.split(separator: "/").contains(".."), !path.contains("\\"),
              !path.contains("\0"), !path.hasPrefix("local/"), !path.hasPrefix(".") else { return nil }
        let base = root.standardizedFileURL.resolvingSymlinksInPath()
        let file = base.appendingPathComponent(path).standardizedFileURL.resolvingSymlinksInPath()
        guard file.path.hasPrefix(base.path + "/"),
              ["html", "js", "css", "svg", "png", "ico", "woff2", "woff", "ttf", "txt"].contains(file.pathExtension) else { return nil }
        return file
    }
}
