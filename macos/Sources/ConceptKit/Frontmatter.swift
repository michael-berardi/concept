import Foundation

extension FrontmatterValue: Codable {
    private enum CodingKeys: String, CodingKey { case t, v }
    private enum Kind: String, Codable { case string, int, double, bool, array, null, raw }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
            return
        }
        if let b = try? container.decode(Bool.self) { self = .bool(b); return }
        if let i = try? container.decode(Int.self) { self = .int(i); return }
        if let d = try? container.decode(Double.self) { self = .double(d); return }
        if let s = try? container.decode(String.self) { self = .string(s); return }
        if let a = try? container.decode([FrontmatterValue].self) { self = .array(a); return }
        self = .raw(String(describing: type(of: container)))
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let s): try container.encode(s)
        case .int(let i): try container.encode(i)
        case .double(let d): try container.encode(d)
        case .bool(let b): try container.encode(b)
        case .null: try container.encodeNil()
        case .array(let items): try container.encode(items)
        case .raw(let r): try container.encode(r)
        }
    }
}

/// A parsed frontmatter value. Scalars keep their textual form so that a
/// round trip (parse -> render) is lossless for unknown keys.
public enum FrontmatterValue: Equatable, Sendable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case array([FrontmatterValue])
    case null
    /// A value ConceptKit does not model (inline JSON-ish, dates kept as strings
    /// are `.string`, nested blocks). The original raw text is preserved.
    case raw(String)

    public var displayString: String {
        switch self {
        case .string(let s): return s
        case .int(let i): return String(i)
        case .double(let d): return String(d)
        case .bool(let b): return b ? "true" : "false"
        case .array(let items): return items.map(\.displayString).joined(separator: ", ")
        case .null: return ""
        case .raw(let r): return r
        }
    }

    public var asString: String? {
        switch self {
        case .string(let s): return s
        case .int(let i): return String(i)
        case .double(let d): return String(d)
        case .raw(let r): return r
        case .bool, .array, .null: return nil
        }
    }

    public var asInt: Int? {
        switch self {
        case .int(let i): return i
        case .string(let s): return Int(s.trimmingCharacters(in: .whitespaces))
        case .double(let d): return Int(d)
        default: return nil
        }
    }

    public var asDouble: Double? {
        switch self {
        case .double(let d): return d
        case .int(let i): return Double(i)
        case .string(let s): return Double(s.trimmingCharacters(in: .whitespaces))
        default: return nil
        }
    }

    public var asBool: Bool? {
        switch self {
        case .bool(let b): return b
        case .string(let s):
            switch s.lowercased() {
            case "true", "yes", "on": return true
            case "false", "no", "off": return false
            default: return nil
            }
        default: return nil
        }
    }

    public var asStringArray: [String] {
        switch self {
        case .array(let items): return items.compactMap {
            switch $0 {
            case .string(let s): return s
            case .int(let i): return String(i)
            case .double(let d): return String(d)
            case .bool(let b): return b ? "true" : "false"
            case .raw(let r): return r
            case .array, .null: return nil
            }
        }
        case .string(let s):
            // Tolerate "a, b" scalar form used by some tools.
            let parts = s.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
            return parts.filter { !$0.isEmpty }
        default: return []
        }
    }
}

/// One ordered frontmatter entry. `rawLine` is kept so untouched entries are
/// written back byte-for-byte (comments, spacing, quoting are preserved).
public struct FrontmatterEntry: Equatable, Sendable {
    public let key: String
    public let value: FrontmatterValue
    /// Raw text of the full entry (may span multiple lines for block values).
    let raw: String?

    public init(key: String, value: FrontmatterValue, raw: String? = nil) {
        self.key = key
        self.value = value
        self.raw = raw
    }
}

/// A Markdown document split into frontmatter entries (ordered) and body.
/// The parser is a strict subset of YAML sufficient for Retex/Concept files:
/// `key: value` scalars, inline `[a, b]` arrays, quoted strings, comments
/// after values, and indented block values (preserved verbatim as `.raw`).
public struct FrontmatterDocument: Equatable, Sendable {
    public var entries: [FrontmatterEntry]
    public var body: String

    public init(entries: [FrontmatterEntry] = [], body: String = "") {
        self.entries = entries
        self.body = body
    }

    public func value(forKey key: String) -> FrontmatterValue? {
        entries.first(where: { $0.key == key })?.value
    }

    public func string(_ key: String) -> String? { value(forKey: key)?.asString }
    public func int(_ key: String) -> Int? { value(forKey: key)?.asInt }
    public func double(_ key: String) -> Double? { value(forKey: key)?.asDouble }
    public func bool(_ key: String) -> Bool? { value(forKey: key)?.asBool }
    public func stringArray(_ key: String) -> [String] { value(forKey: key)?.asStringArray ?? [] }

    public subscript(key: String) -> FrontmatterValue? {
        get { value(forKey: key) }
    }

    /// Sets or inserts a key. Existing keys keep their position; new keys are
    /// appended at the end of the frontmatter block.
    public mutating func set(_ key: String, _ value: FrontmatterValue) {
        if let idx = entries.firstIndex(where: { $0.key == key }) {
            entries[idx] = FrontmatterEntry(key: key, value: value, raw: nil)
        } else {
            entries.append(FrontmatterEntry(key: key, value: value, raw: nil))
        }
    }

    public mutating func set(_ key: String, _ string: String) { set(key, .string(string)) }
    public mutating func set(_ key: String, _ int: Int) { set(key, .int(int)) }
    public mutating func set(_ key: String, _ double: Double) { set(key, .double(double)) }
    public mutating func set(_ key: String, _ bool: Bool) { set(key, .bool(bool)) }
    public mutating func set(_ key: String, strings: [String]) {
        set(key, .array(strings.map { .string($0) }))
    }

    public mutating func remove(_ key: String) {
        entries.removeAll(where: { $0.key == key })
    }

    /// Renders `---\n...\n---\n<body>`. Untouched entries re-emit their raw
    /// text; modified entries are re-serialised.
    public func render() -> String {
        if entries.isEmpty {
            return body
        }
        var lines: [String] = []
        for entry in entries {
            if let raw = entry.raw {
                lines.append(raw)
            } else {
                lines.append(Self.serialise(key: entry.key, value: entry.value))
            }
        }
        // Convention: one blank line separates the frontmatter block from the
        // body; parsing strips that same single blank line, so render/parse is
        // stable.
        var cleanBody = body
        while cleanBody.hasPrefix("\n") { cleanBody.removeFirst() }
        var out = "---\n" + lines.joined(separator: "\n") + "\n---\n"
        if !cleanBody.isEmpty { out += "\n" + cleanBody }
        return out
    }

    /// Serialises one key/value pair (used when creating fresh files).
    public static func serialise(key: String, value: FrontmatterValue) -> String {
        func quoteIfNeeded(_ s: String, inFlow: Bool = false) -> String {
            if s.isEmpty { return "\"\"" }
            var needsQuote = s.first == " " || s.last == " "
                || s.contains(": ")
                || s.contains("#") || s.contains("[") || s.contains("]")
                || s.contains("{") || s.contains("}") || s.contains(",")
                || s.contains("\"") || s.hasPrefix("- ") || s.hasPrefix("?")
                || s.hasPrefix("&") || s.hasPrefix("*") || s.hasPrefix("!")
                || ["true", "false", "null", "yes", "no", "on", "off", "~"].contains(s.lowercased())
                || (Double(s.replacingOccurrences(of: "_", with: "")) != nil && !s.contains(" "))
            if inFlow && s.contains(" ") { needsQuote = true }
            if !needsQuote { return s }
            let escaped = s
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "\"", with: "\\\"")
            return "\"\(escaped)\""
        }
        switch value {
        case .string(let s): return "\(key): \(quoteIfNeeded(s))"
        case .int(let i): return "\(key): \(i)"
        case .double(let d): return "\(key): \(d)"
        case .bool(let b): return "\(key): \(b ? "true" : "false")"
        case .null: return "\(key):"
        case .array(let items):
            let rendered = items.map { item -> String in
                switch item {
                case .string(let s): return quoteIfNeeded(s, inFlow: true)
                case .int(let i): return String(i)
                case .double(let d): return String(d)
                case .bool(let b): return b ? "true" : "false"
                case .null: return "null"
                case .array(let nested): return "[\(nested.map { quoteIfNeeded($0.displayString) }.joined(separator: ", "))]"
                case .raw(let r): return quoteIfNeeded(r)
                }
            }.joined(separator: ", ")
            return "\(key): [\(rendered)]"
        case .raw(let r): return "\(key): \(r)"
        }
    }

    // MARK: - Parsing

    public static func parse(_ text: String) -> FrontmatterDocument {
        var lines = text.components(separatedBy: "\n")
        // Strip a leading UTF-8 BOM if present.
        if var first = lines.first, first.hasPrefix("\u{FEFF}") {
            first.removeFirst()
            if first.isEmpty { lines.removeFirst() } else { lines[0] = first }
        }
        guard let first = lines.first, first.trimmingCharacters(in: .whitespaces) == "---" else {
            return FrontmatterDocument(entries: [], body: text)
        }
        lines.removeFirst()
        var entries: [FrontmatterEntry] = []
        var bodyLines: [String] = []
        var inBody = false
        var blockBuffer: [String] = []
        var blockKey: String? = nil

        func flushBlock() {
            if let key = blockKey {
                if blockBuffer.count > 1 {
                    // Indented continuation lines: preserve the whole block verbatim.
                    entries.append(FrontmatterEntry(key: key, value: .raw(blockBuffer.joined(separator: "\n")), raw: blockBuffer.joined(separator: "\n")))
                } else {
                    // `key:` with nothing following: a null value.
                    entries.append(FrontmatterEntry(key: key, value: .null, raw: blockBuffer.first))
                }
            }
            blockBuffer = []
            blockKey = nil
        }

        for line in lines {
            if inBody {
                bodyLines.append(line)
                continue
            }
            if line.trimmingCharacters(in: .whitespaces) == "---" {
                flushBlock()
                inBody = true
                continue
            }
            if line.isEmpty {
                if blockKey != nil { blockBuffer.append(line) }
                continue
            }
            let isIndented = line.hasPrefix(" ") || line.hasPrefix("\t") || line.hasPrefix("- ")
            if isIndented, blockKey != nil {
                blockBuffer.append(line)
                continue
            }
            guard let colon = line.firstIndex(of: ":") else {
                // Continuation/stray line inside block value.
                if blockKey != nil { blockBuffer.append(line) }
                continue
            }
            flushBlock()
            let key = String(line[..<colon]).trimmingCharacters(in: .whitespaces)
            guard !key.isEmpty, !key.contains(" ") else {
                // Not a plain key line; keep verbatim inside the current block.
                if let k = blockKey { blockBuffer.append(line); _ = k } else { blockKey = nil }
                continue
            }
            let rawValue = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
            // Split trailing comment (" # ...") outside of quotes.
            let parsed = Self.parseScalar(rawValue)
            if parsed.value == nil && parsed.commentOnly {
                // `key:` with nothing (null) or comment only; continuation
                // lines may follow, so defer until the block is closed.
                flushBlock()
                blockKey = key
                blockBuffer = [line]
                continue
            }
            flushBlock()
            entries.append(FrontmatterEntry(key: key, value: parsed.value ?? .null, raw: line))
        }
        flushBlock()
        if !inBody {
            // Unterminated frontmatter; treat whole text as body.
            return FrontmatterDocument(entries: [], body: text)
        }
        var body = bodyLines.joined(separator: "\n")
        if text.hasSuffix("\n") { body += "\n" }
        // Drop the single separator blank line the writer emits.
        if body.hasPrefix("\n") { body.removeFirst() }
        return FrontmatterDocument(entries: entries, body: body)
    }

    /// Parses a scalar token, tolerating an unquoted trailing comment.
    static func parseScalar(_ raw: String) -> (value: FrontmatterValue?, commentOnly: Bool) {
        var s = raw
        if s.isEmpty { return (nil, true) }
        if s.hasPrefix("\"") || s.hasPrefix("'") {
            let quote = s.removeFirst()
            var out = ""
            var closed = false
            var iterator = s.makeIterator()
            while let ch = iterator.next() {
                if ch == "\\" && quote == "\"" {
                    if let next = iterator.next() {
                        switch next {
                        case "n": out.append("\n")
                        case "t": out.append("\t")
                        default: out.append(next)
                        }
                    }
                    continue
                }
                if ch == quote { closed = true; break }
                out.append(ch)
            }
            return (closed ? .string(out) : .string(String(s)), false)
        }
        // Inline array [a, b]
        if s.hasPrefix("[") {
            if let close = s.lastIndex(of: "]") {
                let inner = String(s[s.index(after: s.startIndex)..<close])
                let items = splitTopLevel(inner).compactMap { parseScalar($0).value }
                return (.array(items), false)
            }
            return (.raw(s), false)
        }
        // Strip trailing comment: " # ..."
        if let hashRange = s.range(of: " #") {
            s = String(s[..<hashRange.lowerBound]).trimmingCharacters(in: .whitespaces)
        } else if s.hasPrefix("#") {
            return (nil, true)
        }
        if s.isEmpty { return (nil, true) }
        switch s.lowercased() {
        case "true": return (.bool(true), false)
        case "false": return (.bool(false), false)
        case "null", "~": return (.null, false)
        default: break
        }
        if let i = Int(s) { return (.int(i), false) }
        if let d = Double(s), s.contains(".") { return (.double(d), false) }
        return (.string(s), false)
    }

    static func splitTopLevel(_ s: String) -> [String] {
        var parts: [String] = []
        var depth = 0
        var quote: Character? = nil
        var current = ""
        for ch in s {
            if let q = quote {
                current.append(ch)
                if ch == q { quote = nil }
                continue
            }
            switch ch {
            case "\"", "'": quote = ch; current.append(ch)
            case "[", "{": depth += 1; current.append(ch)
            case "]", "}": depth -= 1; current.append(ch)
            case "," where depth == 0:
                parts.append(current.trimmingCharacters(in: .whitespaces))
                current = ""
            default: current.append(ch)
            }
        }
        let last = current.trimmingCharacters(in: .whitespaces)
        if !last.isEmpty { parts.append(last) }
        return parts
    }
}
