import Foundation

// MARK: - Schema models (Codable to .concept/databases/<slug>.json)

public enum PropertyType: String, Codable, Sendable, CaseIterable {
    case title, text, number, select, multiSelect = "multi_select"
    case status, date, checkbox, url, email, phone, person, relation
    case created, updated
}

public enum ViewType: String, Codable, Sendable {
    case table, board, list, calendar, gallery
}

public struct PropertyOption: Codable, Equatable, Sendable {
    public var id: String
    public var color: String

    public init(id: String, color: String) {
        self.id = id
        self.color = color
    }

    /// The server omits `color`; derive a stable one so schemas written by
    /// either side decode.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        color = try c.decodeIfPresent(String.self, forKey: .color) ?? "gray"
    }

    enum CodingKeys: String, CodingKey { case id, color }
}

public struct Property: Codable, Equatable, Sendable {
    public var key: String
    public var name: String
    public var type: PropertyType
    public var options: [PropertyOption]?
    public var format: String?
    public var database: String?

    public init(key: String, name: String, type: PropertyType,
                options: [PropertyOption]? = nil, format: String? = nil, database: String? = nil) {
        self.key = key
        self.name = name
        self.type = type
        self.options = options
        self.format = format
        self.database = database
    }
}

public struct SortSpec: Codable, Equatable, Sendable {
    public var key: String
    public var dir: String // "asc" | "desc"

    public init(key: String, dir: String = "asc") {
        self.key = key
        self.dir = dir
    }
}

public struct FilterOp: RawRepresentable, Equatable, Sendable {
    public var rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }
    public static let eq = FilterOp(rawValue: "eq")
    public static let neq = FilterOp(rawValue: "neq")
    public static let contains = FilterOp(rawValue: "contains")
    public static let gt = FilterOp(rawValue: "gt")
    public static let lt = FilterOp(rawValue: "lt")
    public static let gte = FilterOp(rawValue: "gte")
    public static let lte = FilterOp(rawValue: "lte")
    public static let empty = FilterOp(rawValue: "empty")
    public static let notEmpty = FilterOp(rawValue: "notempty")
}

public struct FilterSpec: Codable, Equatable, Sendable {
    public var key: String
    public var op: String
    public var value: String?

    public init(key: String, op: String, value: String? = nil) {
        self.key = key
        self.op = op
        self.value = value
    }
}

public struct DatabaseView: Codable, Equatable, Sendable {
    public var id: String
    public var name: String
    public var type: ViewType
    public var groupBy: String?
    public var filters: [FilterSpec]
    public var sorts: [SortSpec]
    public var visible: [String]?

    public init(id: String, name: String, type: ViewType, groupBy: String? = nil,
                filters: [FilterSpec] = [], sorts: [SortSpec] = [], visible: [String]? = nil) {
        self.id = id
        self.name = name
        self.type = type
        self.groupBy = groupBy
        self.filters = filters
        self.sorts = sorts
        self.visible = visible
    }
}

public struct Database: Codable, Equatable, Sendable {
    public var slug: String
    public var name: String
    public var icon: String
    public var recordType: String
    public var properties: [Property]
    public var views: [DatabaseView]

    public init(slug: String, name: String, icon: String, recordType: String,
                properties: [Property], views: [DatabaseView]) {
        self.slug = slug
        self.name = name
        self.icon = icon
        self.recordType = recordType
        self.properties = properties
        self.views = views
    }

    public func property(_ key: String) -> Property? {
        properties.first(where: { $0.key == key })
    }

    /// Status options in declared order (the board columns).
    public var statusOptions: [PropertyOption] {
        properties.first(where: { $0.type == .status })?.options ?? []
    }
}

public struct WorkspaceInfo: Codable, Equatable, Sendable {
    public var name: String
    public var id: String
    /// Optional per-workspace accent color ("#rrggbb"). Not a schema field on
    /// purpose: this demonstrates unknown-key preservation in workspace.json.
    public var accent: String?

    public init(name: String, id: String, accent: String? = nil) {
        self.name = name
        self.id = id
        self.accent = accent
    }
}

public enum DatabaseJSON {
    public static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes]
        return e
    }()

    public static func encode(_ database: Database) throws -> Data {
        try encoder.encode(database)
    }

    public static func decodeDatabase(_ data: Data, slug: String) throws -> Database {
        do {
            return try JSONDecoder().decode(Database.self, from: data)
        } catch {
            throw ConceptError.invalidDatabase(slug, cause: String(describing: error))
        }
    }

    public static func decodeWorkspace(_ data: Data) -> WorkspaceInfo? {
        try? JSONDecoder().decode(WorkspaceInfo.self, from: data)
    }
}

// MARK: - Built-in templates

public enum DatabaseTemplate {
    public static let coreProperties: [Property] = [
        Property(key: "title", name: "Name", type: .title),
        Property(key: "status", name: "Stage", type: .status),
        Property(key: "rank", name: "Rank", type: .text),
        Property(key: "owner", name: "Owner", type: .person),
        Property(key: "company", name: "Company", type: .relation, database: "companies"),
        Property(key: "value", name: "Value", type: .number, format: "currency"),
        Property(key: "due", name: "Due", type: .date),
        Property(key: "next_action", name: "Next action", type: .text),
        Property(key: "tags", name: "Labels", type: .multiSelect),
        Property(key: "archived", name: "Archived", type: .checkbox),
    ]

    public static func boardView(groupBy: String, visible: [String]) -> DatabaseView {
        DatabaseView(id: "board", name: "Board", type: .board, groupBy: groupBy,
                     filters: [], sorts: [], visible: visible)
    }

    public static func tableView(sorts: [SortSpec] = [], visible: [String]? = nil) -> DatabaseView {
        DatabaseView(id: "table", name: "Table", type: .table,
                     filters: [], sorts: sorts, visible: visible)
    }

    public static func database(slug: String, name: String, icon: String, recordType: String,
                                statuses: [String],
                                extra: [Property] = [],
                                visible: [String] = ["value", "due"]) -> Database {
        var properties = coreProperties
        // Replace status placeholder with the concrete options.
        if let idx = properties.firstIndex(where: { $0.key == "status" }) {
            let palette = ["gray", "blue", "green", "orange", "purple", "red", "yellow"]
            properties[idx].options = statuses.enumerated().map { i, s in
                PropertyOption(id: s, color: palette[i % palette.count])
            }
        }
        properties.append(contentsOf: extra)
        return Database(
            slug: slug, name: name, icon: icon, recordType: recordType,
            properties: properties,
            views: [boardView(groupBy: "status", visible: visible), tableView()])
    }

    public static let tasks = database(
        slug: "tasks", name: "Tasks", icon: "✓", recordType: "task",
        statuses: ["Todo", "Doing", "Review", "Done"],
        extra: [], visible: ["due", "owner"])

    public static let contacts = database(
        slug: "contacts", name: "Contacts", icon: "◍", recordType: "contact",
        statuses: ["Active", "Inactive"],
        extra: [Property(key: "email", name: "Email", type: .email),
                Property(key: "phone", name: "Phone", type: .phone)],
        visible: ["company", "email"])

    public static let companies = database(
        slug: "companies", name: "Companies", icon: "□", recordType: "company",
        statuses: ["Prospect", "Customer", "Partner"],
        extra: [Property(key: "url", name: "Website", type: .url)],
        visible: ["value"])

    public static let deals = database(
        slug: "deals", name: "Deals", icon: "◆", recordType: "deal",
        statuses: ["Inbox", "Qualified", "Proposal", "Negotiation", "Won", "Lost"],
        extra: [], visible: ["value", "due"])

    public static let activities = database(
        slug: "activities", name: "Activities", icon: "≡", recordType: "activity",
        statuses: ["Planned", "Logged"],
        extra: [Property(key: "contact", name: "Contact", type: .relation, database: "contacts")],
        visible: ["due", "contact"])

    public static let projects = database(
        slug: "projects", name: "Projects", icon: "◫", recordType: "project",
        statuses: ["Planned", "Active", "Paused", "Done"],
        extra: [], visible: ["due", "owner"])

    public static let all: [Database] = [tasks, contacts, companies, deals, activities, projects]

    /// The CRM starter: Companies, Contacts, Deals, Activities with relations.
    public static var crmStarter: [Database] {
        [companies, contacts, deals, activities]
    }

    public static func named(_ slug: String) -> Database? {
        all.first(where: { $0.slug == slug })
    }
}
