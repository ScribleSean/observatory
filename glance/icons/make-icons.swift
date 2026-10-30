// Draws the app icons from the one telescope mark in public/brand/telescope.svg.
// Run on a Mac from the repository root: `xcrun swift glance/icons/make-icons.swift`
// It writes glance/icons/Observatory.icns and glance/icons/Observatory.ico, which are committed
// so that setup on Windows needs no image tools.
import AppKit

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let out = root.appendingPathComponent("glance/icons")
guard let mark = NSImage(contentsOf: root.appendingPathComponent("public/brand/telescope.svg")) else {
  FileHandle.standardError.write("Run from the repository root.\n".data(using: .utf8)!)
  exit(1)
}

// Mac icons sit inside the standard grid margin. Windows icons fill the square.
func render(_ size: Int, inset: CGFloat) -> Data {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
                             samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                             bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  let side = CGFloat(size)
  let body = NSRect(x: side * inset, y: side * inset, width: side * (1 - 2 * inset), height: side * (1 - 2 * inset))
  // The background and mark colors match public/favicon.svg.
  NSColor(srgbRed: 9 / 255, green: 9 / 255, blue: 11 / 255, alpha: 1).setFill()
  NSBezierPath(roundedRect: body, xRadius: body.width * 0.225, yRadius: body.width * 0.225).fill()
  let glyph = body.insetBy(dx: body.width * 0.17, dy: body.width * 0.17)
  mark.draw(in: glyph, from: .zero, operation: .sourceOver, fraction: 1)
  NSGraphicsContext.restoreGraphicsState()
  return rep.representation(using: .png, properties: [:])!
}

// macOS: an iconset folder, packed by iconutil.
let iconset = FileManager.default.temporaryDirectory.appendingPathComponent("Observatory-\(UUID().uuidString).iconset")
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
for base in [16, 32, 128, 256, 512] {
  try render(base, inset: 0.1).write(to: iconset.appendingPathComponent("icon_\(base)x\(base).png"))
  try render(base * 2, inset: 0.1).write(to: iconset.appendingPathComponent("icon_\(base)x\(base)@2x.png"))
}
let pack = Process()
pack.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
pack.arguments = ["-c", "icns", iconset.path, "-o", out.appendingPathComponent("Observatory.icns").path]
try pack.run()
pack.waitUntilExit()
try? FileManager.default.removeItem(at: iconset)
guard pack.terminationStatus == 0 else {
  FileHandle.standardError.write("iconutil could not pack the icon set.\n".data(using: .utf8)!)
  exit(1)
}

// Windows: an ICO with PNG entries at every size Explorer, Start and the taskbar ask for.
let sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
let images = sizes.map { render($0, inset: 0.02) }
var ico = Data()
func le16(_ value: Int) { ico.append(contentsOf: [UInt8(value & 255), UInt8(value >> 8 & 255)]) }
func le32(_ value: Int) { le16(value & 0xffff); le16(value >> 16 & 0xffff) }
le16(0); le16(1); le16(sizes.count)
var offset = 6 + 16 * sizes.count
for (size, image) in zip(sizes, images) {
  ico.append(UInt8(size >= 256 ? 0 : size)); ico.append(UInt8(size >= 256 ? 0 : size))
  ico.append(0); ico.append(0)
  le16(1); le16(32); le32(image.count); le32(offset)
  offset += image.count
}
for image in images { ico.append(image) }
try ico.write(to: out.appendingPathComponent("Observatory.ico"))
print("Wrote glance/icons/Observatory.icns and glance/icons/Observatory.ico")
