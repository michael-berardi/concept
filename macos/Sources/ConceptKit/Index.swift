import Foundation

// MARK: - Link extraction

public struct WikiLink: Equatable, Sendable {
    public let target: String
    public let display: String
}

public struct OutlineEntry: Equatable, Sendable {
    public let level: Int
    public let text: String
    public let line: Int
}

/// Per-file derived data used by backlinks, search, tags and the graph.
public struct IndexedDocument: Sendable {
    public let path: String
    public let title: String
    public let kind: String            // "page" | record type | "file"
    public let tags: [String]
    public let outgoing: [WikiLink]
    public let outline: [OutlineEntry]
    public let body: String
}

public struct VaultIndex: Sendable {
    public let documents: [IndexedDocument]
    public let titleToPath: [String: String]   // lowercased title -> path
    public let pathSet: Set<String>
    public let tokenIndex: [String: Set<String>]
    public let documentTokens: [String: [String]]
    public let scannedAt: Date

    public func backlinks(to path: String) -> [String] {
        documents.filter { doc in
            doc.path != path && doc.outgoing.contains { resolve($0.target) == path }
        }.map(\.path)
    }

    public func outgoingLinks(from path: String) -> [WikiLink] {
        documents.first(where: { $0.path == path })?.outgoing ?? []
    }

    /// Resolves a wiki-link target by exact path or case-insensitive title.
    public func resolve(_ target: String) -> String? {
        if pathSet.contains(target) { return target }
        return titleToPath[target.lowercased()]
    }

    public func unresolvedLinks() -> [(source: String, target: String)] {
        var out: [(String, String)] = []
        for doc in documents {
            for link in doc.outgoing where resolve(link.target) == nil {
                out.append((doc.path, link.target))
            }
        }
        return out
    }

    public func document(at path: String) -> IndexedDocument? {
        documents.first(where: { $0.path == path })
    }

    // MARK: - Full-text search

    public struct SearchHit: Equatable, Sendable {
        public let path: String
        public let title: String
        public let score: Double

        public init(path: String, title: String, score: Double) {
            self.path = path
            self.title = title
            self.score = score
        }
    }

    /// All-terms AND search with prefix matching on the final token.
    /// Title matches score higher than body matches.
    public func search(_ query: String, limit: Int = 50) -> [SearchHit] {
        let terms = Self.tokens(in: query)
        guard !terms.isEmpty else { return [] }
        var candidates: Set<String>? = nil
        for (i, term) in terms.enumerated() {
            var matching = Set<String>()
            for (token, paths) in tokenIndex {
                if token == term || (i == terms.count - 1 && token.hasPrefix(term)) {
                    matching.formUnion(paths)
                }
            }
            if let existing = candidates {
                candidates = existing.intersection(matching)
            } else {
                candidates = matching
            }
            if candidates?.isEmpty == true { return [] }
        }
        guard let hits = candidates else { return [] }
        var scored: [SearchHit] = []
        for path in hits {
            guard let doc = document(at: path) else { continue }
            var score = 0.0
            let titleTokens = Self.tokens(in: doc.title)
            let bodyTokens = documentTokens[path] ?? []
            for term in terms {
                if titleTokens.contains(where: { $0 == term }) {
                    score += 10
                } else if titleTokens.contains(where: { $0.hasPrefix(term) }) {
                    score += 5
                }
                let bodyCount = bodyTokens.filter { $0 == term || ($0.hasPrefix(term) && term == terms.last) }.count
                score += Double(min(bodyCount, 5))
            }
            scored.append(SearchHit(path: path, title: doc.title, score: score))
        }
        return Array(scored.sorted { $0.score > $1.score }.prefix(limit))
    }

    public static func tokens(in text: String) -> [String] {
        var out: [String] = []
        var current = ""
        for ch in text.lowercased() {
            if ch.isLetter && ch.isASCII || ch.isNumber || ch == "_" {
                current.append(ch)
            } else if !current.isEmpty {
                out.append(current); current = ""
            }
        }
        if !current.isEmpty { out.append(current) }
        return out
    }

    // MARK: - Tags

    public struct TagInfo: Equatable, Sendable {
        public let tag: String
        public let paths: [String]
    }

    public func tags() -> [TagInfo] {
        var map: [String: [String]] = [:]
        for doc in documents {
            for tag in doc.tags {
                map[tag, default: []].append(doc.path)
            }
        }
        return map.keys.sorted().map { TagInfo(tag: $0, paths: map[$0] ?? []) }
    }
}

/// Extracts wiki links, tags and outline from a Markdown document.
public enum MarkdownExtract {
    public static func wikiLinks(inBody body: String) -> [WikiLink] {
        var out: [WikiLink] = []
        var inFence = false
        for line in body.components(separatedBy: "\n") {
            if line.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                inFence.toggle()
                continue
            }
            guard !inFence else { continue }
            var rest = Substring(line)
            while let open = rest.range(of: "[[") {
                let afterOpen = rest[open.upperBound...]
                guard let close = afterOpen.range(of: "]]") else { break }
                let inner = String(afterOpen[..<close.lowerBound])
                let target: String
                let display: String
                if let pipe = inner.firstIndex(of: "|") {
                    target = String(inner[..<pipe]).trimmingCharacters(in: .whitespaces)
                    display = String(inner[inner.index(after: pipe)...]).trimmingCharacters(in: .whitespaces)
                } else {
                    target = inner.trimmingCharacters(in: .whitespaces)
                    display = target
                }
                if !target.isEmpty {
                    out.append(WikiLink(target: target, display: display))
                }
                rest = rest[close.upperBound...]
            }
        }
        return out
    }

    public static func outline(inBody body: String) -> [OutlineEntry] {
        var out: [OutlineEntry] = []
        var inFence = false
        for (i, line) in body.components(separatedBy: "\n").enumerated() {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("```") {
                inFence.toggle()
                continue
            }
            guard !inFence else { continue }
            if trimmed.hasPrefix("#") {
                let level = trimmed.prefix(while: { $0 == "#" }).count
                if level <= 6, trimmed.count > level {
                    let text = trimmed.dropFirst(level).trimmingCharacters(in: .whitespaces)
                    if !text.isEmpty {
                        out.append(OutlineEntry(level: level, text: String(text), line: i))
                    }
                }
            }
        }
        return out
    }

    /// Frontmatter tags plus inline #tags in the body (skipping code fences,
    /// headings' leading hashes and URLs).
    public static func tags(frontmatter: FrontmatterDocument, body: String) -> [String] {
        var out: [String] = []
        for tag in frontmatter.stringArray("tags") where !out.contains(tag) {
            out.append(tag)
        }
        var inFence = false
        for line in body.components(separatedBy: "\n") {
            if line.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                inFence.toggle()
                continue
            }
            guard !inFence, !line.trimmingCharacters(in: .whitespaces).hasPrefix("#") else { continue }
            var rest = Substring(line)
            while let hash = rest.firstIndex(of: "#") {
                let after = rest[rest.index(after: hash)...]
                var token = ""
                for ch in after {
                    if ch.isLetter && ch.isASCII || ch.isNumber || ch == "_" || ch == "-" {
                        token.append(ch)
                    } else { break }
                }
                if token.count > 1, !out.contains(token) {
                    out.append(token)
                }
                rest = after
            }
        }
        return out
    }
}

public enum VaultIndexBuilder {
    /// Builds the link/search/tag index from a snapshot. Only Markdown files
    /// under Pages/ and Data/ are indexed; other files stay visible in the
    /// vault tree but carry no index entry.
    public static func build(vault: Vault, snapshot: VaultSnapshot) -> VaultIndex {
        var documents: [IndexedDocument] = []
        var titleToPath: [String: String] = [:]
        var tokenIndex: [String: Set<String>] = [:]
        var documentTokens: [String: [String]] = [:]

        for file in snapshot.files where !file.isDirectory && file.path.hasSuffix(".md") {
            let isIndexed = file.path.hasPrefix("Pages/") || file.path.hasPrefix("Data/")
            guard let doc = try? vault.readDocument(relativePath: file.path) else { continue }
            let title = doc.string("title")
                ?? ((file.path as NSString).lastPathComponent as NSString).deletingPathExtension
            let tags = MarkdownExtract.tags(frontmatter: doc, body: doc.body)
            let links = isIndexed ? MarkdownExtract.wikiLinks(inBody: doc.body) : []
            let outline = isIndexed ? MarkdownExtract.outline(inBody: doc.body) : []
            let kind = file.path.hasPrefix("Data/")
                ? (doc.string("type") ?? "record") : "page"
            let body = doc.body
            documents.append(IndexedDocument(path: file.path, title: title, kind: kind,
                                             tags: tags, outgoing: links, outline: outline, body: body))
            if isIndexed {
                titleToPath[title.lowercased()] = file.path
                let tokens = VaultIndex.tokens(in: title + " " + tags.joined(separator: " ") + " " + body)
                documentTokens[file.path] = tokens
                for token in Set(tokens) {
                    tokenIndex[token, default: []].insert(file.path)
                }
            }
        }
        var pathSet = Set<String>()
        for doc in documents { pathSet.insert(doc.path) }
        return VaultIndex(documents: documents, titleToPath: titleToPath, pathSet: pathSet,
                          tokenIndex: tokenIndex, documentTokens: documentTokens,
                          scannedAt: snapshot.scannedAt)
    }
}

// MARK: - Graph

public struct GraphNode: Equatable, Sendable {
    public let id: String        // path
    public let title: String
    public let kind: String
    public let tags: [String]
    public var x: Double
    public var y: Double
}

public struct GraphEdge: Equatable, Sendable {
    public let source: String
    public let target: String
}

public struct Graph: Sendable {
    public let nodes: [GraphNode]
    public let edges: [GraphEdge]

    public func node(id: String) -> GraphNode? {
        nodes.first(where: { $0.id == id })
    }

    /// Local graph: the note plus everything linking to or from it.
    public static func local(index: VaultIndex, path: String) -> Graph {
        var ids = Set<String>([path])
        for doc in index.documents where doc.outgoing.contains(where: { index.resolve($0.target) == path }) {
            ids.insert(doc.path)
        }
        if let doc = index.document(at: path) {
            for link in doc.outgoing {
                if let resolved = index.resolve(link.target) { ids.insert(resolved) }
            }
        }
        return build(index: index, ids: ids)
    }

    public static func global(index: VaultIndex) -> Graph {
        build(index: index, ids: Set(index.documents.map(\.path)))
    }

    static func build(index: VaultIndex, ids: Set<String>) -> Graph {
        var nodes: [GraphNode] = []
        for id in ids.sorted() {
            guard let doc = index.document(at: id) else { continue }
            let n = Double(nodes.count)
            // Deterministic seeded ring layout; force layout refines it.
            let angle = n * 2.399963 // golden angle
            nodes.append(GraphNode(id: id, title: doc.title, kind: doc.kind, tags: doc.tags,
                                   x: cos(angle) * (40 + n * 8), y: sin(angle) * (40 + n * 8)))
        }
        var edges: [GraphEdge] = []
        for doc in index.documents where ids.contains(doc.path) {
            for link in doc.outgoing {
                if let target = index.resolve(link.target), ids.contains(target), target != doc.path {
                    edges.append(GraphEdge(source: doc.path, target: target))
                }
            }
        }
        return Graph(nodes: nodes, edges: edges)
    }
}

/// Simple force-directed layout: repulsion + spring + gentle centering.
/// Deterministic (fixed seed, no randomness) so tests can assert convergence.
public enum ForceLayout {
    public static func run(nodes: [GraphNode], edges: [GraphEdge],
                           iterations: Int = 300, repulsion: Double = 11000,
                           springLength: Double = 120, springStrength: Double = 0.012,
                           centerPull: Double = 0.0006, damping: Double = 0.86) -> [CGPoint] {
        var pos: [(Double, Double)] = nodes.map { ($0.x, $0.y) }
        let idx = Dictionary(uniqueKeysWithValues: nodes.enumerated().map { ($1.id, $0) })
        var vel = [(Double, Double)](repeating: (0, 0), count: nodes.count)
        let count = Double(max(nodes.count, 1))

        for _ in 0..<iterations {
            var force = [(Double, Double)](repeating: (0, 0), count: nodes.count)
            // Repulsion (O(n^2), fine for local graphs and modest global ones).
            for i in 0..<nodes.count {
                for j in (i + 1)..<nodes.count {
                    let dx = pos[i].0 - pos[j].0
                    let dy = pos[i].1 - pos[j].1
                    var d2 = dx * dx + dy * dy
                    if d2 < 1 { d2 = 1 }
                    let f = repulsion / d2
                    let d = sqrt(d2)
                    let fx = f * dx / d
                    let fy = f * dy / d
                    force[i].0 += fx; force[i].1 += fy
                    force[j].0 -= fx; force[j].1 -= fy
                }
            }
            // Springs along edges.
            for edge in edges {
                guard let a = idx[edge.source], let b = idx[edge.target] else { continue }
                let dx = pos[b].0 - pos[a].0
                let dy = pos[b].1 - pos[a].1
                let dd = dx * dx + dy * dy
                let d = max(dd.squareRoot(), 0.001)
                let f = (d - springLength) * springStrength
                let fx = f * dx / d
                let fy = f * dy / d
                force[a].0 += fx; force[a].1 += fy
                force[b].0 -= fx; force[b].1 -= fy
            }
            // Centering + integrate.
            for i in 0..<nodes.count {
                force[i].0 -= pos[i].0 * centerPull * count
                force[i].1 -= pos[i].1 * centerPull * count
                vel[i].0 = (vel[i].0 + force[i].0) * damping
                vel[i].1 = (vel[i].1 + force[i].1) * damping
                pos[i].0 += vel[i].0
                pos[i].1 += vel[i].1
            }
        }
        return pos.map { CGPoint(x: $0.0, y: $0.1) }
    }
}
