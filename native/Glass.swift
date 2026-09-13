import AppKit
import SwiftUI

// One system-composited backdrop, with no animation loop or web blur layers.
private struct ObservatoryMaterial: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = .popover
        view.blendingMode = .behindWindow
        view.state = .active
        view.appearance = NSAppearance(named: .darkAqua)
        return view
    }

    func updateNSView(_ view: NSVisualEffectView, context: Context) {}
}

struct ObservatoryBackdrop: View {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        ZStack {
            if reduceTransparency {
                Color(red: 9/255, green: 9/255, blue: 11/255)
            } else {
                ObservatoryMaterial()
                Color.black.opacity(0.22)
                LinearGradient(colors: [.white.opacity(0.055), .clear],
                               startPoint: .topLeading, endPoint: .bottomTrailing)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

struct ObservatoryGlassControl: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    @ViewBuilder
    func body(content: Content) -> some View {
        // Older Xcode SDKs cannot resolve glassEffect, even behind an OS availability check.
        #if compiler(>=6.2)
        if #available(macOS 26.0, *), !reduceTransparency {
            content.glassEffect(.regular, in: RoundedRectangle(cornerRadius: 12))
        } else {
            content.background(.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
        }
        #else
        content.background(.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
        #endif
    }
}
