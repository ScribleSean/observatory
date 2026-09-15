import SwiftUI
import Charts

struct QuotaHistoryPoint: Identifiable {
    let id: Int
    let at: Date
    let used: Double
    let segment: Int
    var reset: String = ""
}

func quotaIsGap(_ previous: QuotaHistoryPoint, _ current: QuotaHistoryPoint) -> Bool {
    let sameReset = previous.reset == current.reset || (parseDate(previous.reset).flatMap { before in
        parseDate(current.reset).map { abs($0.timeIntervalSince(before)) <= 2 }
    } ?? false)
    return current.at > previous.at && current.segment != previous.segment && current.used >= previous.used && sameReset
}

func quotaRecordedDate(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
}

func quotaPeriodRange(_ points: [QuotaHistoryPoint], period: String, anchor: String, checkedAt: Date,
                      calendar: Calendar = .current) -> ClosedRange<Date> {
    guard period != "All retained" else {
        return min(points.first?.at ?? checkedAt, checkedAt.addingTimeInterval(-3600))...checkedAt
    }
    let selected = points.last(where: { quotaRecordedDate($0.at) == anchor })?.at ?? points.last?.at ?? checkedAt
    let day = calendar.startOfDay(for: selected)
    let end = calendar.date(byAdding: .day, value: 1, to: day)!
    let start = calendar.date(byAdding: .day, value: period == "Week" ? -6 : 0, to: day)!
    return start...end
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

func quotaHourlyTickStride(_ hours: [QuotaHourlyPace]) -> Int {
    guard let first = hours.first, let last = hours.last else { return 1 }
    let span = max(1, last.hour.timeIntervalSince(first.hour) / 3600 + 1)
    let minimum = span / 6
    return [1, 2, 3, 4, 6, 12, 24].first { Double($0) >= minimum } ?? max(24, Int(ceil(minimum / 24)) * 24)
}

func quotaHourlyTickDates(_ hours: [QuotaHourlyPace]) -> [Date] {
    guard let first = hours.first, let last = hours.last else { return [] }
    let count = max(0, Int(last.hour.timeIntervalSince(first.hour) / 3600))
    let ticks = stride(from: 0, through: count, by: quotaHourlyTickStride(hours)).map {
        first.hour.addingTimeInterval(Double($0) * 3600 + 1800)
    }
    // A last-hour label has too little trailing space in a dense day chart.
    // Keep the bar and the explicit date range, omit only that crowded tick.
    return count >= 6 && ticks.count > 1 ? ticks.filter { $0 < last.hour } : ticks
}

func quotaCoverageLabel(_ fraction: Double) -> String {
    fraction > 0 && fraction < 0.01 ? "Less than 1 percent" : "\(Int((fraction * 100).rounded())) percent"
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
              let remaining = number(row["remainingPercent"]), remaining.isFinite, remaining >= 0, remaining <= 100 else {
            previous = nil; segment += 1; continue
        }
        let used = 100 - remaining
        let reset = text(row["resetsAt"])
        let sameReset = previous.map { prior in
            reset == prior.reset || (parseDate(reset).flatMap { current in parseDate(prior.reset).map { abs(current.timeIntervalSince($0)) <= 2 } } ?? false)
        } ?? true
        if let previous, at.timeIntervalSince(previous.at) > 630 || at <= previous.at || used < previous.used || !sameReset { segment += 1 }
        result.append(QuotaHistoryPoint(id: result.count, at: at, used: used, segment: segment, reset: reset))
        previous = (at, used, reset)
    }
    return result
}

struct QuotaPanel: View {
    @Environment(\.observatoryTextScale) private var textScale
    let quota: JSONObject
    var dashboard = false
    var historyOnly = false
    @State private var selected = ""
    @State private var historyPeriod = "All retained"
    @State private var historyDate = ""
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
          if !historyOnly {
            ObservatoryAdaptiveRow {
                Text("Account usage").observatoryFont(14.5, weight: .semibold)
                Spacer()
                if let at = parseDate(quota["checkedAt"]) {
                    Text(at, style: .relative).observatoryFont(12).help("Time since the last successful limit read")
                }
            }.foregroundStyle(.secondary)
            Text(statusLabel).observatoryFont(12).foregroundStyle(text(quota["status"]) == "ok" ? ObservatoryTheme.muted : Color.orange)
            ForEach(Array(windows.enumerated()), id: \.offset) { _, row in
                VStack(alignment: .leading, spacing: 4) {
                    ObservatoryAdaptiveRow {
                        Text(label(row)).observatoryFont(dashboard ? 19 : 12, weight: .semibold).tracking(dashboard ? 0.6 : 0)
                        Spacer()
                        Text("\(formatted(number(row["remainingPercent"])))% left").observatoryFont().monospacedDigit()
                    }
                    ProgressView(value: number(row["remainingPercent"]) ?? 0, total: 100).progressViewStyle(ObservatoryProgressStyle())
                        .accessibilityLabel("Allowance remaining for \(label(row))")
                        .accessibilityValue("\(formatted(number(row["remainingPercent"]))) percent")
                    Text(parseDate(row["resetsAt"]).map { "Resets \($0.formatted(date: .abbreviated, time: .shortened))" } ?? "Reset time unknown")
                        .observatoryFont(12).foregroundStyle(ObservatoryTheme.muted)
                    TimelineView(.periodic(from: .now, by: 30)) { context in
                        if let live = quotaLivePace(quota, window: row, now: context.date) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(live.remaining).observatoryFont(dashboard ? 36 : 22, weight: .semibold).tracking(-1).monospacedDigit()
                                Text("Estimated at this pace · reset in \(live.reset)")
                                    .observatoryFont().foregroundStyle(ObservatoryTheme.muted)
                                let rate = formatted(live.rate)
                                Text("\(rate) \(rate == "1" ? "percentage point" : "percentage points") / hour")
                                    .observatoryFont().monospacedDigit()
                            }.frame(maxWidth: .infinity, alignment: .leading)
                        } else {
                            Text(quotaPaceText(quota, window: row, now: context.date))
                            .observatoryFont().foregroundStyle(ObservatoryTheme.muted)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        if let fraction = quotaPaceCoverage(quota, window: row, now: context.date) {
                            VStack(spacing: 3) {
                                ProgressView(value: fraction, total: 1).progressViewStyle(ObservatoryProgressStyle(color: ObservatoryTheme.sage))
                                ObservatoryAdaptiveRow {
                                    Text("Now")
                                    Spacer()
                                    Text("Reset")
                                }.observatoryFont(10).foregroundStyle(.secondary)
                            }.accessibilityElement(children: .ignore)
                                .accessibilityLabel("Estimated time coverage until reset at the last observed pace")
                                .accessibilityValue("\(quotaCoverageLabel(fraction)). Filled portion ends at estimated exhaustion or reset, whichever comes first.")
                        }
                    }
                }.accessibilityElement(children: .contain)
                    .accessibilityLabel(label(row))
            }
          }
            if let chosen {
                if windows.count > 1 {
                    Picker("Limit history", selection: Binding(get: { key(chosen) }, set: { selected = $0 })) {
                        ForEach(Array(windows.enumerated()), id: \.offset) { _, row in Text(label(row)).tag(key(row)) }
                    }.labelsHidden().accessibilityLabel("Limit history window")
                }
                let retained = quotaHistoryPoints(rows(quota["history"]), bucket: text(chosen["bucket"]), window: text(chosen["window"]))
                if dashboard {
                    ObservatorySegments(title: "Period", labels: ["Day", "Week", "All retained"], values: ["Day", "Week", "All retained"], selection: $historyPeriod)
                }
                let dates = Array(Set(retained.map { quotaRecordedDate($0.at) })).sorted()
                let anchor = dates.contains(historyDate) ? historyDate : dates.last ?? ""
                if dashboard && historyPeriod != "All retained" && !dates.isEmpty {
                    ObservatoryFilterRow(title: historyPeriod == "Week" ? "Week ending" : "Recorded day") {
                        ObservatoryPopup(title: "Recorded date", labels: dates, values: dates,
                            selection: Binding(get: { anchor }, set: { historyDate = $0 }))
                    }
                }
                let checkedAt = parseDate(quota["checkedAt"]) ?? retained.last?.at ?? Date()
                let range = dashboard ? quotaPeriodRange(retained, period: historyPeriod, anchor: anchor, checkedAt: checkedAt)
                    : checkedAt.addingTimeInterval(-86400)...checkedAt
                let start = range.lowerBound
                let end = range.upperBound
                let points = retained.filter { $0.at >= start && $0.at <= checkedAt && (historyPeriod == "All retained" ? $0.at <= end : $0.at < end) }
                Text("Allowance used").observatoryFont(dashboard ? 19 : 12, weight: .semibold).tracking(dashboard ? 0.6 : 0)
                if !points.isEmpty {
                    Chart {
                      ForEach(points) { point in
                        LineMark(x: .value("Time", point.at), y: .value("Used percent", point.used), series: .value("Reading segment", point.segment))
                            .foregroundStyle(ObservatoryTheme.sage)
                        PointMark(x: .value("Time", point.at), y: .value("Used percent", point.used)).symbolSize(8).foregroundStyle(ObservatoryTheme.sage)
                            .accessibilityHidden(true)
                      }
                      ForEach(Array(points.dropFirst().enumerated()), id: \.offset) { index, point in
                        if quotaIsGap(points[index], point) {
                            ForEach([points[index], point]) { endpoint in
                                LineMark(x: .value("Time", endpoint.at), y: .value("Used percent", endpoint.used), series: .value("Unknown coverage", "gap-\(index)"))
                                    .foregroundStyle(ObservatoryTheme.sage.opacity(0.82))
                                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 4]))
                                    .accessibilityLabel("Coverage unknown. No observation between these readings.")
                            }
                        }
                      }
                    }
                    .chartYScale(domain: 0...100)
                    .chartXScale(domain: start...end)
                    .chartXAxis {
                        AxisMarks(values: .stride(by: .hour, count: dashboard ? 1 : 6)) {
                            AxisGridLine()
                            AxisTick()
                            AxisValueLabel(format: .dateTime.hour(.defaultDigits(amPM: .abbreviated)))
                                .font(ObservatoryTheme.font(11 * textScale))
                        }
                    }
                    .chartYAxis { AxisMarks(values: [0, 50, 100]) {
                        AxisGridLine(); AxisTick(); AxisValueLabel().font(ObservatoryTheme.font(11 * textScale))
                    } }
                    .chartXAxis(dashboard ? .hidden : .automatic)
                    .frame(height: 130 * textScale)
                    .accessibilityLabel("Allowance used. Dashed spans mean coverage unknown, not estimated usage. Resets remain separate.")
                    Text("Dashed spans: coverage unknown. No estimated readings.").observatoryFont(12).foregroundStyle(ObservatoryTheme.muted)
                    if dashboard && !historyOnly {
                        Text("Live snapshot history retains up to 30 days. Older saved observations are in the account archive.").observatoryFont(12).foregroundStyle(ObservatoryTheme.muted)
                    }
                    if dashboard {
                        ObservatoryAdaptiveRow {
                            Text(start, format: .dateTime.month(.abbreviated).day().hour().minute())
                            Spacer()
                            Text(end, format: .dateTime.month(.abbreviated).day().hour().minute())
                        }.observatoryFont(12).foregroundStyle(ObservatoryTheme.muted)
                    }
                    let hourly = quotaHourlyPace(points)
                    if !hourly.isEmpty {
                        Text("Usage pace by hour").observatoryFont(dashboard ? 19 : 13, weight: .semibold).tracking(dashboard ? 0.6 : 0)
                        Chart(hourly) { hour in
                            BarMark(x: .value("Hour", hour.hour, unit: .hour),
                                    y: .value("Percentage points per hour", hour.percentagePointsPerHour))
                                .foregroundStyle(ObservatoryTheme.sage).cornerRadius(4)
                                .accessibilityLabel(hour.hour.formatted(date: .abbreviated, time: .shortened))
                                .accessibilityValue("\(formatted(hour.percentagePointsPerHour)) percentage points per hour, based on \(formatted(hour.observedMinutes)) observed minutes")
                        }
                        .chartXScale(domain: (dashboard ? hourly.first!.hour : points.last!.at.addingTimeInterval(-86400))...hourly.last!.hour.addingTimeInterval(3600))
                        .chartXAxis {
                            if dashboard {
                                AxisMarks(values: quotaHourlyTickDates(hourly)) { AxisValueLabel(format: .dateTime.hour()).font(ObservatoryTheme.font(11 * textScale)) }
                            } else {
                                AxisMarks(values: .stride(by: .hour, count: 6)) { AxisValueLabel(format: .dateTime.hour()).font(ObservatoryTheme.font(11 * textScale)) }
                            }
                        }
                        .chartPlotStyle { plot in plot.clipped() }
                        .chartYAxis { AxisMarks(values: .automatic(desiredCount: 4)) {
                            AxisGridLine(); AxisTick(); AxisValueLabel().font(ObservatoryTheme.font(11 * textScale))
                        } }
                        .frame(height: 115 * textScale)
                        Text("Rates use observed intervals within each hour. Missing polls, resets and intervals crossing an hour boundary are excluded.")
                            .observatoryFont(10).foregroundStyle(.secondary)
                    }
                } else {
                    Text("No saved observations in this period.").observatoryFont(11).foregroundStyle(.secondary)
                }
            }
            let daily = Array(rows(quota["dailyUsageBuckets"]).suffix(14))
            if !daily.isEmpty {
                Text("Account tokens · recent daily totals").observatoryFont(11).foregroundStyle(.secondary)
                Chart(Array(daily.enumerated()), id: \.offset) { _, day in
                    if let date = parseDate(text(day["startDate"]) + "T00:00:00Z"), let tokens = number(day["tokens"]) {
                        BarMark(x: .value("Day", date, unit: .day), y: .value("Tokens", tokens), width: .fixed(40)).foregroundStyle(ObservatoryTheme.sage).cornerRadius(4)
                    }
                }
                .chartXAxis { AxisMarks(values: .automatic(desiredCount: 3)) {
                    AxisGridLine(); AxisTick(); AxisValueLabel().font(ObservatoryTheme.font(11 * textScale))
                } }
                .chartYAxis { AxisMarks(values: .automatic(desiredCount: 3)) { axis in
                    AxisGridLine()
                    AxisValueLabel {
                        if let value = axis.as(Double.self) {
                            Text(formatted(value, compact: true)).font(ObservatoryTheme.font(11 * textScale))
                        }
                    }
                } }
                .environment(\.timeZone, TimeZone(secondsFromGMT: 0)!)
                .frame(height: 75 * textScale)
                .accessibilityLabel("Daily account token totals. Missing days are unknown, not zero.")
            }
            Text("Account-wide readings, not a device sum. Tokens and allowance use different units. Daily totals may lag.")
                .observatoryFont(10).foregroundStyle(.secondary)
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
