import XCTest
@testable import UsageCore

final class UsageCoreTests: XCTestCase {
    private let key = "sk-or-v1-synthetic-key-for-tests"

    private func observation(_ daily: String = "0", at: String = "2026-10-31T23:59:00Z") throws -> Observation {
        let usage = try Usage.decode(Data("{\"data\":{\"usage_daily\":\(daily),\"usage\":12.34567}}".utf8))
        return Observation(usage: usage, observedAt: ISO8601DateFormatter().date(from: at)!)
    }

    func testBoundaryValidationAndMissingAmounts() throws {
        XCTAssertEqual(try validatedKey(" \(key)\n"), key)
        for invalid in ["", "sk-or-short", "sk-or-v1-abcdefghij\r\nAuthorization: injected", "sk-or-v1-abc defghijklmnop"] {
            XCTAssertThrowsError(try validatedKey(invalid))
        }
        let zero = try observation().usage
        XCTAssertEqual(zero.usageDaily, 0)
        XCTAssertNil(zero.limitRemaining)
        XCTAssertEqual(money(nil), "Not reported")
        XCTAssertThrowsError(try observation("-1"))
        XCTAssertThrowsError(try observation("\"0\""))
        XCTAssertThrowsError(try Usage.decode(Data("{\"data\":null}".utf8)))
        XCTAssertThrowsError(try Usage.decode(Data("{\"data\":{\"usage\":-1}}".utf8)))
        XCTAssertNil(try Usage.decode(Data("{\"data\":{}}".utf8)).usageDaily)
        XCTAssertEqual(keyID("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    }

    func testHistoryPrivacyRolloverAndReplacement() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = HistoryStore(directory: directory)
        try store.record(key: key, observation: observation("1.234567"))
        try store.record(key: key, observation: observation("2.345678", at: "2026-10-31T23:59:30Z"))
        // An older in-flight response must not roll an observation backwards.
        try store.record(key: key, observation: observation("1"))
        try store.record(key: key, observation: observation("0", at: "2026-11-01T00:00:00Z"))
        try store.record(key: key + "-other", observation: observation("99"))
        let days = try store.recent(key: key)
        XCTAssertEqual(days.count, 2)
        XCTAssertEqual(days[0].0, "2026-11-01")
        XCTAssertEqual(days[0].1.usageUsd, 0)
        XCTAssertEqual(days[1].1.usageUsd, 2.345678)
        XCTAssertEqual(days[1].1.firstObservedAt, "2026-10-31T23:59:00.000Z")
        XCTAssertEqual(days[1].1.lastObservedAt, "2026-10-31T23:59:30.000Z")
        let text = try String(contentsOf: store.file, encoding: .utf8)
        XCTAssertFalse(text.contains(key))
        XCTAssertTrue(text.contains("usage_usd"))
        XCTAssertTrue(text.contains("total_usage_usd"))
        XCTAssertTrue(text.contains("first_observed_at"))
        for (url, mode) in [(directory, 0o700), (store.file, 0o600)] {
            let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
            XCTAssertEqual((attributes[.posixPermissions] as? NSNumber)?.intValue, mode)
        }
        XCTAssertEqual(try store.recent(key: key + "-unknown").count, 0)
    }

    func testMissingDailyDoesNotCreateHistory() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = HistoryStore(directory: directory)
        let usage = try Usage.decode(Data("{\"data\":{\"usage_daily\":null}}".utf8))
        try store.record(key: key, observation: Observation(usage: usage, observedAt: Date()))
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.file.path))
    }

    func testCorruptHistoryIsNeverOverwritten() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let store = HistoryStore(directory: directory)
        for text in ["broken JSON", "{\"version\":2,\"timezone\":\"UTC\",\"keys\":{}}",
                     "{\"version\":1,\"timezone\":\"local\",\"keys\":{}}"] {
            try Data(text.utf8).write(to: store.file)
            XCTAssertThrowsError(try store.record(key: key, observation: observation()))
            XCTAssertEqual(try String(contentsOf: store.file, encoding: .utf8), text)
        }
    }
}
