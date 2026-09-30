import Foundation

/// Fractional ordering keys ("rank") for board columns.
///
/// Key shape: `<head><digits>[<fracdigits>]`
/// - `head`: lowercase letter whose index in `a...z` is the count of integer
///   digits that follow (so lexicographic order == numeric order, because the
///   integer part never has leading zeros).
/// - integer digits: base-62 (`0-9A-Za-z`), no leading zeros.
/// - optional fractional digits: base-62, no trailing zeros ("" == 0).
///
/// Examples: `a0` (first), `a1`, `ag`, `b10` (first two-digit), `a0h` (between
/// `a0` and `a1`). Plain integer keys written by other tools (`retex move`
/// writes `0`, `1`, `2`) are accepted and normalised before use; mixed keys
/// are ordered by `RankOrder`. If a column's keys leave no room (e.g. inserting
/// before the absolute first key `a0`), callers renumber via `rekey`.
public enum Rank {
    public static let digitAlphabet = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")
    static let base: UInt32 = 62
    static let maxIntegerDigitCount = 26

    // MARK: - Public API

    /// A key that sorts strictly after `after` and strictly before `before`.
    /// `nil` means +infinity for `before` (append to end) or that the caller
    /// wants the first position (see `first()`).
    public static func key(between after: String?, and before: String?) throws -> String {
        try midpoint(after, before).key
    }

    /// The absolute first key of a column. Nothing sorts before it; inserting
    /// before it requires renumbering (`rekey`).
    public static func first() -> String { "a0" }

    /// `count` fresh keys for a full-column renumber.
    public static func rekey(count: Int) throws -> [String] {
        guard count > 0 else { return [] }
        var out: [String] = []
        out.reserveCapacity(count)
        var prev = "a0"
        if count >= 1 { out.append(prev) }
        for _ in 1..<count {
            let m = try midpoint(prev, nil)
            out.append(m.key)
            prev = m.key
        }
        return out
    }

    /// Normalises an external rank string into Concept's canonical form.
    /// Accepts pure integers ("0", "42") and canonical keys.
    public static func normalize(_ raw: String?) throws -> String? {
        guard var key = raw?.trimmingCharacters(in: .whitespaces), !key.isEmpty else { return nil }
        // Tolerate foreign formats such as the SPEC example `0|hzzzzz:` by
        // keeping the integer part before the separator.
        if key.contains("|") {
            key = String(key.prefix(while: { $0 != "|" && $0 != ":" }))
        }
        if key.allSatisfy({ Self.digitAlphabet.contains($0) }), let first = key.first, first.isNumber {
            // Pure base-10 integer from an external tool.
            guard let value = Int(key) else {
                throw ConceptError(code: "rank.invalid_key",
                    message: "Rank '\(key)' is numeric but does not fit an integer")
            }
            return try encodeInteger(value)
        }
        guard let head = key.first, let value = head.asciiValue,
              value >= UInt8(ascii: "a"), value <= UInt8(ascii: "z") else {
            throw ConceptError(code: "rank.invalid_key",
                message: "Rank key '\(key)' must start with a lowercase letter a-z")
        }
        let digits = Array(key.dropFirst())
        let count = Int(value - UInt8(ascii: "a")) + 1
        guard digits.count >= count else {
            throw ConceptError(code: "rank.invalid_key",
                message: "Rank key '\(key)' declares \(count) integer digits but has \(digits.count)")
        }
        for d in digits where !Self.digitAlphabet.contains(d) {
            throw ConceptError(code: "rank.invalid_key",
                message: "Rank key '\(key)' contains a character outside base-62")
        }
        return key
    }

    // MARK: - Midpoint

    struct MidpointResult { let key: String }

    static func midpoint(_ afterRaw: String?, _ beforeRaw: String?) throws -> MidpointResult {
        if afterRaw == nil && beforeRaw == nil {
            return MidpointResult(key: "a0")
        }
        let after = try normalize(afterRaw)
        let before = try normalize(beforeRaw)
        if let a = after, let b = before, !orderLess(a, b) {
            throw ConceptError(code: "rank.invalid_order",
                message: "Cannot place a key between '\(afterRaw ?? "-")' and '\(beforeRaw ?? "-")': they are not strictly ordered")
        }

        let a = split(after)
        let b = split(before)

        // The absolute first key has nothing before it.
        if after == nil, let beforeKey = before {
            let bInt = stripLeadingZeros(b.int)
            if bInt.isEmpty && b.frac.isEmpty {
                throw ConceptError(code: "rank.exhausted",
                    message: "No rank key sorts before '\(beforeKey)' (from '\(beforeRaw ?? "-")'); renumber the column instead")
            }
        }

        // Compare integer parts as big numbers. A nil bound is ±infinity:
        // before==nil is +inf (always "greater"), after==nil is -inf.
        let intCompare: Int
        switch (after, before) {
        case (nil, nil): intCompare = 0
        case (_, nil): intCompare = -1
        case (nil, _): intCompare = compareDigits([], b.int)
        default: intCompare = compareDigits(a.int, b.int)
        }

        if intCompare < 0 {
            if before != nil, distance(a.int, b.int) >= 2 {
                // Room for a whole integer strictly between: use it (keeps keys short).
                let mid = addOne(to: a.int)
                return MidpointResult(key: try encode(intDigits: mid, fracDigits: []))
            }
            // Adjacent integers or an infinite upper bound: go into fractions.
            return MidpointResult(key: try fractionBetween(a: (a.int, a.frac), b: (b.int, before == nil ? nil : b.frac),
                                                          afterRaw: afterRaw, beforeRaw: beforeRaw))
        }
        if intCompare > 0 {
            throw ConceptError(code: "rank.invalid_order",
                message: "Before-key '\(beforeRaw ?? "-")' sorts after after-key '\(afterRaw ?? "-")'")
        }
        // Same integer part: split the fraction.
        let key = try fractionBetween(a: (a.int, a.frac), b: (b.int, b.frac),
                                     afterRaw: afterRaw, beforeRaw: beforeRaw)
        return MidpointResult(key: key)
    }

    /// Midpoint strictly between (intA, fracA) and (intB, fracB) where the
    /// integer parts are equal or adjacent-with-empty-b-frac.
    static func fractionBetween(a: (int: [UInt32], frac: [UInt32]?), b: (int: [UInt32], frac: [UInt32]?),
                                afterRaw: String?, beforeRaw: String?) throws -> String {
        var fa = a.frac ?? []
        var fb = b.frac ?? []
        // Trim canonical forms.
        fa = trimTrailingZeros(fa)
        fb = trimTrailingZeros(fb)

        var result: [UInt32] = []
        var i = 0
        var aSuffix = fa
        var bSuffix = fb
        while true {
            let da: UInt32 = aSuffix.isEmpty ? 0 : aSuffix[0]
            let db: UInt32 = bSuffix.isEmpty ? base - 1 : bSuffix[0]
            if da == db {
                result.append(da)
                aSuffix = aSuffix.isEmpty ? aSuffix : Array(aSuffix.dropFirst())
                bSuffix = bSuffix.isEmpty ? bSuffix : Array(bSuffix.dropFirst())
                if aSuffix.isEmpty && bSuffix.isEmpty {
                    // Fractions equal: insert at end of this integer.
                    // Must go above fa; since fb is "" (max infinity of the next
                    // integer minus 1), any positive digit works.
                    result.append(1)
                    break
                }
                i += 1
                continue
            }
            guard db > da else {
                throw ConceptError(code: "rank.invalid_order",
                    message: "Fractional order invalid at digit \(i) (\(da) >= \(db))")
            }
            if db - da >= 2 {
                result.append((da + db + 1) / 2) // ceil, strictly above a
            } else {
                // db == da + 1: emit da, then continue inside (da, da+1).
                result.append(da)
                aSuffix = aSuffix.isEmpty ? aSuffix : Array(aSuffix.dropFirst())
                bSuffix = bSuffix.isEmpty ? bSuffix : Array(bSuffix.dropFirst())
                // If both suffixes now empty, pick mid of (0, max).
                if aSuffix.isEmpty && bSuffix.isEmpty {
                    result.append((base - 1 + 1) / 2)
                    break
                }
                continue
            }
            break
        }
        let frac = trimTrailingZeros(result)
        // Sanity: strictly between.
        let key = try encode(intDigits: a.int, fracDigits: frac)
        if let af = a.frac.map(trimTrailingZeros), let old = try? encode(intDigits: a.int, fracDigits: af), orderLessOrEqual(key, old) {
            throw ConceptError(code: "rank.exhausted",
                message: "No rank key strictly after '\(old)' before '\(beforeRaw ?? "+inf")'")
        }
        if let bf = b.frac.map(trimTrailingZeros), !bf.isEmpty,
           let next = try? encode(intDigits: b.int, fracDigits: bf), !orderLess(key, next) {
            throw ConceptError(code: "rank.exhausted",
                message: "No rank key strictly before '\(next)'")
        }
        return key
    }

    // MARK: - Big base-62 number helpers (digit arrays, most significant first)

    static func compareDigits(_ x: [UInt32], _ y: [UInt32]) -> Int {
        var a = x, b = y
        a = stripLeadingZeros(a)
        b = stripLeadingZeros(b)
        if a.count != b.count { return a.count < b.count ? -1 : 1 }
        for i in 0..<a.count where a[i] != b[i] {
            return a[i] < b[i] ? -1 : 1
        }
        return 0
    }

    /// y - x assuming y > x (returns >= 0). Digit arrays are most significant first.
    static func distance(_ x: [UInt32], _ y: [UInt32]) -> Int {
        let a = stripLeadingZeros(x)
        let b = stripLeadingZeros(y)
        var diff: [UInt32] = Array(repeating: 0, count: max(a.count, b.count))
        var borrow: Int32 = 0
        for i in (0..<diff.count).reversed() {
            let offsetA = i - (diff.count - a.count)
            let da = Int32(offsetA >= 0 ? a[offsetA] : 0) - borrow
            let dbv = Int32(i - (diff.count - b.count) >= 0 ? b[i - (diff.count - b.count)] : 0)
            var d = dbv - da
            if d < 0 { d += Int32(base); borrow = 1 } else { borrow = 0 }
            diff[i] = UInt32(d)
        }
        let trimmed = stripLeadingZeros(diff)
        if trimmed.isEmpty { return 0 }
        // Convert small diff to Int (diffs beyond Int.max are irrelevant here).
        var value = 0
        for d in trimmed { value = value * Int(base) + Int(d) }
        return value
    }

    static func addOne(to x: [UInt32]) -> [UInt32] {
        var a = stripLeadingZeros(x)
        if a.isEmpty { return [1] }
        var i = a.count - 1
        while i >= 0 {
            if a[i] < base - 1 { a[i] += 1; return a }
            a[i] = 0
            i -= 1
        }
        return [1] + a
    }

    static func stripLeadingZeros(_ d: [UInt32]) -> [UInt32] {
        var out = d
        while out.count > 1 && out.first == 0 { out.removeFirst() }
        if out == [0] { return [] }
        return out
    }

    static func trimTrailingZeros(_ d: [UInt32]) -> [UInt32] {
        var out = d
        while out.last == 0 { out.removeLast() }
        return out
    }

    static func encodeInteger(_ value: Int) throws -> String {
        guard value >= 0 else {
            throw ConceptError(code: "rank.invalid_key", message: "Negative rank '\(value)' is not supported")
        }
        var digits: [UInt32] = []
        var v = value
        repeat { digits.insert(UInt32(v % Int(base)), at: 0); v /= Int(base) } while v > 0
        return try encode(intDigits: digits, fracDigits: [])
    }

    static func encode(intDigits: [UInt32], fracDigits: [UInt32]) throws -> String {
        let ints = intDigits.isEmpty ? [UInt32(0)] : stripLeadingZeros(intDigits)
        let count = max(ints.count, 1)
        guard count <= maxIntegerDigitCount else {
            throw ConceptError(code: "rank.exhausted",
                message: "Rank integer part needs \(count) digits; the format supports \(maxIntegerDigitCount)")
        }
        let head = Character(UnicodeScalar(UInt8(ascii: "a") + UInt8(count - 1)))
        // Head declares `count` digits; pad with a leading zero when the value
        // itself has fewer (only happens for value 0 -> "0").
        var padded = ints
        if padded.isEmpty { padded = [0] }
        while padded.count < count { padded.insert(0, at: 0) }
        var key = String(head) + String(padded.map { digitAlphabet[Int($0)] })
        let frac = trimTrailingZeros(fracDigits)
        if !frac.isEmpty {
            key += String(frac.map { digitAlphabet[Int($0)] })
        }
        return key
    }

    static func split(_ key: String?) -> (int: [UInt32], frac: [UInt32]) {
        guard let key, !key.isEmpty else { return ([], []) }
        let digits = Array(key.dropFirst())
        let count = (key.first.flatMap { $0.asciiValue } ?? UInt8(ascii: "a")) - UInt8(ascii: "a") + 1
        let intPart = Array(digits.prefix(Int(count)))
        let fracPart = Array(digits.dropFirst(Int(count)))
        let int = intPart.map { UInt32(digitAlphabet.firstIndex(of: $0)!) }
        let frac = fracPart.map { UInt32(digitAlphabet.firstIndex(of: $0)!) }
        return (int, frac)
    }

    static func orderLess(_ a: String, _ b: String) -> Bool {
        let sa = split(a)
        let sb = split(b)
        let c = compareDigits(sa.int, sb.int)
        if c != 0 { return c < 0 }
        let fa = trimTrailingZeros(sa.frac)
        let fb = trimTrailingZeros(sb.frac)
        let n = max(fa.count, fb.count)
        for i in 0..<n {
            let da = i < fa.count ? fa[i] : 0
            let db = i < fb.count ? fb[i] : 0
            if da != db { return da < db }
        }
        return false
    }

    static func orderLessOrEqual(_ a: String, _ b: String) -> Bool {
        a == b || orderLess(a, b)
    }
}

/// Total order over possibly-mixed rank keys: pure decimal integers compare
/// numerically, canonical keys lexicographically (which is numeric under the
/// scheme above); integer keys sort before letter keys deterministically.
public enum RankOrder {
    public static func sort<T>(_ items: [T], key: (T) -> String) -> [T] {
        items.enumerated().sorted { a, b in
            let ca = canonical(key(a.element))
            let cb = canonical(key(b.element))
            if ca == cb { return a.offset < b.offset }
            return ca < cb
        }.map(\.element)
    }

    static func canonical(_ key: String) -> String {
        let k = key.trimmingCharacters(in: .whitespaces)
        guard !k.isEmpty else { return "0" }
        if k.allSatisfy({ $0.isNumber }) {
            let padded = String(repeating: "0", count: max(0, 20 - k.count)) + k
            return "0" + padded
        }
        if k.allSatisfy({ Rank.digitAlphabet.contains($0) }) {
            return "0" + String(repeating: "0", count: max(0, 20 - k.count)) + k
        }
        return "1" + k
    }
}
