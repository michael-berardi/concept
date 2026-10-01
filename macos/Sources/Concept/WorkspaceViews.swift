import SwiftUI
import ConceptKit
import UniformTypeIdentifiers

// MARK: - Sidebar (page tree + databases)

struct WorkspaceSidebar: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 1) {
                quickRow("Search", icon: .search, shortcut: "⌘O") { model.showQuickSwitcher = true }
                quickRow("Home", icon: .doc, shortcut: nil, active: model.selectedPage == nil && model.selectedDatabase == nil && !model.showGraph) {
                    model.selectedPage = nil; model.selectedDatabase = nil; model.showGraph = false
                }
                quickRow("Graph", icon: .graph, shortcut: "⌘G", active: model.showGraph) {
                    model.graphScope = model.selectedPage == nil ? .global : .local
                    model.showGraph.toggle()
                }
            }
            .padding(.horizontal, 8)
            .padding(.top, 10)
            ScrollView {
                VStack(alignment: .leading, spacing: 1) {
                    ForEach(model.databases, id: \.slug) { db in
                        DatabaseRow(db: db)
                    }
                    if !model.databases.isEmpty { Color.clear.frame(height: 8) }
                    if let snapshot = model.snapshot {
                        PageTree(pages: snapshot.pages, level: 0)
                    }
                    Button { model.newPage(title: "Untitled") } label: {
                        HStack(spacing: 6) {
                            Icon(name: .plus, size: 13)
                            Text("New page").font(AppFont.small)
                        }
                        .foregroundStyle(theme.textTertiary)
                        .padding(.horizontal, 6).padding(.vertical, 5)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 8)
                .padding(.top, 6)
            }
            Hairline()
            HStack {
                Menu {
                    ForEach(DatabaseTemplateProvider.all) { template in
                        Button(template.name) { model.newDatabase(from: template) }
                    }
                } label: {
                    HStack(spacing: 6) {
                        Icon(name: .database, size: 13)
                        Text("New database").font(AppFont.small)
                    }
                    .foregroundStyle(theme.textSecondary)
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
                Spacer()
            }
            .padding(.horizontal, 14).padding(.vertical, 8)
        }
        .frame(minWidth: 220, idealWidth: 236, maxWidth: 260)
        .background(theme.surface)
    }

    private func quickRow(_ title: String, icon: Icon.Name, shortcut: String?, active: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Icon(name: icon, size: 13)
                Text(title).font(AppFont.small)
                Spacer()
                if let shortcut { Text(shortcut).font(AppFont.micro).foregroundStyle(theme.textTertiary) }
            }
            .foregroundStyle(active ? theme.text : theme.textSecondary)
            .padding(.horizontal, 6).padding(.vertical, 5)
            .background(RoundedRectangle(cornerRadius: 5).fill(active ? theme.selection : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

struct SectionLabel: View {
    @Environment(\.theme) private var theme
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 10.5, weight: .medium))
            .tracking(0.8)
            .foregroundStyle(theme.textTertiary)
            .padding(.bottom, 4)
            .padding(.top, 2)
    }
}

struct PageTree: View {
    @Environment(AppModel.self) private var model
    let pages: [PageRef]
    let level: Int

    var body: some View {
        let roots = pages.filter { $0.parentPath == nil }.sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
        ForEach(roots, id: \.path) { page in
            PageRow(page: page)
            PageChildren(page: page, pages: pages)
        }
    }
}

struct PageChildren: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    let page: PageRef
    let pages: [PageRef]
    @State private var expanded = false

    var children: [PageRef] {
        pages.filter { $0.parentPath == page.path }
            .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
    }

    var body: some View {
        if !children.isEmpty {
            Button {
                expanded.toggle()
            } label: {
                HStack(spacing: 4) {
                    Icon(name: expanded ? .chevronDown : .chevronRight, size: 11)
                        .padding(.leading, CGFloat(pageDepth * 12) + 14)
                    Text(children.count == 1 ? "1 subpage" : "\(children.count) subpages")
                        .font(AppFont.micro)
                        .foregroundStyle(theme.textTertiary)
                    Spacer()
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if expanded {
                ForEach(children, id: \.path) { child in
                    PageRow(page: child)
                    PageChildren(page: child, pages: pages)
                }
            }
        }
    }

    private var pageDepth: Int {
        var depth = 0
        var current: PageRef? = page
        while let p = current?.parentPath, let parent = pages.first(where: { $0.path == p }) {
            depth += 1
            current = parent
        }
        return depth
    }
}

struct PageRow: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    let page: PageRef

    private var depth: Int {
        var d = 0
        var current = page
        while let parentPath = current.parentPath, let parent = model.snapshot?.pages.first(where: { $0.path == parentPath }) {
            d += 1
            current = parent
        }
        return d
    }

    var body: some View {
        Button {
            model.open(path: page.path)
            if model.mode == .board { model.mode = .workspace }
        } label: {
            HStack(spacing: 6) {
                Icon(name: .page, size: 13)
                    .padding(.leading, CGFloat(depth * 12))
                Text(page.icon ?? "")
                    .font(AppFont.small)
                    .frame(width: page.icon == nil ? 0 : nil)
                Text(page.title)
                    .font(AppFont.small)
                    .lineLimit(1)
                Spacer()
            }
            .foregroundStyle(model.selectedPage == page.path ? theme.text : theme.textSecondary)
            .padding(.horizontal, 6)
            .padding(.vertical, 3.5)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 4).fill(model.selectedPage == page.path ? theme.selection : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("Delete", role: .destructive) { model.delete(path: page.path) }
        }
    }
}

struct DatabaseRow: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    let db: Database

    var body: some View {
        Button {
            model.selectedDatabase = db.slug
            if model.mode == .workspace {
                model.selectedPage = nil
                model.showGraph = false
            }
        } label: {
            HStack(spacing: 6) {
                Icon(name: .database, size: 13)
                Text(db.name).font(AppFont.small).lineLimit(1)
                Spacer()
                Badge(text: db.recordType, color: theme.textTertiary)
            }
            .foregroundStyle(model.selectedDatabase == db.slug && (model.mode == .board || model.selectedPage == nil) ? theme.text : theme.textSecondary)
            .padding(.horizontal, 6)
            .padding(.vertical, 3.5)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 4).fill(model.selectedDatabase == db.slug && (model.mode == .board || model.selectedPage == nil) ? theme.selection : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Page editor

struct PageEditorView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    let path: String
    @State private var title = ""
    @State private var saveTask: Task<Void, Never>?
    @FocusState private var titleFocus: Bool

    private var doc: FrontmatterDocument? { try? model.vault?.readDocument(relativePath: path) }
    private static let hidden: Set<String> = ["title", "type", "rank", "created", "updated", "archived", "cover"]

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    TextField("Untitled", text: $title)
                        .textFieldStyle(.plain)
                        .font(.system(size: 38, weight: .bold))
                        .tracking(-0.8)
                        .foregroundStyle(theme.text)
                        .focused($titleFocus)
                        .onSubmit { model.rename(path: path, to: title) }
                        .padding(.bottom, 14)
                    propertiesBlock
                    if model.readingMode {
                        MarkdownView(body_text: model.draft(for: path)) { target in
                            if let resolved = model.index?.resolve(target) { model.open(path: resolved) }
                        }
                    } else {
                        TextEditor(text: Binding(
                            get: { model.draft(for: path) },
                            set: { newValue in
                                model.setDraft(newValue, for: path)
                                scheduleSave()
                            }))
                            .font(AppFont.mono(13))
                            .scrollContentBackground(.hidden)
                            .colorScheme(model.theme.isDark ? .dark : .light)
                            .frame(minHeight: 420)
                    }
                }
                .padding(.horizontal, 48)
                .padding(.top, 28)
                .padding(.bottom, 120)
                .frame(maxWidth: 800, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
        }
        .background(theme.canvas)
        .onAppear {
            title = currentTitle
            DispatchQueue.main.async { titleFocus = false }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { titleFocus = false }
        }
        .onChange(of: path) { _, _ in title = currentTitle }
        .onDisappear { model.saveDraft(for: path) }
    }

    private var currentTitle: String {
        doc?.string("title") ?? ((path as NSString).lastPathComponent as NSString).deletingPathExtension
    }

    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 800_000_000)
            if !Task.isCancelled { model.saveDraft(for: path) }
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            let parts = path.replacingOccurrences(of: ".md", with: "").split(separator: "/").map(String.init).filter { $0 != "Pages" }
            ForEach(Array(parts.dropLast().enumerated()), id: \.offset) { _, part in
                Text(part).font(AppFont.small).foregroundStyle(theme.textTertiary)
                Icon(name: .chevronRight, size: 9, color: theme.textTertiary)
            }
            Text(parts.last ?? "").font(AppFont.small).foregroundStyle(theme.textSecondary).lineLimit(1)
            Spacer()
            if path.hasPrefix("Data/") {
                Button("Open card") { model.openCard(path: path) }
                    .buttonStyle(.plain).font(AppFont.small).foregroundStyle(theme.accent)
            }
            HStack(spacing: 0) {
                modeButton("Source", active: !model.readingMode) { model.readingMode = false }
                modeButton("Reading", active: model.readingMode) { model.readingMode = true }
            }
            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(theme.hairline, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 6))
            Button { model.showRightPanel.toggle() } label: {
                Icon(name: .columns, size: 14, color: model.showRightPanel ? theme.text : theme.textTertiary)
            }
            .buttonStyle(.plain)
            .help("Side panel (⌥⌘B)")
        }
        .padding(.horizontal, 20)
        .frame(height: 38)
        .overlay(alignment: .bottom) { Hairline() }
    }

    @ViewBuilder
    private var propertiesBlock: some View {
        let rows = (doc?.entries ?? []).filter { !Self.hidden.contains($0.key) && $0.key != FrontmatterDocument.commentKey }
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, entry in
                    HStack(alignment: .firstTextBaseline, spacing: 0) {
                        Text(entry.key)
                            .font(AppFont.small)
                            .foregroundStyle(theme.textTertiary)
                            .frame(width: 140, alignment: .leading)
                        Text(entry.value.displayString.replacingOccurrences(of: "[[", with: "").replacingOccurrences(of: "]]", with: ""))
                            .font(AppFont.small)
                            .foregroundStyle(theme.text)
                            .textSelection(.enabled)
                        Spacer()
                    }
                    .frame(minHeight: 30)
                }
            }
            .padding(.bottom, 14)
            .overlay(alignment: .bottom) { Hairline() }
            .padding(.bottom, 20)
        }
    }

    private func modeButton(_ label: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(AppFont.small)
                .foregroundStyle(active ? theme.text : theme.textSecondary)
                .padding(.horizontal, 11)
                .padding(.vertical, 4)
                .background(active ? theme.surfaceRaised : .clear)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Board (drag and drop)

struct BoardView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    let databaseSlug: String

    var database: Database? { model.database(slug: databaseSlug) }

    var body: some View {
        VStack(spacing: 0) {
            BoardHeader(databaseSlug: databaseSlug)
            Hairline()
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(database?.statusOptions ?? [], id: \.id) { option in
                        BoardColumn(databaseSlug: databaseSlug, status: option)
                    }
                    Spacer(minLength: 0)
                }
                .padding(16)
            }
        }
        .background(theme.canvas)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct BoardHeader: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    let databaseSlug: String

    var body: some View {
        HStack(spacing: 10) {
            if let db = model.database(slug: databaseSlug) {
                Text(db.name).font(AppFont.heading).foregroundStyle(theme.text)
                Badge(text: "\(model.records(databaseSlug: databaseSlug).count) cards", color: theme.textTertiary)
            }
            Spacer()
            Menu {
                ForEach(DatabaseTemplateProvider.all) { t in
                    Button(t.name) { model.newDatabase(from: t) }
                }
            } label: {
                HStack(spacing: 5) {
                    Icon(name: .plus, size: 12)
                    Text("New database").font(AppFont.small)
                }
                .foregroundStyle(theme.textSecondary)
            }
            .menuStyle(.borderlessButton)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}

struct BoardColumn: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    let databaseSlug: String
    let status: PropertyOption

    private var cards: [Record] {
        model.records(databaseSlug: databaseSlug).filter { $0.status == status.id && !$0.archived }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Circle().fill(statusColor(status.id, theme: theme)).frame(width: 7, height: 7)
                Text(status.id).font(AppFont.small).foregroundStyle(theme.text)
                Text("\(cards.count)").font(AppFont.micro).foregroundStyle(theme.textTertiary)
                Spacer()
                Menu {
                    Button("New card") { model.newRecord(databaseSlug: databaseSlug, title: "") }
                } label: {
                    Icon(name: .plus, size: 13)
                }
                .menuStyle(.borderlessButton)
                .frame(width: 18)
            }
            .padding(.horizontal, 2)

            ForEach(cards, id: \.path) { card in
                BoardCard(databaseSlug: databaseSlug, card: card)
            }

            Spacer(minLength: 8)

            Text("")
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
                .onDropCard { provider in
                    appendDropped(provider)
                }
        }
        .frame(width: 252)
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 8).fill(theme.surface))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(theme.hairline, lineWidth: 1))
    }

    /// Drops onto the column background append at the end of the column.
    private func appendDropped(_ provider: NSItemProvider) -> Bool {
        provider.loadObject(ofClass: NSString.self) { object, _ in
            guard let path = object as? String else { return }
            let last = cards.last?.path
            Task { @MainActor in
                model.moveCard(path: path, databaseSlug: databaseSlug, status: status.id,
                               afterID: last, beforeID: nil)
            }
        }
        return true
    }
}

struct BoardCard: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    let databaseSlug: String
    let card: Record
    @State private var dragging = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(card.title)
                .font(AppFont.small.weight(.medium))
                .foregroundStyle(theme.text)
                .lineLimit(3)
                .multilineTextAlignment(.leading)
            if !(card.properties["tags"]?.asStringArray ?? []).isEmpty {
                HStack(spacing: 4) {
                    ForEach(card.properties["tags"]?.asStringArray ?? [], id: \.self) { tag in
                        Badge(text: tag, color: theme.accent)
                    }
                }
            }
            HStack(spacing: 8) {
                if let owner = card.properties["owner"]?.asString {
                    HStack(spacing: 3) {
                        Icon(name: .person, size: 11)
                        Text(owner).font(AppFont.micro)
                    }
                    .foregroundStyle(theme.textSecondary)
                }
                if let due = card.properties["due"]?.asString {
                    HStack(spacing: 3) {
                        Icon(name: .calendar, size: 11)
                        Text(due).font(AppFont.micro)
                    }
                    .foregroundStyle(theme.textSecondary)
                }
                Spacer()
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 6).fill(theme.surfaceRaised))
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(theme.hairline, lineWidth: 1))
        .opacity(dragging ? 0.5 : 1)
        .contentShape(Rectangle())
        .onTapGesture { model.openCard(path: card.path) }
        .onDrag {
            dragging = true
            return NSItemProvider(object: card.path as NSString)
        }
        .onDrop(of: [UTType.plainText], delegate: CardDropDelegate(
            databaseSlug: databaseSlug, target: card, model: model))
        .onHover { hovering in
            if !hovering { dragging = false }
        }
        .contextMenu {
            Button("Open as card") { model.openCard(path: card.path) }
            Button("Open as Page") {
                model.mode = .workspace
                model.open(path: card.path)
            }
            Button("Archive") {
                model.updateRecord(card.path, properties: ["archived": .bool(true)])
            }
        }
    }
}

/// Drop target on a card: inserts the dragged card *before* this one.
struct CardDropDelegate: DropDelegate {
    let databaseSlug: String
    let target: Record
    let model: AppModel

    func validateDrop(info: DropInfo) -> Bool {
        info.hasItemsConforming(to: [UTType.plainText.identifier])
    }

    func performDrop(info: DropInfo) -> Bool {
        guard let provider = info.itemProviders(for: [UTType.plainText]).first else { return false }
        _ = provider.loadObject(ofClass: NSString.self) { object, _ in
            guard let path = object as? String else { return }
            Task { @MainActor in
                model.insertDropped(path: path, databaseSlug: databaseSlug, before: target)
            }
        }
        return true
    }

    func dropEntered(info: DropInfo) {}
}

extension AppModel {
    /// Places `path` immediately before `target` (or appends when target is last
    /// in its column and there is no explicit neighbour). Called from drop handlers.
    @MainActor
    func insertDropped(path: String, databaseSlug: String, before target: Record) {
        let column = records(databaseSlug: databaseSlug)
            .filter { $0.status == target.status && !$0.archived }
        let idx = column.firstIndex(where: { $0.path == target.path })
        let after: Record? = idx.flatMap { $0 > 0 ? column[$0 - 1] : nil }
        moveCard(path: path, databaseSlug: databaseSlug, status: target.status,
                 afterID: after?.path, beforeID: target.path)
    }
}

extension View {
    /// Convenience drop handler used by the column background.
    func onDropCard(_ handler: @escaping (NSItemProvider) -> Bool) -> some View {
        onDrop(of: [UTType.plainText], isTargeted: nil) { providers in
            guard let p = providers.first else { return false }
            return handler(p)
        }
    }
}

// MARK: - Table view

struct TableView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    let databaseSlug: String

    var body: some View {
        VStack(spacing: 0) {
            BoardHeader(databaseSlug: databaseSlug)
            Hairline()
            let db = model.database(slug: databaseSlug)
            let visible = db?.properties.filter { p in
                p.type != .title && (db?.views.first(where: { $0.id == "table" })?.visible == nil || true)
                    && !["rank", "archived", "type"].contains(p.key)
            } ?? []
            ScrollView([.horizontal, .vertical]) {
                VStack(spacing: 0) {
                    HStack(spacing: 0) {
                        TableCellHeader(text: "Name", width: 220)
                        ForEach(visible, id: \.key) { prop in
                            TableCellHeader(text: prop.name, width: prop.type == .text ? 220 : 120)
                        }
                    }
                    Hairline()
                    ForEach(model.records(databaseSlug: databaseSlug).filter { !$0.archived }, id: \.path) { record in
                        HStack(spacing: 0) {
                            TableCell(width: 220) {
                                Button { model.openCard(path: record.path) } label: {
                                    Text(record.title)
                                        .font(AppFont.small)
                                        .foregroundStyle(theme.text)
                                        .lineLimit(1)
                                }
                                .buttonStyle(.plain)
                            }
                            ForEach(visible, id: \.key) { prop in
                                TableCell(width: prop.type == .text ? 220 : 120) {
                                    RecordPropertyValue(record: record, property: prop)
                                }
                            }
                        }
                        .background(model.selectedFile == record.path ? theme.selection : .clear)
                        .contentShape(Rectangle())
                        .onTapGesture { model.selectedFile = record.path }
                        Hairline()
                    }
                }
            }
        }
        .background(theme.canvas)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct TableCellHeader: View {
    @Environment(\.theme) private var theme
    let text: String
    let width: CGFloat
    var body: some View {
        Text(text)
            .font(AppFont.micro.weight(.medium))
            .foregroundStyle(theme.textTertiary)
            .frame(width: width, height: 30, alignment: .leading)
            .padding(.horizontal, 10)
            .background(theme.surface)
    }
}

struct TableCell<Content: View>: View {
    let width: CGFloat
    @ViewBuilder let content: () -> Content
    var body: some View {
        content()
            .frame(width: width, alignment: .leading)
            .frame(minHeight: 34, alignment: .leading)
            .padding(.horizontal, 10)
    }
}

/// Inline-editable property cell; writes through to the file on commit.
struct RecordPropertyValue: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    let record: Record
    let property: Property
    @State private var text: String = ""
    @State private var loaded = false

    var body: some View {
        Group {
            switch property.type {
            case .status, .select:
                Menu {
                    ForEach(property.options ?? [], id: \.id) { option in
                        Button(option.id) {
                            model.updateRecord(record.path, properties: [property.key: .string(option.id)])
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Circle().fill(statusColor(text, theme: theme)).frame(width: 6, height: 6)
                        Text(text).font(AppFont.small).foregroundStyle(theme.textSecondary)
                    }
                }
                .menuStyle(.borderlessButton)
            case .date:
                TextField("", text: $text, prompt: Text("yyyy-mm-dd").font(AppFont.small).foregroundStyle(theme.textTertiary))
                    .font(AppFont.small)
                    .textFieldStyle(.plain)
                    .onSubmit(commit)
            case .number:
                TextField("", text: $text)
                    .font(AppFont.small)
                    .textFieldStyle(.plain)
                    .onSubmit(commit)
            case .checkbox:
                Toggle("", isOn: Binding(
                    get: { record.properties[property.key]?.asBool ?? false },
                    set: { model.updateRecord(record.path, properties: [property.key: .bool($0)]) }))
                    .toggleStyle(.checkbox)
                    .labelsHidden()
            default:
                TextField("", text: $text)
                    .font(AppFont.small)
                    .textFieldStyle(.plain)
                    .onSubmit(commit)
            }
        }
        .foregroundStyle(theme.textSecondary)
        .onAppear {
            if !loaded {
                text = record.properties[property.key]?.asString ?? ""
                loaded = true
            }
        }
        .onChange(of: record.contentHash) { _, _ in
            text = record.properties[property.key]?.asString ?? ""
        }
    }

    private func commit() {
        let value: FrontmatterValue
        switch property.type {
        case .number:
            if let int = Int(text) { value = .int(int) }
            else if let double = Double(text) { value = .double(double) }
            else { value = .string(text) }
        default:
            value = .string(text)
        }
        model.updateRecord(record.path, properties: [property.key: value])
    }
}

// MARK: - Card sheet

struct CardSheet: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    let path: String
    @Environment(\.dismiss) private var dismiss
    @State private var bodyText: String = ""
    @State private var loaded = false

    var record: Record? {
        model.records(databaseSlug: databaseSlug).first(where: { $0.path == path })
    }

    var databaseSlug: String {
        path.split(separator: "/").count > 1 ? String(path.split(separator: "/")[1]) : ""
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Hairline()
            if let record, let db = model.database(slug: databaseSlug) {
                HSplitView {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 14) {
                            propertyRows(record: record, db: db)
                            checklist(record: record)
                        }
                        .padding(18)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(minWidth: 380)
                    ScrollView {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Description").font(AppFont.micro.weight(.medium)).foregroundStyle(theme.textTertiary)
                            TextEditor(text: $bodyText)
                                .font(AppFont.mono(12.5))
                                .frame(minHeight: 220)
                                .scrollContentBackground(.hidden)
                                .colorScheme(model.theme.isDark ? .dark : .light)
                                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(theme.hairline, lineWidth: 1))
                            HStack {
                                Spacer()
                                Button("Save") {
                                    model.updateRecord(path, properties: [:], body: bodyText)
                                }
                                .buttonStyle(.borderedProminent)
                                .tint(theme.accent)
                            }
                        }
                        .padding(18)
                    }
                    .frame(minWidth: 380)
                }
            } else {
                Text("Card not found: \(path)").foregroundStyle(theme.textSecondary).padding()
            }
        }
        .background(theme.canvas)
        .frame(width: 820, height: 560)
        .onAppear {
            if !loaded, let doc = try? model.vault?.readDocument(relativePath: path) {
                bodyText = doc.body
                loaded = true
            }
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Icon(name: .database, size: 15)
            Text(record?.title ?? path).font(AppFont.heading).foregroundStyle(theme.text).lineLimit(1)
            if let type = record?.recordType { Badge(text: type, color: theme.textTertiary) }
            Spacer()
            Button {
                dismiss()
            } label: {
                Icon(name: .close, size: 15)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 12)
    }

    @ViewBuilder
    private func propertyRows(record: Record, db: Database) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Properties").font(AppFont.micro.weight(.medium)).foregroundStyle(theme.textTertiary)
            ForEach(db.properties.filter { !["rank", "type", "title"].contains($0.key) }, id: \.key) { prop in
                HStack(alignment: .center) {
                    Text(prop.name)
                        .font(AppFont.small)
                        .foregroundStyle(theme.textTertiary)
                        .frame(width: 92, alignment: .leading)
                    CardPropertyEditor(record: record, property: prop)
                }
            }
        }
    }

    /// Markdown task lists in the body rendered as an interactive checklist.
    @ViewBuilder
    private func checklist(record: Record) -> some View {
        let items = Self.taskLines(in: bodyText)
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text("Checklist").font(AppFont.micro.weight(.medium)).foregroundStyle(theme.textTertiary)
                ForEach(items, id: \.offset) { item in
                    Button {
                        bodyText = Self.toggling(line: item.offset, in: bodyText)
                    } label: {
                        HStack(spacing: 8) {
                            MarkdownView.ToggleTask(checked: item.checked)
                            Text(item.text)
                                .font(AppFont.small)
                                .foregroundStyle(item.checked ? theme.textSecondary : theme.text)
                                .strikethrough(item.checked, color: theme.textTertiary)
                            Spacer()
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                Text("Toggles update the Markdown task list (saved with Description).")
                    .font(AppFont.micro)
                    .foregroundStyle(theme.textTertiary)
            }
        }
    }

    static func taskLines(in text: String) -> [(offset: Int, checked: Bool, text: String)] {
        text.components(separatedBy: "\n").enumerated().compactMap { index, line in
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("- [ ] ") {
                return (index, false, String(trimmed.dropFirst(6)))
            }
            if trimmed.hasPrefix("- [x] ") || trimmed.hasPrefix("- [X] ") {
                return (index, true, String(trimmed.dropFirst(6)))
            }
            return nil
        }
    }

    static func toggling(line target: Int, in text: String) -> String {
        var lines = text.components(separatedBy: "\n")
        guard lines.indices.contains(target) else { return text }
        let trimmed = lines[target].trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix("- [ ] ") {
            lines[target] = lines[target].replacingOccurrences(of: "- [ ] ", with: "- [x] ")
        } else if trimmed.hasPrefix("- [x] ") {
            lines[target] = lines[target].replacingOccurrences(of: "- [x] ", with: "- [ ] ")
        } else if trimmed.hasPrefix("- [X] ") {
            lines[target] = lines[target].replacingOccurrences(of: "- [X] ", with: "- [ ] ")
        }
        return lines.joined(separator: "\n")
    }
}

/// Editor for one property row inside the card sheet.
struct CardPropertyEditor: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    let record: Record
    let property: Property
    @State private var text = ""

    var body: some View {
        switch property.type {
        case .status, .select:
            Menu {
                ForEach(property.options ?? [], id: \.id) { option in
                    Button(option.id) {
                        model.updateRecord(record.path, properties: [property.key: .string(option.id)])
                    }
                }
            } label: {
                HStack(spacing: 5) {
                    Circle().fill(statusColor(record.properties[property.key]?.asString ?? "", theme: theme))
                        .frame(width: 7, height: 7)
                    Text(record.properties[property.key]?.asString ?? "—").font(AppFont.small)
                }
                .foregroundStyle(theme.text)
            }
            .menuStyle(.borderlessButton)
        case .multiSelect:
            TagEditor(tags: record.properties[property.key]?.asStringArray ?? []) { tags in
                model.updateRecord(record.path, properties: [property.key: .array(tags.map { .string($0) })])
            }
        case .date:
            DatePicker("", selection: Binding(
                get: {
                    record.properties[property.key]?.asString.flatMap { Self.parseDate($0) } ?? Date()
                },
                set: { model.updateRecord(record.path, properties: [property.key: .string(Self.format($0))]) }),
                displayedComponents: .date)
                .labelsHidden()
                .datePickerStyle(.field)
        case .checkbox:
            Toggle("", isOn: Binding(
                get: { record.properties[property.key]?.asBool ?? false },
                set: { model.updateRecord(record.path, properties: [property.key: .bool($0)]) }))
                .toggleStyle(.switch)
                .labelsHidden()
                .controlSize(.small)
        default:
            TextField(property.name, text: $text)
                .font(AppFont.small)
                .textFieldStyle(.plain)
                .padding(.vertical, 3)
                .padding(.horizontal, 6)
                .background(RoundedRectangle(cornerRadius: 4).fill(theme.surfaceRaised))
                .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(theme.hairline, lineWidth: 1))
                .onAppear { text = record.properties[property.key]?.asString ?? "" }
                .onSubmit { model.updateRecord(record.path, properties: [property.key: .string(text)]) }
        }
    }

    static func parseDate(_ string: String) -> Date? {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: string)
    }

    static func format(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}

/// Labels editor: comma-separated quiet list.
struct TagEditor: View {
    @Environment(\.theme) private var theme
    let tags: [String]
    let onChange: ([String]) -> Void
    @State private var draft: String = ""
    @State private var seeded = false

    var body: some View {
        TextField("labels, comma separated", text: $draft)
            .font(AppFont.small)
            .textFieldStyle(.plain)
            .padding(.vertical, 3)
            .padding(.horizontal, 6)
            .background(RoundedRectangle(cornerRadius: 4).fill(theme.surfaceRaised))
            .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(theme.hairline, lineWidth: 1))
            .onAppear { draft = tags.joined(separator: ", ") }
            .onSubmit {
                let parsed = draft.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
                onChange(parsed)
            }
    }
}

// MARK: - CRM home (pipeline overview)

struct CRMHomeView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model

    var deals: (database: Database, records: [Record])? {
        guard let db = model.database(slug: "deals") else { return nil }
        return (db, model.records(databaseSlug: "deals").filter { !$0.archived })
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("CRM overview").font(AppFont.title).foregroundStyle(theme.text)
                if let deals {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Pipeline value by stage").font(AppFont.small).foregroundStyle(theme.textSecondary)
                        ForEach(deals.database.statusOptions, id: \.id) { option in
                            let cards = deals.records.filter { $0.status == option.id }
                            let total = cards.reduce(0) { $0 + ($1.properties["value"]?.asInt ?? 0) }
                            HStack(spacing: 10) {
                                Text(option.id).font(AppFont.small).foregroundStyle(theme.text)
                                    .frame(width: 92, alignment: .leading)
                                GeometryReader { geo in
                                    ZStack(alignment: .leading) {
                                        RoundedRectangle(cornerRadius: 3).fill(theme.surfaceRaised)
                                        RoundedRectangle(cornerRadius: 3)
                                            .fill(statusColor(option.id, theme: theme).opacity(0.8))
                                            .frame(width: barWidth(total, in: geo.size.width))
                                    }
                                }
                                .frame(height: 14)
                                Text(Self.money(total))
                                    .font(AppFont.small.monospacedDigit())
                                    .foregroundStyle(theme.textSecondary)
                                    .frame(width: 96, alignment: .trailing)
                            }
                        }
                    }
                    .padding(16)
                    .background(RoundedRectangle(cornerRadius: 8).fill(theme.surface))
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(theme.hairline, lineWidth: 1))

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Upcoming follow-ups (by due date)").font(AppFont.small).foregroundStyle(theme.textSecondary)
                        let upcoming = deals.records
                            .compactMap { record -> (Record, String)? in
                                guard let due = record.properties["due"]?.asString else { return nil }
                                return (record, due)
                            }
                            .sorted { $0.1 < $1.1 }
                            .prefix(8)
                        ForEach(Array(upcoming), id: \.0.path) { record, due in
                            HStack {
                                Button { model.openCard(path: record.path) } label: {
                                    Text(record.title).font(AppFont.small).foregroundStyle(theme.text)
                                }
                                .buttonStyle(.plain)
                                Spacer()
                                Text(due).font(AppFont.small.monospacedDigit()).foregroundStyle(theme.textSecondary)
                            }
                            .padding(.vertical, 2)
                        }
                        if upcoming.isEmpty {
                            Text("No dated deals yet — add a due date to a card.").font(AppFont.small).foregroundStyle(theme.textTertiary)
                        }
                    }
                    .padding(16)
                    .background(RoundedRectangle(cornerRadius: 8).fill(theme.surface))
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(theme.hairline, lineWidth: 1))
                } else {
                    Text("No 'deals' database in this vault. Create one from the sidebar: New database → Deals.")
                        .font(AppFont.small).foregroundStyle(theme.textSecondary)
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(theme.canvas)
    }

    private func stageTotals() -> [Int] {
        guard let deals else { return [] }
        return deals.database.statusOptions.map { option in
            let cards = deals.records.filter { $0.status == option.id }
            let values = cards.map { $0.properties["value"]?.asInt ?? 0 }
            return values.reduce(0, +)
        }
    }

    private func barWidth(_ total: Int, in width: CGFloat) -> CGFloat {
        let totals = stageTotals()
        let maxTotal = max(1, totals.max() ?? 1)
        let scale = CGFloat(total) / CGFloat(maxTotal)
        return max(4, scale * (width - 8))
    }

    static func money(_ value: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }
}
