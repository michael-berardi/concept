import SwiftUI
import ConceptKit

// MARK: - File tree (every file on disk, quiet gray)

struct TabBar: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(spacing: 0) {
            ForEach(model.openTabs) { tab in
                let active = model.activeTab == tab.path
                HStack(spacing: 6) {
                    Icon(name: tab.path.hasPrefix("Data/") ? .database : .doc, size: 11)
                    Text(model.index?.document(at: tab.path)?.title ?? ((tab.path as NSString).lastPathComponent as NSString).deletingPathExtension)
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
                .onTapGesture { model.showGraph = false; model.open(path: tab.path) }
                .overlay(alignment: .trailing) { Hairline(horizontal: false) }
            }
            Spacer()
        }
        .background(theme.surface)
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

struct Inspector: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    @State private var section: InspectorSection = .links

    enum InspectorSection: String, CaseIterable, Identifiable {
        case properties, links, outline, tags
        var id: String { rawValue }
    }

    var path: String? { model.selectedPage }

    var body: some View {
        VStack(spacing: 0) {
            Picker("", selection: $section) {
                ForEach(InspectorSection.allCases) { s in
                    Text(s.rawValue.capitalized).tag(s)
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
                    LinkLine(target: model.index?.document(at: source)?.title ?? source, resolved: source)
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
                                            iterations: scope == .global ? 300 : 300)
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
