// Standalone, macOS-only pixel regression for synthetic --render-style output.
// Build separately (not as an app entry point):
// swiftc -parse-as-library -D OBSERVATORY_CHART_RENDER_TEST -framework AppKit \
//   -framework Vision native/ChartRenderRegression.swift -o /path/to/check-chart-render
// Run: /path/to/check-chart-render /absolute/path/to/rendered-fixtures
#if OBSERVATORY_CHART_RENDER_TEST
import AppKit
import Vision

@main
struct ChartRenderRegression {
    struct Fixture {
        let name: String
        let dates: [String]
    }

    static func main() throws {
        guard CommandLine.arguments.count == 2 else {
            fputs("Expected a synthetic --render-style output directory\n", stderr)
            exit(64)
        }
        let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let fixtures = ["light", "dark"].flatMap { mode in
            ["tokens", "activity"].flatMap { section in
                [
                    Fixture(name: "observatory-\(mode)-\(section)-all-760.png", dates: ["09/01", "09/16", "09/30"]),
                    Fixture(name: "observatory-\(mode)-\(section)-all-1280.png", dates: ["09/01", "09/16", "09/30"]),
                    Fixture(name: "observatory-\(mode)-200-\(section)-all-760.png", dates: ["09/01", "09/30"])
                ]
            }
        }
        let datePattern = try NSRegularExpression(pattern: "09/[0-3][0-9]")
        let valuePattern = try NSRegularExpression(pattern: "^[0-9]+(?:[.,][0-9]+)?(?:[MK]| min)$")
        var failures = [String]()
        var reports = [[String: Any]]()
        for fixture in fixtures {
            let url = root.appendingPathComponent(fixture.name)
            let data = try Data(contentsOf: url)
            guard let bitmap = NSBitmapImageRep(data: data) else { throw CocoaError(.fileReadCorruptFile) }
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.recognitionLanguages = ["en-US"]
            request.usesLanguageCorrection = false
            request.minimumTextHeight = 0.004
            try VNImageRequestHandler(url: url).perform([request])
            let observations = (request.results ?? []).compactMap { observation -> (String, CGRect)? in
                guard let text = observation.topCandidates(1).first?.string else { return nil }
                return (text, observation.boundingBox)
            }
            let dates = observations.flatMap { text, _ in
                datePattern.matches(in: text, range: NSRange(text.startIndex..., in: text)).compactMap {
                    Range($0.range, in: text).map { String(text[$0]) }
                }
            }.sorted()
            if dates != fixture.dates.sorted() {
                failures.append("\(fixture.name): x labels \(dates), expected \(fixture.dates)")
            }
            let yLabels = observations.filter { text, box in
                box.minX > 0.8 && valuePattern.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
            }
            if yLabels.count < 2 {
                failures.append("\(fixture.name): fewer than two readable y-axis labels")
            }
            let contrast = yLabels.map { text, box -> [String: Any] in
                // Compare glyph interiors with the surrounding card, not the
                // antialiased edges of 11pt labels. Ignore isolated extreme pixels;
                // this is a disappearance/contrast regression, not a WCAG audit.
                let left = max(0, Int(box.minX * Double(bitmap.pixelsWide)))
                let right = min(bitmap.pixelsWide - 1, Int(box.maxX * Double(bitmap.pixelsWide)))
                let top = max(0, Int((1 - box.maxY) * Double(bitmap.pixelsHigh)))
                let bottom = min(bitmap.pixelsHigh - 1, Int((1 - box.minY) * Double(bitmap.pixelsHigh)))
                // The left neighbor can be a grid line or bar; sample the card
                // just beyond the trailing label instead.
                let background = luminance(bitmap.colorAt(x: min(bitmap.pixelsWide - 1, right + 5), y: (top + bottom) / 2)!)
                var ratios = [Double]()
                for y in top...bottom {
                    for x in left...right {
                        let value = luminance(bitmap.colorAt(x: x, y: y)!)
                        ratios.append((max(value, background) + 0.05) / (min(value, background) + 0.05))
                    }
                }
                ratios.sort(by: >)
                let ratio = ratios[ratios.count / 50]
                if ratio < 3 {
                    failures.append("\(fixture.name): y label \(text) contrast \(String(format: "%.2f", ratio)):1, expected >= 3:1")
                }
                return ["text": text, "contrast": ratio]
            }
            reports.append(["file": fixture.name, "xLabels": dates, "yLabels": contrast,
                            "recognizedText": observations.map(\.0)])
        }
        let report: [String: Any] = ["fixtures": reports, "failures": failures, "passed": failures.isEmpty]
        print(String(decoding: try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]), as: UTF8.self))
        exit(failures.isEmpty ? 0 : 1)
    }

    static func luminance(_ color: NSColor) -> Double {
        let rgb = color.usingColorSpace(.sRGB)!
        func linear(_ value: CGFloat) -> Double {
            let value = Double(value)
            return value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linear(rgb.redComponent) + 0.7152 * linear(rgb.greenComponent) + 0.0722 * linear(rgb.blueComponent)
    }
}
#endif
