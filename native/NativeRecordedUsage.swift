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

struct NativeDictation: View {
    let snapshot: Snapshot?
    @State private var host = "Mac"
    @State private var provider = "Wispr Flow"
    @State private var latestWeek = true
    private var source: JSONObject? {
        rows(snapshot?.object["dictation"]).first {
            text($0["host"]) == host && text($0["source"], fallback: "TypeWhisper") == provider
        }
    }

    var body: some View {
        let days = dictationDays(source, latestWeek: latestWeek)
        let wispr = provider == "Wispr Flow"
        VStack(alignment: .leading, spacing: 18) {
            Picker("Product", selection: $provider) {
                Text("Wispr Flow").tag("Wispr Flow")
                Text("TypeWhisper").tag("TypeWhisper")
            }.pickerStyle(.segmented)
            Picker("Device", selection: $host) {
                Text("Mac").tag("Mac")
                Text("Windows").tag("Windows")
            }.pickerStyle(.segmented)
            Picker("Period", selection: $latestWeek) {
                Text("Latest recorded week").tag(true)
                Text("All retained").tag(false)
            }.pickerStyle(.segmented)
            if text(source?["status"]) != "ok" {
                ContentUnavailableView("Statistics unavailable", systemImage: "mic.slash",
                    description: Text("Source status: \(text(source?["status"], fallback: "not-connected")). Missing records are unknown, not zero. Hosts and products are not combined."))
            } else if days.isEmpty {
                Text("No retained transcription aggregates. This is not a confirmed zero usage total.")
            } else {
                Text("\(text(days.first?["date"])) to \(text(days.last?["date"])), \(wispr ? "America/New_York" : "device-local") dates.")
                    .font(.callout).foregroundStyle(.secondary)
                LabeledContent(wispr ? "History records" : "Transcriptions", value: formatted(recordedSum(days, field: "transcriptions")))
                LabeledContent("Words", value: dictationValue(days, field: "words", wispr: wispr))
                LabeledContent("Recorded audio minutes", value: dictationValue(days, field: "audioSeconds", wispr: wispr))
                if wispr {
                    Text("Words recorded for \(formatted(recordedSum(days, field: "wordRecords"))) of \(formatted(recordedSum(days, field: "transcriptions"))) records. Audio duration recorded for \(formatted(recordedSum(days, field: "audioRecords"))) records. Partial coverage is not a full usage total.")
                        .font(.callout).foregroundStyle(.secondary)
                }
                Text("Daily totals").font(.headline).accessibilityAddTraits(.isHeader)
                ForEach(Array(days.reversed().enumerated()), id: \.offset) { _, day in
                    DisclosureGroup(text(day["date"])) {
                        VStack(alignment: .leading, spacing: 8) {
                            LabeledContent("Records", value: formatted(number(day["transcriptions"])))
                            LabeledContent("Words", value: dictationValue([day], field: "words", wispr: wispr))
                            LabeledContent("Audio minutes", value: dictationValue([day], field: "audioSeconds", wispr: wispr))
                            if !wispr {
                                let engines = rows(day["engines"])
                                if engines.isEmpty { Text("Engine breakdown unknown.").foregroundStyle(.secondary) }
                                ForEach(Array(engines.enumerated()), id: \.offset) { _, engine in
                                    LabeledContent(text(engine["engine"]), value: formatted(number(engine["transcriptions"])))
                                }
                            }
                        }.padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            Text(wispr ? "Retained history may include unfinished or failed records. Audio duration includes silence. The host identifies the store read, not necessarily the recording device. Synced or imported records can overlap."
                : "TypeWhisper history can include recovered or imported transcriptions.")
                .font(.callout).foregroundStyle(.secondary)
            Text("Hosts and products stay separate. Missing dates are not filled with zeros. Transcripts, recordings, app names and custom model names are excluded.")
                .font(.callout).foregroundStyle(.secondary)
            if let date = parseDate(source?["checkedAt"]) {
                Text("Last checked: \(date.formatted(date: .abbreviated, time: .shortened))").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

struct NativeAgentUsage: View {
    let snapshot: Snapshot?
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            let receipts = rows(snapshot?.object["agents"])
            let status = text((snapshot?.object["agentSource"] as? JSONObject)?["status"])
            Text("Saved handoff receipts").font(.headline).accessibilityAddTraits(.isHeader)
            if receipts.isEmpty { Text("No handoff receipts available. Missing receipts are not zero usage.") }
            if status != "ok" { Text("Receipt source status: \(status). Coverage may be incomplete.").foregroundStyle(.secondary) }
            ForEach(Array(receipts.enumerated()), id: \.offset) { _, receipt in
                DisclosureGroup(text(receipt["model"]) + " · " + text(receipt["status"])) {
                    VStack(alignment: .leading, spacing: 8) {
                        LabeledContent("Role", value: text(receipt["role"]))
                        LabeledContent("Recorded at", value: text(receipt["recordedAt"]))
                        LabeledContent("Latest call seconds", value: formatted(number(receipt["seconds"])))
                        LabeledContent("Reported tokens", value: text(receipt["status"]) == "failed" ? "Unknown" : formatted(number(receipt["total"])))
                        if let failure = receipt["failure"] as? String { Text(failure) }
                    }.padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            Text("Only saved top-level receipts are covered, not every agent or provider. One newest snapshot per conversation avoids summing cumulative counters. Duration describes the latest call. A returned response is not a review pass, and the requested model is not proof of the serving model.")
                .font(.callout).foregroundStyle(.secondary)
            localRuns
            toolCalls
        }
    }

    private var localRuns: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Local model runs").font(.headline).accessibilityAddTraits(.isHeader)
            let local = snapshot?.object["localModel"] as? JSONObject
            let runs = rows(local?["records"])
            if text(local?["status"]) != "ok" { Text("Local receipts unavailable.") }
            else if runs.isEmpty { Text("No saved local model runs.") }
            else {
                ForEach(Array(runs.enumerated()), id: \.offset) { _, run in
                    DisclosureGroup(text(run["model"]) + " · " + text(run["status"])) {
                        VStack(alignment: .leading, spacing: 8) {
                            LabeledContent("Recorded at", value: text(run["recordedAt"]))
                            LabeledContent("Reply seconds", value: formatted(number(run["seconds"])))
                            LabeledContent("Input tokens", value: formatted(number(run["input"])))
                            LabeledContent("Cached tokens", value: formatted(number(run["cached"])))
                            LabeledContent("Output tokens", value: formatted(number(run["output"])))
                            LabeledContent("Time to first token seconds", value: formatted(number(run["ttft"])))
                            LabeledContent("Peak total GPU memory MiB", value: formatted(number(run["peakGpuMiB"])))
                        }.padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            Text("Saved benchmarks, separate from cloud tokens and screen time. GPU memory is total device use, not model-only memory. These records do not prove a model is running now.")
                .font(.callout).foregroundStyle(.secondary)
        }
    }

    private var toolCalls: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Recorded tool calls").font(.headline).accessibilityAddTraits(.isHeader)
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
                                Text(text(call["tool"], fallback: "Unknown tool")).font(.headline).textSelection(.enabled)
                                Text("Namespace: \(text(call["namespace"])) · \(text(call["category"]))").font(.caption)
                                LabeledContent(text(call["date"]), value: formatted(number(call["count"])) + " requests")
                            }.padding(.vertical, 6).frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
            }
            Text("Saved Codex request counts are not proof of successful execution or time worked. Hosts are not summed. General SSH commands and unlogged tools are absent. Nested calls are not inferred from wrapper arguments.")
                .font(.callout).foregroundStyle(.secondary)
        }
    }
}
