import SwiftUI
import Charts

struct QuotaHistoryPoint: Identifiable {
    let id: Int
    let at: Date
    let used: Double
    let segment: Int
}

struct QuotaHourlyPace: Identifiable {
    var id: Date { hour }
    let hour: Date
    let percentagePointsPerHour: Double
    let observedMinutes: Double
}

func quotaHourlyPace(_ points: [QuotaHistoryPoint], calendar: Calendar = .current) -> [QuotaHourlyPace] {
    var totals: [Date: (used: Double, seconds: Double)] = [:]
    for (previous, current) in zip(points, points.dropFirst()) {
        let seconds = current.at.timeIntervalSince(previous.at)
        guard previous.segment == current.segment, seconds > 0, seconds <= 630,
              current.used >= previous.used,
              let hour = calendar.dateInterval(of: .hour, for: previous.at), current.at <= hour.end else { continue }
        let before = totals[hour.start] ?? (used: 0, seconds: 0)
        totals[hour.start] = (before.used + current.used - previous.used, before.seconds + seconds)
    }
    return totals.keys.sorted().map { hour in
        let value = totals[hour]!
        return QuotaHourlyPace(hour: hour, percentagePointsPerHour: value.used * 3600 / value.seconds,
                               observedMinutes: value.seconds / 60)
    }
}

struct QuotaLivePace {
    let remaining: String
    let reset: String
    let rate: Double
    let coverage: Double
}

func quotaLivePace(_ quota: JSONObject, window: JSONObject, now: Date) -> QuotaLivePace? {
    guard text(quota["status"]) == "ok", let at = parseDate(quota["checkedAt"]),
          now >= at, now.timeIntervalSince(at) < 600, let reset = parseDate(window["resetsAt"]), reset > now,
          let pace = rows(quota["pace"]).first(where: {
              text($0["bucket"]) == text(window["bucket"]) && text($0["window"]) == text(window["window"])
          }), text(pace["asOf"]) == text(quota["checkedAt"]),
          ["projected", "resets-first"].contains(text(pace["status"])),
          let rate = number(pace["percentagePointsPerHour"]), rate.isFinite, rate > 0,
          let remaining = number(window["remainingPercent"]), remaining.isFinite, remaining > 0, remaining <= 100 else { return nil }
    let exhaustion = at.addingTimeInterval(remaining / rate * 3600)
    guard exhaustion > now else { return nil }
    func duration(_ seconds: Double) -> String {
        let minutes = Int(ceil(seconds / 60))
        return "\(minutes / 60)h \(minutes % 60)m"
    }
    return QuotaLivePace(remaining: exhaustion >= reset ? "Lasts until reset" : duration(exhaustion.timeIntervalSince(now)),
                         reset: duration(reset.timeIntervalSince(now)), rate: rate,
                         coverage: min(1, exhaustion.timeIntervalSince(now) / reset.timeIntervalSince(now)))
}

func quotaHistoryPoints(_ history: [JSONObject], bucket: String, window: String) -> [QuotaHistoryPoint] {
    var result: [QuotaHistoryPoint] = []
    var previous: (at: Date, used: Double, reset: String)?
    var segment = 0
    for sample in history {
        guard let at = parseDate(sample["checkedAt"]),
              let row = rows(sample["windows"]).first(where: { text($0["bucket"]) == bucket && text($0["window"]) == window }),
              let remaining = number(row["remainingPercent"]), remaining <= 100 else {
            previous = nil; segment += 1; continue
        }
        let used = 100 - remaining
        let reset = text(row["resetsAt"])
        let sameReset = previous.map { prior in
            reset == prior.reset || (parseDate(reset).flatMap { current in parseDate(prior.reset).map { abs(current.timeIntervalSince($0)) <= 2 } } ?? false)
        } ?? true
        if let previous, at.timeIntervalSince(previous.at) > 630 || at <= previous.at || used < previous.used || !sameReset { segment += 1 }
        result.append(QuotaHistoryPoint(id: result.count, at: at, used: used, segment: segment))
        previous = (at, used, reset)
    }
    return result
}

struct QuotaPanel: View {
    let quota: JSONObject
    var dashboard = false
    @State private var selected = ""
    private var windows: [JSONObject] { visibleQuotaWindows(quota["windows"]) }
    private var chosen: JSONObject? { windows.first(where: { key($0) == selected }) ?? windows.first }
    private func key(_ row: JSONObject) -> String { text(row["bucket"]) + ":" + text(row["window"]) }
    private func label(_ row: JSONObject) -> String {
        let duration = number(row["durationMinutes"]).map { value in
            value >= 1440 ? "\(formatted(value / 1440))d" : value >= 60 ? "\(formatted(value / 60))h" : "\(formatted(value))m"
        } ?? text(row["window"])
        return "\(text(row["bucket"])) · \(duration)"
    }
    private var statusLabel: String {
        if text(quota["latestReadStatus"]) == "waiting" { return "Waiting for the next permitted usage check." }
        switch text(quota["status"]) {
        case "ok": return "Latest reading"
        case "stale": return "Saved reading"
        case "needs-auth": return "Sign in through Codex, then refresh."
        case "unsupported": return "This Codex client or account does not report limits."
        default: return "Limits unavailable. Check Codex or try again later."
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Account usage").font(ObservatoryTheme.font(14.5, weight: .semibold))
                Spacer()
                if let at = parseDate(quota["checkedAt"]) {
                    Text(at, style: .relative).font(ObservatoryTheme.font(12)).help("Time since the last successful limit read")
                }
            }.foregroundStyle(.secondary)
            Text(statusLabel).font(ObservatoryTheme.font(12)).foregroundStyle(text(quota["status"]) == "ok" ? ObservatoryTheme.muted : Color.orange)
            ForEach(Array(windows.enumerated()), id: \.offset) { _, row in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(label(row)).font(ObservatoryTheme.font(dashboard ? 19 : 12, weight: .semibold)).tracking(dashboard ? 0.6 : 0)
                        Spacer()
                        Text("\(formatted(number(row["remainingPercent"])))% left").font(ObservatoryTheme.font()).monospacedDigit()
                    }
                    ProgressView(value: number(row["remainingPercent"]) ?? 0, total: 100).progressViewStyle(ObservatoryProgressStyle())
                        .accessibilityLabel("Allowance remaining for \(label(row))")
                        .accessibilityValue("\(formatted(number(row["remainingPercent"]))) percent")
                    Text(parseDate(row["resetsAt"]).map { "Resets \($0.formatted(date: .abbreviated, time: .shortened))" } ?? "Reset time unknown")
                        .font(ObservatoryTheme.font(12)).foregroundStyle(ObservatoryTheme.muted)
                    TimelineView(.periodic(from: .now, by: 30)) { context in
                        if let live = quotaLivePace(quota, window: row, now: context.date) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(live.remaining).font(ObservatoryTheme.font(dashboard ? 36 : 22, weight: .semibold)).tracking(-1).monospacedDigit()
                                Text("Estimated at this pace · reset in \(live.reset)")
                                    .font(ObservatoryTheme.font()).foregroundStyle(ObservatoryTheme.muted)
                                Text("\(formatted(live.rate)) percentage points / hour")
                                    .font(ObservatoryTheme.font()).monospacedDigit()
                            }
                        } else {
                            Text(quotaPaceText(quota, window: row, now: context.date))
                            .font(ObservatoryTheme.font()).foregroundStyle(ObservatoryTheme.muted)
                        }
                        if let fraction = quotaPaceCoverage(quota, window: row, now: context.date) {
                            VStack(spacing: 3) {
                                ProgressView(value: fraction, total: 1).progressViewStyle(ObservatoryProgressStyle(color: ObservatoryTheme.purple))
                                HStack {
                                    Text("Now")
                                    Spacer()
                                    Text("Reset")
                                }.font(.system(size: 10)).foregroundStyle(.secondary)
                            }.accessibilityElement(children: .ignore)
                                .accessibilityLabel("Estimated time coverage until reset at the last observed pace")
                                .accessibilityValue("\(Int((fraction * 100).rounded())) percent. Filled portion ends at estimated exhaustion or reset, whichever comes first.")
                        }
                    }
                }.accessibilityElement(children: .contain)
                    .accessibilityLabel(label(row))
            }
            if let chosen {
                if windows.count > 1 {
                    Picker("Limit history", selection: Binding(get: { key(chosen) }, set: { selected = $0 })) {
                        ForEach(Array(windows.enumerated()), id: \.offset) { _, row in Text(label(row)).tag(key(row)) }
                    }.labelsHidden().accessibilityLabel("Limit history window")
                }
                let points = quotaHistoryPoints(rows(quota["history"]), bucket: text(chosen["bucket"]), window: text(chosen["window"]))
                Text("Allowance used").font(ObservatoryTheme.font(dashboard ? 19 : 12, weight: .semibold)).tracking(dashboard ? 0.6 : 0)
                if !points.isEmpty {
                    Chart(points) { point in
                        LineMark(x: .value("Time", point.at), y: .value("Used percent", point.used), series: .value("Reading segment", point.segment))
                            .foregroundStyle(ObservatoryTheme.sage)
                        PointMark(x: .value("Time", point.at), y: .value("Used percent", point.used)).symbolSize(8).foregroundStyle(ObservatoryTheme.sage)
                            .accessibilityHidden(true)
                    }
                    .chartYScale(domain: 0...100)
                    .chartXScale(domain: (dashboard ? min(points.first!.at, points.last!.at.addingTimeInterval(-3600)) : points.last!.at.addingTimeInterval(-86400))...points.last!.at)
                    .chartXAxis {
                        AxisMarks(values: .stride(by: .hour, count: dashboard ? 1 : 6)) {
                            AxisGridLine()
                            AxisTick()
                            AxisValueLabel(format: .dateTime.hour(.defaultDigits(amPM: .abbreviated)))
                        }
                    }
                    .chartYAxis { AxisMarks(values: [0, 50, 100]) }
                    .chartXAxis(dashboard ? .hidden : .automatic)
                    .frame(height: 130)
                    .accessibilityLabel("Allowance history. Gaps and resets are separate segments.")
                    if dashboard {
                        HStack {
                            Text(points.first!.at.formatted(date: .omitted, time: .shortened))
                            Spacer()
                            Text(points.last!.at.formatted(date: .omitted, time: .shortened))
                        }.font(ObservatoryTheme.font(12)).foregroundStyle(ObservatoryTheme.muted)
                    }
                    let hourly = quotaHourlyPace(points)
                    if !hourly.isEmpty {
                        Text("Usage pace by hour").font(ObservatoryTheme.font(dashboard ? 19 : 13, weight: .semibold)).tracking(dashboard ? 0.6 : 0)
                        Chart(hourly) { hour in
                            BarMark(x: .value("Hour", hour.hour, unit: .hour),
                                    y: .value("Percentage points per hour", hour.percentagePointsPerHour))
                                .foregroundStyle(ObservatoryTheme.purple)
                                .accessibilityLabel(hour.hour.formatted(date: .abbreviated, time: .shortened))
                                .accessibilityValue("\(formatted(hour.percentagePointsPerHour)) percentage points per hour, based on \(formatted(hour.observedMinutes)) observed minutes")
                        }
                        .chartXScale(domain: (dashboard ? hourly.first!.hour : points.last!.at.addingTimeInterval(-86400))...hourly.last!.hour.addingTimeInterval(3600))
                        .chartXAxis { AxisMarks(values: .stride(by: .hour, count: dashboard ? 1 : 6)) { AxisValueLabel(format: .dateTime.hour(), centered: true) } }
                        .chartPlotStyle { plot in plot.clipped() }
                        .chartYAxis { AxisMarks(values: .automatic(desiredCount: 4)) }
                        .frame(height: 115)
                        Text("Rates use observed intervals within each hour. Missing polls, resets and intervals crossing an hour boundary are excluded.")
                            .font(.system(size: 10)).foregroundStyle(.secondary)
                    }
                } else {
                    Text("History begins with the first successful reading.").font(.system(size: 11)).foregroundStyle(.secondary)
                }
            }
            let daily = Array(rows(quota["dailyUsageBuckets"]).suffix(14))
            if !daily.isEmpty {
                Text("Account tokens · recent daily totals").font(.system(size: 11)).foregroundStyle(.secondary)
                Chart(Array(daily.enumerated()), id: \.offset) { _, day in
                    if let date = parseDate(text(day["startDate"]) + "T00:00:00Z"), let tokens = number(day["tokens"]) {
                        BarMark(x: .value("Day", date, unit: .day), y: .value("Tokens", tokens)).foregroundStyle(Color.accentColor.opacity(0.65))
                    }
                }
                .chartXAxis { AxisMarks(values: .automatic(desiredCount: 3)) }
                .chartYAxis { AxisMarks(values: .automatic(desiredCount: 3)) }
                .environment(\.timeZone, TimeZone(secondsFromGMT: 0)!)
                .frame(height: 75)
                .accessibilityLabel("Daily account token totals. Missing days are unknown, not zero.")
            }
            Text("Account-wide readings, not a device sum. Tokens and allowance use different units. Daily totals may lag.")
                .font(.system(size: 10)).foregroundStyle(.secondary)
        }
        .padding(dashboard ? 0 : 15).background(dashboard ? Color.clear : Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
    }
}

func quotaPaceCoverage(_ quota: JSONObject, window: JSONObject, now: Date) -> Double? {
    quotaLivePace(quota, window: window, now: now)?.coverage
}

func quotaPaceText(_ quota: JSONObject, window: JSONObject, now: Date) -> String {
    guard text(quota["status"]) == "ok", let at = parseDate(quota["checkedAt"]),
          now.timeIntervalSince(at) >= 0, now.timeIntervalSince(at) < 600 else {
        return "Estimate unavailable until a fresh reading."
    }
    guard let pace = rows(quota["pace"]).first(where: {
        text($0["bucket"]) == text(window["bucket"]) && text($0["window"]) == text(window["window"])
    }), text(pace["asOf"]) == text(quota["checkedAt"]), let summary = pace["summary"] as? String else {
        return "Not enough recent history to estimate time left."
    }
    if let reset = parseDate(window["resetsAt"]), reset <= now {
        return "Reset time reached. Waiting for a fresh reading."
    }
    if text(pace["status"]) == "projected", let exhaustion = parseDate(pace["estimatedExhaustionAt"]), exhaustion <= now {
        return "Projection elapsed. Waiting for a fresh reading."
    }
    return summary
}
