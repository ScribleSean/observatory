import SwiftUI

func dictationDays(_ source: JSONObject?, latestWeek: Bool) -> [JSONObject] {
    guard let source, text(source["status"]) == "ok" else { return [] }
    let days = rows(source["days"]).sorted { text($0["date"]) < text($1["date"]) }
    guard latestWeek, let last = days.last,
          let end = parseDate(text(last["date"]) + "T12:00:00Z") else { return days }
    let start = end.addingTimeInterval(-6 * 86400)
    return days.filter {
        guard let date = parseDate(text($0["date"]) + "T12:00:00Z") else { return false }
        return date >= start && date <= end
    }
}

func recordedSum(_ values: [JSONObject], field: String) -> Double? {
    guard !values.isEmpty else { return nil }
    let numbers = values.compactMap { number($0[field]) }
    guard numbers.count == values.count else { return nil }
    return numbers.reduce(0, +)
}

func dictationValue(_ values: [JSONObject], field: String, wispr: Bool) -> String {
    let coverage = field == "words" ? "wordRecords" : "audioRecords"
    if wispr {
        guard let covered = recordedSum(values, field: coverage), covered > 0 else { return "Unknown" }
    }
    guard let total = recordedSum(values, field: field) else { return "Unknown" }
    let partial = wispr && recordedSum(values, field: coverage) != recordedSum(values, field: "transcriptions")
    let display = (field == "audioSeconds" ? total / 60 : total).formatted(.number.precision(.fractionLength(0...1)))
    return display + (partial ? " (partial)" : "")
}

struct NativeVoiceSource: Identifiable {
    let host: String
    let tool: String
    let status: String
    let checkedAt: String
    let days: [JSONObject]
    var id: String { host + tool }
}

func nativeVoiceSources(_ raw: [JSONObject], host: String, tool: String) -> [NativeVoiceSource] {
    let hosts = host == "All devices" ? ["Mac", "Windows"] : [host]
    let tools = tool == "All tools" ? ["Wispr Flow", "ChatGPT"] : [tool]
    return hosts.flatMap { device in tools.map { provider in
        let matches = raw.filter { text($0["host"]) == device && text($0["source"]) == provider }
        let source = provider == "Wispr Flow" && matches.count == 1 ? matches[0] : nil
        let status = provider == "ChatGPT" ? "Tracking not yet verified" :
            matches.count > 1 ? "Ambiguous source" : text(source?["status"], fallback: "not-connected")
        return NativeVoiceSource(host: device, tool: provider, status: status,
            checkedAt: text(source?["checkedAt"]),
            days: status == "ok" ? nativePeriodDays(rows(source?["days"]), period: "all", anchor: "") : [])
    }}
}

struct NativeDictation: View {
    let snapshot: Snapshot?
    @State private var host = "All devices"
    @State private var provider = "All tools"
    @State private var period = "week"
    @State private var anchor = ""
    private var sources: [NativeVoiceSource] {
        nativeVoiceSources(rows(snapshot?.object["dictation"]), host: host, tool: provider)
    }
    private var dates: [String] {
        Array(Set(sources.flatMap { $0.days.map { text($0["date"]) } })).sorted()
    }
    private var end: String { dates.contains(anchor) ? anchor : dates.last ?? "" }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Your voice usage over time, by tool and device.").foregroundStyle(.secondary)
            ObservatoryFilterRow(title: "Tool") {
                ObservatorySegments(title: "Tool", labels: ["All tools", "Wispr Flow", "ChatGPT"],
                    values: ["All tools", "Wispr Flow", "ChatGPT"], selection: $provider)
                    .onChange(of: provider) { anchor = "" }
            }
            ObservatoryFilterRow(title: "Device") {
                ObservatorySegments(title: "Device", labels: ["All devices", "Mac", "Windows"],
                    values: ["All devices", "Mac", "Windows"], selection: $host)
                    .onChange(of: host) { anchor = "" }
            }
            ObservatoryFilterRow(title: "Period") {
                ObservatorySegments(title: "Period", labels: ["Day", "Week", "All retained"],
                    values: ["day", "week", "all"], selection: $period)
            }
            if period != "all" && !dates.isEmpty {
                ObservatoryFilterRow(title: period == "week" ? "Week ending" : "Recorded day") {
                    ObservatoryPopup(title: period == "week" ? "Week ending" : "Recorded day", labels: dates, values: dates,
                        selection: Binding(get: { end }, set: { anchor = $0 }))
                }
            }
            let known = sources.filter {
                dictationValue(nativePeriodDays($0.days, period: period, anchor: end), field: "audioSeconds", wispr: true) != "Unknown"
            }
            Text("Recorded voice time").observatoryFont(.headline)
            if known.isEmpty {
                ObservatoryValueRow("Recorded audio minutes", value: "Unknown")
            } else {
                ForEach(known) { source in
                    ObservatoryValueRow(source.tool + " · " + source.host,
                        value: dictationValue(nativePeriodDays(source.days, period: period, anchor: end), field: "audioSeconds", wispr: true) + " min")
                }
            }
            Text("Known recordings in the selected period. Coverage is incomplete. Device histories may overlap and are not added together.")
                .observatoryFont(.callout).foregroundStyle(.secondary)
            Text("By tool and device").observatoryFont(.headline).accessibilityAddTraits(.isHeader)
            ForEach(sources) { source in
                sourceSection(source)
            }
            Text("More local speech detection coming soon.").observatoryFont(.headline)
            Text("ChatGPT voice tracking has not been verified. General ChatGPT screen time is not voice usage.")
            Text("Wispr recording metadata can include silence and unfinished records. Synced or imported histories can overlap, so device totals are not added together.")
            Text("America/New_York dates. Missing dates are gaps, not zeros. Transcripts, recordings and credentials are excluded.")
                .observatoryFont(.callout).foregroundStyle(.secondary)
        }
    }

    private func sourceSection(_ source: NativeVoiceSource) -> some View {
        let days = nativePeriodDays(source.days, period: period, anchor: end)
        return GroupBox(source.tool + " · " + source.host) {
            VStack(alignment: .leading, spacing: 10) {
                ObservatoryValueRow("Status", value: source.status == "ok" ? "Recorded history" : source.status)
                ObservatoryValueRow("Last checked", value: source.checkedAt)
                ObservatoryValueRow("Records", value: formatted(recordedSum(days, field: "transcriptions")))
                ObservatoryValueRow("Words", value: dictationValue(days, field: "words", wispr: true))
                ObservatoryValueRow("Recorded audio minutes", value: dictationValue(days, field: "audioSeconds", wispr: true))
                if days.isEmpty {
                    Text("No recorded voice statistics in this scope. Missing data is not zero usage.").foregroundStyle(.secondary)
                } else {
                    DisclosureGroup("Voice over time") {
                        ForEach(Array(days.suffix(60).reversed().enumerated()), id: \.offset) { _, day in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(text(day["date"])).observatoryFont(.headline)
                                ObservatoryValueRow("Records", value: formatted(number(day["transcriptions"])))
                                ObservatoryValueRow("Words", value: dictationValue([day], field: "words", wispr: true))
                                ObservatoryValueRow("Audio minutes", value: dictationValue([day], field: "audioSeconds", wispr: true))
                            }.padding(.vertical, 6)
                        }
                        Text("Latest 60 recorded dates shown. Totals cover the selected period.").observatoryFont(.caption)
                    }
                }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(6)
        }
    }
}

struct NativeAgentUsage: View {
    let snapshot: Snapshot?
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            let receipts = rows(snapshot?.object["agents"])
            let status = text((snapshot?.object["agentSource"] as? JSONObject)?["status"])
            Text("Saved handoff receipts").observatoryFont(.headline).accessibilityAddTraits(.isHeader)
            if receipts.isEmpty { Text("No handoff receipts available. Missing receipts are not zero usage.") }
            if status != "ok" { Text("Receipt source status: \(status). Coverage may be incomplete.").foregroundStyle(.secondary) }
            ForEach(Array(receipts.enumerated()), id: \.offset) { _, receipt in
                DisclosureGroup(text(receipt["model"]) + " · " + text(receipt["status"])) {
                    VStack(alignment: .leading, spacing: 8) {
                        ObservatoryValueRow("Role", value: text(receipt["role"]))
                        ObservatoryValueRow("Recorded at", value: text(receipt["recordedAt"]))
                        ObservatoryValueRow("Latest call seconds", value: formatted(number(receipt["seconds"])))
                        ObservatoryValueRow("Reported tokens", value: text(receipt["status"]) == "failed" ? "Unknown" : formatted(number(receipt["total"])))
                        if let failure = receipt["failure"] as? String { Text(failure) }
                    }.padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            Text("Only saved top-level receipts are covered, not every agent or provider. One newest snapshot per conversation avoids summing cumulative counters. Duration describes the latest call. A returned response is not a review pass, and the requested model is not proof of the serving model.")
                .observatoryFont(.callout).foregroundStyle(.secondary)
            localRuns
            toolCalls
        }
    }

    private var localRuns: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Local model runs").observatoryFont(.headline).accessibilityAddTraits(.isHeader)
            let local = snapshot?.object["localModel"] as? JSONObject
            let runs = rows(local?["records"])
            if text(local?["status"]) != "ok" { Text("Local receipts unavailable.") }
            else if runs.isEmpty { Text("No saved local model runs.") }
            else {
                ForEach(Array(runs.enumerated()), id: \.offset) { _, run in
                    DisclosureGroup(text(run["model"]) + " · " + text(run["status"])) {
                        VStack(alignment: .leading, spacing: 8) {
                            ObservatoryValueRow("Recorded at", value: text(run["recordedAt"]))
                            ObservatoryValueRow("Reply seconds", value: formatted(number(run["seconds"])))
                            ObservatoryValueRow("Input tokens", value: formatted(number(run["input"])))
                            ObservatoryValueRow("Cached tokens", value: formatted(number(run["cached"])))
                            ObservatoryValueRow("Output tokens", value: formatted(number(run["output"])))
                            ObservatoryValueRow("Time to first token seconds", value: formatted(number(run["ttft"])))
                            ObservatoryValueRow("Peak total GPU memory MiB", value: formatted(number(run["peakGpuMiB"])))
                        }.padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            Text("Saved benchmarks, separate from cloud tokens and screen time. GPU memory is total device use, not model-only memory. These records do not prove a model is running now.")
                .observatoryFont(.callout).foregroundStyle(.secondary)
        }
    }

    private var toolCalls: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Recorded tool calls").observatoryFont(.headline).accessibilityAddTraits(.isHeader)
            let sources = rows(snapshot?.object["settings"])
            if sources.isEmpty { Text("No saved tool-call sources.") }
            ForEach(Array(sources.enumerated()), id: \.offset) { _, source in
                DisclosureGroup(text(source["host"])) {
                    if text(source["status"]) != "ok" { Text("Tool records unavailable.") }
                    else {
                        let calls = rows(source["tools"])
                        if calls.isEmpty { Text("No recorded tool requests.") }
                        ForEach(Array(calls.enumerated()), id: \.offset) { _, call in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(text(call["tool"], fallback: "Unknown tool")).observatoryFont(.headline).textSelection(.enabled)
                                Text("Namespace: \(text(call["namespace"])) · \(text(call["category"]))").observatoryFont(.caption)
                                ObservatoryValueRow(text(call["date"]), value: formatted(number(call["count"])) + " requests")
                            }.padding(.vertical, 6).frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
            }
            Text("Saved Codex request counts are not proof of successful execution or time worked. Hosts are not summed. General SSH commands and unlogged tools are absent. Nested calls are not inferred from wrapper arguments.")
                .observatoryFont(.callout).foregroundStyle(.secondary)
        }
    }
}
