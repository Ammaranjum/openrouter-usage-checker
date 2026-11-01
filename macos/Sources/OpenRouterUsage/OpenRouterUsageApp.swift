import AppKit
import Combine
import SwiftUI

@main
@MainActor
enum OpenRouterUsageApp {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.setActivationPolicy(.accessory)
        app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private(set) var statusItem: NSStatusItem?
    private(set) var window: NSWindow?
    private(set) var model: UsageModel?
    private let popover = NSPopover()
    private var changes: AnyCancellable?
    private var titleTimer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Create and retain an ordinary AppKit status item before loading credentials.
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem = item
        item.isVisible = true
        if let button = item.button {
            button.title = "OR"
            button.toolTip = "OpenRouter Usage — click to open"
            button.setAccessibilityLabel("OpenRouter Usage")
            button.target = self
            button.action = #selector(togglePopover)
        }

        let model = UsageModel()
        self.model = model
        let panel = UsagePanel(model: model, openWindow: { [weak self] in self?.showWindow() })
        popover.behavior = .transient
        popover.contentViewController = NSHostingController(rootView: panel)
        popover.contentSize = NSSize(width: 380, height: 600)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 380, height: 600),
                              styleMask: [.titled, .closable, .miniaturizable],
                              backing: .buffered, defer: false)
        window.title = "OpenRouter Usage"
        window.isReleasedWhenClosed = false
        window.contentViewController = NSHostingController(rootView: panel)
        window.setContentSize(NSSize(width: 380, height: 600))
        window.center()
        self.window = window
        // A normal window keeps setup reachable even when a status item is hidden.
        showWindow()
        changes = model.objectWillChange.sink { [weak self] _ in
            Task { @MainActor in self?.updateTitle() }
        }
        titleTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.updateTitle() }
        }

        Task { @MainActor in
            if CommandLine.arguments.contains("--startup-check") {
                await StartupCheck.run(self)
            } else {
                await model.start()
            }
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showWindow()
        return false
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func showWindow() {
        popover.performClose(nil)
        model?.settingsVisible = true
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc func togglePopover() {
        guard let button = statusItem?.button else { showWindow(); return }
        if popover.isShown { popover.performClose(nil) }
        else {
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    var isPopoverShown: Bool { popover.isShown }

    private func updateTitle() {
        guard let model else { return }
        statusItem?.button?.title = model.showAmount ? model.menuTitle : "OR"
    }
}
