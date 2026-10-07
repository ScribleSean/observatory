import Foundation

let nativeArchivedHistoryNotice = "Archived Ubuntu. Read-only saved records. Observatory is not collecting from Ubuntu. These records are not included in native All totals."
let nativeHistoryScopeNotice = "All is unavailable because this saved aggregate's device scope is not verified as Mac and Windows only. Select a device to view its recorded history."

func nativeHistoryDeviceLabel(_ host: String) -> String { host == "Ubuntu" ? "Archived Ubuntu" : host }

func nativeHistoryDevices(_ snapshot: Snapshot?, key: String) -> [String] {
    let native = ["All", "Mac", "Windows"]
    guard ["activity", "tokens"].contains(key),
          let snapshot, !snapshot.recordedDays(key, host: "Ubuntu").isEmpty else { return native }
    return native + ["Ubuntu"]
}

// The retired choice requires real dated counters, not a retained placeholder.
// Validate the read-only view without changing the saved source or its rows.
func validArchivedHistoryDay(_ day: JSONObject, key: String) -> Bool {
    guard ["activity", "tokens"].contains(key),
          number(day[key == "tokens" ? "totalTokens" : "seconds"]) != nil,
          let date = day["date"] as? String else { return false }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.isLenient = false
    guard let parsed = formatter.date(from: date) else { return false }
    return formatter.string(from: parsed) == date
}
