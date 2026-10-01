import SwiftUI
import ConceptKit

@main
struct ConceptApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup("Concept", id: "main") {
            RootView()
                .environment(model)
                .frame(minWidth: 980, minHeight: 620)
                .environment(\.theme, model.theme)
        }
        .windowStyle(.automatic)
        .defaultSize(width: 1320, height: 820)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Page") { model.newPage(title: "Untitled") }
                    .keyboardShortcut("n", modifiers: .command)
            }
            CommandMenu("Go") {
                Button("Quick Switcher…") { model.showQuickSwitcher = true }
                    .keyboardShortcut("o", modifiers: .command)
                Button("Search…") { model.showQuickSwitcher = true }
                    .keyboardShortcut("k", modifiers: .command)
                Divider()
                Button("Workspace") { model.mode = .workspace }
                    .keyboardShortcut("1", modifiers: .command)
                Button("Board") { model.mode = .board }
                    .keyboardShortcut("2", modifiers: .command)
                Button("Graph") { model.mode = .workspace; model.showGraph.toggle() }
                    .keyboardShortcut("g", modifiers: .command)
                Button("Toggle Side Panel") { model.showRightPanel.toggle() }
                    .keyboardShortcut("b", modifiers: [.command, .option])
                Button("Toggle Source / Reading") { model.readingMode.toggle() }
                    .keyboardShortcut("e", modifiers: .command)
            }
            CommandMenu("Vault") {
                Button("Save Current File") {
                    if let path = model.activePath { model.saveDraft(for: path) }
                }
                .keyboardShortcut("s", modifiers: .command)
                Divider()
                Button("Sync Now") { model.syncNow() }
                    .keyboardShortcut("r", modifiers: [.command, .shift])
                Divider()
                Button("Open Card for Selection") {
                    if let path = model.activePath, path.hasPrefix("Data/") {
                        model.openCard(path: path)
                    }
                }
                .keyboardShortcut(.return, modifiers: .command)
            }
            CommandMenu("Theme") {
                ForEach(Theme.all, id: \.name) { theme in
                    Button(theme.name) { model.themeName = theme.name }
                        .keyboardShortcut(KeyEquivalent(Character(String(theme.name.prefix(1)).lowercased())),
                                          modifiers: [.command, .shift])
                }
            }
        }
        .windowToolbarStyle(.unified)
    }
}

// MARK: - Root

struct RootView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    @State private var showSyncSettings = false
    @State private var showNewVault = false

    var body: some View {
        if model.vault == nil {
            VaultPickerView(showNewVault: $showNewVault)
        } else {
            VStack(spacing: 0) {
                TopBar(showSyncSettings: $showSyncSettings, showNewVault: $showNewVault)
                Hairline()
                HStack(spacing: 0) {
                    switch model.mode {
                    case .workspace:
                        WorkspaceSidebar()
                    case .board:
                        BoardSidebar()
                    }
                    Hairline(horizontal: false)
                    VStack(spacing: 0) {
                        if model.mode == .workspace && !model.openTabs.isEmpty {
                            TabBar()
                            Hairline()
                        }
                        content
                    }
                    Hairline(horizontal: false)
                    if model.mode == .workspace && model.showRightPanel && model.selectedPage != nil && !model.showGraph {
                        Inspector()
                    }
                }
                if let error = model.lastError {
                    ErrorBar(code: error.code, message: error.message)
                }
            }
            .overlay {
                if model.showQuickSwitcher {
                    ZStack {
                        Color.black.opacity(0.35)
                            .onTapGesture { model.showQuickSwitcher = false }
                        QuickSwitcher()
                    }
                }
            }
            .sheet(item: Binding(
                get: { model.cardSheet.map(CardItem.init) },
                set: { model.cardSheet = $0?.path })) { item in
                CardSheet(path: item.path)
            }
            .sheet(isPresented: $showSyncSettings) {
                SyncSettingsView()
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.mode {
        case .workspace:
            if model.showGraph {
                GraphView()
            } else if let db = model.selectedDatabase, model.selectedPage == nil {
                TableView(databaseSlug: db)
            } else if let path = model.selectedPage {
                PageEditorView(path: path)
            } else {
                CRMHomeView()
            }
        case .board:
            if let db = model.selectedDatabase {
                BoardView(databaseSlug: db)
            } else {
                EmptyState(icon: .board, title: "No database selected",
                           detail: "Pick a database in the sidebar or create one from a template.")
            }
        }
    }
}

// Board sidebar lists databases only (the board lens).
struct BoardSidebar: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 2) {
                SectionLabel("Databases")
                ForEach(model.databases, id: \.slug) { db in
                    DatabaseRow(db: db)
                }
            }
            .padding(10)
        }
        .frame(minWidth: 212, idealWidth: 224, maxWidth: 250)
        .background(themeSurface)
    }

    private var themeSurface: Color { Theme.named(model.themeName).surface }
}

// MARK: - Top bar

struct TopBar: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    @Binding var showSyncSettings: Bool
    @Binding var showNewVault: Bool

    var body: some View {
        HStack(spacing: 12) {
            Menu {
                Button("Open Vault…") { pickVault() }
                Button("New Vault…") { showNewVault = true }
                Divider()
                ForEach(AppModel.recentVaults().prefix(5), id: \.self) { recent in
                    Button((recent as NSString).lastPathComponent) {
                        model.openVault(at: URL(fileURLWithPath: recent))
                    }
                }
            } label: {
                HStack(spacing: 6) {
                    Icon(name: .vault, size: 14, color: theme.text)
                    Text(model.vaultName).font(AppFont.small).foregroundStyle(theme.text)
                }
            }
            .menuStyle(.borderlessButton)
            .fixedSize()

            Picker("", selection: Binding(
                get: { model.mode },
                set: { model.mode = $0 })) {
                ForEach(AppModel.Mode.allCases) { mode in
                    Text(mode.rawValue).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(width: 280)

            Spacer()

            Button {
                model.showQuickSwitcher = true
            } label: {
                HStack(spacing: 6) {
                    Icon(name: .search, size: 13)
                    Text("Search").font(AppFont.small)
                    Text("⌘O").font(AppFont.micro).foregroundStyle(theme.textTertiary)
                }
                .foregroundStyle(theme.textSecondary)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(RoundedRectangle(cornerRadius: 6).fill(theme.surfaceRaised))
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(theme.hairline, lineWidth: 1))
            }
            .buttonStyle(.plain)

            SyncPill(showSettings: $showSyncSettings)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(theme.surface)
    }

    private func pickVault() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.message = "Choose a vault folder (a folder of Markdown files)"
        if panel.runModal() == .OK, let url = panel.url {
            model.openVault(at: url)
        }
    }
}

struct SyncPill: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    @Binding var showSettings: Bool

    var body: some View {
        HStack(spacing: 8) {
            switch model.syncState {
            case .idle:
                Icon(name: .sync, size: 13)
                Text("Sync").font(AppFont.small)
            case .syncing:
                ProgressView().controlSize(.small)
                Text("Syncing…").font(AppFont.small)
            case .ok(let detail):
                Icon(name: .syncDone, size: 13, color: Color(hex: "#57b581"))
                Text(detail).font(AppFont.small)
            case .failed(let code, let message):
                Icon(name: .close, size: 13, color: Color(hex: "#d86b6b"))
                Text(message).font(AppFont.small).lineLimit(1)
                    .help("[\(code)] \(message)")
            }
            Button {
                model.syncNow()
            } label: {
                Text("Sync now").font(AppFont.small)
            }
            .buttonStyle(.borderless)
            Button {
                showSettings = true
            } label: {
                Icon(name: .settings, size: 14)
            }
            .buttonStyle(.borderless)
        }
        .foregroundStyle(theme.textSecondary)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(RoundedRectangle(cornerRadius: 6).fill(theme.surfaceRaised))
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(theme.hairline, lineWidth: 1))
        .help("Git sync: commit, pull --rebase, push. Conflicts are preserved as *.conflict-*.md copies.")
    }
}

struct ErrorBar: View {
    @Environment(\.theme) private var theme
    let code: String
    let message: String
    var body: some View {
        HStack(spacing: 8) {
            Icon(name: .close, size: 12, color: Color(hex: "#d86b6b"))
            Text("[\(code)] \(message)")
                .font(AppFont.small)
                .foregroundStyle(theme.text)
                .lineLimit(2)
            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 7)
        .background(theme.surfaceRaised)
    }
}

struct EmptyState: View {
    @Environment(\.theme) private var theme
    let icon: Icon.Name
    let title: String
    let detail: String

    var body: some View {
        VStack(spacing: 10) {
            Icon(name: icon, size: 28, color: theme.textTertiary)
            Text(title).font(AppFont.heading).foregroundStyle(theme.text)
            Text(detail).font(AppFont.small).foregroundStyle(theme.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.canvas)
    }
}

// MARK: - Vault picker

struct VaultPickerView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    @Binding var showNewVault: Bool

    var body: some View {
        VStack(spacing: 22) {
            Icon(name: .vault, size: 40, color: theme.textSecondary)
            VStack(spacing: 6) {
                Text("Concept").font(.system(size: 26, weight: .semibold)).foregroundStyle(theme.text)
                Text("Your workspace is a folder of Markdown files.")
                    .font(AppFont.base)
                    .foregroundStyle(theme.textSecondary)
            }
            HStack(spacing: 12) {
                Button {
                    let panel = NSOpenPanel()
                    panel.canChooseDirectories = true
                    panel.canChooseFiles = false
                    if panel.runModal() == .OK, let url = panel.url {
                        model.openVault(at: url)
                    }
                } label: {
                    Text("Open Vault…").frame(minWidth: 120)
                }
                .keyboardShortcut(.defaultAction)
                Button {
                    showNewVault = true
                } label: {
                    Text("Create New…").frame(minWidth: 120)
                }
            }
            if let error = model.lastError {
                Text("[\(error.code)] \(error.message)")
                    .font(AppFont.small)
                    .foregroundStyle(Color(hex: "#d86b6b"))
            }
            let recents = AppModel.recentVaults()
            if !recents.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    SectionLabel("Recent vaults")
                    ForEach(recents.prefix(5), id: \.self) { recent in
                        Button {
                            model.openVault(at: URL(fileURLWithPath: recent))
                        } label: {
                            HStack(spacing: 6) {
                                Icon(name: .vault, size: 12)
                                Text(recent).font(AppFont.small).foregroundStyle(theme.textSecondary)
                                Spacer()
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .frame(width: 380)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.canvas)
        .sheet(isPresented: $showNewVault) {
            NewVaultSheet()
        }
    }
}

struct NewVaultSheet: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var template = "crm"
    @State private var folderURL: URL?
    @State private var error: ConceptError?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Create a vault").font(AppFont.heading).foregroundStyle(theme.text)
            LabeledRow("Name") {
                TextField("My workspace", text: $name)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 280)
            }
            LabeledRow("Template") {
                Picker("", selection: $template) {
                    Text("CRM starter (Companies, Contacts, Deals, Activities)").tag("crm")
                    Text("Blank").tag("blank")
                }
                .labelsHidden()
                .frame(width: 360)
            }
            LabeledRow("Folder") {
                HStack {
                    Text(folderURL?.path ?? "Choose…").font(AppFont.small).foregroundStyle(theme.textSecondary).lineLimit(1)
                    Button("Choose…") {
                        let panel = NSOpenPanel()
                        panel.canChooseDirectories = true
                        panel.canChooseFiles = false
                        panel.canCreateDirectories = true
                        if panel.runModal() == .OK { folderURL = panel.url }
                    }
                }
            }
            if let error {
                Text("[\(error.code)] \(error.message)").font(AppFont.small).foregroundStyle(Color(hex: "#d86b6b"))
            }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Create") {
                    guard let folderURL else { return }
                    let target = folderURL.appendingPathComponent(name.isEmpty ? "Vault" : name)
                    switch AppModel.createVault(at: target, name: name.isEmpty ? "Vault" : name,
                                                template: template == "crm" ? .crm : .blank) {
                    case .success(let vault):
                        model.openVault(at: vault.url)
                        dismiss()
                    case .failure(let failure):
                        error = failure
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(folderURL == nil)
            }
        }
        .padding(20)
        .frame(width: 560)
        .background(theme.surface)
    }
}

struct LabeledRow<Content: View>: View {
    @Environment(\.theme) private var theme
    let label: String
    @ViewBuilder let content: () -> Content
    init(_ label: String, @ViewBuilder content: @escaping () -> Content) {
        self.label = label
        self.content = content
    }
    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Text(label).font(AppFont.small).foregroundStyle(theme.textTertiary).frame(width: 60, alignment: .trailing)
            content()
        }
    }
}

// MARK: - Sync settings

struct SyncSettingsView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var remoteUrl = ""
    @State private var branch = "main"
    @State private var token = ""
    @State private var enabled = false
    @State private var loaded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Git sync").font(AppFont.heading).foregroundStyle(theme.text)
            Text("Concept commits your changes, runs pull --rebase and pushes. Conflicts keep both sides: the losing version is saved as <name>.conflict-<timestamp>.md.")
                .font(AppFont.small)
                .foregroundStyle(theme.textSecondary)
            LabeledRow("Remote") {
                TextField("https://git.example.com/team/vault.git", text: $remoteUrl)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 380)
            }
            LabeledRow("Branch") {
                TextField("main", text: $branch)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 140)
            }
            LabeledRow("Token") {
                SecureField("cpt_… or access token (stored in Keychain)", text: $token)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 380)
            }
            LabeledRow("Enabled") {
                Toggle("", isOn: $enabled).labelsHidden()
            }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Save") {
                    model.setSync(remoteUrl: remoteUrl, branch: branch, enabled: enabled,
                                  token: token.isEmpty ? nil : token)
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 560)
        .background(theme.surface)
        .onAppear {
            if !loaded {
                remoteUrl = model.syncSettings?.remoteUrl ?? ""
                branch = model.syncSettings?.branch ?? "main"
                enabled = model.syncSettings?.enabled ?? false
                loaded = true
            }
        }
    }
}
