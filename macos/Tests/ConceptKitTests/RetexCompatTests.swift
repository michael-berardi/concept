import Testing
import Foundation
@testable import ConceptKit

/// Concept-written vaults must be valid Retex vaults:
/// `retex doctor` passes and `retex board` shows records Concept wrote.
struct RetexCompatTests {
    static let retexPath = NSHomeDirectory() + "/.ultraterm/bin/retex"

    @Test("retex doctor and board accept a vault Concept wrote")
    func doctorAndBoard() throws {
        guard FileManager.default.fileExists(atPath: Self.retexPath) else {
            Issue.record("retex CLI not present at \(Self.retexPath); compatibility not verified in this environment")
            return
        }
        let vault = try Vault.create(at: URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("concept-retex-\(UUID().uuidString.prefix(8))"),
            name: "Retex Check", template: .crm)
        defer { try? FileManager.default.removeItem(at: vault.url) }

        // Concept-authored content: a page, and three deal records.
        _ = try vault.createPage(title: "Acme", body: "Parent page for [[Acme renewal]].\n")
        _ = try vault.createRecord(databaseSlug: "deals", properties: [
            "title": .string("Acme renewal"),
            "owner": .string("mike"),
            "company": .string("[[Acme]]"),
            "value": .int(12000),
            "due": .string("2026-10-14"),
            "tags": .array([.string("priority")]),
        ], body: "Markdown body. Wiki links [[Acme]], task lists - [ ] call customer.\n")
        _ = try vault.createRecord(databaseSlug: "deals", properties: ["title": .string("Beta order")])
        _ = try vault.createRecord(databaseSlug: "contacts", properties: [
            "title": .string("Sam Ortega"),
            "email": .string("sam@example.com"),
        ])

        // doctor --vault <dir> (--lean = JSON output)
        let doctor = try Self.runRetex(["doctor", "--vault", vault.url.path, "--lean"])
        #expect(doctor.contains("\"issues\":[]"))
        #expect(doctor.contains("\"configOk\":true"))
        #expect(doctor.contains("\"notes\":4"))

        // board --vault <dir> shows Concept records in the Inbox column.
        let board = try Self.runRetex(["board", "--vault", vault.url.path, "--lean"])
        #expect(board.contains("Acme renewal"))
        #expect(board.contains("Sam Ortega") == false) // contacts are not deals
        #expect(board.contains("\"name\":\"Inbox\""))

        // query --type deal works on Concept-written records.
        let query = try Self.runRetex(["query", "--vault", vault.url.path, "--type", "deal", "--lean"])
        #expect(query.contains("Acme renewal"))
        #expect(query.contains("Beta order"))

        // search finds page bodies and record bodies.
        let search = try Self.runRetex(["search", "call customer", "--vault", vault.url.path, "--lean"])
        #expect(search.contains("Acme renewal"))
    }

    static func runRetex(_ arguments: [String]) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: retexPath)
        process.arguments = arguments
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        try process.run()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw ConceptError(code: "retex.failed",
                message: "retex \(arguments.joined(separator: " ")) failed: \(String(data: data, encoding: .utf8) ?? "")")
        }
        return String(data: data, encoding: .utf8) ?? ""
    }
}
