import Foundation

/// Every ConceptKit failure carries a stable machine-readable code and a
/// human message that names its cause. No silent failures.
public struct ConceptError: Error, LocalizedError, Sendable {
    public let code: String
    public let message: String

    public init(code: String, message: String) {
        self.code = code
        self.message = message
    }

    public var errorDescription: String? { "[\(code)] \(message)" }

    public static func vaultNotFound(_ path: String) -> ConceptError {
        .init(code: "vault.not_found", message: "Vault directory does not exist: \(path)")
    }

    public static func vaultNotDirectory(_ path: String) -> ConceptError {
        .init(code: "vault.not_directory", message: "Vault path is not a directory: \(path)")
    }

    public static func pageNotFound(_ path: String) -> ConceptError {
        .init(code: "page.not_found", message: "No page file at path: \(path)")
    }

    public static func databaseNotFound(_ slug: String) -> ConceptError {
        .init(code: "database.not_found", message: "No database with slug '\(slug)' in .concept/databases/")
    }

    public static func invalidDatabase(_ slug: String, cause: String) -> ConceptError {
        .init(code: "database.invalid", message: "Database '\(slug)' is invalid: \(cause)")
    }

    public static func invalidPath(_ path: String, cause: String) -> ConceptError {
        .init(code: "path.invalid", message: "Refusing to use path '\(path)': \(cause)")
    }

    public static func writeFailed(_ path: String, cause: String) -> ConceptError {
        .init(code: "write.failed", message: "Could not write '\(path)': \(cause)")
    }

    public static func readFailed(_ path: String, cause: String) -> ConceptError {
        .init(code: "read.failed", message: "Could not read '\(path)': \(cause)")
    }

    public static func gitMissing() -> ConceptError {
        .init(code: "git.missing", message: "/usr/bin/git was not found on this system")
    }

    public static func gitFailed(_ command: String, status: Int32, stderr: String) -> ConceptError {
        .init(code: "git.command_failed",
              message: "git \(command) exited with status \(status): \(stderr.trimmingCharacters(in: .whitespacesAndNewlines))")
    }

    public static func gitNoRemote() -> ConceptError {
        .init(code: "git.no_remote", message: "Sync is enabled but no remote URL is configured")
    }

    public static func syncConflict(_ files: [String]) -> ConceptError {
        .init(code: "sync.conflict",
              message: "Pull conflicts on \(files.count) file(s); local versions were preserved as *.conflict-*.md copies")
    }

    public static func keychain(_ cause: String) -> ConceptError {
        .init(code: "keychain.failed", message: "Keychain operation failed: \(cause)")
    }

    public static func server(_ status: Int, code: String, message: String) -> ConceptError {
        .init(code: "server.\(code)", message: "HTTP \(status): \(message)")
    }

    public static func badResponse(_ cause: String) -> ConceptError {
        .init(code: "server.bad_response", message: "Server returned an undecodable response: \(cause)")
    }
}
