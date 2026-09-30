import Testing
import Foundation
@testable import ConceptKit

@Suite("Git sync")
struct GitSyncTests {
    static func scratch(_ label: String) -> URL {
        URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("concept-git-\(label)-\(UUID().uuidString.prefix(8))")
    }

    /// Creates a bare origin and a vault A pushed to it; returns (origin, A).
    static func originWithVault(_ label: String) throws -> (origin: URL, vaultA: Vault) {
        let origin = scratch("\(label)-origin")
        try GitSync.run(["init", "--bare", "-b", "main", origin.path], cwd: nil)
        let vaultA = try Vault.create(at: scratch("\(label)-a"), name: "A", template: .blank)
        try GitSync.initRepository(vaultA.url, branch: "main")
        try GitSync.setRemote(vaultA.url, remoteUrl: origin.path)
        _ = try vaultA.createPage(title: "One", body: "# One\nshared line\n")
        try GitSync.commitAll(vaultA.url, message: "init")
        return (origin, vaultA)
    }

    @Test("Status parsing, commitAll idempotence, push then clone")
    func basics() throws {
        let (origin, a) = try Self.originWithVault("basics")
        defer {
            try? FileManager.default.removeItem(at: origin)
            try? FileManager.default.removeItem(at: a.url)
        }
        var status = try GitSync.status(a.url)
        #expect(status.isRepository)
        #expect(status.branch == "main")
        #expect(status.isClean)
        #expect(status.hasRemote) // setRemote configured origin
        // commitAll with no changes commits nothing.
        #expect(try GitSync.commitAll(a.url, message: "empty") == false)

        try GitSync.push(a.url, branch: "main", remoteUrl: origin.path, token: nil)
        status = try GitSync.status(a.url)
        #expect(status.ahead == 0)

        // Clone the origin into B; both see the same history.
        let bURL = Self.scratch("basics-b")
        try GitSync.run(["clone", origin.path, bURL.path], cwd: nil)
        defer { try? FileManager.default.removeItem(at: bURL) }
        let vaultB = try Vault(url: bURL)
        _ = try vaultB.createPage(title: "Two", body: "# Two\n")
        try GitSync.commitAll(vaultB.url, message: "b adds page")
        status = try GitSync.status(vaultB.url)
        #expect(status.ahead == 1)

        // A syncs (no-op pull), then B syncs: pull --rebase, push.
        let outA = try GitSync.sync(a.url, remoteUrl: origin.path, branch: "main", token: nil,
                                    message: "a noop", authorName: "A", authorEmail: "a@x")
        #expect(outA.pushed)
        let outB = try GitSync.sync(vaultB.url, remoteUrl: origin.path, branch: "main", token: nil,
                                    message: "b sync", authorName: "B", authorEmail: "b@x")
        #expect(outB.pulled)
        #expect(outB.pushed)
        #expect(outB.conflictFiles.isEmpty)
        status = try GitSync.status(vaultB.url)
        #expect(status.isClean)
    }

    @Test("Conflicts preserve the losing side as *.conflict-*.md")
    func conflict() throws {
        let (origin, a) = try Self.originWithVault("conflict")
        defer {
            try? FileManager.default.removeItem(at: origin)
            try? FileManager.default.removeItem(at: a.url)
        }
        try GitSync.push(a.url, branch: "main", remoteUrl: origin.path, token: nil)

        let bURL = Self.scratch("conflict-b")
        try GitSync.run(["clone", origin.path, bURL.path], cwd: nil)
        defer { try? FileManager.default.removeItem(at: bURL) }
        let vaultB = try Vault(url: bURL)

        // Both sides edit the same line of the same file.
        let pageA = "Pages/One.md"
        try "shared line CHANGED-A\n".write(to: a.absoluteURL(pageA), atomically: true, encoding: .utf8)
        try GitSync.commitAll(a.url, message: "a edits", authorName: "A", authorEmail: "a@x")
        let outA = try GitSync.sync(a.url, remoteUrl: origin.path, branch: "main", token: nil,
                                    message: "a sync", authorName: "A", authorEmail: "a@x")
        #expect(outA.pushed)

        try "shared line CHANGED-B\n".write(to: vaultB.absoluteURL(pageA), atomically: true, encoding: .utf8)
        try GitSync.commitAll(vaultB.url, message: "b edits", authorName: "B", authorEmail: "b@x")
        let outB = try GitSync.sync(vaultB.url, remoteUrl: origin.path, branch: "main", token: nil,
                                    message: "b sync", authorName: "B", authorEmail: "b@x")
        #expect(!outB.conflictFiles.isEmpty)
        #expect(outB.pushed)

        // B's losing version survives as a conflict copy next to the file.
        let dir = vaultB.absoluteURL("Pages")
        let copies = try FileManager.default.contentsOfDirectory(atPath: dir.path)
            .filter { $0.contains(".conflict-") }
        #expect(copies.count == 1)
        let copyContent = try String(contentsOf: dir.appendingPathComponent(copies[0]), encoding: .utf8)
        #expect(copyContent.contains("CHANGED-B"))
        // The live file carries the incoming (A) version.
        let live = try String(contentsOf: vaultB.absoluteURL(pageA), encoding: .utf8)
        #expect(live.contains("CHANGED-A"))
        // A pulls B's merge and stays clean.
        let outA2 = try GitSync.sync(a.url, remoteUrl: origin.path, branch: "main", token: nil,
                                     message: "a pulls merge", authorName: "A", authorEmail: "a@x")
        #expect(outA2.pulled)
        let statusA = try GitSync.status(a.url)
        #expect(statusA.isClean)
    }

    @Test("Authenticated HTTPS remote embeds the token for transport only")
    func tokenEmbedding() {
        #expect(GitSync.authenticatedRemote("https://git.example.com/x/y.git", token: "cpt_abc")
            == "https://x-access-token:cpt_abc@git.example.com/x/y.git")
        #expect(GitSync.authenticatedRemote("https://git.example.com/x/y.git", token: nil)
            == "https://git.example.com/x/y.git")
        #expect(GitSync.authenticatedRemote("git@github.com:x/y.git", token: "cpt_abc")
            == "git@github.com:x/y.git")
    }
}
