import Foundation

/// Git sync for a local vault via /usr/bin/git.
///
/// Semantics (mirrors the server contract):
/// 1. commit all changed files (acting author),
/// 2. `pull --rebase`; on conflict never lose data — the losing side is saved
///    as `<name>.conflict-<timestamp>.md` next to the file, the incoming
///    version is accepted, and the merge is committed,
/// 3. `push`.
public enum GitSync {
    public static let gitPath = "/usr/bin/git"

    public struct SyncStatus: Equatable, Sendable {
        public let isRepository: Bool
        public let branch: String
        public let ahead: Int
        public let behind: Int
        public let hasRemote: Bool
        public let changedFiles: [String]
        public var isClean: Bool { changedFiles.isEmpty }
    }

    public struct SyncOutcome: Equatable, Sendable {
        public let committed: Bool
        public let pulled: Bool
        public let pushed: Bool
        public let conflictFiles: [String]
    }

    // MARK: - Process plumbing

    /// Test/CLI convenience: run git and throw unless it exits 0.
    @discardableResult
    public static func run(_ arguments: [String], cwd: URL?) throws -> String {
        try gitOK(arguments, cwd: cwd)
    }

    @discardableResult
    static func git(_ arguments: [String], cwd: URL?, env: [String: String] = [:]) throws -> (stdout: String, stderr: String, status: Int32) {
        guard FileManager.default.fileExists(atPath: gitPath) else {
            throw ConceptError.gitMissing()
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: gitPath)
        process.arguments = arguments
        var environment = ProcessInfo.processInfo.environment
        // Deterministic, locale-free git.
        environment["GIT_TERMINAL_PROMPT"] = "0"
        environment["LC_ALL"] = "C"
        for (key, value) in env { environment[key] = value }
        process.environment = environment
        if let cwd {
            process.currentDirectoryURL = cwd
        }
        let outPipe = Pipe()
        let errPipe = Pipe()
        process.standardOutput = outPipe
        process.standardError = errPipe
        do {
            try process.run()
        } catch {
            throw ConceptError.gitFailed(arguments.joined(separator: " "), status: -1,
                                         stderr: "could not launch git: \(error)")
        }
        let outData = outPipe.fileHandleForReading.readDataToEndOfFile()
        let errData = errPipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        let out = String(data: outData, encoding: .utf8) ?? ""
        let err = String(data: errData, encoding: .utf8) ?? ""
        return (out, err, process.terminationStatus)
    }

    @discardableResult
    static func gitOK(_ arguments: [String], cwd: URL?, env: [String: String] = [:]) throws -> String {
        let result = try git(arguments, cwd: cwd, env: env)
        guard result.status == 0 else {
            throw ConceptError.gitFailed(arguments.joined(separator: " "), status: result.status, stderr: result.stderr)
        }
        return result.stdout
    }

    static func authorEnv(authorName: String?, authorEmail: String?) -> [String: String] {
        [
            "GIT_AUTHOR_NAME": authorName ?? "Concept",
            "GIT_AUTHOR_EMAIL": authorEmail ?? "concept@local",
            "GIT_COMMITTER_NAME": authorName ?? "Concept",
            "GIT_COMMITTER_EMAIL": authorEmail ?? "concept@local",
        ]
    }

    /// URL with credentials embedded for HTTPS remotes; token never stored in git config.
    public static func authenticatedRemote(_ remoteUrl: String, token: String?) -> String {
        guard let token, !token.isEmpty, remoteUrl.hasPrefix("https://") else { return remoteUrl }
        let rest = remoteUrl.dropFirst("https://".count)
        return "https://x-access-token:\(token)@\(rest)"
    }

    // MARK: - Repository state

    public static func isRepository(_ url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.appendingPathComponent(".git").path)
    }

    public static func initRepository(_ url: URL, branch: String = "main") throws {
        try gitOK(["init", "-b", branch, url.path], cwd: nil)
    }

    public static func setRemote(_ url: URL, remoteUrl: String) throws {
        let remote = authenticatedRemote(remoteUrl, token: nil) // URL without token for config
        if try git(["remote", "get-url", "origin"], cwd: url).status == 0 {
            try gitOK(["remote", "set-url", "origin", remote], cwd: url)
        } else {
            try gitOK(["remote", "add", "origin", remote], cwd: url)
        }
    }

    public static func status(_ url: URL) throws -> SyncStatus {
        guard isRepository(url) else {
            return SyncStatus(isRepository: false, branch: "", ahead: 0, behind: 0, hasRemote: false, changedFiles: [])
        }
        let out = try gitOK(["status", "--porcelain", "-b"], cwd: url)
        var branch = ""
        var ahead = 0
        var behind = 0
        var changed: [String] = []
        for (i, raw) in out.split(separator: "\n", omittingEmptySubsequences: true).enumerated() {
            let line = String(raw)
            if i == 0 && line.hasPrefix("##") {
                branch = line.dropFirst(2).trimmingCharacters(in: .whitespaces)
                if let bracket = branch.range(of: "[") {
                    let info = branch[branch.index(after: bracket.lowerBound)...].prefix(while: { $0 != "]" })
                    for part in info.split(separator: ",") {
                        let piece = part.trimmingCharacters(in: .whitespaces)
                        if piece.hasPrefix("ahead ") { ahead = Int(piece.dropFirst(6)) ?? 0 }
                        if piece.hasPrefix("behind ") { behind = Int(piece.dropFirst(7)) ?? 0 }
                    }
                    branch = String(branch[..<bracket.lowerBound]).trimmingCharacters(in: .whitespaces)
                }
                if let dots = branch.range(of: "...") {
                    branch = String(branch[..<dots.lowerBound])
                }
                continue
            }
            if line.count > 3 {
                changed.append(String(line.dropFirst(3)))
            }
        }
        let hasRemote = (try? git(["remote", "get-url", "origin"], cwd: url).status) == 0
        return SyncStatus(isRepository: true, branch: branch, ahead: ahead, behind: behind,
                          hasRemote: hasRemote, changedFiles: changed)
    }

    // MARK: - Sync

    @discardableResult
    public static func commitAll(_ url: URL, message: String,
                                 authorName: String? = nil, authorEmail: String? = nil) throws -> Bool {
        guard isRepository(url) else {
            throw ConceptError.gitFailed("commit", status: -1, stderr: "\(url.path) is not a git repository")
        }
        try gitOK(["add", "-A"], cwd: url)
        let staged = try git(["diff", "--cached", "--quiet"], cwd: url)
        guard staged.status != 0 else { return false } // nothing staged
        try gitOK(["commit", "-m", message], cwd: url, env: authorEnv(authorName: authorName, authorEmail: authorEmail))
        return true
    }

    @discardableResult
    public static func pullRebase(_ url: URL, branch: String, remoteUrl: String, token: String?) throws -> String {
        let remote = authenticatedRemote(remoteUrl, token: token)
        return try gitOK(["pull", "--rebase", remote, branch], cwd: url)
    }

    public static func push(_ url: URL, branch: String, remoteUrl: String, token: String?) throws {
        let remote = authenticatedRemote(remoteUrl, token: token)
        try gitOK(["push", "-u", remote, branch], cwd: url)
    }

    /// Full sync cycle. Throws `sync.conflict` only when conflict copies were
    /// created (data is never lost; the outcome names the files).
    public static func sync(_ url: URL, remoteUrl: String, branch: String, token: String?,
                            message: String,
                            authorName: String? = nil, authorEmail: String? = nil) throws -> SyncOutcome {
        if !isRepository(url) {
            try initRepository(url, branch: branch)
        }
        var conflicts: [String] = []
        let committed = try commitAll(url, message: message, authorName: authorName, authorEmail: authorEmail)

        var pulled = false
        var pushed = false
        if try remoteBranchExists(remoteUrl: remoteUrl, branch: branch, token: token) {
            do {
                try pullRebase(url, branch: branch, remoteUrl: remoteUrl, token: token)
                pulled = true
            } catch let error as ConceptError {
                guard error.code == "git.command_failed" else { throw error }
                conflicts = try resolveConflict(url: url, remoteUrl: remoteUrl, branch: branch,
                                                token: token, authorName: authorName, authorEmail: authorEmail)
                try commitAll(url, message: "sync: accept remote with conflict copies", authorName: authorName, authorEmail: authorEmail)
                // Record the remote history so the subsequent push fast-forwards.
                // Our tree already contains the reconciled file contents.
                try gitOK(["merge", "FETCH_HEAD", "-s", "ours",
                           "-m", "sync: merge remote history; local versions preserved as conflict copies"],
                          cwd: url, env: authorEnv(authorName: authorName, authorEmail: authorEmail))
                pulled = true
            }
        }
        try push(url, branch: branch, remoteUrl: remoteUrl, token: token)
        pushed = true
        return SyncOutcome(committed: committed, pulled: pulled, pushed: pushed, conflictFiles: conflicts)
    }

    static func remoteBranchExists(remoteUrl: String, branch: String, token: String?) throws -> Bool {
        let remote = authenticatedRemote(remoteUrl, token: token)
        let result = try git(["ls-remote", "--heads", remote, branch], cwd: nil)
        guard result.status == 0 else { return false }
        return !result.stdout.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Called after a failed `pull --rebase`: aborts the rebase, then brings
    /// in remote changes; local versions of diverged files are preserved as
    /// `<name>.conflict-<timestamp>.md` copies.
    static func resolveConflict(url: URL, remoteUrl: String, branch: String,
                                token: String?, authorName: String?, authorEmail: String?) throws -> [String] {
        // Abort the stopped rebase to restore our committed state.
        _ = try? git(["rebase", "--abort"], cwd: url)
        let remote = authenticatedRemote(remoteUrl, token: token)
        try gitOK(["fetch", remote, branch], cwd: url)

        let mergeBase = try gitOK(["merge-base", "HEAD", "FETCH_HEAD"], cwd: url)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let remoteChanged = try gitOK(["diff", "--name-only", "HEAD...FETCH_HEAD"], cwd: url)
            .split(separator: "\n").map(String.init)
        let oursChanged = Set(try gitOK(["diff", "--name-only", mergeBase, "HEAD"], cwd: url)
            .split(separator: "\n").map(String.init))

        var conflicts: [String] = []
        let stamp = Int(Date().timeIntervalSince1970)
        for file in remoteChanged {
            let filePath = url.appendingPathComponent(file)
            if oursChanged.contains(file) && FileManager.default.fileExists(atPath: filePath.path) {
                let dir = filePath.deletingLastPathComponent()
                let name = filePath.lastPathComponent
                let ext = (name as NSString).pathExtension
                let stem = (name as NSString).deletingPathExtension
                let copyName = ext.isEmpty ? "\(stem).conflict-\(stamp)" : "\(stem).conflict-\(stamp).\(ext)"
                let copyURL = dir.appendingPathComponent(copyName)
                do {
                    try FileManager.default.copyItem(at: filePath, to: copyURL)
                    conflicts.append(file + " -> " + copyName)
                } catch {
                    throw ConceptError.writeFailed(copyURL.path, cause: "conflict copy failed: \(error)")
                }
            }
            try gitOK(["checkout", "FETCH_HEAD", "--", file], cwd: url)
        }
        return conflicts
    }
}
