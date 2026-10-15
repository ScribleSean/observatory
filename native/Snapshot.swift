import Foundation
import CoreFoundation

typealias JSONObject = [String: Any]

func number(_ value: Any?) -> Double? {
    guard let value = value as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID() else { return nil }
    let result = value.doubleValue
    return result.isFinite && result >= 0 ? result : nil
}

func rows(_ value: Any?) -> [JSONObject] { value as? [JSONObject] ?? [] }
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

struct Snapshot {
    let object: JSONObject
    var collectedAt: Date? { parseDate(object["collectedAt"]) }
    var sourceCounts: (read: Int, total: Int) {
        var sources = ["activity", "tokens", "settings", "dictation", "providerTokenSources", "providerAllowances"].flatMap { rows(object[$0]) }
        sources += ["quota", "localModel", "agentSource"].compactMap { object[$0] as? JSONObject }
        sources = sources.filter { text($0["status"]) != "not-connected" }
        return (sources.filter { text($0["status"]) == "ok" }.count, sources.count)
    }
}

struct AssetResolver {
    let root: URL
    // Each host serves only its own page or pages.
    let pages: Set<String>
    func resolve(_ url: URL) -> URL? {
        guard url.scheme == "observatory", url.host == "app", url.user == nil, url.password == nil,
              url.port == nil else { return nil }
        let path = url.path == "/" || url.path.isEmpty ? "index.html" : String(url.path.dropFirst())
        guard pages.contains(path) || path.hasPrefix("assets/") else { return nil }
        guard !path.split(separator: "/").contains(".."), !path.contains("\\"),
              !path.contains("\0"), !path.hasPrefix("local/"), !path.hasPrefix(".") else { return nil }
        let base = root.standardizedFileURL.resolvingSymlinksInPath()
        let file = base.appendingPathComponent(path).standardizedFileURL.resolvingSymlinksInPath()
        guard file.path.hasPrefix(base.path + "/"),
              ["html", "js", "css", "svg", "png", "ico", "woff2", "woff", "ttf", "txt"].contains(file.pathExtension) else { return nil }
        guard file.pathExtension != "html" || pages.contains(path) else { return nil }
        return file
    }
}
