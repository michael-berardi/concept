import Foundation

/// Keychain storage for the sync access token (never written to the vault).
public enum KeychainStore {
    static let service = "dev.concept.vault-sync"

    public static func account(for vaultURL: URL) -> String {
        Vault.sha256Hex(Data(vaultURL.standardizedFileURL.path.utf8))
    }

    public static func setToken(_ token: String?, for vaultURL: URL) throws {
        let account = account(for: vaultURL)
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let status = SecItemCopyMatching(base as CFDictionary, nil)
        switch status {
        case errSecSuccess, errSecInteractionNotAllowed:
            guard let token, !token.isEmpty else {
                let deleteStatus = SecItemDelete(base as CFDictionary)
                guard deleteStatus == errSecSuccess || deleteStatus == errSecItemNotFound else {
                    throw ConceptError.keychain("delete failed with status \(deleteStatus)")
                }
                return
            }
            let update: [String: Any] = [kSecValueData as String: Data(token.utf8)]
            let updateStatus = SecItemUpdate(base as CFDictionary, update as CFDictionary)
            guard updateStatus == errSecSuccess else {
                throw ConceptError.keychain("update failed with status \(updateStatus)")
            }
        case errSecItemNotFound:
            guard let token, !token.isEmpty else { return }
            var add = base
            add[kSecValueData as String] = Data(token.utf8)
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            let addStatus = SecItemAdd(add as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                throw ConceptError.keychain("add failed with status \(addStatus)")
            }
        default:
            throw ConceptError.keychain("lookup failed with status \(status)")
        }
    }

    public static func token(for vaultURL: URL) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account(for: vaultURL),
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
