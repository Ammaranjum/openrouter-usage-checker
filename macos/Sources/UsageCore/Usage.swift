import Foundation
import CryptoKit

public enum UsageError: Error, LocalizedError {
    case invalidKey, rejected, rateLimited, server, invalidResponse, history
    public var errorDescription: String? {
        switch self {
        case .invalidKey: return "Enter a valid OpenRouter API key without spaces."
        case .rejected: return "OpenRouter rejected this key. Replace it in Settings."
        case .rateLimited: return "OpenRouter is rate limiting requests. Wait a minute before refreshing."
        case .server: return "OpenRouter is unavailable. Try again later."
        case .invalidResponse: return "OpenRouter returned an unrecognized response. Try again later."
        case .history: return "Could not read or save history. The existing file was preserved."
        }
    }
}

public struct Usage: Codable {
    public let limit: Double?
    public let limitRemaining: Double?
    public let usage: Double?
    public let usageDaily: Double?
    public let usageWeekly: Double?
    public let usageMonthly: Double?

    public static func decode(_ data: Data) throws -> Usage {
        struct Envelope: Decodable { let data: Usage }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let result: Usage
        do { result = try decoder.decode(Envelope.self, from: data).data }
        catch { throw UsageError.invalidResponse }
        for value in [result.limit, result.usage, result.usageDaily, result.usageWeekly, result.usageMonthly].compactMap({ $0 }) {
            guard value.isFinite, value >= 0 else { throw UsageError.invalidResponse }
        }
        if let remaining = result.limitRemaining, !remaining.isFinite { throw UsageError.invalidResponse }
        return result
    }
}

public func validatedKey(_ input: String) throws -> String {
    let key = input.trimmingCharacters(in: .whitespacesAndNewlines)
    guard (20...512).contains(key.utf8.count), key.hasPrefix("sk-or-"),
          key.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 45 || $0 == 95 })
    else { throw UsageError.invalidKey }
    return key
}

public func keyID(_ key: String) -> String {
    SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
}

public func money(_ value: Double?) -> String {
    guard let value, value.isFinite else { return "Not reported" }
    return value.formatted(.currency(code: "USD"))
}

public struct Observation {
    public let usage: Usage
    public let observedAt: Date
    public init(usage: Usage, observedAt: Date) { self.usage = usage; self.observedAt = observedAt }
}

private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

public enum UsageClient {
    public static func fetch(key: String) async throws -> Observation {
        let key = try validatedKey(key)
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 20
        config.httpShouldSetCookies = false
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        let session = URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: URL(string: "https://openrouter.ai/api/v1/key")!)
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (bytes, response) = try await session.bytes(for: request)
        guard let response = response as? HTTPURLResponse else { throw UsageError.invalidResponse }
        switch response.statusCode {
        case 200: break
        case 401, 403: throw UsageError.rejected
        case 429: throw UsageError.rateLimited
        case 500...599: throw UsageError.server
        default: throw UsageError.invalidResponse
        }
        var body = Data()
        for try await byte in bytes {
            try Task.checkCancellation()
            guard body.count < 65_536 else { throw UsageError.invalidResponse }
            body.append(byte)
        }
        let now = Date()
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss z"
        let serverDate = response.value(forHTTPHeaderField: "Date").flatMap { formatter.date(from: $0) }
        // Prefer server UTC near midnight, but reject implausible proxy dates.
        let observed = serverDate.flatMap { abs($0.timeIntervalSince(now)) <= 300 ? $0 : nil } ?? now
        return Observation(usage: try Usage.decode(body), observedAt: observed)
    }
}
