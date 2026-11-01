import Foundation

public struct Day: Codable {
    public let usageUsd: Double
    public let totalUsageUsd: Double?
    public let firstObservedAt: String
    public let lastObservedAt: String
}

public struct KeyHistory: Codable { public var days: [String: Day] = [:] }
public struct History: Codable {
    public var version = 1
    public var timezone = "UTC"
    public var keys: [String: KeyHistory] = [:]
    public init() {}
}

public struct HistoryStore {
    public let file: URL
    public init(directory: URL) { file = directory.appendingPathComponent("usage-history.json") }

    private func read() throws -> History {
        guard FileManager.default.fileExists(atPath: file.path) else { return History() }
        let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
        guard ((attributes[.size] as? NSNumber)?.intValue ?? Int.max) <= 8_388_608 else { throw UsageError.history }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let history = try decoder.decode(History.self, from: Data(contentsOf: file))
        guard history.version == 1, history.timezone == "UTC" else { throw UsageError.history }
        for (id, entry) in history.keys {
            guard id.count == 64, id.allSatisfy({ "0123456789abcdef".contains($0) }) else { throw UsageError.history }
            for (date, day) in entry.days {
                guard date.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil,
                      day.usageUsd.isFinite, day.usageUsd >= 0,
                      day.totalUsageUsd.map({ $0.isFinite && $0 >= 0 }) ?? true,
                      Self.timestamp(day.firstObservedAt) != nil,
                      Self.timestamp(day.lastObservedAt) != nil else { throw UsageError.history }
            }
        }
        return history
    }

    private static func timestamp(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

    public func recent(key: String) throws -> [(String, Day)] {
        let days = try read().keys[keyID(key)]?.days ?? [:]
        return days.keys.sorted(by: >).prefix(7).compactMap { date in days[date].map { (date, $0) } }
    }

    public func record(key: String, observation: Observation) throws {
        guard let daily = observation.usage.usageDaily else { return }
        guard daily.isFinite, daily >= 0 else { throw UsageError.history }
        var history = try read()
        let id = keyID(key)
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let timestamp = formatter.string(from: observation.observedAt)
        let date = String(timestamp.prefix(10))
        var entry = history.keys[id] ?? KeyHistory()
        let previous = entry.days[date]
        if let previous, let last = Self.timestamp(previous.lastObservedAt), last > observation.observedAt { return }
        entry.days[date] = Day(usageUsd: daily, totalUsageUsd: observation.usage.usage,
                              firstObservedAt: previous?.firstObservedAt ?? timestamp, lastObservedAt: timestamp)
        history.keys[id] = entry
        let directory = file.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        // Create the temporary file private from the outset, then atomically rename.
        let temporary = directory.appendingPathComponent(UUID().uuidString + ".tmp")
        defer { try? FileManager.default.removeItem(at: temporary) }
        guard FileManager.default.createFile(atPath: temporary.path, contents: nil, attributes: [.posixPermissions: 0o600])
        else { throw UsageError.history }
        try encoder.encode(history).write(to: temporary)
        if FileManager.default.fileExists(atPath: file.path) {
            _ = try FileManager.default.replaceItemAt(file, withItemAt: temporary, options: .usingNewMetadataOnly)
        } else {
            try FileManager.default.moveItem(at: temporary, to: file)
        }
    }
}
