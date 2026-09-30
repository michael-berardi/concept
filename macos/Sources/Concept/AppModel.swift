import SwiftUI
import ConceptKit

/// One open editor tab.
struct OpenTab: Equatable, Identifiable {
    let path: String
    var id: String { path }
}

/// A card opened as a sheet (Identifiable wrapper over the record path).
struct CardItem: Identifiable, Equatable {
    let path: String
    var id: String { path }
    init(_ path: String) { self.path = path }
}

/// Application state. Everything UI-facing lives here on the main actor.
@MainActor
@Observable
final class AppModel {
    enum Mode: String, CaseIterable, Identifiable {
        case workspace = "Workspace"
        case vault = "Vault"
        case board = "Board"
        var id: String { rawValue }
    }

    // Vault
    private(set) var vault: Vault?
    private(set) var snapshot: VaultSnapshot?
    private(set) var index: VaultIndex?
    private var watcher: VaultWatcher?

    // Layout state
    var mode: Mode = .workspace
    var selectedDatabase: String?
    var selectedPage: String?
    var selectedFile: String?
    var openTabs: [OpenTab] = []
    var activeTab: String?
    var readingMode = false
    var showGraph = false
    var showInspector = true
    var showQuickSwitcher = false
    var cardSheet: String?
    var graphScope: GraphScope = .local

    enum GraphScope: String, CaseIterable, Identifiable {
        case local, global
        var id: String { rawValue }
    }

    // Editor drafts (unsaved text keyed by path); written with ⌘S.
    var drafts: [String: String] = [:]

    // Sync
    enum SyncState: Equatable {
        case idle
        case syncing
        case ok(detail: String)
        case failed(code: String, message: String)
    }
    private(set) var syncState: SyncState = .idle
    private(set) var syncSettings: Vault.SyncSettings?

    var themeName: String {
        didSet {
            UserDefaults.standard.set(themeName, forKey: "themeName")
        }
    }
    var theme: Theme { Theme.named(themeName) }

    var lastError: (code: String, message: String)?

    init() {
        themeName = UserDefaults.standard.string(forKey: "themeName") ?? Theme.oled.name
        let environment = ProcessInfo.processInfo.environment
        // Environment seeds are used by scripts and visual checks to open the
        // app in a known state (vault, mode, overlays).
        if let env = environment["CONCEPT_VAULT"], !env.isEmpty {
            openVault(at: URL(fileURLWithPath: env))
        } else if let recent = Self.recentVaults().first {
            openVault(at: URL(fileURLWithPath: recent))
        }
        switch environment["CONCEPT_MODE"] {
        case "vault": mode = .vault
        case "board": mode = .board
        default: break
        }
        if let db = environment["CONCEPT_DATABASE"] { selectedDatabase = db }
        if environment["CONCEPT_SWITCHER"] == "1" { showQuickSwitcher = true }
        if environment["CONCEPT_GRAPH"] == "1" { mode = .vault; showGraph = true }
        if let path = environment["CONCEPT_CARD"], !path.isEmpty {
            cardSheet = path
        }
    }

    // MARK: - Recents

    static func recentVaults() -> [String] {
        UserDefaults.standard.stringArray(forKey: "recentVaults") ?? []
    }

    private func rememberVault(_ url: URL) {
        var recents = Self.recentVaults().filter { $0 != url.path }
        recents.insert(url.path, at: 0)
        UserDefaults.standard.set(Array(recents.prefix(8)), forKey: "recentVaults")
    }

    // MARK: - Open / rescan

    var vaultName: String {
        vault?.workspaceInfo()?.name ?? vault?.url.lastPathComponent ?? ""
    }

    func openVault(at url: URL) {
        do {
            let vault = try Vault(url: url)
            self.vault = vault
            rescan()
            selectedPage = snapshot?.pages.first?.path
            selectedFile = snapshot?.pages.first?.path
            openTabs.removeAll()
            activeTab = nil
            if let first = snapshot?.pages.first?.path {
                open(path: first)
            }
            syncSettings = vault.syncSettings()
            syncState = .idle
            startWatching()
            rememberVault(url)
        } catch let error as ConceptError {
            lastError = (error.code, error.message)
        } catch {
            lastError = ("vault.open_failed", String(describing: error))
        }
    }

    static func createVault(at url: URL, name: String, template: Vault.Template) -> Result<Vault, ConceptError> {
        do {
            return .success(try Vault.create(at: url, name: name, template: template))
        } catch let error as ConceptError {
            return .failure(error)
        } catch {
            return .failure(ConceptError(code: "vault.create_failed", message: String(describing: error)))
        }
    }

    func rescan() {
        guard let vault else { return }
        do {
            let snapshot = try vault.scan()
            self.snapshot = snapshot
            self.index = VaultIndexBuilder.build(vault: vault, snapshot: snapshot)
            // Drop drafts/tabs for files that disappeared.
            let paths = Set(snapshot.files.map(\.path))
            openTabs.removeAll { !paths.contains($0.path) }
            drafts = drafts.filter { paths.contains($0.key) }
            if let active = activeTab, !paths.contains(active) {
                activeTab = openTabs.first?.path
            }
        } catch let error as ConceptError {
            lastError = (error.code, error.message)
        } catch {
            lastError = ("vault.scan_failed", String(describing: error))
        }
    }

    private func startWatching() {
        guard let vault else { return }
        watcher?.stop()
        let newWatcher = VaultWatcher(url: vault.url)
        newWatcher.onEvent = { [weak self] in
            self?.rescan()
        }
        newWatcher.onError = { [weak self] message in
            self?.lastError = ("watch.failed", message)
        }
        newWatcher.start()
        watcher = newWatcher
    }

    // MARK: - Tabs & selection

    func open(path: String) {
        if !openTabs.contains(where: { $0.path == path }) {
            openTabs.append(OpenTab(path: path))
        }
        activeTab = path
        selectedPage = path
        selectedFile = path
    }

    func closeTab(_ path: String) {
        openTabs.removeAll { $0.path == path }
        if activeTab == path {
            activeTab = openTabs.last?.path
        }
    }

    func openCard(path: String) {
        cardSheet = path
    }

    // MARK: - Page & record actions

    var activePath: String? {
        mode == .vault ? (activeTab ?? selectedFile) : (selectedPage ?? activeTab)
    }

    func draft(for path: String) -> String {
        if let d = drafts[path] { return d }
        guard let vault, let doc = try? vault.readDocument(relativePath: path) else { return "" }
        return doc.body
    }

    func setDraft(_ text: String, for path: String) {
        drafts[path] = text
    }

    @discardableResult
    func saveDraft(for path: String) -> Bool {
        guard let vault, let text = drafts[path] else { return false }
        do {
            var doc = try vault.readDocument(relativePath: path)
            doc.body = text
            try vault.writeDocument(relativePath: path, document: doc)
            drafts.removeValue(forKey: path)
            rescan()
            return true
        } catch let error as ConceptError {
            lastError = (error.code, error.message)
            return false
        } catch {
            lastError = ("page.save_failed", String(describing: error))
            return false
        }
    }

    func newPage(title: String) {
        guard let vault else { return }
        do {
            let page = try vault.createPage(title: title.isEmpty ? "Untitled" : title)
            rescan()
            open(path: page.path)
        } catch let error as ConceptError {
            lastError = (error.code, error.message)
        } catch {
            lastError = ("page.create_failed", String(describing: error))
        }
    }

    func newRecord(databaseSlug: String, title: String) {
        guard let vault else { return }
        do {
            let record = try vault.createRecord(databaseSlug: databaseSlug,
                                                properties: ["title": .string(title.isEmpty ? "Untitled" : title)])
            rescan()
            openCard(path: record.path)
        } catch let error as ConceptError {
            lastError = (error.code, error.message)
        } catch {
            lastError = ("record.create_failed", String(describing: error))
        }
    }

    func newDatabase(from template: DatabaseTemplateProvider.Template) {
        guard let vault else { return }
        do {
            try vault.writeDatabase(template.database)
            rescan()
            selectedDatabase = template.slug
            mode = .board
        } catch let error as ConceptError {
            lastError = (error.code, error.message)
        } catch {
            lastError = ("database.create_failed", String(describing: error))
        }
    }

    func delete(path: String) {
        guard let vault else { return }
        do {
            try vault.deleteToTrash(relativePath: path)
            closeTab(path)
            if selectedPage == path { selectedPage = nil }
            rescan()
        } catch let error as ConceptError {
            lastError = (error.code, error.message)
        } catch {
            lastError = ("path.delete_failed", String(describing: error))
        }
    }

    func updateRecord(_ path: String, properties: [String: FrontmatterValue], body: String? = nil) {
        guard let vault else { return }
        do {
            _ = try vault.updateRecord(relativePath: path, properties: properties, body: body)
            rescan()
        } catch let error as ConceptError {
            lastError = (error.code, error.message)
        } catch {
            lastError = ("record.update_failed", String(describing: error))
        }
    }

    /// Board drag: place `path` between neighbours in `status`.
    func moveCard(path: String, databaseSlug: String, status: String, afterID: String?, beforeID: String?) {
        guard let vault else { return }
        do {
            _ = try vault.moveRecord(relativePath: path, databaseSlug: databaseSlug,
                                     status: status, afterID: afterID, beforeID: beforeID)
            rescan()
        } catch let error as ConceptError {
            lastError = (error.code, error.message)
        } catch {
            lastError = ("record.move_failed", String(describing: error))
        }
    }

    func records(databaseSlug: String) -> [Record] {
        guard let vault else { return [] }
        return (try? vault.records(databaseSlug: databaseSlug)) ?? []
    }

    func database(slug: String) -> Database? {
        try? vault?.database(slug: slug)
    }

    var databases: [Database] {
        vault?.databases() ?? []
    }

    // MARK: - Sync

    func setSync(remoteUrl: String, branch: String, enabled: Bool, token: String?) {
        guard let vault else { return }
        do {
            let settings = Vault.SyncSettings(remoteUrl: remoteUrl, branch: branch, enabled: enabled)
            try vault.writeSyncSettings(enabled && !remoteUrl.isEmpty ? settings : nil)
            try KeychainStore.setToken(token, for: vault.url)
            syncSettings = vault.syncSettings()
            syncState = .ok(detail: "Settings saved")
        } catch let error as ConceptError {
            syncState = .failed(code: error.code, message: error.message)
        } catch {
            syncState = .failed(code: "sync.save_failed", message: String(describing: error))
        }
    }

    func syncNow() {
        guard let vault else { return }
        guard let settings = syncSettings, settings.enabled, !settings.remoteUrl.isEmpty else {
            syncState = .failed(code: "sync.not_configured",
                                message: "No sync remote configured. Add a remote URL in Settings.")
            return
        }
        syncState = .syncing
        let url = vault.url
        let remote = settings.remoteUrl
        let branch = settings.branch
        let token = KeychainStore.token(for: url)
        Task.detached(priority: .userInitiated) { [weak self] in
            do {
                let outcome = try GitSync.sync(url, remoteUrl: remote, branch: branch, token: token,
                                               message: "sync from Concept",
                                               authorName: "Concept", authorEmail: "concept@local")
                let conflicts = outcome.conflictFiles
                await MainActor.run { [weak self] in
                    self?.rescan()
                    if conflicts.isEmpty {
                        self?.syncState = .ok(detail: "Synced \(Self.clockTime())")
                    } else {
                        self?.syncState = .failed(code: "sync.conflict",
                            message: "Conflicts preserved as copies: \(conflicts.joined(separator: ", "))")
                    }
                }
            } catch let error as ConceptError {
                await MainActor.run { [weak self] in
                    self?.syncState = .failed(code: error.code, message: error.message)
                }
            } catch {
                await MainActor.run { [weak self] in
                    self?.syncState = .failed(code: "sync.failed", message: String(describing: error))
                }
            }
        }
    }

    nonisolated private static func clockTime() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: Date())
    }
}

/// Template choices for the "New database" flow.
enum DatabaseTemplateProvider {
    struct Template: Identifiable {
        let slug: String
        let name: String
        let database: Database
        var id: String { slug }
    }

    static let all: [Template] = DatabaseTemplate.all.map {
        Template(slug: $0.slug, name: $0.name, database: $0)
    }
}
