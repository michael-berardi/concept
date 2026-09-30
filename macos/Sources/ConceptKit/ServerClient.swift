import Foundation

/// REST client for the optional Concept server mode, speaking the API in
/// docs/SPEC.md (session cookie or `Authorization: Bearer cpt_…`).
///
/// All errors surface as `ConceptError` with a server-provided or derived
/// code; error bodies are `{"error":{"code":"…","message":"…"}}`.
public struct ServerClient: @unchecked Sendable {
    public let baseURL: URL
    public var token: String?
    public var session: URLSession

    public init(baseURL: URL, token: String? = nil, session: URLSession? = nil) {
        self.baseURL = baseURL
        self.token = token
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.ephemeral
            config.httpCookieAcceptPolicy = .always
            self.session = URLSession(configuration: config)
        }
    }

    // MARK: - DTOs

    public struct Health: Codable, Equatable, Sendable {
        public let ok: Bool
        public let version: String
        public let setupRequired: Bool
    }

    public struct User: Codable, Equatable, Sendable {
        public let id: String
        public let email: String
        public let name: String
    }

    public struct Workspace: Codable, Equatable, Sendable {
        public let id: String
        public let name: String
        public let slug: String
    }

    public struct TreeNode: Codable, Sendable {
        public let title: String
        public let path: String
        public let type: String
        public var children: [TreeNode]?
    }

    public struct Page: Codable, Sendable {
        public let path: String
        public let title: String
        public var properties: [String: FrontmatterValue]?
        public var body: String?
        public var contentHash: String?
        public var backlinks: [String]?
    }

    public struct Row: Codable, Sendable {
        public let id: String
        public let path: String
        public var properties: [String: FrontmatterValue]?
        public var rank: String?
        public var contentHash: String?
    }

    public struct RowsResponse: Codable, Sendable {
        public let rows: [Row]
        public var nextCursor: String?
    }

    public struct SyncConfig: Codable, Sendable {
        public var remoteUrl: String?
        public var branch: String?
        public var enabled: Bool?
    }

    public struct SyncStatusDTO: Codable, Sendable {
        public var branch: String?
        public var ahead: Int?
        public var behind: Int?
        public var clean: Bool?
        public var conflicts: [String]?
    }

    public struct SyncRunResult: Codable, Sendable {
        public var committed: Bool?
        public var pushed: Bool?
        public var conflicts: [String]?
    }

    public struct TagDTO: Codable, Sendable {
        public let tag: String
        public let paths: [String]
    }

    // MARK: - Request plumbing

    public struct Empty: Codable, Sendable {}

    private struct APIErrorBody: Decodable {
        struct Inner: Decodable { let code: String; let message: String }
        let error: Inner
    }

    func request(method: String, path: String, query: [String: String] = [:],
                 body: Data? = nil, ifMatch: String? = nil) throws -> URLRequest {
        guard var components = URLComponents(url: baseURL.appendingPathComponent(path),
                                             resolvingAgainstBaseURL: false) else {
            throw ConceptError.badResponse("invalid URL for \(path)")
        }
        if !query.isEmpty {
            components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components.url else {
            throw ConceptError.badResponse("could not build URL for \(path)")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        if let token, !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if body != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let ifMatch {
            request.setValue(ifMatch, forHTTPHeaderField: "If-Match")
        }
        return request
    }

    func send<T: Decodable>(_ type: T.Type, _ request: URLRequest) async throws -> T {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ConceptError.badResponse("non-HTTP response for \(request.url?.path ?? "?")")
        }
        guard (200..<300).contains(http.statusCode) else {
            if let decoded = try? JSONDecoder().decode(APIErrorBody.self, from: data) {
                throw ConceptError.server(http.statusCode, code: decoded.error.code, message: decoded.error.message)
            }
            throw ConceptError.server(http.statusCode, code: "http_\(http.statusCode)",
                                      message: String(data: data.prefix(300), encoding: .utf8) ?? "no body")
        }
        if T.self == Empty.self, data.isEmpty {
            return Empty() as! T
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw ConceptError.badResponse(String(describing: error))
        }
    }

    func sendJSON(_ body: some Encodable) throws -> Data {
        try JSONEncoder().encode(body)
    }

    // MARK: - Auth & instance

    public func health() async throws -> Health {
        try await send(Health.self, try request(method: "GET", path: "api/health"))
    }

    public struct Credentials: Encodable, Sendable {
        public let email: String
        public let password: String
        public init(email: String, password: String) {
            self.email = email
            self.password = password
        }
    }

    public func login(_ credentials: Credentials) async throws -> User {
        try await send(User.self, try request(method: "POST", path: "api/auth/login",
                                              body: try sendJSON(credentials)))
    }

    public func me() async throws -> User {
        try await send(User.self, try request(method: "GET", path: "api/me"))
    }

    // MARK: - Workspaces

    public func workspaces() async throws -> [Workspace] {
        try await send([Workspace].self, try request(method: "GET", path: "api/workspaces"))
    }

    public struct NewWorkspace: Encodable, Sendable {
        public let name: String
        public var slug: String?
        public var template: String?
        public init(name: String, slug: String? = nil, template: String? = nil) {
            self.name = name
            self.slug = slug
            self.template = template
        }
    }

    public func createWorkspace(_ body: NewWorkspace) async throws -> Workspace {
        try await send(Workspace.self, try request(method: "POST", path: "api/workspaces",
                                                   body: try sendJSON(body)))
    }

    // MARK: - Content

    public func tree(workspace slug: String) async throws -> [TreeNode] {
        try await send([TreeNode].self, try request(method: "GET", path: "api/w/\(slug)/tree"))
    }

    public func page(workspace slug: String, path: String) async throws -> Page {
        let encoded = path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? path
        return try await send(Page.self, try request(method: "GET", path: "api/w/\(slug)/pages/\(encoded)"))
    }

    public struct PageUpdate: Encodable, Sendable {
        public var title: String?
        public var properties: [String: FrontmatterValue]?
        public var body: String?
        public init(title: String? = nil, properties: [String: FrontmatterValue]? = nil, body: String? = nil) {
            self.title = title
            self.properties = properties
            self.body = body
        }
    }

    public func putPage(workspace slug: String, path: String, update: PageUpdate, ifMatch: String? = nil) async throws -> Page {
        let encoded = path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? path
        return try await send(Page.self, try request(method: "PUT", path: "api/w/\(slug)/pages/\(encoded)",
                                                     body: try sendJSON(update), ifMatch: ifMatch))
    }

    public func rows(workspace slug: String, database: String, view: String? = nil,
                     q: String? = nil, limit: Int? = nil, cursor: String? = nil) async throws -> RowsResponse {
        var query: [String: String] = [:]
        if let view { query["view"] = view }
        if let q { query["q"] = q }
        if let limit { query["limit"] = String(limit) }
        if let cursor { query["cursor"] = cursor }
        return try await send(RowsResponse.self, try request(method: "GET",
                                                             path: "api/w/\(slug)/databases/\(database)/rows",
                                                             query: query))
    }

    public struct RowMove: Encodable, Sendable {
        public let status: String
        public var beforeId: String?
        public var afterId: String?
        public init(status: String, beforeId: String? = nil, afterId: String? = nil) {
            self.status = status
            self.beforeId = beforeId
            self.afterId = afterId
        }
    }

    public func moveRow(workspace slug: String, database: String, id: String, move: RowMove) async throws -> Row {
        try await send(Row.self, try request(method: "POST",
                                             path: "api/w/\(slug)/databases/\(database)/rows/\(id)/move",
                                             body: try sendJSON(move)))
    }

    public func search(workspace slug: String, q: String, type: String? = nil) async throws -> [SearchHitDTO] {
        var query = ["q": q]
        if let type { query["type"] = type }
        return try await send([SearchHitDTO].self, try request(method: "GET",
                                                               path: "api/w/\(slug)/search", query: query))
    }

    public struct SearchHitDTO: Codable, Sendable {
        public let path: String
        public let title: String
        public var score: Double?
    }

    public func backlinks(workspace slug: String, path: String) async throws -> [String] {
        try await send([String].self, try request(method: "GET", path: "api/w/\(slug)/backlinks",
                                                  query: ["path": path]))
    }

    public func graph(workspace slug: String, scope: String = "global", path: String? = nil,
                      depth: Int? = nil) async throws -> GraphDTO {
        var query = ["scope": scope]
        if let path { query["path"] = path }
        if let depth { query["depth"] = String(depth) }
        return try await send(GraphDTO.self, try request(method: "GET",
                                                         path: "api/w/\(slug)/graph", query: query))
    }

    public struct GraphDTO: Codable, Sendable {
        public struct Node: Codable, Sendable {
            public let id: String
            public let path: String
            public let title: String
            public let type: String
            public var tags: [String]?
        }
        public struct Edge: Codable, Sendable {
            public let source: String
            public let target: String
        }
        public let nodes: [Node]
        public let edges: [Edge]
    }

    // MARK: - Sync

    public func syncConfig(workspace slug: String) async throws -> SyncConfig {
        try await send(SyncConfig.self, try request(method: "GET", path: "api/w/\(slug)/sync"))
    }

    public func putSyncConfig(workspace slug: String, config: SyncConfig) async throws -> SyncConfig {
        try await send(SyncConfig.self, try request(method: "PUT", path: "api/w/\(slug)/sync",
                                                    body: try sendJSON(config)))
    }

    public func runSync(workspace slug: String) async throws -> SyncRunResult {
        try await send(SyncRunResult.self, try request(method: "POST", path: "api/w/\(slug)/sync/run"))
    }

    public func syncStatus(workspace slug: String) async throws -> SyncStatusDTO {
        try await send(SyncStatusDTO.self, try request(method: "GET", path: "api/w/\(slug)/sync/status"))
    }

    public func tags(workspace slug: String) async throws -> [TagDTO] {
        try await send([TagDTO].self, try request(method: "GET", path: "api/w/\(slug)/tags"))
    }
}
