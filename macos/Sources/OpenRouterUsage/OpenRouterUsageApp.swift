import SwiftUI
import AppKit

@main
@MainActor
struct OpenRouterUsageApp: App {
    @StateObject private var model = UsageModel()

    var body: some Scene {
        MenuBarExtra {
            UsagePanel(model: model)
        } label: {
            TimelineView(.periodic(from: .now, by: 30)) { _ in
                HStack(spacing: 4) {
                    Image(systemName: "chart.bar.xaxis")
                    if model.showAmount { Text(model.menuTitle).monospacedDigit() }
                }
                .help("OpenRouter Usage — click to view usage and settings")
                .accessibilityLabel("OpenRouter Usage. \(model.menuTitle)")
            }
        }
        .menuBarExtraStyle(.window)
    }
}
