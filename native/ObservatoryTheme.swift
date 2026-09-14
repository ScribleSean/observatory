import SwiftUI
import CoreText

// One label column keeps native segmented controls aligned across dashboards.
struct ObservatoryFilterRow<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content
    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Text(title).frame(width: 108, alignment: .leading)
            content.labelsHidden().accessibilityLabel(title)
                .frame(maxWidth: .infinity, alignment: .leading)
        }.frame(maxWidth: 680, alignment: .leading)
    }
}

// Keep these values aligned with app/observatory.css and docs/BRAND.md.
enum ObservatoryTheme {
    static func color(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let value = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
            return NSColor(srgbRed: Double((value >> 16) & 255) / 255,
                           green: Double((value >> 8) & 255) / 255,
                           blue: Double(value & 255) / 255, alpha: 1)
        })
    }
    static let background = color(0xEDEAE5, 0x1C1D1B)
    static let surface = color(0xF4F1EC, 0x272825)
    static let text = color(0x292D28, 0xF0EEE8)
    static let muted = color(0x64695F, 0xB3B7AC)
    static let sage = color(0x586F50, 0xADC29D)
    static let purple = color(0x79658E, 0xB7A4CC)
    static let track = color(0xDADBD3, 0x3B3E37)
    static func font(_ size: CGFloat = 14.5, weight: Font.Weight = .regular) -> Font {
        .custom("InterTight-Regular", size: size).weight(weight)
    }
    static func registerFont() {
        guard let url = Bundle.main.url(forResource: "InterTight", withExtension: "ttf") else { return }
        CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
    }
}

struct ObservatoryCard: ViewModifier {
    @Environment(\.colorScheme) private var scheme
    func body(content: Content) -> some View {
        content.padding(18).background(ObservatoryTheme.surface, in: RoundedRectangle(cornerRadius: 18))
            .shadow(color: .black.opacity(scheme == .dark ? 0.22 : 0.07), radius: 12, x: 0, y: 6)
            .shadow(color: .white.opacity(scheme == .dark ? 0.025 : 0.6), radius: 1, x: 0, y: -1)
    }
}

struct ObservatoryGroupBoxStyle: GroupBoxStyle {
    func makeBody(configuration: Configuration) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            configuration.label.font(ObservatoryTheme.font(19, weight: .semibold)).tracking(0.6)
            configuration.content
        }.frame(maxWidth: .infinity, alignment: .leading).modifier(ObservatoryCard())
    }
}

struct ObservatoryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(ObservatoryTheme.font()).padding(.horizontal, 14)
            .frame(minHeight: 40).foregroundStyle(ObservatoryTheme.text)
            .background(ObservatoryTheme.surface.gradient, in: Capsule())
            .shadow(color: .white.opacity(0.06), radius: 6, x: 0, y: -2)
            .shadow(color: .black.opacity(configuration.isPressed ? 0.03 : 0.12), radius: 6, x: 0, y: 3)
            .opacity(configuration.isPressed ? 0.75 : 1)
    }
}

struct ObservatoryProgressStyle: ProgressViewStyle {
    var color = ObservatoryTheme.sage
    func makeBody(configuration: Configuration) -> some View {
        GeometryReader { geometry in
            Capsule().fill(ObservatoryTheme.track)
                .overlay(alignment: .leading) {
                    Capsule().fill(color).frame(width: geometry.size.width * min(1, max(0, configuration.fractionCompleted ?? 0)))
                }
        }.frame(height: 8)
    }
}
