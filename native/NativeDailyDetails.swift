import SwiftUI
import Charts

struct NativeNamedCounter: Identifiable {
    var id: String { name }
    let name: String
    let value: Double
}

func nativeCounters(_ object: Any?) -> [NativeNamedCounter] {
    guard let values = object as? JSONObject else { return [] }
    return values.compactMap { name, raw in
        number(raw).map { NativeNamedCounter(name: name, value: $0) }
    }.sorted { $0.value == $1.value ? $0.name < $1.name : $0.value > $1.value }
}

struct NativeSettingsCoverage {
    let status: String
    let profiles: [JSONObject]
    let knownTokens: Double
}

func nativeSettingsCoverage(model: JSONObject, profiles: [JSONObject]) -> NativeSettingsCoverage {
    guard !profiles.isEmpty, model["inferred"] as? Bool != true else {
        return NativeSettingsCoverage(status: "missing", profiles: [], knownTokens: 0)
    }
    let fields = ["inputTokens", "cacheReadTokens", "cacheCreationTokens", "outputTokens", "totalTokens"]
    var exact = true
    for field in fields {
        guard let limit = number(model[field]), let sum = recordedSum(profiles, field: field), sum <= limit else {
            return NativeSettingsCoverage(status: "unreconciled", profiles: [], knownTokens: 0)
        }
        if sum != limit { exact = false }
    }
    return NativeSettingsCoverage(status: exact ? "matched" : "partial", profiles: profiles,
                                  knownTokens: recordedSum(profiles, field: "totalTokens") ?? 0)
}

struct NativeActivityDetails: View {
    let day: JSONObject
    var showHours = true
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if showHours {
            Text("Recorded activity by hour").font(.headline).accessibilityAddTraits(.isHeader)
            let hours = day["hours"] as? [Any] ?? []
            if hours.count == 24 && hours.allSatisfy({ number($0) != nil }) {
                Chart(Array(hours.enumerated()), id: \.offset) { hour, raw in
                    BarMark(x: .value("Hour", hour), y: .value("Recorded minutes", (number(raw) ?? 0) / 60))
                }
                .chartXScale(domain: -0.5...23.5)
                .chartXAxis { AxisMarks(values: [0, 6, 12, 18, 23]) }
                .frame(height: 150)
                .accessibilityLabel("Recorded active minutes by New York clock hour. Empty hours can mean idle time or missing tracking.")
            } else { Text("Hourly breakdown unavailable.").foregroundStyle(.secondary) }
            Text("New York time. Repeated daylight-saving clock hours share a chart cell. Gaps may be idle time or missing records.")
                .font(.callout).foregroundStyle(.secondary)
            }
            if let tracked = number(day["trackedSeconds"]), tracked == 0, number(day["seconds"]) == 0 {
                Text("No tracking records for this date. Zero recorded activity does not establish inactivity.").foregroundStyle(.secondary)
            }
            Text("Categories and recorded apps").font(.headline).accessibilityAddTraits(.isHeader)
            let categories = nativeCounters(day["categories"]).filter { $0.value > 0 }
            if categories.isEmpty { Text("No category breakdown available.").foregroundStyle(.secondary) }
            ForEach(categories) { category in
                VStack(alignment: .leading, spacing: 8) {
                    LabeledContent(category.name == "Mixed activity" ? "Device overlap" : category.name,
                                   value: formatted(category.value / 60) + " min")
                    if category.name == "Mixed activity" {
                        Text("Different categories were active on devices at once. Counted once without guessing attention.")
                            .font(.caption).foregroundStyle(.secondary)
                    } else {
                        if category.name == "AI apps" {
                            Text("Foreground app time, not model execution time.").font(.caption).foregroundStyle(.secondary)
                        }
                        let apps = nativeCounters((day["apps"] as? JSONObject)?[category.name])
                        if !apps.isEmpty {
                            DisclosureGroup("Recorded apps") {
                                VStack(alignment: .leading, spacing: 8) {
                                    ForEach(apps) { app in LabeledContent(app.name, value: formatted(app.value / 60) + " min") }
                                    if apps.contains(where: { $0.name == "ChatGPT / Codex" }) {
                                        Text("ChatGPT and Codex share a desktop process label and cannot be separated from these foreground records.")
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8)
                            }
                        }
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
            Text("ActivityWatch foreground intervals intersect non-idle intervals. Recognized app labels only. Window titles stay on the device. Foreground time does not prove attention or distinguish automation from human input.")
                .font(.callout).foregroundStyle(.secondary)
        }
    }
}

struct NativeTokenDetails: View {
    let day: JSONObject
    let recordedDays: [JSONObject]
    let snapshot: Snapshot?
    let host: String
    private var settings: JSONObject? {
        if host == "All" {
            guard text(((snapshot?.object["combinedTokens"] as? JSONObject)?["verification"] as? JSONObject)?["status"]) == "verified" else { return nil }
            return snapshot?.object["combinedSettings"] as? JSONObject
        }
        return rows(snapshot?.object["settings"]).first { text($0["host"]) == host }
    }
    private let fields = [("inputTokens", "Uncached input"), ("cacheReadTokens", "Cached input"),
                          ("cacheCreationTokens", "Cache writes"), ("outputTokens", "Output")]
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(fields, id: \.0) { field, label in LabeledContent(label, value: formatted(number(day[field]))) }
            Text("Reasoning is included in output. Tokens are not remaining allowance or subscription charges.")
                .font(.callout).foregroundStyle(.secondary)
            estimate(day["apiEstimate"] as? JSONObject)
            Text("By model").font(.headline).accessibilityAddTraits(.isHeader)
            let models = rows(day["models"])
            if models.isEmpty { Text("No model breakdown in this report.").foregroundStyle(.secondary) }
            ForEach(Array(models.enumerated()), id: \.offset) { _, model in
                DisclosureGroup(text(model["model"]) + " · " + formatted(number(model["totalTokens"]), compact: true) + " tokens") {
                    VStack(alignment: .leading, spacing: 10) {
                        if model["inferred"] as? Bool == true { Text("Inferred model label").foregroundStyle(.secondary) }
                        ForEach(fields, id: \.0) { field, label in LabeledContent(label, value: formatted(number(model[field]))) }
                        estimate(model["apiEstimate"] as? JSONObject)
                        Text("Recorded reasoning and speed").font(.headline)
                        let candidates = nativePeriodProfiles(model: model, days: recordedDays, settings: settings)
                        let coverage = nativeSettingsCoverage(model: model, profiles: candidates)
                        if text(settings?["status"]) != "ok" || settings?["snapshotStable"] as? Bool == false {
                            Text("Settings unavailable or usage changed during collection. Breakdown withheld.").foregroundStyle(.secondary)
                        } else if coverage.profiles.isEmpty {
                            Text(coverage.status == "unreconciled" ? "Settings counters do not match this report. Breakdown withheld." : "No reconciled settings for these model/date records. Missing or conflicting counters are withheld.")
                                .foregroundStyle(.secondary)
                        } else {
                            ForEach(Array(coverage.profiles.enumerated()), id: \.offset) { _, profile in
                                LabeledContent(text(profile["date"]) + " · " + text(profile["effort"]) + " · " + text(profile["speed"]),
                                               value: formatted(number(profile["totalTokens"])) + " tokens")
                            }
                            if coverage.status == "partial", let total = number(model["totalTokens"]) {
                                Text("\(formatted(total - coverage.knownTokens)) tokens have no reconciled settings in this scan.").foregroundStyle(.secondary)
                            }
                        }
                        Text("Recorded settings, not measured reasoning time. No missing settings are inferred.").font(.caption).foregroundStyle(.secondary)
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8)
                }
            }
        }
    }
    private func estimate(_ saved: JSONObject?) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("Saved API comparison: " + (number(saved?["usd"]).map { "$" + String(format: "%.2f", $0) } ?? "Unknown"))
            Text("Hypothetical standard short-context pricing, not your bill. Covered tokens: \(formatted(number(saved?["coveredTokens"]))). Rate check: \(text(saved?["checked"])). Unsupported and inferred models may be excluded. This view does not refresh prices.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }
}
