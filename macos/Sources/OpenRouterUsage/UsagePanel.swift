import SwiftUI
import AppKit
import UsageCore

@MainActor
struct UsagePanel: View {
    @ObservedObject var model: UsageModel
    @State private var draftKey = ""
    @State private var confirmDelete = false
    @State private var historyVisible = false
    @FocusState private var keyFocused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Label("OpenRouter", systemImage: "chart.bar.xaxis")
                        .font(.headline)
                    Spacer()
                    if model.refreshing { ProgressView().controlSize(.small).accessibilityLabel("Refreshing usage") }
                    Button { model.refresh() } label: { Image(systemName: "arrow.clockwise") }
                        .help("Refresh usage (⌘R)")
                        .accessibilityLabel("Refresh usage")
                        .keyboardShortcut("r")
                        .disabled(!model.hasKey || model.refreshing)
                }

                if !model.hasKey {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Your usage, at a glance.").font(.title2.weight(.semibold))
                        Text("Connect your OpenRouter key to see spending and save daily observations on this Mac.")
                            .foregroundStyle(.secondary)
                    }
                } else {
                    usageSummary
                }

                if let error = model.error {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityLabel("Error: \(error)")
                }
                if let warning = model.historyWarning {
                    Label(warning, systemImage: "externaldrive.badge.exclamationmark")
                        .font(.callout).foregroundStyle(.secondary)
                }

                if model.hasKey {
                    DisclosureGroup("Recent days (UTC)", isExpanded: $historyVisible) {
                        VStack(alignment: .leading, spacing: 10) {
                            if model.days.isEmpty { Text("No daily observations saved yet.").foregroundStyle(.secondary) }
                            ForEach(model.days, id: \.0) { date, day in
                                VStack(alignment: .leading, spacing: 3) {
                                    HStack {
                                        Text(date)
                                        Spacer()
                                        Text(money(day.usageUsd)).monospacedDigit()
                                    }
                                    Text("Observed \(day.lastObservedAt)")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            Text("Saved observations, not final daily totals. Missing days are unknown. Days reset at 00:00 UTC.")
                                .font(.caption).foregroundStyle(.secondary)
                        }.padding(.top, 8)
                    }
                }
                Divider()
                DisclosureGroup("Settings", isExpanded: $model.settingsVisible) {
                    settings.padding(.top, 10)
                }
                HStack {
                    Link("OpenRouter keys", destination: URL(string: "https://openrouter.ai/settings/keys")!)
                    Spacer()
                    Button("Quit") { NSApplication.shared.terminate(nil) }.keyboardShortcut("q")
                }.font(.callout)
            }
            .padding(20)
        }
        .frame(width: 380)
        .frame(maxHeight: 640)
        .onAppear { model.refreshIfStale() }
        .onDisappear { draftKey = "" }
        .confirmationDialog("Delete the saved API key?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete key", role: .destructive) { model.deleteKey(); draftKey = "" }
        } message: { Text("The key will be removed from Keychain. Saved daily history stays on this Mac.") }
    }

    private var usageSummary: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Today · UTC").font(.subheadline).foregroundStyle(.secondary)
            TimelineView(.periodic(from: .now, by: 30)) { context in
                let stale = model.updated.map { context.date.timeIntervalSince($0) >= Double(model.interval + 30) } ?? false
                VStack(alignment: .leading, spacing: 12) {
                    Text(stale ? "Refresh needed" : money(model.usage?.usageDaily))
                        .font(.system(.largeTitle, design: .rounded).weight(.semibold))
                        .monospacedDigit()
                        .textSelection(.enabled)
                    GroupBox {
                        VStack(spacing: 10) {
                            metric("This week", stale ? nil : model.usage?.usageWeekly)
                            metric("This month", stale ? nil : model.usage?.usageMonthly)
                            metric("All time", stale ? nil : model.usage?.usage)
                            Divider()
                            metric("Key cap remaining", stale ? nil : model.usage?.limitRemaining)
                        }.padding(4)
                    }
                    if let updated = model.updated {
                        HStack(spacing: 4) {
                            Text(stale ? "Last observation" : "Updated")
                            Text(updated, style: .relative)
                            Text("ago")
                        }.font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            Text("Key spending cap, not your account balance. Amounts in USD.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private func metric(_ title: String, _ value: Double?) -> some View {
        HStack {
            Text(title).foregroundStyle(.secondary)
            Spacer()
            Text(money(value)).monospacedDigit()
        }
        .accessibilityElement(children: .combine)
    }

    private var settings: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(model.hasKey ? "Replace API key" : "API key").font(.subheadline.weight(.medium))
            SecureField("sk-or-…", text: $draftKey)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel(model.hasKey ? "Replacement OpenRouter API key" : "OpenRouter API key")
                .focused($keyFocused)
                .onSubmit(save)
            Text("Stored in this Mac’s Keychain. Sent only to OpenRouter over HTTPS. No analytics or third-party services.")
                .font(.caption).foregroundStyle(.secondary)
            HStack {
                Button("Save and refresh", action: save)
                    .buttonStyle(.borderedProminent)
                    .disabled(draftKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                if model.hasKey {
                    Button("Delete key", role: .destructive) { confirmDelete = true }
                }
            }
            Picker("Refresh every", selection: $model.interval) {
                Text("30 seconds").tag(30)
                Text("1 minute").tag(60)
                Text("2 minutes").tag(120)
                Text("5 minutes").tag(300)
                Text("10 minutes").tag(600)
                Text("30 minutes").tag(1800)
                Text("1 hour").tag(3600)
            }
            Toggle("Show remaining cap in menu bar", isOn: $model.showAmount)
            Toggle("Open at login", isOn: Binding(get: { model.loginEnabled }, set: { model.setLogin($0) }))
        }
    }

    private func save() {
        if model.saveKey(draftKey) {
            draftKey = ""
            keyFocused = false
            model.settingsVisible = false
        }
    }
}
