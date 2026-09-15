import SwiftUI
import CoreText

private struct ObservatoryTextScaleKey: EnvironmentKey {
    static let defaultValue: Double = 1
}

extension EnvironmentValues {
    var observatoryTextScale: Double {
        get { self[ObservatoryTextScaleKey.self] }
        set { self[ObservatoryTextScaleKey.self] = newValue.isFinite ? min(2, max(0.75, newValue)) : 1 }
    }
}

private struct ObservatoryFont: ViewModifier {
    @Environment(\.observatoryTextScale) private var scale
    let size: CGFloat
    let weight: Font.Weight
    let design: Font.Design?
    func body(content: Content) -> some View {
        content.font(design.map { Font.system(size: size * scale, weight: weight, design: $0) }
            ?? ObservatoryTheme.font(size * scale, weight: weight))
    }
}

extension View {
    func observatoryFont(_ size: CGFloat = 14.5, weight: Font.Weight = .regular, design: Font.Design? = nil) -> some View {
        modifier(ObservatoryFont(size: size, weight: weight, design: design))
    }
    func observatoryFont(_ style: Font.TextStyle) -> some View {
        observatoryFont(style == .caption ? 11 : style == .callout ? 12 : 14.5,
            weight: style == .headline ? .semibold : .regular)
    }
}

struct ObservatoryAdaptiveRow<Content: View>: View {
    @Environment(\.observatoryTextScale) private var scale
    @ViewBuilder let content: Content
    var body: some View {
        let layout = scale > 1.25 ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10)) : AnyLayout(HStackLayout(spacing: 8))
        layout { content }
    }
}

struct ObservatoryLabeledContentStyle: LabeledContentStyle {
    @Environment(\.observatoryTextScale) private var scale
    func makeBody(configuration: Configuration) -> some View {
        if scale > 1.25 {
            VStack(alignment: .leading, spacing: 4) {
                configuration.label.foregroundStyle(ObservatoryTheme.muted)
                configuration.content
            }.fixedSize(horizontal: false, vertical: true)
        } else {
            HStack {
                configuration.label
                Spacer()
                configuration.content.foregroundStyle(ObservatoryTheme.muted)
            }
        }
    }
}

struct ObservatoryValueRow: View {
    let title: String
    let value: String
    init(_ title: String, value: String) { self.title = title; self.value = value }
    var body: some View {
        LabeledContent(title, value: value).labeledContentStyle(ObservatoryLabeledContentStyle())
    }
}

struct ObservatoryEmptyState: View {
    let title: String
    let systemImage: String
    let message: String
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage).observatoryFont(32).accessibilityHidden(true)
            Text(title).observatoryFont(22, weight: .semibold).accessibilityAddTraits(.isHeader)
            Text(message).foregroundStyle(ObservatoryTheme.muted)
        }.multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity).padding(20)
    }
}

struct ObservatoryPopup: NSViewRepresentable {
    @Environment(\.observatoryTextScale) private var scale
    @Environment(\.colorScheme) private var scheme
    let title: String
    let labels: [String]
    let values: [String]
    @Binding var selection: String
    func makeCoordinator() -> Coordinator { Coordinator(selection: $selection, values: values) }
    func makeNSView(context: Context) -> NSPopUpButton {
        let control = NSPopUpButton(frame: .zero, pullsDown: false)
        control.target = context.coordinator
        control.action = #selector(Coordinator.choose(_:))
        control.setAccessibilityLabel(title)
        return control
    }
    func updateNSView(_ control: NSPopUpButton, context: Context) {
        if control.itemTitles != labels { control.removeAllItems(); control.addItems(withTitles: labels) }
        context.coordinator.selection = $selection
        context.coordinator.values = values
        control.font = .systemFont(ofSize: 13 * scale)
        control.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
        control.menu?.font = control.font!
        control.selectItem(at: values.firstIndex(of: selection) ?? -1)
    }
    func sizeThatFits(_ proposal: ProposedViewSize, nsView: NSPopUpButton, context: Context) -> CGSize? {
        CGSize(width: proposal.width ?? nsView.intrinsicContentSize.width, height: max(28, nsView.intrinsicContentSize.height))
    }
    final class Coordinator: NSObject {
        var selection: Binding<String>
        var values: [String]
        init(selection: Binding<String>, values: [String]) { self.selection = selection; self.values = values }
        @objc func choose(_ sender: NSPopUpButton) {
            guard values.indices.contains(sender.indexOfSelectedItem) else { return }
            selection.wrappedValue = values[sender.indexOfSelectedItem]
        }
    }
}

struct ObservatorySegments: View {
    @Environment(\.observatoryTextScale) private var scale
    let title: String
    let labels: [String]
    let values: [String]
    @Binding var selection: String
    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                ForEach(values.indices, id: \.self) { index in
                    segment(index).fixedSize(horizontal: true, vertical: true)
                }
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 180), spacing: 8)], spacing: 8) {
                ForEach(values.indices, id: \.self) { index in
                    segment(index)
                }
            }
        }.accessibilityElement(children: .contain).accessibilityLabel(title)
    }
    private func segment(_ index: Int) -> some View {
        Button { selection = values[index] } label: {
            Text(labels[index]).observatoryFont(13)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 16).padding(.vertical, 8)
                .frame(maxWidth: .infinity, minHeight: 36)
                .foregroundStyle(selection == values[index] ? ObservatoryTheme.background : ObservatoryTheme.text)
                .background(selection == values[index] ? ObservatoryTheme.sage : ObservatoryTheme.surface, in: Capsule())
                .shadow(color: .black.opacity(0.08), radius: 3, y: 2)
        }.buttonStyle(.plain)
            .accessibilityIdentifier("observatory-filter-\(title)-\(values[index])")
            .accessibilityValue(selection == values[index] ? "Selected" : "Not selected")
            .accessibilityAddTraits(selection == values[index] ? .isSelected : [])
    }
}

private struct ObservatorySegmentControl: NSViewRepresentable {
    @Environment(\.observatoryTextScale) private var scale
    let title: String
    let labels: [String]
    let values: [String]
    @Binding var selection: String
    func makeCoordinator() -> Coordinator { Coordinator(selection: $selection, values: values) }
    func makeNSView(context: Context) -> NSSegmentedControl {
        let control = NSSegmentedControl(labels: labels, trackingMode: .selectOne,
            target: context.coordinator, action: #selector(Coordinator.choose(_:)))
        control.segmentDistribution = .fillEqually
        control.selectedSegmentBezelColor = NSColor(ObservatoryTheme.sage)
        control.setAccessibilityLabel(title)
        return control
    }
    func updateNSView(_ control: NSSegmentedControl, context: Context) {
        control.font = .systemFont(ofSize: 13 * scale)
        context.coordinator.selection = $selection
        context.coordinator.values = values
        control.selectedSegment = values.firstIndex(of: selection) ?? -1
    }
    func sizeThatFits(_ proposal: ProposedViewSize, nsView: NSSegmentedControl, context: Context) -> CGSize? {
        CGSize(width: proposal.width ?? nsView.intrinsicContentSize.width, height: max(28, 28 * scale))
    }
    final class Coordinator: NSObject {
        var selection: Binding<String>
        var values: [String]
        init(selection: Binding<String>, values: [String]) { self.selection = selection; self.values = values }
        @objc func choose(_ sender: NSSegmentedControl) {
            guard values.indices.contains(sender.selectedSegment) else { return }
            selection.wrappedValue = values[sender.selectedSegment]
        }
    }
}

// One label column keeps native segmented controls aligned across dashboards.
struct ObservatoryFilterRow<Content: View>: View {
    @Environment(\.observatoryTextScale) private var scale
    let title: String
    @ViewBuilder let content: Content
    var body: some View {
        let layout = scale > 1 ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(spacing: 12))
        layout {
            Text(title).frame(width: scale > 1 ? nil : 108, alignment: .leading)
            content.labelsHidden().accessibilityLabel(title)
                .frame(maxWidth: .infinity, alignment: .leading)
        }.frame(maxWidth: 680, alignment: .leading)
    }
}

// Keep these values aligned with app/observatory.css and docs/BRAND.md.
enum ObservatoryTheme {
    static let cardRadius: CGFloat = 16
    static let cardPadding: CGFloat = 16
    static let spacing: [CGFloat] = [4, 8, 12, 16, 24]
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
        content.padding(ObservatoryTheme.cardPadding).background(ObservatoryTheme.surface, in: RoundedRectangle(cornerRadius: ObservatoryTheme.cardRadius))
            .shadow(color: .black.opacity(scheme == .dark ? 0.22 : 0.07), radius: 12, x: 0, y: 6)
            .shadow(color: .white.opacity(scheme == .dark ? 0.025 : 0.6), radius: 1, x: 0, y: -1)
    }
}

struct ObservatoryGroupBoxStyle: GroupBoxStyle {
    func makeBody(configuration: Configuration) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            configuration.label.observatoryFont(19, weight: .semibold).tracking(-0.5)
            configuration.content
        }.frame(maxWidth: .infinity, alignment: .leading).modifier(ObservatoryCard())
    }
}

struct ObservatoryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.observatoryFont().fixedSize(horizontal: false, vertical: true).padding(.horizontal, 14)
            .frame(minHeight: 40).foregroundStyle(ObservatoryTheme.text)
            .background(ObservatoryTheme.surface.gradient, in: Capsule())
            .shadow(color: .white.opacity(0.06), radius: 6, x: 0, y: -2)
            .shadow(color: .black.opacity(configuration.isPressed ? 0.03 : 0.12), radius: 6, x: 0, y: 3)
            .opacity(enabled ? (configuration.isPressed ? 0.75 : 1) : 0.45)
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
