import AppKit

// Draw an original utility icon at each resolution; no downloaded assets or fonts.
let destination = CommandLine.arguments[1]
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
                                      bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                      isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        let inset = CGFloat(pixels) * 0.08
        let rect = NSRect(x: inset, y: inset, width: CGFloat(pixels) - 2 * inset, height: CGFloat(pixels) - 2 * inset)
        let shape = NSBezierPath(roundedRect: rect, xRadius: CGFloat(pixels) * 0.19, yRadius: CGFloat(pixels) * 0.19)
        NSGradient(starting: NSColor(srgbRed: 0.17, green: 0.47, blue: 0.97, alpha: 1),
                   ending: NSColor(srgbRed: 0.22, green: 0.24, blue: 0.72, alpha: 1))!.draw(in: shape, angle: -70)
        NSColor.white.setFill()
        for (index, height) in [0.23, 0.39, 0.54].enumerated() {
            let bar = NSRect(x: CGFloat(pixels) * (0.25 + Double(index) * 0.19), y: CGFloat(pixels) * 0.25,
                             width: CGFloat(pixels) * 0.12, height: CGFloat(pixels) * height)
            NSBezierPath(roundedRect: bar, xRadius: CGFloat(pixels) * 0.025, yRadius: CGFloat(pixels) * 0.025).fill()
        }
        NSGraphicsContext.restoreGraphicsState()
        let suffix = scale == 2 ? "@2x" : ""
        let url = URL(fileURLWithPath: destination).appendingPathComponent("icon_\(size)x\(size)\(suffix).png")
        try bitmap.representation(using: .png, properties: [:])!.write(to: url)
    }
}
