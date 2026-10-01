import Testing
import Foundation
@testable import ConceptKit

@Suite("Frontmatter")
struct FrontmatterTests {

    @Test("Round trip preserves unknown keys, order, comments and body")
    func roundTrip() throws {
        let original = """
        ---
        title: Acme renewal
        type: deal
        status: Proposal        # board column
        rank: 0|hzzzzz:
        owner: mike
        company: "[[Acme]]"
        value: 12000
        due: 2026-10-14
        tags: [priority]
        archived: false
        mystery_key: keep me
        mystery_block:
          nested: true
          list:
            - a
            - b
        ---
        Markdown body. Wiki links [[Other page]], task lists `- [ ]`, tables, code.
        """
        let doc = FrontmatterDocument.parse(original)
        #expect(doc.string("title") == "Acme renewal")
        #expect(doc.string("type") == "deal")
        #expect(doc.string("status") == "Proposal")
        #expect(doc.string("rank") == "0|hzzzzz:")
        #expect(doc.int("value") == 12000)
        #expect(doc.bool("archived") == false)
        #expect(doc.stringArray("tags") == ["priority"])
        #expect(doc.string("mystery_key") == "keep me")
        // The unknown block key survives verbatim.
        #expect(doc.value(forKey: "mystery_block")?.asString?.contains("nested: true") == true)
        #expect(doc.body.contains("Wiki links [[Other page]]"))

        let rendered = doc.render()
        let reparsed = FrontmatterDocument.parse(rendered)
        #expect(reparsed.entries.map(\.key) == doc.entries.map(\.key))
        #expect(reparsed.body == doc.body)
        // Comments on untouched lines are preserved byte-for-byte.
        #expect(rendered.contains("status: Proposal        # board column"))
    }

    @Test("Set replaces in place, new keys append at the end")
    func setKeys() {
        var doc = FrontmatterDocument.parse("---\nstatus: Inbox\nvalue: 1\n---\nbody\n")
        doc.set("status", "Won")
        doc.set("owner", "sam")
        #expect(doc.entries.map(\.key) == ["status", "value", "owner"])
        #expect(doc.string("status") == "Won")
        #expect(doc.string("owner") == "sam")
        let rendered = doc.render()
        #expect(rendered.hasPrefix("---\nstatus: Won\nvalue: 1\nowner: sam\n---\n"))
    }

    @Test("Quoting of special values")
    func quoting() {
        #expect(FrontmatterDocument.serialise(key: "company", value: .string("Acme [[Holdings]]: 1"))
            == "company: \"Acme [[Holdings]]: 1\"")
        #expect(FrontmatterDocument.serialise(key: "ok", value: .bool(true)) == "ok: true")
        #expect(FrontmatterDocument.serialise(key: "tags", value: .array([.string("a"), .string("b c")]))
            == "tags: [a, \"b c\"]")
        #expect(FrontmatterDocument.serialise(key: "rank", value: .string("0|hzzzzz:")) == "rank: 0|hzzzzz:")
        // A quoted string that looks numeric must stay quoted after round trip.
        let doc = FrontmatterDocument.parse("---\nvalue: \"12000\"\n---\n")
        #expect(doc.entries[0].value == .string("12000"))
        let again = FrontmatterDocument.parse(doc.render())
        #expect(again.entries[0].value == .string("12000"))
    }

    @Test("Empty and unterminated frontmatter")
    func degenerate() {
        let noFm = FrontmatterDocument.parse("just a body")
        #expect(noFm.entries.isEmpty)
        #expect(noFm.body == "just a body")
        let unterminated = FrontmatterDocument.parse("---\ntitle: X\nno close")
        #expect(unterminated.entries.isEmpty)
        let empty = FrontmatterDocument.parse("")
        #expect(empty.render() == "")
    }
}

@Suite("Rank math")
struct RankTests {
    @Test("rekey produces strictly increasing valid keys")
    func rekeyOrder() throws {
        let keys = try Rank.rekey(count: 64)
        #expect(keys.count == 64)
        for i in 1..<keys.count { #expect(keys[i - 1] < keys[i]) }
        #expect(keys.allSatisfy(Rank.isValid))
    }

    @Test("A key always fits before the first and after the last card")
    func edges() throws {
        let before = try Rank.key(between: nil, and: "1")
        #expect(before < "1" && Rank.isValid(before))
        let afterLast = try Rank.key(between: "9", and: nil)
        #expect(afterLast > "9" && Rank.isValid(afterLast))
    }

    @Test("Deep insertion between adjacent keys stays strictly ordered")
    func deepInsertion() throws {
        var key = try Rank.key(between: "4", and: "5")
        for _ in 0..<120 {
            let next = try Rank.key(between: key, and: "5")
            #expect(key < next && next < "5")
            key = next
        }
    }

    @Test("Normalization keeps digits and the integer part of SPEC-style keys")
    func normalize() throws {
        #expect(try Rank.normalize("42") == "42")
        #expect(try Rank.normalize("420") == "42")
        #expect(try Rank.normalize("0|hzzzzz:") == "1")
        #expect(throws: (ConceptError).self) { try Rank.normalize("BAD KEY") }
    }

    @Test("Mixed rank text sorts deterministically via RankOrder")
    func mixedOrder() {
        let items = [("9", "i9"), ("a0V", "c1"), ("", "c2"), ("25", "i25")]
        #expect(RankOrder.sort(items, key: { $0.0 }).map { $0.1 } == ["c2", "i25", "i9", "c1"])
    }

    @Test("Letters and trailing zeros are refused with a named cause")
    func refuses() {
        #expect(throws: (ConceptError).self) { _ = try Rank.key(between: "a0V", and: nil) }
        #expect(throws: (ConceptError).self) { _ = try Rank.key(between: "40", and: nil) }
        #expect(throws: (ConceptError).self) { _ = try Rank.key(between: "6", and: "4") }
    }

    @Test("Randomised interleaving keeps string order == visual order")
    func fuzz() throws {
        var seed: UInt64 = 0x9E3779B97F4A7C15
        func next(_ bound: Int) -> Int {
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            return Int((seed >> 33) % UInt64(max(bound, 1)))
        }
        var keys = try Rank.rekey(count: 8)
        for i in 0..<400 {
            let lo = next(keys.count - 1)
            let mid = try Rank.key(between: keys[lo], and: keys[lo + 1])
            #expect(keys[lo] < mid && mid < keys[lo + 1], "step \(i): \(keys[lo]) < \(mid) < \(keys[lo + 1])")
            keys.insert(mid, at: lo + 1)
        }
    }
}
