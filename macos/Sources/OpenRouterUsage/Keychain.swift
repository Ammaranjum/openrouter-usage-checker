import Foundation
import Security

// Only the credential lives here. No iCloud synchronization or shared access group.
enum Keychain {
    // Explicit startup checks use an isolated synthetic item, never a user's key.
    private static let service = "com.ammaranjum.openrouter-usage" +
        (CommandLine.arguments.contains("--startup-check") ? ".startup-check." + UUID().uuidString : "")
    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: "openrouter-api-key"]
    }

    static func load() throws -> String? {
        var lookup = query
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data,
              let key = String(data: data, encoding: .utf8) else { throw Failure(status: status) }
        return key
    }

    static func save(_ key: String) throws {
        let attributes: [String: Any] = [
            kSecValueData as String: Data(key.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            let item = query.merging(attributes) { _, new in new }
            let added = SecItemAdd(item as CFDictionary, nil)
            guard added == errSecSuccess else { throw Failure(status: added) }
        } else if status != errSecSuccess { throw Failure(status: status) }
    }

    static func delete() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw Failure(status: status) }
    }

    struct Failure: LocalizedError {
        var status: OSStatus? = nil
        var errorDescription: String? { "Keychain is unavailable or access was denied. Unlock your Mac and try again." }
    }
}
