import Testing
import Foundation
@testable import ConceptKit

@Suite("Server-written database schemas")
struct ServerSchemaTests {
    @Test("Every schema the server writes decodes", arguments: ["deals", "companies", "contacts", "activities"])
    func decodes(slug: String) throws {
        let url = try #require(Bundle.module.url(forResource: slug, withExtension: "json", subdirectory: "Fixtures"))
        let db = try DatabaseJSON.decodeDatabase(Data(contentsOf: url), slug: slug)
        #expect(db.slug == slug)
        #expect(!db.properties.isEmpty)
    }
}
