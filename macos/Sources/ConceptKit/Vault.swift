import Foundation
import CryptoKit

/// Relative-path file entry (slash-separated, always relative to the vault root).
public struct FileInfo: Equatable, Sendable {
    public let path: String
    public let isDirectory: Bool
}

public struct PageRef: Equatable, Sendable {
    public let path: String          // "Pages/Meetings/Standup.md"
    public let parentPath: String?   // "Pages/Meetings.md" or nil for root
    public let title: String
    public let icon: String?
}

public struct Record: Equatable, Sendable {
    public let path: String           // "Data/deals/acme-renewal.md"
    public let databaseSlug: String
    public let title: String
    public let recordType: String
    public let status: String
    public let rank: String
    public let archived: Bool
    public let properties: [String: FrontmatterValue]
    public let contentHash: String
}

/// Result of one vault scan.
public struct VaultSnapshot: Sendable {
    public let files: [FileInfo]
    public let pages: [PageRef]
    public let records: [Record]
    public let scannedAt: Date
}

/// The vault engine: a folder of Markdown files plus `.concept/` workspace
/// state. Files are the truth; everything here reads and writes Markdown.
public final class Vault {
    public let url: URL
    public let fileManager: FileManager

    public init(url: URL) throws {
        let fm = FileManager.default
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: url.path, isDirectory: &isDir) else {
            throw ConceptError.vaultNotFound(url.path)
        }
        guard isDir.boolValue else {
            throw ConceptError.vaultNotDirectory(url.path)
        }
        self.url = url.standardizedFileURL
        self.fileManager = fm
    }

    // MARK: - Path helpers

    public static let excludedDirectories: Set<String> = [".git", ".retex", ".trash"]
    public static let excludedFiles: Set<String> = [".DS_Store"]

    public func absoluteURL(_ relativePath: String) -> URL {
        url.appendingPathComponent(relativePath)
    }

    public func relativePath(of url: URL) -> String? {
        let p = url.standardizedFileURL.path
        let root = self.url.path
        guard p.hasPrefix(root + "/") else { return nil }
        return String(p.dropFirst(root.count + 1))
    }

    public static func slugify(_ title: String) -> String {
        let lower = title.lowercased()
        var out = ""
        var lastDash = false
        for ch in lower {
            if ch.isLetter && ch.isASCII || ch.isNumber {
                out.append(ch)
                lastDash = false
            } else if !lastDash && !out.isEmpty {
                out.append("-")
                lastDash = true
            }
        }
        while out.hasSuffix("-") { out.removeLast() }
        return out.isEmpty ? "untitled" : String(out.prefix(80))
    }

    func ensureDirectory(_ relative: String) throws {
        let dir = absoluteURL(relative)
        if !fileManager.fileExists(atPath: dir.path) {
            do {
                try fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
            } catch {
                throw ConceptError.writeFailed(relative, cause: String(describing: error))
            }
        }
    }

    // MARK: - Workspace metadata

    public static let conceptDirectory = ".concept"
    public static let workspaceFile = ".concept/workspace.json"
    public static let databasesDirectory = ".concept/databases"
    public static let syncFile = ".concept/sync.json"
    public static let gitignoreFile = ".gitignore"

    public func workspaceInfo() -> WorkspaceInfo? {
        guard let data = try? Data(contentsOf: absoluteURL(Self.workspaceFile)) else { return nil }
        return DatabaseJSON.decodeWorkspace(data)
    }

    func writeWorkspaceInfo(_ info: WorkspaceInfo) throws {
        let data = try JSONEncoder().encode(info)
        try data.write(to: absoluteURL(Self.workspaceFile), options: .atomic)
    }

    // MARK: - Creation

    public enum Template: Equatable, Sendable {
        case blank
        case crm
        case databases([String])

        var databases: [Database] {
            switch self {
            case .blank: return []
            case .crm: return DatabaseTemplate.crmStarter
            case .databases(let slugs): return slugs.compactMap { DatabaseTemplate.named($0) }
            }
        }
    }

    /// Creates a new vault on disk (workspace.json, templates, gitignore).
    public static func create(at url: URL, name: String, template: Template = .crm) throws -> Vault {
        let fm = FileManager.default
        do {
            try fm.createDirectory(at: url, withIntermediateDirectories: true)
        } catch {
            throw ConceptError.writeFailed(url.path, cause: String(describing: error))
        }
        let vault = try Vault(url: url)
        try vault.ensureDirectory(Self.conceptDirectory)
        try vault.ensureDirectory(Self.databasesDirectory)
        try vault.ensureDirectory("Pages")
        try vault.ensureDirectory("Data")
        try vault.ensureDirectory("Attachments")
        let info = WorkspaceInfo(name: name, id: UUID().uuidString.lowercased())
        try vault.writeWorkspaceInfo(info)
        for db in template.databases {
            try vault.writeDatabase(db)
        }
        // Retex state is vault-local and must stay out of git.
        if !fm.fileExists(atPath: vault.absoluteURL(Self.gitignoreFile).path) {
            try ".retex/\n.trash/\n.DS_Store\n"
                .data(using: .utf8)!
                .write(to: vault.absoluteURL(Self.gitignoreFile), options: .atomic)
        }
        return vault
    }

    // MARK: - Scan

    /// Walks the vault (excluding `.git`, `.retex`, `.trash`) and parses every
    /// Markdown file into pages (under `Pages/`) and records (under `Data/`).
    public func scan() throws -> VaultSnapshot {
        var files: [FileInfo] = []
        files.append(FileInfo(path: "", isDirectory: true))
        collectFiles(relative: "", into: &files)

        var pages: [PageRef] = []
        var records: [Record] = []
        for file in files where !file.isDirectory && file.path.hasSuffix(".md") {
            if file.path.hasPrefix("Data/") {
                if let record = try? parseRecord(relativePath: file.path) {
                    records.append(record)
                }
            } else if file.path.hasPrefix("Pages/") {
                if let page = try? parsePageRef(relativePath: file.path) {
                    pages.append(page)
                }
            }
        }
        let sortedRecords = RankOrder.sort(records, key: { r in
            (r.databaseSlug + "/" + r.status) + "\u{0}" + r.rank
        })
        return VaultSnapshot(files: files, pages: pages.sorted { $0.path < $1.path },
                             records: sortedRecords, scannedAt: Date())
    }

    func collectFiles(relative: String, into files: inout [FileInfo]) {
        let dirURL = relative.isEmpty ? url : absoluteURL(relative)
        let items: [URL]
        do {
            items = try fileManager.contentsOfDirectory(at: dirURL, includingPropertiesForKeys: [.isDirectoryKey], options: [])
        } catch {
            return // unreadable directory: reported as missing content, not a crash
        }
        for item in items {
            let name = item.lastPathComponent
            if name == ".DS_Store" { continue }
            let rel = relative.isEmpty ? name : relative + "/" + name
            var isDir: ObjCBool = false
            guard fileManager.fileExists(atPath: item.path, isDirectory: &isDir) else { continue }
            if isDir.boolValue {
                if Self.excludedDirectories.contains(name) { continue }
                files.append(FileInfo(path: rel, isDirectory: true))
                collectFiles(relative: rel, into: &files)
            } else {
                files.append(FileInfo(path: rel, isDirectory: false))
            }
        }
    }

    // MARK: - Documents

    public func readDocument(relativePath: String) throws -> FrontmatterDocument {
        let fileURL = absoluteURL(relativePath)
        guard fileManager.fileExists(atPath: fileURL.path) else {
            throw ConceptError.pageNotFound(relativePath)
        }
        do {
            let text = try String(contentsOf: fileURL, encoding: .utf8)
            return FrontmatterDocument.parse(text)
        } catch {
            throw ConceptError.readFailed(relativePath, cause: String(describing: error))
        }
    }

    @discardableResult
    public func writeDocument(relativePath: String, document: FrontmatterDocument) throws -> String {
        let fileURL = absoluteURL(relativePath)
        let dir = (relativePath as NSString).deletingLastPathComponent
        if !dir.isEmpty {
            try ensureDirectory(dir)
        }
        do {
            try document.render().write(to: fileURL, atomically: true, encoding: .utf8)
        } catch {
            throw ConceptError.writeFailed(relativePath, cause: String(describing: error))
        }
        return contentHash(of: fileURL)
    }

    public func contentHash(of fileURL: URL) -> String {
        guard let data = try? Data(contentsOf: fileURL) else { return "" }
        return Self.sha256Hex(data)
    }

    public static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    public func deleteToTrash(relativePath: String) throws {
        let source = absoluteURL(relativePath)
        guard fileManager.fileExists(atPath: source.path) else {
            throw ConceptError.pageNotFound(relativePath)
        }
        let stamp = Int(Date().timeIntervalSince1970)
        let name = (relativePath as NSString).lastPathComponent
        let dest = absoluteURL(".trash/\(stamp)-\(name)")
        try ensureDirectory(".trash")
        do {
            try fileManager.moveItem(at: source, to: dest)
        } catch {
            throw ConceptError.writeFailed(relativePath, cause: "trash move failed: \(error)")
        }
    }

    // MARK: - Pages

    public func parsePageRef(relativePath: String) throws -> PageRef {
        let doc = try readDocument(relativePath: relativePath)
        let title = doc.string("title")
            ?? (relativePath as NSString).lastPathComponent.replacingOccurrences(of: ".md", with: "")
        let parentDir = (relativePath as NSString).deletingLastPathComponent // "Pages/Foo"
        var parentPath: String? = nil
        if parentDir != "Pages" && parentDir.hasPrefix("Pages/") {
            parentPath = parentDir + ".md"
        }
        return PageRef(path: relativePath, parentPath: parentPath, title: title, icon: doc.string("icon"))
    }

    public func createPage(title: String, parentPagePath: String? = nil,
                           body: String = "", icon: String? = nil) throws -> PageRef {
        var dir = "Pages"
        if let parent = parentPagePath {
            guard parent.hasPrefix("Pages/") && parent.hasSuffix(".md") else {
                throw ConceptError.invalidPath(parent, cause: "parent page must live under Pages/")
            }
            dir = (parent as NSString).deletingLastPathComponent + "/" +
                  ((parent as NSString).lastPathComponent as NSString).deletingPathExtension
        }
        let rel = try uniqueMarkdownPath(directory: dir, title: title)
        var doc = FrontmatterDocument()
        doc.set("title", title)
        doc.set("type", "page")
        if let icon { doc.set("icon", icon) }
        doc.body = body.isEmpty ? "# \(title)\n" : body
        try writeDocument(relativePath: rel, document: doc)
        return PageRef(path: rel, parentPath: parentPagePath, title: title, icon: icon)
    }

    enum PathStyle { case page, record }

    func uniqueMarkdownPath(directory: String, title: String, style: PathStyle = .page) throws -> String {
        let base: String
        switch style {
        case .page:
            // Obsidian-style: the file name is the title (case preserved).
            var t = title
                .replacingOccurrences(of: "/", with: "-")
                .replacingOccurrences(of: ":", with: "-")
                .replacingOccurrences(of: "\n", with: " ")
                .trimmingCharacters(in: .whitespaces)
            if t.count > 120 { t = String(t.prefix(120)).trimmingCharacters(in: .whitespaces) }
            base = t.isEmpty ? "Untitled" : t
        case .record:
            base = Self.slugify(title)
        }
        let candidate = directory + "/" + base + ".md"
        if !fileManager.fileExists(atPath: absoluteURL(candidate).path) {
            return candidate
        }
        var n = 2
        while true {
            let next = directory + "/\(base) \(n).md"
            if !fileManager.fileExists(atPath: absoluteURL(next).path) { return next }
            n += 1
        }
    }

    // MARK: - Databases

    public func databases() -> [Database] {
        let dir = absoluteURL(Self.databasesDirectory)
        guard let items = try? fileManager.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else {
            return []
        }
        return items.filter { $0.pathExtension == "json" }.compactMap { item in
            guard let data = try? Data(contentsOf: item) else { return nil }
            return try? DatabaseJSON.decodeDatabase(data, slug: item.deletingPathExtension().lastPathComponent)
        }.sorted { $0.slug < $1.slug }
    }

    public func database(slug: String) throws -> Database {
        let fileURL = absoluteURL("\(Self.databasesDirectory)/\(slug).json")
        guard fileManager.fileExists(atPath: fileURL.path) else {
            throw ConceptError.databaseNotFound(slug)
        }
        do {
            let data = try Data(contentsOf: fileURL)
            return try DatabaseJSON.decodeDatabase(data, slug: slug)
        } catch let error as ConceptError {
            throw error
        } catch {
            throw ConceptError.readFailed("\(Self.databasesDirectory)/\(slug).json", cause: String(describing: error))
        }
    }

    public func writeDatabase(_ database: Database) throws {
        try ensureDirectory(Self.databasesDirectory)
        let data = try DatabaseJSON.encode(database)
        try data.write(to: absoluteURL("\(Self.databasesDirectory)/\(database.slug).json"), options: .atomic)
    }

    // MARK: - Records

    public func parseRecord(relativePath: String) throws -> Record {
        guard relativePath.hasPrefix("Data/") else {
            throw ConceptError.invalidPath(relativePath, cause: "records live under Data/<database>/")
        }
        let parts = relativePath.split(separator: "/")
        guard parts.count >= 3 else {
            throw ConceptError.invalidPath(relativePath, cause: "expected Data/<database>/<row>.md")
        }
        let slug = String(parts[1])
        let db = try database(slug: slug)
        let doc = try readDocument(relativePath: relativePath)
        var properties: [String: FrontmatterValue] = [:]
        for entry in doc.entries {
            properties[entry.key] = entry.value
        }
        let title = doc.string("title") ?? ((relativePath as NSString).lastPathComponent as NSString).deletingPathExtension
        return Record(
            path: relativePath,
            databaseSlug: slug,
            title: title,
            recordType: doc.string("type") ?? db.recordType,
            status: doc.string("status") ?? db.statusOptions.first?.id ?? "",
            rank: doc.string("rank") ?? "",
            archived: doc.bool("archived") ?? false,
            properties: properties,
            contentHash: contentHash(of: absoluteURL(relativePath)))
    }

    public func records(databaseSlug: String) throws -> [Record] {
        let dir = "Data/\(databaseSlug)"
        guard fileManager.fileExists(atPath: absoluteURL(dir).path) else { return [] }
        let items = try? fileManager.contentsOfDirectory(at: absoluteURL(dir), includingPropertiesForKeys: nil)
        var out: [Record] = []
        for item in items ?? [] where item.pathExtension == "md" {
            if let record = try? parseRecord(relativePath: dir + "/" + item.lastPathComponent) {
                out.append(record)
            }
        }
        return RankOrder.sort(out, key: { $0.rank })
    }

    public func createRecord(databaseSlug: String, properties: [String: FrontmatterValue],
                             body: String = "") throws -> Record {
        let db = try database(slug: databaseSlug)
        let title = properties["title"]?.asString ?? "Untitled"
        let status = properties["status"]?.asString ?? db.statusOptions.first?.id ?? ""
        let rel = try uniqueMarkdownPath(directory: "Data/\(databaseSlug)", title: title, style: .record)
        var doc = FrontmatterDocument()
        doc.set("type", db.recordType)
        // Core properties next, in the Retex contract order.
        var written = Set<String>()
        func put(_ key: String, _ value: FrontmatterValue?) {
            guard let value, !(value.displayString.isEmpty && key != "title") else { return }
            doc.set(key, value)
            written.insert(key)
        }
        for property in db.properties {
            switch property.key {
            case "title": put("title", .string(title))
            case "status": put("status", .string(status))
            case "rank": put("rank", try .string(appendRank(databaseSlug: databaseSlug, status: status, database: db)))
            case "archived": put("archived", .bool(false))
            default: put(property.key, properties[property.key])
            }
        }
        // Unknown/custom properties, preserving caller order.
        for (key, value) in properties where !written.contains(key) {
            doc.set(key, value)
        }
        doc.body = body.isEmpty ? "# \(title)\n" : body
        try writeDocument(relativePath: rel, document: doc)
        return try parseRecord(relativePath: rel)
    }

    /// Rank that appends to the end of the given column ("a0" when empty).
    func appendRank(databaseSlug: String, status: String, database: Database) throws -> String {
        let column = try records(databaseSlug: databaseSlug).filter { $0.status == status && !$0.archived }
        let ordered = RankOrder.sort(column, key: { $0.rank })
        guard let last = ordered.last else { return Rank.first() }
        return try Rank.key(between: last.rank, and: nil)
    }

    public func updateRecord(relativePath: String,
                             properties: [String: FrontmatterValue]? = nil,
                             body: String? = nil) throws -> Record {
        var doc = try readDocument(relativePath: relativePath)
        if let properties {
            for (key, value) in properties {
                doc.set(key, value)
            }
        }
        if let body { doc.body = body }
        try writeDocument(relativePath: relativePath, document: doc)
        return try parseRecord(relativePath: relativePath)
    }

    /// Board drag: set `status` and place the card between `afterID` and
    /// `beforeID` (either may be nil). Inserting before the very first card
    /// renumbers the whole column so a valid key always exists. Returns the
    /// paths that were rewritten.
    @discardableResult
    public func moveRecord(relativePath: String, databaseSlug: String,
                           status: String, afterID: String?, beforeID: String?) throws -> [String] {
        let db = try database(slug: databaseSlug)
        let column = try records(databaseSlug: databaseSlug).filter { $0.status == status && !$0.archived }
        let ordered = RankOrder.sort(column, key: { $0.rank })

        var rewritten: [(path: String, rank: String)] = []
        let afterRecord = ordered.first(where: { $0.path == afterID })
        let beforeRecord = ordered.first(where: { $0.path == beforeID })

        func nextKey(after: String?, before: String?) throws -> String {
            try Rank.key(between: after, and: before)
        }

        if afterID == nil && beforeID == nil {
            rewritten.append((relativePath, try nextKey(after: ordered.last?.rank, before: nil)))
        } else if let after = afterRecord, beforeID == nil {
            rewritten.append((relativePath, try nextKey(after: after.rank, before: nil)))
        } else if beforeID != nil && afterID == nil {
            if let before = beforeRecord, before.path == ordered.first?.path {
                // Insert at the very top: renumber the column.
                let keys = try Rank.rekey(count: ordered.count + 1)
                rewritten.append((relativePath, keys[0]))
                for (i, record) in ordered.enumerated() where record.path != relativePath {
                    rewritten.append((record.path, keys[i + 1]))
                }
            } else {
                let idx = ordered.firstIndex(where: { $0.path == beforeID })
                let prev = idx.flatMap { $0 > 0 ? ordered[$0 - 1] : nil }
                rewritten.append((relativePath, try nextKey(after: prev?.rank, before: beforeRecord?.rank)))
            }
        } else if let after = afterRecord, let before = beforeRecord {
            rewritten.append((relativePath, try nextKey(after: after.rank, before: before.rank)))
        } else {
            throw ConceptError(code: "record.bad_move",
                message: "Move references unknown cards (after='\(afterID ?? "-")', before='\(beforeID ?? "-")') in \(databaseSlug)")
        }
        _ = db

        for item in rewritten {
            var doc = try readDocument(relativePath: item.path)
            doc.set("rank", item.rank)
            doc.set("status", status)
            try writeDocument(relativePath: item.path, document: doc)
        }
        return rewritten.map(\.path)
    }

    // MARK: - Sync settings (token lives in the Keychain)

    public struct SyncSettings: Codable, Equatable, Sendable {
        public var remoteUrl: String
        public var branch: String
        public var enabled: Bool

        public init(remoteUrl: String, branch: String = "main", enabled: Bool) {
            self.remoteUrl = remoteUrl
            self.branch = branch
            self.enabled = enabled
        }
    }

    public func syncSettings() -> SyncSettings? {
        guard let data = try? Data(contentsOf: absoluteURL(Self.syncFile)) else { return nil }
        return try? JSONDecoder().decode(SyncSettings.self, from: data)
    }

    public func writeSyncSettings(_ settings: SyncSettings?) throws {
        guard let settings else {
            if fileManager.fileExists(atPath: absoluteURL(Self.syncFile).path) {
                try fileManager.removeItem(at: absoluteURL(Self.syncFile))
            }
            return
        }
        let data = try JSONEncoder().encode(settings)
        try data.write(to: absoluteURL(Self.syncFile), options: .atomic)
    }
}
