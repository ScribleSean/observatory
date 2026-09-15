import SwiftUI

struct ArchiveChart: Decodable {
    let version: Int
    let width: Int
    let height: Int
    let from: Double
    let to: Double
    let encoding: String
    let pixels: String
    let scanned: Int
    let observations: Int
    let gaps: Int
    let segments: Int
    let firstAt: Double?
    let lastAt: Double?
    let minUsed: Double?
    let maxUsed: Double?

    func validatedMask() throws -> Data {
        guard version == 1, (2...1024).contains(width), (2...160).contains(height),
              from.isFinite, to.isFinite, from >= 0, to > from, to <= 8_640_000_000_000_000,
              encoding == "ink-mask-u8", pixels.utf8.count <= 218_456,
              scanned >= 0, observations >= 0, observations <= scanned,
              gaps >= 0, gaps <= observations, segments >= 0, segments <= observations,
              let mask = Data(base64Encoded: pixels), mask.count == width * height,
              mask.allSatisfy({ $0 <= 3 }) else { throw CocoaError(.fileReadCorruptFile) }
        if observations == 0 {
            guard firstAt == nil, lastAt == nil, minUsed == nil, maxUsed == nil, mask.allSatisfy({ $0 == 0 }) else { throw CocoaError(.fileReadCorruptFile) }
        } else {
            guard let firstAt, let lastAt, firstAt >= from, lastAt <= to, firstAt <= lastAt,
                  let minUsed, let maxUsed, minUsed >= 0, maxUsed <= 100, minUsed <= maxUsed,
                  mask.contains(3) else { throw CocoaError(.fileReadCorruptFile) }
        }
        return mask
    }

    func image() -> CGImage? {
        guard let mask = try? validatedMask() else { return nil }
        var rgba = Data(capacity: mask.count * 4)
        for ink in mask {
            let alpha: UInt8 = ink == 0 ? 0 : ink == 2 ? 110 : 255
            rgba.append(contentsOf: [255, 255, 255, alpha])
        }
        guard let provider = CGDataProvider(data: rgba as CFData) else { return nil }
        return CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue),
            provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
    }
}

struct ArchiveChartView: View {
    let chart: ArchiveChart
    var windowLabel = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Allowance used · full selected range").observatoryFont(19, weight: .semibold)
            Text(windowLabel).observatoryFont(12).foregroundStyle(ObservatoryTheme.muted)
            if chart.observations == 0 {
                Text("No observations in this range. Missing is not zero.")
            } else if let image = chart.image() {
                HStack(spacing: 8) {
                    VStack { Text("100%"); Spacer(); Text("50%"); Spacer(); Text("0%") }
                        .observatoryFont(11).foregroundStyle(ObservatoryTheme.muted)
                    Image(decorative: image, scale: 1).renderingMode(.template).resizable()
                        .interpolation(.none).foregroundStyle(ObservatoryTheme.sage)
                }.frame(height: 160)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(chart.observations) saved observations. \(chart.gaps) unknown coverage gaps. Dashed ink is not an estimated percentage.")
            }
            ObservatoryAdaptiveRow {
                Text(Date(timeIntervalSince1970: chart.from / 1000), format: .dateTime.year().month().day())
                Spacer()
                Text(Date(timeIntervalSince1970: chart.to / 1000), format: .dateTime.year().month().day())
            }.observatoryFont(12).foregroundStyle(ObservatoryTheme.muted)
            Text("\(chart.observations.formatted()) observations processed. Dashed spans mean unknown coverage. Zoom with the date range for more detail.")
                .observatoryFont(12).foregroundStyle(ObservatoryTheme.muted)
        }.modifier(ObservatoryCard())
    }
}
