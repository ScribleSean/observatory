import AppKit
import SwiftUI

@MainActor
func checkTypographyControls() {
    func popup(in view: NSView) -> NSPopUpButton? {
        if let value = view as? NSPopUpButton { return value }
        return view.subviews.lazy.compactMap { popup(in: $0) }.first
    }
    var environment = EnvironmentValues()
    for (input, expected) in [(Double.nan, 1.0), (.infinity, 1), (-1, 0.75), (3, 2), (1.5, 1.5)] {
        environment.observatoryTextScale = input
        precondition(environment.observatoryTextScale == expected)
    }
    for scale in [1.0, 2.0] {
        var selected = "first"
        let root = ObservatoryPopup(title: "Synthetic choice", labels: ["First", "Second"], values: ["first", "second"],
            selection: Binding(get: { selected }, set: { selected = $0 }))
            .environment(\.observatoryTextScale, scale).environment(\.colorScheme, .light)
        let host = NSHostingView(rootView: root)
        host.frame = NSRect(x: 0, y: 0, width: 400, height: 80)
        host.layoutSubtreeIfNeeded()
        guard let control = popup(in: host) else { preconditionFailure("Native text-size popup missing") }
        precondition(control.font?.pointSize == 13 * scale)
        precondition(control.appearance?.name == .aqua)
        precondition(control.itemTitles == ["First", "Second"] && control.indexOfSelectedItem == 0)
        control.selectItem(at: 1)
        precondition(control.sendAction(control.action, to: control.target) && selected == "second")
        control.selectItem(at: -1)
        _ = control.sendAction(control.action, to: control.target)
        precondition(selected == "second")
    }
}
