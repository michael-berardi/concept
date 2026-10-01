import Foundation

/// Fractional ordering keys ("rank") for board columns.
///
/// The same scheme the Concept server uses, so a vault can be edited by the
/// Mac app and the server alike: a rank is a non-empty string of digits that
/// never ends in `0`. Plain string comparison orders a column, and a key can
/// always be generated between any two neighbours, so a drag rewrites exactly
/// one file.
///
/// Files written by other tools may carry other rank text (`retex move` writes
/// integers, older files may hold letters). Those still sort deterministically
/// (`RankOrder`); a column that contains them is renumbered on its next move.
public enum Rank {
    /// First key in an empty column.
    public static func first() -> String { "4" }

    /// True for a key this scheme can place between others.
    public static func isValid(_ key: String) -> Bool {
        !key.isEmpty && key.allSatisfy(\.isASCIIDigit) && !key.hasSuffix("0")
    }

    /// A key that sorts strictly after `after` and strictly before `before`.
    /// `nil` means "no neighbour" on that side.
    public static func key(between after: String?, and before: String?) throws -> String {
        let a = after ?? ""
        let b = before ?? ""
        for (name, value) in [("after", after), ("before", before)] {
            if let value, !isValid(value) {
                throw ConceptError(code: "rank.invalid_key",
                    message: "Rank '\(value)' (\(name) neighbour) is not a digit string without a trailing 0; renumber the column")
            }
        }
        if !a.isEmpty, !b.isEmpty, !(a < b) {
            throw ConceptError(code: "rank.invalid_order",
                message: "Cannot place a key between '\(a)' and '\(b)': they are not strictly ordered")
        }
        let ad = Array(a.utf8).map { Int($0) - 48 }
        let bd = Array(b.utf8).map { Int($0) - 48 }
        var out = ""
        var i = 0
        while true {
            let x = i < ad.count ? ad[i] : 0
            let y = i < bd.count ? bd[i] : 9
            if y - x >= 2 { return out + String((x + y) / 2) }
            out += String(x)
            i += 1
        }
    }

    /// `count` increasing keys for a full-column renumber.
    public static func rekey(count: Int) throws -> [String] {
        guard count > 0 else { return [] }
        var keys = [first()]
        while keys.count < count {
            keys.append(try key(between: keys[keys.count - 1], and: nil))
        }
        return keys
    }

    /// Accepts digit strings (trailing zeros trimmed) and the `0|hzzzzz:` style
    /// found in older notes by keeping the integer part; anything else throws.
    public static func normalize(_ raw: String?) throws -> String? {
        guard var key = raw?.trimmingCharacters(in: .whitespaces), !key.isEmpty else { return nil }
        if key.contains("|") { key = String(key.prefix(while: { $0 != "|" && $0 != ":" })) }
        guard !key.isEmpty, key.allSatisfy(\.isASCIIDigit) else {
            throw ConceptError(code: "rank.invalid_key", message: "Rank key '\(key)' is not a digit string")
        }
        while key.count > 1 && key.hasSuffix("0") { key.removeLast() }
        return key == "0" ? "1" : key
    }

    static func orderLess(_ a: String, _ b: String) -> Bool { a < b }
}

private extension Character {
    var isASCIIDigit: Bool { isASCII && isNumber }
}

/// Deterministic total order over any rank text: empty first, then plain
/// string order; ties keep their original order.
public enum RankOrder {
    public static func sort<T>(_ items: [T], key: (T) -> String) -> [T] {
        items.enumerated().sorted { a, b in
            let ka = key(a.element).trimmingCharacters(in: .whitespaces)
            let kb = key(b.element).trimmingCharacters(in: .whitespaces)
            if ka == kb { return a.offset < b.offset }
            return ka < kb
        }.map(\.element)
    }
}
