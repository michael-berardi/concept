import SwiftUI
import ConceptKit

// MARK: - File tree (every file on disk, quiet gray)

struct VaultFileTree: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                SectionLabel("Files")
                if let files = model.snapshot?.files.filter({ $0.isDirectory && $0.path != "" }) {
                    ForEach(files, id: \.path) { dir in
                        DirectoryRow(path: dir.path)
                    }
                }
                // Loose files at the root.
                if let rootFiles = model.snapshot?.files.filter({ !$0.isDirectory && !$0.path.contains("/") }) {
                    ForEach(rootFiles, id: \.path) { file in
                        FileRow(path: file.path, depth: 0)
                    }
                }
            }
            .padding(10)
        }
        .frame(minWidth: 212, idealWidth: 224, maxWidth: 250)
        .background(theme.surface)
    }
}

struct DirectoryRow: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    let path: String
    @State private var expanded = true

    private var name: String { (path as NSString).lastPathComponent }
    private var depth: Int { path.split(separator: "/").count - 1 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                expanded.toggle()
            } label: {
                HStack(spacing: 4) {
                    Icon(name: expanded ? .chevronDown : .chevronRight, size: 10)
                        .padding(.leading, CGFloat(depth * 12))
                    Icon(name: .vault, size: 13)
                    Text(name).font(AppFont.small).foregroundStyle(theme.textSecondary).lineLimit(1)
                    Spacer()
                }
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if expanded {
                let children = (model.snapshot?.files ?? []).filter {
                    !$0.isDirectory && $0.path.hasPrefix(path + "/") &&
                    ($0.path as NSString).deletingLastPathComponent == path
                }
                ForEach(children, id: \.path) { child in
                    FileRow(path: child.path, depth: depth + 1)
                }
                let subdirs = (model.snapshot?.files ?? []).filter {
                    $0.isDirectory && $0.path != "" && ($0.path as NSString).deletingLastPathComponent == path
                }
                ForEach(subdirs, id: \.path) { sub in
                    DirectoryRow(path: sub.path)
                }
            }
        }
    }
}

struct FileRow: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    let path: String
    let depth: Int

    private var isSelected: Bool { model.activeTab == path || (model.mode == .vault && model.selectedFile == path) }

    var body: some View {
        let isRecord = path.hasPrefix("Data/")
        Button {
            model.open(path: path)
        } label: {
            HStack(spacing: 4) {
                Icon(name: isRecord ? .database : .doc, size: 12)
                    .padding(.leading, CGFloat(depth * 12))
                Text(((path as NSString).lastPathComponent as NSString).deletingPathExtension)
                    .font(AppFont.small)
                    .foregroundStyle(isSelected ? theme.text : theme.textSecondary.opacity(0.85))
                    .lineLimit(1)
                if isRecord, let record = model.records(databaseSlug: String(path.split(separator: "/")[1]))
                    .first(where: { $0.path == path }) {
                    Badge(text: record.recordType, color: theme.textTertiary)
                }
                Spacer()
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 2.5)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 4).fill(isSelected ? theme.selection : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("Open") { model.open(path: path) }
            Button("Delete", role: .destructive) { model.delete(path: path) }
        }
    }
}

// MARK: - Tabs

struct TabBar: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(spacing: 0) {
            ForEach(model.openTabs) { tab in
                let active = model.activeTab == tab.path
                HStack(spacing: 6) {
                    Icon(name: tab.path.hasPrefix("Data/") ? .database : .doc, size: 11)
                    Text(((tab.path as NSString).lastPathComponent as NSString).deletingPathExtension)
                        .font(AppFont.small)
                        .foregroundStyle(active ? theme.text : theme.textSecondary)
                        .lineLimit(1)
                        .frame(maxWidth: 160)
                    Button {
                        model.closeTab(tab.path)
                    } label: {
                        Icon(name: .close, size: 10, color: theme.textTertiary)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(active ? theme.canvas : .clear)
                .contentShape(Rectangle())
                .onTapGesture { model.activeTab = tab.path }
                .overlay(alignment: .trailing) { Hairline(horizontal: false) }
            }
            Spacer()
        }
        .background(theme.surface)
    }
}

// MARK: - Vault editor (source + reading)

struct VaultEditorView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    let path: String

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Text(path).font(AppFont.micro).foregroundStyle(theme.textTertiary).lineLimit(1)
                Spacer()
                HStack(spacing: 0) {
                    Button {
                        model.readingMode = false
                    } label: {
                        Text("Source")
                            .font(AppFont.small)
                            .foregroundStyle(!model.readingMode ? theme.text : theme.textSecondary)
                            .padding(.horizontal, 12).padding(.vertical, 5)
                            .background(!model.readingMode ? theme.surfaceRaised : .clear)
                    }
                    .buttonStyle(.plain)
                    Button {
                        model.readingMode = true
                    } label: {
                        Text("Reading")
                            .font(AppFont.small)
                            .foregroundStyle(model.readingMode ? theme.text : theme.textSecondary)
                            .padding(.horizontal, 12).padding(.vertical, 5)
                            .background(model.readingMode ? theme.surfaceRaised : .clear)
                    }
                    .buttonStyle(.plain)
                }
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(theme.hairline, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                Button {
                    model.showGraph.toggle()
                } label: {
                    HStack(spacing: 5) {
                        Icon(name: .graph, size: 13)
                        Text("Graph").font(AppFont.small)
                    }
                    .foregroundStyle(model.showGraph ? theme.accent : theme.textSecondary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(RoundedRectangle(cornerRadius: 6).fill(model.showGraph ? theme.selection : .clear))
                    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(theme.hairline, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            Hairline()
            if model.readingMode {
                ScrollView {
                    MarkdownView(body_text: model.draft(for: path)) { target in
                        if let resolved = model.index?.resolve(target) {
                            model.open(path: resolved)
                        }
                    }
                    .padding(20)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                TextEditor(text: Binding(
                    get: { model.draft(for: path) },
                    set: { model.setDraft($0, for: path) }))
                    .font(AppFont.mono(13))
                    .scrollContentBackground(.hidden)
                    .colorScheme(model.theme.isDark ? .dark : .light)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
            }
            Hairline()
            RetexBadgeBar(path: path)
        }
        .background(theme.canvas)
    }
}

/// Quiet Retex status badges on record files.
struct RetexBadgeBar: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    let path: String

    var body: some View {
        if path.hasPrefix("Data/"),
           let record = model.snapshot?.records.first(where: { $0.path == path }) {
            HStack(spacing: 8) {
                Badge(text: "retex · \(record.recordType)", color: theme.textTertiary)
                Badge(text: record.status, color: statusColor(record.status, theme: theme))
                if !record.rank.isEmpty {
                    Badge(text: "rank \(record.rank)", color: theme.textTertiary)
                }
                if record.archived {
                    Badge(text: "archived", color: theme.textTertiary)
                }
                Spacer()
                Text("contentHash \(String(record.contentHash.prefix(12)))…")
                    .font(AppFont.micro.monospacedDigit())
                    .foregroundStyle(theme.textTertiary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .background(theme.surface)
        }
    }
}

// MARK: - Inspector: properties, backlinks, outgoing, outline, tags

struct VaultInspector: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    @State private var section: InspectorSection = .properties

    enum InspectorSection: String, CaseIterable, Identifiable {
        case properties, links, outline, tags
        var id: String { rawValue }
    }

    var path: String? { model.activeTab ?? model.selectedFile }

    var body: some View {
        VStack(spacing: 0) {
            Picker("", selection: $section) {
                ForEach(InspectorSection.allCases) { s in
                    Text(s.rawValue).tag(s)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(10)
            Hairline()
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    switch section {
                    case .properties: PropertiesPanel(path: path)
                    case .links: LinksPanel(path: path)
                    case .outline: OutlinePanel(path: path)
                    case .tags: TagsPanel()
                    }
                }
                .padding(12)
            }
        }
        .frame(minWidth: 252, idealWidth: 264, maxWidth: 300)
        .background(theme.surface)
    }
}

struct PropertiesPanel: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    let path: String?

    var body: some View {
        if let path, let doc = try? model.vault?.readDocument(relativePath: path) {
            if doc.entries.isEmpty {
                Text("No properties").font(AppFont.small).foregroundStyle(theme.textTertiary)
            }
            ForEach(Array(doc.entries.enumerated()), id: \.offset) { _, entry in
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.key).font(AppFont.micro.weight(.medium)).foregroundStyle(theme.textTertiary)
                    Text(entry.value.displayString)
                        .font(AppFont.small)
                        .foregroundStyle(theme.text)
                        .textSelection(.enabled)
                }
                .padding(.vertical, 3)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else {
            Text("Nothing selected").font(AppFont.small).foregroundStyle(theme.textTertiary)
        }
    }
}

struct LinksPanel: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    let path: String?

    var body: some View {
        if let path {
            let outgoing = model.index?.outgoingLinks(from: path) ?? []
            let backlinks = model.index?.backlinks(to: path) ?? []
            VStack(alignment: .leading, spacing: 8) {
                Text("Outgoing (\(outgoing.count))").font(AppFont.micro.weight(.medium)).foregroundStyle(theme.textTertiary)
                ForEach(Array(outgoing.enumerated()), id: \.offset) { _, link in
                    LinkLine(target: link.target, resolved: model.index?.resolve(link.target))
                }
                if outgoing.isEmpty { Text("—").font(AppFont.small).foregroundStyle(theme.textTertiary) }
                Text("Backlinks (\(backlinks.count))").font(AppFont.micro.weight(.medium)).foregroundStyle(theme.textTertiary).padding(.top, 6)
                ForEach(backlinks, id: \.self) { source in
                    LinkLine(target: source, resolved: source)
                }
                if backlinks.isEmpty { Text("—").font(AppFont.small).foregroundStyle(theme.textTertiary) }
            }
        }
    }
}

struct LinkLine: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    let target: String
    let resolved: String?

    var body: some View {
        Button {
            if let resolved { model.open(path: resolved) }
        } label: {
            HStack(spacing: 5) {
                Icon(name: resolved == nil ? .link : .doc, size: 11)
                Text(target).font(AppFont.small)
                    .foregroundStyle(resolved == nil ? theme.textTertiary : theme.text)
                    .lineLimit(1)
                if resolved == nil { Badge(text: "unresolved", color: theme.textTertiary) }
                Spacer()
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

struct OutlinePanel: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    let path: String?

    var body: some View {
        if let path, let doc = model.index?.document(at: path) {
            if doc.outline.isEmpty {
                Text("No headings").font(AppFont.small).foregroundStyle(theme.textTertiary)
            }
            ForEach(Array(doc.outline.enumerated()), id: \.offset) { _, entry in
                Text(String(repeating: "    ", count: entry.level - 1) + entry.text)
                    .font(AppFont.small)
                    .foregroundStyle(theme.textSecondary)
                    .lineLimit(1)
            }
        }
    }
}

struct TagsPanel: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model

    var body: some View {
        let tagInfos = model.index?.tags() ?? []
        if tagInfos.isEmpty {
            Text("No tags in this vault").font(AppFont.small).foregroundStyle(theme.textTertiary)
        }
        ForEach(tagInfos, id: \.tag) { info in
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 5) {
                    Icon(name: .tag, size: 11)
                    Text("#\(info.tag)").font(AppFont.small).foregroundStyle(theme.text)
                    Text("\(info.paths.count)").font(AppFont.micro).foregroundStyle(theme.textTertiary)
                }
                ForEach(info.paths.prefix(6), id: \.self) { path in
                    Button { model.open(path: path) } label: {
                        Text(((path as NSString).lastPathComponent as NSString).deletingPathExtension)
                            .font(AppFont.micro)
                            .foregroundStyle(theme.textSecondary)
                            .padding(.leading, 16)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, 2)
        }
    }
}

// MARK: - Graph view (Canvas + force layout)

struct GraphView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    @State private var layout: [String: CGPoint] = [:]
    @State private var computeTask: Task<Void, Never>?
    @State private var offset: CGSize = .zero
    @State private var zoom: CGFloat = 1

    var graph: Graph? {
        guard let index = model.index else { return nil }
        switch model.graphScope {
        case .global: return Graph.global(index: index)
        case .local:
            guard let focus = model.activeTab ?? model.selectedFile else {
                return Graph.global(index: index)
            }
            return Graph.local(index: index, path: focus)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Picker("", selection: Binding(
                    get: { model.graphScope },
                    set: { model.graphScope = $0 })) {
                    Text("Local").tag(AppModel.GraphScope.local)
                    Text("Global").tag(AppModel.GraphScope.global)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(width: 160)
                Text("\(graph?.nodes.count ?? 0) notes · \(graph?.edges.count ?? 0) links")
                    .font(AppFont.micro)
                    .foregroundStyle(theme.textTertiary)
                Spacer()
                Button { offset = .zero; zoom = 1 } label: {
                    Text("Reset view").font(AppFont.small).foregroundStyle(theme.textSecondary)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            Hairline()
            Canvas { context, size in
                guard let graph else { return }
                let center = CGPoint(x: size.width / 2, y: size.height / 2)
                // Edges
                context.stroke(Path { p in
                    for edge in graph.edges {
                        guard let a = layout[edge.source], let b = layout[edge.target] else { continue }
                        p.move(to: transform(a, center: center))
                        p.addLine(to: transform(b, center: center))
                    }
                }, with: .color(theme.hairline.opacity(theme.isDark ? 2.2 : 1.4)), lineWidth: 1)
                // Nodes
                for node in graph.nodes {
                    guard let p = layout[node.id] else { continue }
                    let point = transform(p, center: center)
                    let isFocus = node.id == (model.activeTab ?? model.selectedFile)
                    let radius: CGFloat = isFocus ? 7 : node.kind == "page" ? 5 : 4.5
                    let rect = CGRect(x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2)
                    context.fill(Path(ellipseIn: rect),
                                 with: .color(isFocus ? theme.accent : theme.textSecondary.opacity(0.75)))
                    let label = Text(node.title)
                        .font(AppFont.micro)
                        .foregroundStyle(isFocus ? theme.text : theme.textSecondary)
                    context.draw(context.resolve(label), at: CGPoint(x: point.x, y: point.y + radius + 9))
                }
            }
            .background(theme.canvas)
            .clipped()
            .gesture(
                DragGesture()
                    .onChanged { value in offset = value.translation }
                    .onEnded { _ in }
            )
            .gesture(MagnificationGesture().onChanged { value in zoom = max(0.3, min(3, value)) })
            .task(id: graphKey) {
                computeLayout()
            }
            .onChange(of: model.activeTab) { _, _ in computeLayout() }
        }
    }

    private var graphKey: String {
        let scope = model.graphScope.rawValue
        let count = graph?.nodes.count ?? 0
        return scope + "#" + String(count) + "#" + (model.activeTab ?? "")
    }

    private func transform(_ p: CGPoint, center: CGPoint) -> CGPoint {
        CGPoint(x: center.x + (p.x + offset.width) * zoom,
                y: center.y + (p.y + offset.height) * zoom)
    }

    private func computeLayout() {
        computeTask?.cancel()
        guard let graph, !graph.nodes.isEmpty else { layout = [:]; return }
        let nodes = graph.nodes
        let edges = graph.edges
        let scope = model.graphScope
        computeTask = Task {
            let positions = ForceLayout.run(nodes: nodes, edges: edges,
                                            iterations: scope == .global ? 150 : 220)
            if Task.isCancelled { return }
            var map: [String: CGPoint] = [:]
            for (node, point) in zip(nodes, positions) {
                map[node.id] = point
            }
            await MainActor.run { self.layout = map }
        }
    }
}

// MARK: - Quick switcher (⌘O / ⌘K)

struct QuickSwitcher: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    @State private var query = ""
    @State private var selected = 0
    @FocusState private var focused: Bool

    var results: [VaultIndex.SearchHit] {
        guard let index = model.index else { return [] }
        if query.trimmingCharacters(in: .whitespaces).isEmpty {
            return index.documents.sorted { $0.title < $1.title }.prefix(12).map {
                VaultIndex.SearchHit(path: $0.path, title: $0.title, score: 0)
            }
        }
        return index.search(query, limit: 12)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Icon(name: .search, size: 15)
                TextField("Jump to a page or record…", text: $query)
                    .textFieldStyle(.plain)
                    .font(AppFont.base)
                    .focused($focused)
                    .onSubmit { activate(selected) }
            }
            .padding(12)
            Hairline()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(results.enumerated()), id: \.element.path) { index, hit in
                        Button {
                            activate(index)
                        } label: {
                            HStack {
                                Icon(name: hit.path.hasPrefix("Data/") ? .database : .page, size: 12)
                                Text(hit.title).font(AppFont.small).foregroundStyle(theme.text)
                                Spacer()
                                Text(hit.path).font(AppFont.micro).foregroundStyle(theme.textTertiary).lineLimit(1)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .background(index == selected ? theme.selection : .clear)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .onHover { _ in selected = index }
                    }
                    if results.isEmpty {
                        Text("No matches").font(AppFont.small).foregroundStyle(theme.textTertiary).padding(12)
                    }
                }
            }
            .frame(maxHeight: 320)
        }
        .frame(width: 540)
        .background(RoundedRectangle(cornerRadius: 10).fill(theme.surfaceRaised))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(theme.hairline, lineWidth: 1))
        .onAppear { focused = true; query = ""; selected = 0 }
        .onExitCommand { model.showQuickSwitcher = false }
        .background(keyHandler)
    }

    private var keyHandler: some View {
        VStack {}
            .background(
                Button("up") {
                    selected = max(0, selected - 1)
                }
                .keyboardShortcut(.upArrow, modifiers: [])
                .opacity(0)
                .frame(width: 0, height: 0)
                .hidden()
            )
            .background(
                Button("down") {
                    selected = min(max(0, results.count - 1), selected + 1)
                }
                .keyboardShortcut(.downArrow, modifiers: [])
                .opacity(0)
                .frame(width: 0, height: 0)
                .hidden()
            )
            .background(
                Button("esc") { model.showQuickSwitcher = false }
                    .keyboardShortcut(.escape, modifiers: [])
                    .opacity(0)
                    .frame(width: 0, height: 0)
                    .hidden()
            )
    }

    private func activate(_ index: Int) {
        guard results.indices.contains(index) else { return }
        model.open(path: results[index].path)
        model.showQuickSwitcher = false
    }
}
