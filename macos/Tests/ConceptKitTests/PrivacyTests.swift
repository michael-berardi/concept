import Testing
import Foundation
@testable import ConceptKit

@Suite("Privacy")
struct PrivacyTests {
    private func permissions(_ url: URL) throws -> Int {
        let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
        return (attrs[.posixPermissions] as? NSNumber)?.intValue ?? -1
    }

    @Test("New vaults and the files Concept writes are owner-only")
    func privateVaultPermissions() throws {
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent("concept-privacy-\(UUID().uuidString)")
        defer { try? fm.removeItem(at: dir) }

        let vault = try Vault.create(at: dir, name: "Private")
        #expect(try permissions(dir) == 0o700)
        for relative in ["Pages", "Data", "Attachments", ".concept", ".concept/databases"] {
            #expect(try permissions(vault.absoluteURL(relative)) == 0o700)
        }
        for relative in [
            ".concept/workspace.json",
            ".concept/databases/deals.json",
            ".gitignore",
        ] {
            #expect(try permissions(vault.absoluteURL(relative)) == 0o600)
        }

        let page = try vault.createPage(title: "Private note", body: "secret text")
        #expect(try permissions(vault.absoluteURL(page.path)) == 0o600)
        try vault.writeSyncSettings(Vault.SyncSettings(remoteUrl: "https://git.example.com/v.git", enabled: false))
        #expect(try permissions(vault.absoluteURL(Vault.syncFile)) == 0o600)
    }
}
