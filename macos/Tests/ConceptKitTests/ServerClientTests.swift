import Testing
import Foundation
@testable import ConceptKit

/// URLProtocol stub so ServerClient is exercised without a live server.
final class StubURLProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: (@Sendable (URLRequest) -> (Int, Data))?
    nonisolated(unsafe) static var lastRequest: URLRequest?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lastRequest = request
        let (status, data) = Self.handler?(request) ?? (200, Data())
        let response = HTTPURLResponse(url: request.url!, statusCode: status,
                                       httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    static func body(of request: URLRequest) -> Data {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return Data() }
        stream.open()
        defer { stream.close() }
        var data = Data()
        let bufferSize = 4096
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
        defer { buffer.deallocate() }
        while stream.hasBytesAvailable {
            let read = stream.read(buffer, maxLength: bufferSize)
            if read <= 0 { break }
            data.append(buffer, count: read)
        }
        return data
    }
}

@Suite("ServerClient (REST, optional server mode)", .serialized)
struct ServerClientTests {
    static func makeClient() -> ServerClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        let session = URLSession(configuration: config)
        return ServerClient(baseURL: URL(string: "https://concept.example")!, token: "cpt_test", session: session)
    }

    @Test("Health decodes and sends bearer token")
    func health() async throws {
        let client = Self.makeClient()
        StubURLProtocol.handler = { _ in
            (200, Data(#"{"ok":true,"version":"1.0.0","setupRequired":false}"#.utf8))
        }
        let health = try await client.health()
        #expect(health.ok)
        #expect(health.version == "1.0.0")
        #expect(StubURLProtocol.lastRequest?.value(forHTTPHeaderField: "Authorization") == "Bearer cpt_test")
        #expect(StubURLProtocol.lastRequest?.url?.path == "/api/health")
    }

    @Test("PUT page sends If-Match and JSON body")
    func putPage() async throws {
        let client = Self.makeClient()
        StubURLProtocol.handler = { _ in
            (200, Data(#"{"path":"Pages/A.md","title":"A","contentHash":"abc"}"#.utf8))
        }
        var update = ServerClient.PageUpdate()
        update.body = "new body"
        let page = try await client.putPage(workspace: "ws", path: "Pages/A.md", update: update, ifMatch: "abc123")
        #expect(page.title == "A")
        let request = StubURLProtocol.lastRequest!
        #expect(request.httpMethod == "PUT")
        #expect(request.value(forHTTPHeaderField: "If-Match") == "abc123")
        let body = try JSONDecoder().decode([String: String].self, from: StubURLProtocol.body(of: request))
        #expect(body["body"] == "new body")
    }

    @Test("Error bodies surface server code and message")
    func errorBody() async throws {
        let client = Self.makeClient()
        StubURLProtocol.handler = { _ in
            (409, Data(#"{"error":{"code":"conflict","message":"version moved"}}"#.utf8))
        }
        do {
            var update = ServerClient.PageUpdate()
            update.body = "x"
            _ = try await client.putPage(workspace: "ws", path: "Pages/A.md", update: update, ifMatch: "stale")
            Issue.record("expected a conflict error")
        } catch let error as ConceptError {
            #expect(error.code == "server.conflict")
            #expect(error.message.contains("version moved"))
        }
    }

    @Test("Row move posts board drag payload")
    func moveRow() async throws {
        let client = Self.makeClient()
        StubURLProtocol.handler = { request in
            let body = StubURLProtocol.body(of: request)
            #expect(String(data: body, encoding: .utf8)!.contains("\"status\":\"Proposal\""))
            return (200, Data(#"{"id":"r1","path":"Data/deals/x.md","rank":"a1"}"#.utf8))
        }
        let row = try await client.moveRow(workspace: "ws", database: "deals", id: "r1",
                                           move: .init(status: "Proposal", beforeId: "r2"))
        #expect(row.rank == "a1")
        #expect(StubURLProtocol.lastRequest?.url?.path.contains("rows/r1/move") == true)
    }

    @Test("Graph and tags endpoints build the expected queries")
    func graphQuery() async throws {
        let client = Self.makeClient()
        StubURLProtocol.handler = { request in
            if request.url?.path.hasSuffix("/graph") == true {
                return (200, Data(#"{"nodes":[{"id":"1","path":"Pages/A.md","title":"A","type":"page"}],"edges":[]}"#.utf8))
            }
            return (200, Data("[]".utf8))
        }
        let graph = try await client.graph(workspace: "ws", scope: "local", path: "Pages/A.md")
        #expect(graph.nodes.count == 1)
        #expect(StubURLProtocol.lastRequest?.url?.query?.contains("scope=local") == true)
        _ = try await client.tags(workspace: "ws")
        #expect(StubURLProtocol.lastRequest?.url?.path == "/api/w/ws/tags")
    }
}
