import Testing
import Foundation
@testable import ConceptKit

@Suite("Safety")
struct SafetyTests {
    func tempVault() throws -> Vault {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("concept-safety-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return try Vault(url: dir)
    }

    @Test("Paths that leave the vault are refused, including through symlinks")
    func confinement() throws {
        let vault = try tempVault()
        defer { try? FileManager.default.removeItem(at: vault.url) }
        #expect(throws: (ConceptError).self) { _ = try vault.confinedURL("../outside.md") }
        #expect(throws: (ConceptError).self) { _ = try vault.confinedURL("/etc/passwd") }
        #expect(throws: (ConceptError).self) { _ = try vault.confinedURL("Pages/../../x.md") }

        let outside = FileManager.default.temporaryDirectory.appendingPathComponent("concept-outside-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: outside) }
        try FileManager.default.createDirectory(at: vault.url.appendingPathComponent("Pages"), withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(at: vault.url.appendingPathComponent("Pages/Escape"), withDestinationURL: outside)
        #expect(throws: (ConceptError).self) { _ = try vault.confinedURL("Pages/Escape/new.md") }
        #expect(throws: (ConceptError).self) {
            try vault.writeDocument(relativePath: "Pages/Escape/new.md", document: FrontmatterDocument(entries: [], body: "x"))
        }
        #expect(!FileManager.default.fileExists(atPath: outside.appendingPathComponent("new.md").path))
        #expect(throws: Never.self) { _ = try vault.confinedURL("Pages/Fine.md") }
    }

    @Test("Credentials are redacted from git output and errors")
    func redaction() {
        let text = "fatal: unable to access 'https://x-access-token:SECRET123@example.com/r.git/': denied"
        let clean = GitSync.redact(text)
        #expect(!clean.contains("SECRET123"))
        #expect(clean.contains("https://***@example.com"))
    }

    @Test("Remotes that git would read as options are refused")
    func remotes() throws {
        for bad in ["--upload-pack=touch /tmp/x", "ext::sh -c id", "-oProxyCommand=id", "https://a b"] {
            #expect(throws: (ConceptError).self) { try GitSync.validateRemote(bad) }
        }
        try GitSync.validateRemote("https://github.com/acme/vault.git")
        try GitSync.validateRemote("git@github.com:acme/vault.git")
        try GitSync.validateRemote("/tmp/bare.git")
    }

    @Test("Block scalars and comments survive a read-modify-write")
    func frontmatterPreservation() {
        let text = "---\ntitle: A\n# keep me\nnotes: |\n  first secret line\n  second line\nstatus: Inbox\n---\nBody\n"
        var doc = FrontmatterDocument.parse(text)
        doc.set("status", "Won")
        let out = doc.render()
        #expect(out.contains("# keep me"))
        #expect(out.contains("  first secret line"))
        #expect(out.contains("  second line"))
        #expect(out.contains("status: Won"))
    }

    @Test("A title with a newline cannot inject another property")
    func noInjection() {
        var doc = FrontmatterDocument.parse("---\ntitle: A\n---\n")
        doc.set("title", "hello\nstatus: Won")
        let reparsed = FrontmatterDocument.parse(doc.render())
        #expect(reparsed.string("title") == "hello\nstatus: Won")
        #expect(reparsed.string("status") == nil)
    }

    @Test("Saving repeatedly does not grow the trailing blank lines")
    func stableRender() {
        var text = "---\ntitle: A\n---\n\nBody\n"
        for _ in 0..<3 { text = FrontmatterDocument.parse(text).render() }
        #expect(text == "---\ntitle: A\n---\n\nBody\n")
    }
}
