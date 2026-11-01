import AppKit
import SwiftUI
import ServiceManagement
import UsageCore

@MainActor
final class UsageModel: ObservableObject {
    @Published private(set) var usage: Usage?
    @Published private(set) var updated: Date?
    @Published private(set) var days: [(String, Day)] = []
    @Published private(set) var refreshing = false
    @Published private(set) var hasKey = false
    @Published var error: String?
    @Published var historyWarning: String?
    @Published var settingsVisible = true
    @Published var loginEnabled = false
    @Published var interval: Int {
        didSet {
            UserDefaults.standard.set(interval, forKey: "refreshSeconds")
            scheduleRefresh()
        }
    }
    @Published var showAmount: Bool {
        didSet { UserDefaults.standard.set(showAmount, forKey: "showMenuAmount") }
    }
    private var key = ""
    private var request: Task<Void, Never>?
    private var timer: Timer?
    private var generation = UUID()
    private var started = false
    private let history: HistoryStore

    init() {
        let seconds = UserDefaults.standard.integer(forKey: "refreshSeconds")
        interval = [30, 60, 120, 300, 600, 1800, 3600].contains(seconds) ? seconds : 120
        showAmount = UserDefaults.standard.bool(forKey: "showMenuAmount")
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        history = HistoryStore(directory: support.appendingPathComponent("OpenRouterUsage", isDirectory: true))
        scheduleRefresh()
    }

    // Keychain can wait for user interaction. Never hold up status item/window creation.
    func start(readKey: @escaping @Sendable () throws -> String? = { try Keychain.load() }) async {
        guard !started else { return }
        started = true
        let token = generation
        do {
            let saved = try await Task.detached(priority: .userInitiated, operation: readKey).value
            // A key saved/deleted while Keychain was loading takes precedence.
            guard token == generation else { return }
            if let saved {
                key = try validatedKey(saved)
                hasKey = true
                loadHistory()
            }
        } catch {
            guard token == generation else { return }
            self.error = "Could not read the saved key. Unlock your Mac or replace the key in Settings."
        }
        refreshLoginStatus()
        settingsVisible = !hasKey
        refresh()
    }

    var menuTitle: String {
        guard showAmount else { return "" }
        guard let usage, let updated, error == nil,
              Date().timeIntervalSince(updated) < Double(interval + 30) else { return "OR ?" }
        return usage.limitRemaining.map { money($0) + " left" } ?? "OR ?"
    }

    func saveKey(_ input: String) -> Bool {
        do {
            let candidate = try validatedKey(input)
            try Keychain.save(candidate)
            resetRequest()
            key = candidate
            hasKey = true
            error = nil
            historyWarning = nil
            loadHistory()
            refresh()
            return true
        } catch { self.error = error.localizedDescription; return false }
    }

    func deleteKey() {
        do {
            try Keychain.delete()
            resetRequest()
            key = ""
            hasKey = false
            days = []
            error = nil
            historyWarning = nil
        } catch { self.error = error.localizedDescription }
    }

    func setLogin(_ enabled: Bool) {
        do {
            if enabled { try SMAppService.mainApp.register() }
            else { try SMAppService.mainApp.unregister() }
            loginEnabled = SMAppService.mainApp.status == .enabled
            if enabled && !loginEnabled { error = "Allow OpenRouter Usage in System Settings → General → Login Items." }
        } catch {
            loginEnabled = SMAppService.mainApp.status == .enabled
            self.error = "Could not change login settings. Move the app to Applications and try again."
        }
    }

    func refresh() {
        guard hasKey else { return }
        request?.cancel()
        let token = UUID()
        generation = token
        let currentKey = key
        refreshing = true
        error = nil
        request = Task { [weak self] in
            do {
                let observation = try await UsageClient.fetch(key: currentKey)
                guard let self, !Task.isCancelled, self.generation == token else { return }
                self.usage = observation.usage
                self.updated = observation.observedAt
                self.historyWarning = nil
                do { try self.history.record(key: currentKey, observation: observation) }
                catch { self.historyWarning = UsageError.history.localizedDescription }
                self.loadHistory()
                self.refreshing = false
            } catch {
                guard let self, !Task.isCancelled, self.generation == token else { return }
                self.usage = nil
                self.updated = nil
                self.refreshing = false
                // Do not expose raw network errors, headers, or server response bodies.
                self.error = (error as? UsageError)?.localizedDescription ?? "Could not refresh. Check your connection and try again."
            }
        }
    }

    func refreshIfStale() {
        refreshLoginStatus()
        if !refreshing && (updated == nil || Date().timeIntervalSince(updated!) >= Double(interval)) { refresh() }
    }

    private func refreshLoginStatus() {
        Task {
            loginEnabled = await Task.detached { SMAppService.mainApp.status == .enabled }.value
        }
    }

    private func resetRequest() {
        generation = UUID()
        request?.cancel()
        request = nil
        refreshing = false
        usage = nil
        updated = nil
    }

    private func loadHistory() {
        do { days = try history.recent(key: key) }
        catch { days = []; historyWarning = UsageError.history.localizedDescription }
    }

    private func scheduleRefresh() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: Double(interval), repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refreshIfStale() }
        }
        timer?.tolerance = min(15, Double(interval) / 10)
    }
}
