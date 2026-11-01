import AppKit
import CoreGraphics
import Foundation

// External probe: verifies the ordinary app process, without its startup-test flag.
guard CommandLine.arguments.count == 2, let pid = Int32(CommandLine.arguments[1]) else { exit(2) }
let deadline = Date().addingTimeInterval(10)
while Date() < deadline {
    let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? []
    if windows.contains(where: { window in
        guard (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
              (window[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
              let bounds = window[kCGWindowBounds as String] as? [String: Any],
              let width = bounds["Width"] as? NSNumber,
              let height = bounds["Height"] as? NSNumber else { return false }
        return width.doubleValue >= 380 && height.doubleValue >= 600
    }) {
        print("PASS: ordinary app launch has a visible WindowServer window")
        exit(0)
    }
    if NSRunningApplication(processIdentifier: pid)?.isTerminated != false { break }
    Thread.sleep(forTimeInterval: 0.1)
}
fputs("FAIL: ordinary app launch has no visible window\n", stderr)
exit(1)
