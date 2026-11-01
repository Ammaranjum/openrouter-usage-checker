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
        // NSPopover closes asynchronously when its system animation is enabled.
        let reopened = await waitUntil { window.isVisible && !delegate.isPopoverShown }
        check(reopened,
              "Reopening the app restores settings independently of the menu bar")
        gate.signal()
        await loading.value
        check(model.error != nil && model.settingsVisible && !model.hasKey,
              "Keychain failure leaves setup accessible and reports the error")
        let empty = UsageModel()
        await empty.start(readKey: { nil })
        check(!empty.hasKey && empty.error == nil && empty.settingsVisible,
              "First run without a saved key keeps setup open")
        let invalid = UsageModel()
        await invalid.start(readKey: { "invalid-saved-key" })
        check(!invalid.hasKey && invalid.error != nil && invalid.settingsVisible,
              "Invalid saved key keeps setup open and shows an error")
        model.showAmount = true
        let unknownTitle = await waitUntil { button.title == "OR ?" }
        check(unknownTitle, "Unreported remaining cap never becomes a fabricated amount")
        model.showAmount = false
        let restoredTitle = await waitUntil { button.title == "OR" }
        check(restoredTitle, "Disabling the amount preserves an identifiable menu bar button")
        // This uses a unique test service, never the normal saved-key service.
        do {
            try await Task.detached {
                defer { try? Keychain.delete() }
                try Keychain.save("sk-or-v1-synthetic-startup-check-key")
                guard try Keychain.load() == "sk-or-v1-synthetic-startup-check-key" else {
                    throw Keychain.Failure()
                }
                try Keychain.save("sk-or-v1-synthetic-replacement-key")
                guard try Keychain.load() == "sk-or-v1-synthetic-replacement-key" else {
                    throw Keychain.Failure()
                }
                try Keychain.delete()
                guard try Keychain.load() == nil else { throw Keychain.Failure() }
            }.value
            check(true, "Packaged sandboxed app saves, reads, replaces, and deletes a synthetic Keychain item")
        } catch {
            let status = (error as? Keychain.Failure)?.status.map(String.init) ?? "unknown"
            fail("Real Keychain round trip failed (OSStatus: \(status))")
        }
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

    private static func waitUntil(_ condition: () -> Bool) async -> Bool {
        let deadline = Date().addingTimeInterval(3)
        while !condition() && Date() < deadline {
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        return condition()
    }

    private static func fail(_ message: String) -> Never {
        fputs("FAIL: " + message + "\n", stderr)
        exit(1)
    }
}
