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

    @Test("rekey produces strictly increasing keys")
    func rekeyOrder() throws {
        let keys = try Rank.rekey(count: 64)
        #expect(keys.count == 64)
        for i in 1..<keys.count {
            #expect(Rank.orderLess(keys[i - 1], keys[i]))
        }
        #expect(keys[0] == "a0")
    }

    @Test("Deep insertion between adjacent keys stays strictly ordered")
    func deepInsertion() throws {
        var key = try Rank.key(between: "a0", and: "a1")
        #expect(Rank.orderLess("a0", key) && Rank.orderLess(key, "a1"))
        for _ in 0..<120 {
            key = try Rank.key(between: key, and: "a1")
            #expect(Rank.orderLess(key, "a1"))
        }
    }

    @Test("Between multi-digit keys and head growth")
    func multiDigit() throws {
        let k = try Rank.key(between: "az", and: nil) // after max 1-digit
        #expect(Rank.orderLess("az", k))
        let k2 = try Rank.key(between: "b10", and: "b11")
        #expect(Rank.orderLess("b10", k2) && Rank.orderLess(k2, "b11"))
        // The absolute first key has no room before it: callers must renumber.
        #expect(throws: (ConceptError).self) {
            _ = try Rank.key(between: nil, and: "a0")
        }
        // But there is room inside a fractional first key.
        let k3 = try Rank.key(between: nil, and: "a0V")
        #expect(Rank.orderLess(k3, "a0V"))
    }

    @Test("Normalization accepts integers, canonical keys and SPEC-style keys")
    func normalize() throws {
        #expect(try Rank.normalize("0") == "a0")
        #expect(try Rank.normalize("42") != nil)
        #expect(try Rank.normalize("0|hzzzzz:") == "a0")
        #expect(try Rank.normalize("a0h") == "a0h")
        #expect(throws: (ConceptError).self) { try Rank.normalize("BAD KEY") }
    }

    @Test("Mixed external integer keys sort numerically via RankOrder")
    func mixedOrder() {
        let items = [("9", "i9"), ("10", "i10"), ("a0h", "c1"), ("", "c2")]
        let sorted = RankOrder.sort(items, key: { $0.0 })
        #expect(sorted.map { $0.1 } == ["c2", "i9", "i10", "c1"])
    }

    @Test("Randomised interleaving keeps lexicographic == visual order")
    func fuzz() throws {
        var seed: UInt64 = 0x9E3779B97F4A7C15
        func next(_ bound: Int) -> Int {
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            return Int((seed >> 33) % UInt64(max(bound, 1)))
        }
        var keys = try Rank.rekey(count: 8)
        // Repeatedly insert between ADJACENT pairs — exactly the board-drag
        // case, where after/before are the drop neighbours.
        for i in 0..<400 {
            let lo = next(keys.count - 1)
            let after = keys[lo]
            let before = keys[lo + 1]
            let mid = try Rank.key(between: after, and: before)
            #expect(mid != after && mid != before, "midpoint('\(after)', '\(before)') returned '\(mid)' at step \(i)")
            #expect(Rank.orderLess(after, mid) && Rank.orderLess(mid, before),
                    "mid '\(mid)' not between '\(after)' and '\(before)' at step \(i)")
            keys.insert(mid, at: lo + 1)
            for j in 1..<keys.count {
                #expect(Rank.orderLess(keys[j - 1], keys[j]),
                        "order broken at step \(i): \(keys[j-1]) !< \(keys[j])")
            }
        }
    }

    @Test("Invalid order throws with a named cause")
    func invalidOrder() {
        #expect(throws: (ConceptError).self) {
            _ = try Rank.key(between: "b2", and: "a1")
        }
    }
}
