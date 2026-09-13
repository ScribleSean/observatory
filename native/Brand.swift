import AppKit

func telescopeImage(template: Bool = false) -> NSImage {
    let image = Bundle.main.url(forResource: "telescope", withExtension: "svg")
        .flatMap { NSImage(contentsOf: $0) } ?? NSImage(size: NSSize(width: 24, height: 24))
    image.size = NSSize(width: 18, height: 18)
    image.isTemplate = template
    image.accessibilityDescription = "Observatory telescope"
    return image
}
