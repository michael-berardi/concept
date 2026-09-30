import Testing
import Foundation
@testable import ConceptKit

@Suite("Vault engine")
struct VaultTests {
    static func makeTempVault(name: String, template: Vault.Template = .crm) throws -> Vault {
        let dir = NSTemporaryDirectory() + "concept-tests-\(name)-\(UUID().uuidString.prefix(8))"
        let url = URL(fileURLWithPath: dir)
        return try Vault.create(at: url, name: name, template: template)
    }

    @Test("Create CRM vault, scan, parse records")
    func crmVault() throws {
        let vault = try Self.makeTempVault(name: "crm")
        defer { try? FileManager.default.removeItem(at: vault.url) }

        #expect(vault.workspaceInfo()?.name == "crm")
        let dbs = vault.databases()
        #expect(dbs.map(\.slug) == ["activities", "companies", "contacts", "deals"])
        let deals = try vault.database(slug: "deals")
        #expect(deals.statusOptions.map(\.id) == ["Inbox", "Qualified", "Proposal", "Negotiation", "Won", "Lost"])

        _ = try vault.createRecord(databaseSlug: "deals", properties: [
            "title": .string("Acme renewal"),
            "owner": .string("mike"),
            "value": .int(12000),
            "due": .string("2026-10-14"),
            "tags": .array([.string("priority")]),
        ], body: "Body with [[Companies/Acme]] link and - [ ] checklist item.\n")
        let records = try vault.records(databaseSlug: "deals")
        #expect(records.count == 1)
        let record = records[0]
        #expect(record.path.hasPrefix("Data/deals/"))
        #expect(record.recordType == "deal")
        #expect(record.status == "Inbox")
        #expect(record.rank == "a0")
        #expect(record.archived == false)
        #expect(record.properties["value"]?.asInt == 12000)

        let snapshot = try vault.scan()
        #expect(snapshot.records.count == 1)
        #expect(snapshot.files.contains(FileInfo(path: "Data/deals", isDirectory: true)))
        #expect(!snapshot.files.contains { $0.path.hasPrefix(".retex") })
    }

    @Test("Board move reorders ranks and renumbers when reaching the top")
    func boardMoves() throws {
        let vault = try Self.makeTempVault(name: "board")
        defer { try? FileManager.default.removeItem(at: vault.url) }
        _ = try vault.createRecord(databaseSlug: "deals", properties: ["title": .string("One")])
        _ = try vault.createRecord(databaseSlug: "deals", properties: ["title": .string("Two")])
        _ = try vault.createRecord(databaseSlug: "deals", properties: ["title": .string("Three")])

        var records = try vault.records(databaseSlug: "deals")
        #expect(records.map(\.title) == ["One", "Two", "Three"])

        // Move "One" after "Two".
        _ = try vault.moveRecord(relativePath: records[0].path, databaseSlug: "deals",
                                 status: "Inbox", afterID: records[1].path, beforeID: records[2].path)
        records = try vault.records(databaseSlug: "deals")
        #expect(records.map(\.title) == ["Two", "One", "Three"])
        #expect(Rank.orderLess(records[0].rank, records[1].rank))
        #expect(Rank.orderLess(records[1].rank, records[2].rank))

        // Move "Three" before the first card -> whole column is renumbered.
        _ = try vault.moveRecord(relativePath: records[2].path, databaseSlug: "deals",
                                 status: "Inbox", afterID: nil, beforeID: records[0].path)
        records = try vault.records(databaseSlug: "deals")
        #expect(records.map(\.title) == ["Three", "Two", "One"])
        for i in 1..<records.count {
            #expect(Rank.orderLess(records[i - 1].rank, records[i].rank))
        }

        // Move between columns.
        _ = try vault.moveRecord(relativePath: records[0].path, databaseSlug: "deals",
                                 status: "Won", afterID: nil, beforeID: nil)
        let inbox = try vault.records(databaseSlug: "deals").filter { $0.status == "Inbox" }
        #expect(inbox.count == 2)
        #expect(try vault.records(databaseSlug: "deals").first { $0.status == "Won" }?.title == "Three")
    }

    @Test("Pages: create, nest, trash; unknown frontmatter keys survive edits")
    func pages() throws {
        let vault = try Self.makeTempVault(name: "pages", template: .blank)
        defer { try? FileManager.default.removeItem(at: vault.url) }

        let parent = try vault.createPage(title: "Meetings")
        #expect(parent.path == "Pages/Meetings.md")
        let child = try vault.createPage(title: "Standup", parentPagePath: parent.path)
        #expect(child.path == "Pages/Meetings/Standup.md")

        var doc = try vault.readDocument(relativePath: child.path)
        doc.set("custom_owner", "ana") // unknown key, arbitrary position
        try vault.writeDocument(relativePath: child.path, document: doc)

        var doc2 = try vault.readDocument(relativePath: child.path)
        doc2.set("title", "Standup v2")
        try vault.writeDocument(relativePath: child.path, document: doc2)
        let doc3 = try vault.readDocument(relativePath: child.path)
        #expect(doc3.string("custom_owner") == "ana")
        #expect(doc3.entries.map(\.key).contains("custom_owner"))

        try vault.deleteToTrash(relativePath: child.path)
        let snapshot = try vault.scan()
        #expect(!snapshot.pages.contains(where: { $0.path == child.path }))
        #expect(!snapshot.files.contains { $0.path.hasPrefix(".trash/") })
    }

    @Test("contentHash is stable and reflects content")
    func hashes() throws {
        let vault = try Self.makeTempVault(name: "hash", template: .blank)
        defer { try? FileManager.default.removeItem(at: vault.url) }
        let page = try vault.createPage(title: "Hash me", body: "# Hash me\n")
        let h1 = vault.contentHash(of: vault.absoluteURL(page.path))
        let h2 = vault.contentHash(of: vault.absoluteURL(page.path))
        #expect(h1 == h2)
        #expect(h1.count == 64)
        var doc = try vault.readDocument(relativePath: page.path)
        doc.body += "more\n"
        try vault.writeDocument(relativePath: page.path, document: doc)
        #expect(vault.contentHash(of: vault.absoluteURL(page.path)) != h1)
    }

    @Test("Vault errors carry codes that name their cause")
    func errors() {
        #expect(ConceptError.databaseNotFound("nope").code == "database.not_found")
        #expect(ConceptError.vaultNotFound("/nope").message.contains("/nope"))
    }
}

@Suite("Index: links, search, tags, graph")
struct IndexTests {
    static func indexedVault() throws -> (Vault, VaultIndex, VaultSnapshot) {
        let vault = try VaultTests.makeTempVault(name: "index", template: .blank)
        _ = try vault.createPage(title: "Alpha", body: "Links to [[Beta]] and [[Missing Page]]. Inline #priority tag.\n")
        _ = try vault.createPage(title: "Beta", body: "Points back at [[Alpha]].\n## Section A\n### Deep\n")
        _ = try vault.createPage(title: "Gamma Searchable Corpus", body: "quokka quokka unique\n")
        let snapshot = try vault.scan()
        let index = VaultIndexBuilder.build(vault: vault, snapshot: snapshot)
        return (vault, index, snapshot)
    }

    @Test("Backlinks and outgoing links resolve by title")
    func links() throws {
        let (vault, index, _) = try Self.indexedVault()
        defer { try? FileManager.default.removeItem(at: vault.url) }
        let alpha = "Pages/Alpha.md"
        let beta = "Pages/Beta.md"
        #expect(index.backlinks(to: beta) == [alpha])
        #expect(index.backlinks(to: alpha) == [beta])
        #expect(index.outgoingLinks(from: alpha).map(\.target).contains("Beta"))
        let unresolved = index.unresolvedLinks()
        #expect(unresolved.contains(where: { $0.source == alpha && $0.target == "Missing Page" }))
        _ = vault
    }

    @Test("Tags come from frontmatter and inline body")
    func tags() throws {
        let (vault, index, snapshot) = try Self.indexedVault()
        defer { try? FileManager.default.removeItem(at: vault.url) }
        let tagInfos = index.tags()
        #expect(tagInfos.contains { $0.tag == "priority" })
        _ = snapshot
    }

    @Test("Search matches titles, bodies and prefixes with ranked scoring")
    func search() throws {
        let (vault, index, _) = try Self.indexedVault()
        defer { try? FileManager.default.removeItem(at: vault.url) }
        #expect(index.search("beta").first?.path == "Pages/Beta.md") // title outranks body mention
        #expect(index.search("quokka").map(\.path) == ["Pages/Gamma Searchable Corpus.md"])
        let prefix = index.search("gam")
        #expect(prefix.first?.path == "Pages/Gamma Searchable Corpus.md")
        #expect(index.search("zzznothing").isEmpty)
        #expect(index.search("").isEmpty)
    }

    @Test("Outline extracts headings with levels")
    func outline() throws {
        let (vault, index, _) = try Self.indexedVault()
        defer { try? FileManager.default.removeItem(at: vault.url) }
        let beta = index.document(at: "Pages/Beta.md")
        #expect(beta?.outline.contains(OutlineEntry(level: 2, text: "Section A", line: 1)) == true)
        #expect(beta?.outline.contains(OutlineEntry(level: 3, text: "Deep", line: 2)) == true)
    }

    @Test("Graph builds local and global shapes; force layout converges")
    func graph() throws {
        let (vault, index, _) = try Self.indexedVault()
        defer { try? FileManager.default.removeItem(at: vault.url) }
        let global = Graph.global(index: index)
        #expect(global.nodes.count == 3)
        #expect(global.edges.count == 2)
        let local = Graph.local(index: index, path: "Pages/Beta.md")
        #expect(local.nodes.count == 2)
        let positions = ForceLayout.run(nodes: global.nodes, edges: global.edges, iterations: 120)
        #expect(positions.count == 3)
        #expect(positions.allSatisfy { $0.x.isFinite && $0.y.isFinite })
    }
}

@Suite("Database schema JSON")
struct DatabaseTests {
    @Test("Template encode/decode round trip preserves order")
    func roundTrip() throws {
        let data = try DatabaseJSON.encode(DatabaseTemplate.deals)
        let decoded = try DatabaseJSON.decodeDatabase(data, slug: "deals")
        #expect(decoded == DatabaseTemplate.deals)
        #expect(decoded.views[0].type == .board)
        #expect(decoded.views[0].groupBy == "status")
        #expect(decoded.properties.map(\.key).prefix(2) == ["title", "status"])
    }

    @Test("CRM starter wires relations")
    func crmRelations() {
        let starter = DatabaseTemplate.crmStarter
        #expect(starter.map(\.slug) == ["companies", "contacts", "deals", "activities"])
        let deals = starter.first { $0.slug == "deals" }
        #expect(deals?.property("company")?.database == "companies")
        let activities = starter.first { $0.slug == "activities" }
        #expect(activities?.property("contact")?.database == "contacts")
    }

    @Test("Corrupt schema JSON reports database.invalid")
    func corrupt() {
        #expect(throws: (ConceptError).self) {
            _ = try DatabaseJSON.decodeDatabase(Data("{not json".utf8), slug: "deals")
        }
    }
}
