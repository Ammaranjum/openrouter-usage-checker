import AppKit
import Foundation

// Exercised only by the packaged-app CI check. No real credentials or API requests.
@MainActor
enum StartupCheck {
    static func run(_ delegate: AppDelegate) async {
        guard let model = delegate.model, let window = delegate.window,
              let item = delegate.statusItem, let button = item.button else {
            fail("Launch did not create a status item and window")
        }
        let gate = DispatchSemaphore(value: 0)
        let loading = Task {
            await model.start(readKey: {
                gate.wait()
                throw Keychain.Failure()
            })
        }
        // Simulate Keychain waiting indefinitely while the main run loop handles UI.
        try? await Task.sleep(nanoseconds: 300_000_000)
        check(item.isVisible && button.title == "OR" && button.window != nil,
              "Native menu bar button exists before Keychain finishes")
        check(window.isVisible && window.contentView!.bounds.height > 0 && model.settingsVisible,
              "Launch opens a nonempty settings window before Keychain finishes")
        window.close()
        check(!window.isVisible, "Closing the window leaves the app alive")
        button.performClick(nil)
        check(delegate.isPopoverShown, "Clicking the menu bar button opens the usage panel")
        _ = delegate.applicationShouldHandleReopen(NSApp, hasVisibleWindows: false)
        check(window.isVisible && !delegate.isPopoverShown,
              "Reopening the app restores settings independently of the menu bar")
        gate.signal()
        await loading.value
        check(model.error != nil && model.settingsVisible && !model.hasKey,
              "Keychain failure leaves setup accessible and reports the error")
        window.contentView?.displayIfNeeded()
        if let view = window.contentView,
           let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) {
            view.cacheDisplay(in: view.bounds, to: bitmap)
            if let png = bitmap.representation(using: .png, properties: [:]) {
                print("STARTUP_SCREENSHOT:" + png.base64EncodedString())
            }
        }
        print("ALL PACKAGED MAC STARTUP CHECKS PASSED")
        fflush(stdout)
        NSApp.terminate(nil)
    }

    private static func check(_ condition: Bool, _ message: String) {
        guard condition else { fail(message) }
        print("PASS: " + message)
    }

    private static func fail(_ message: String) -> Never {
        fputs("FAIL: " + message + "\n", stderr)
        exit(1)
    }
}
