import SwiftUI
import ConceptKit

/// Lightweight Markdown rendering for the reading toggle: headings, bold,
/// italic, inline code, lists, task lists, quotes, rules, fenced code and
/// wiki links. Deliberately simple, deterministic and self-contained.
struct MarkdownView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    var index: VaultIndex? { model.index }
    let body_text: String
    let openPath: (String) -> Void

    struct Block: Identifiable {
        let id = UUID()
        enum Kind {
            case heading(level: Int, text: String)
            case paragraph(String)
            case list(items: [(checked: Bool?, text: String)], ordered: Bool)
            case quote([String])
            case code(String)
            case rule
            case table(header: [String], rows: [[String]])
        }
        let kind: Kind
    }

    static func parse(_ text: String) -> [Block] {
        var blocks: [Block] = []
        var lines = text.components(separatedBy: "\n")
        while lines.last?.isEmpty == true { lines.removeLast() }

        var i = 0
        var paragraph: [String] = []
        func flushParagraph() {
            if !paragraph.isEmpty {
                blocks.append(Block(kind: .paragraph(paragraph.joined(separator: " "))))
                paragraph = []
            }
        }
        while i < lines.count {
            let line = lines[i]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty {
                flushParagraph()
                i += 1
                continue
            }
            if trimmed.hasPrefix("```") {
                flushParagraph()
                var code: [String] = []
                i += 1
                while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                    code.append(lines[i])
                    i += 1
                }
                i += 1
                blocks.append(Block(kind: .code(code.joined(separator: "\n"))))
                continue
            }
            if trimmed == "---" || trimmed == "***" {
                flushParagraph()
                blocks.append(Block(kind: .rule))
                i += 1
                continue
            }
            if trimmed.hasPrefix("#") {
                flushParagraph()
                let level = trimmed.prefix(while: { $0 == "#" }).count
                let heading = trimmed.dropFirst(level).trimmingCharacters(in: .whitespaces)
                blocks.append(Block(kind: .heading(level: level, text: String(heading))))
                i += 1
                continue
            }
            if trimmed.hasPrefix(">") {
                flushParagraph()
                var quote: [String] = []
                while i < lines.count, lines[i].trimmingCharacters(in: .whitespaces).hasPrefix(">") {
                    quote.append(lines[i].trimmingCharacters(in: .whitespaces).dropFirst().trimmingCharacters(in: .whitespaces))
                    i += 1
                }
                blocks.append(Block(kind: .quote(quote)))
                continue
            }
            if trimmed.hasPrefix("|"), i + 1 < lines.count,
               lines[i + 1].trimmingCharacters(in: .whitespaces).range(of: "^\\|?[ :|-]+\\|[ :|-]*$", options: .regularExpression) != nil {
                flushParagraph()
                func cells(_ l: String) -> [String] {
                    var parts = l.trimmingCharacters(in: .whitespaces).components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
                    if parts.first == "" { parts.removeFirst() }
                    if parts.last == "" { parts.removeLast() }
                    return parts
                }
                let header = cells(trimmed)
                i += 2
                var rows: [[String]] = []
                while i < lines.count, lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("|") {
                    rows.append(cells(lines[i]))
                    i += 1
                }
                blocks.append(Block(kind: .table(header: header, rows: rows)))
                continue
            }
            let isBullet = trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ")
            let isOrdered = Self.orderedPrefix(trimmed) != nil
            if isBullet || isOrdered {
                flushParagraph()
                var items: [(Bool?, String)] = []
                let ordered = isOrdered
                while i < lines.count {
                    let l = lines[i].trimmingCharacters(in: .whitespaces)
                    if l.hasPrefix("- ") || l.hasPrefix("* ") {
                        var rest = l.dropFirst(2).trimmingCharacters(in: .whitespaces)
                        var checked: Bool? = nil
                        if rest.hasPrefix("[ ] ") { checked = false; rest = String(rest.dropFirst(4)).trimmingCharacters(in: .whitespaces) }
                        else if rest.hasPrefix("[x] ") || rest.hasPrefix("[X] ") { checked = true; rest = String(rest.dropFirst(4)).trimmingCharacters(in: .whitespaces) }
                        items.append((checked, rest))
                    } else if ordered, let num = Self.orderedPrefix(l) {
                        _ = num
                        var rest = l.drop(while: { $0 != " " }).trimmingCharacters(in: .whitespaces)
                        var checked: Bool? = nil
                        if rest.hasPrefix("[ ] ") { checked = false; rest = String(rest.dropFirst(4)).trimmingCharacters(in: .whitespaces) }
                        else if rest.hasPrefix("[x] ") || rest.hasPrefix("[X] ") { checked = true; rest = String(rest.dropFirst(4)).trimmingCharacters(in: .whitespaces) }
                        items.append((checked, rest))
                    } else {
                        break
                    }
                    i += 1
                }
                blocks.append(Block(kind: .list(items: items, ordered: ordered)))
                continue
            }
            paragraph.append(trimmed)
            i += 1
        }
        flushParagraph()
        return blocks
    }

    static func orderedPrefix(_ line: String) -> String? {
        guard let dot = line.firstIndex(where: { $0 == "." || $0 == ")" }), dot != line.startIndex,
              line[..<dot].allSatisfy({ $0.isNumber }),
              line.index(after: dot) < line.endIndex, line[line.index(after: dot)] == " "
        else { return nil }
        return String(line[..<dot])
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Self.parse(body_text)) { block in
                blockView(block)
            }
            if body_text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text("No content")
                    .font(AppFont.base)
                    .foregroundStyle(theme.textTertiary)
            }
        }
    }

    @ViewBuilder
    private func blockView(_ block: Block) -> some View {
        switch block.kind {
        case .heading(let level, let text):
            let size: CGFloat = level == 1 ? 24 : level == 2 ? 19 : 16
            inline(text)
                .font(.system(size: size, weight: .semibold))
                .foregroundStyle(theme.text)
                .padding(.top, level <= 2 ? 6 : 2)
        case .paragraph(let text):
            inline(text)
                .font(AppFont.base)
                .foregroundStyle(theme.text)
                .lineSpacing(7)
        case .list(let items, let ordered):
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    HStack(alignment: .top, spacing: 8) {
                        if let checked = item.checked {
                            ToggleTask(checked: checked)
                        } else {
                            Text(ordered ? "\(index + 1)." : "·")
                                .font(AppFont.base)
                                .foregroundStyle(theme.textTertiary)
                                .frame(width: 14, alignment: .trailing)
                        }
                        inline(item.text)
                            .font(AppFont.base)
                            .foregroundStyle(item.checked == true ? theme.textSecondary : theme.text)
                            .strikethrough(item.checked == true, color: theme.textTertiary)
                    }
                }
            }
        case .quote(let lines):
            HStack(alignment: .top, spacing: 10) {
                Rectangle().fill(theme.accent.opacity(0.6)).frame(width: 2)
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(lines.enumerated()), id: \.offset) { _, l in
                        inline(l).font(AppFont.base).foregroundStyle(theme.textSecondary).lineSpacing(6)
                    }
                }
            }
            .padding(.vertical, 2)
        case .code(let code):
            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(AppFont.mono(12))
                    .foregroundStyle(theme.text)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(10)
            .background(RoundedRectangle(cornerRadius: 6).fill(theme.surfaceRaised))
            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(theme.hairline, lineWidth: 1))
        case .rule:
            Hairline().padding(.vertical, 4)
        case .table(let header, let rows):
            VStack(spacing: 0) {
                tableRow(header, bold: true)
                ForEach(Array(rows.enumerated()), id: \.offset) { _, r in
                    Hairline()
                    tableRow(r, bold: false)
                }
            }
            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(theme.hairline, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
    }

    private func tableRow(_ cells: [String], bold: Bool) -> some View {
        HStack(spacing: 0) {
            ForEach(Array(cells.enumerated()), id: \.offset) { _, c in
                inline(c)
                    .font(bold ? AppFont.small.weight(.semibold) : AppFont.small)
                    .foregroundStyle(theme.text)
                    .padding(.horizontal, 10).padding(.vertical, 7)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .background(bold ? theme.surfaceRaised : .clear)
    }

    /// Inline formatting: `code`, **bold**, *italic*, [[wiki links]] (tappable).
    @ViewBuilder
    func inline(_ text: String) -> some View {
        RichText(text: text, onOpen: openPath, resolveLink: resolve)
    }

    func resolve(_ target: String) -> String? {
        let resolved = index?.resolve(target) ?? nil
        return resolved.flatMap { path in
            index?.document(at: path).map { $0.title } ?? path
        }
    }
}

/// Renders inline Markdown (code, bold, italic) plus tappable wiki links.
/// Wiki-link brackets never show: the label is the alias after `|` or the
/// resolved page title.
struct RichText: View {
    @Environment(\.theme) private var theme
    let text: String
    let onOpen: (String) -> Void
    var resolveLink: ((String) -> String?)? = nil

    static func attributed(_ text: String, theme: Theme,
                           resolveLink: ((String) -> String?)? = nil) -> AttributedString {
        var attributed = AttributedString("")
        let linkPattern = "\\[\\[([^\\]|]+)(?:\\|([^\\]]*))?\\]\\]"
        var cursor = text.startIndex
        for match in MarkdownView.matches(of: linkPattern, in: text) {
            guard let fullRange = text.range(of: match.full, range: cursor..<text.endIndex) else { continue }
            if fullRange.lowerBound > cursor {
                appendPlain(String(text[cursor..<fullRange.lowerBound]), theme: theme, into: &attributed)
            }
            let target = match.group1.trimmingCharacters(in: .whitespaces)
            let alias = (match.group2 ?? "").trimmingCharacters(in: .whitespaces)
            let label = alias.isEmpty ? (resolveLink?(target) ?? target) : alias
            var run = AttributedString(label)
            run.foregroundColor = theme.accent
            run.underlineStyle = .single
            if let url = URL(string: "concept://open?p=" + (target.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? target)) {
                run.link = url
            }
            attributed.append(run)
            cursor = fullRange.upperBound
        }
        if cursor < text.endIndex {
            appendPlain(String(text[cursor...]), theme: theme, into: &attributed)
        }
        return attributed
    }

    /// Applies code/bold/italic styling to a plain segment and appends it.
    static func appendPlain(_ plain: String, theme: Theme, into attributed: inout AttributedString) {
        var segment = AttributedString(plain)
        segment.foregroundColor = theme.text
        for match in MarkdownView.matches(of: "`([^`]+)`", in: plain) {
            if let range = segment.range(of: match.full) {
                segment[range].font = AppFont.mono(12.5)
                segment[range].foregroundColor = theme.accent
            }
        }
        for match in MarkdownView.matches(of: "\\*\\*([^*]+)\\*\\*", in: plain) {
            if let range = segment.range(of: match.full) {
                segment[range].inlinePresentationIntent = .stronglyEmphasized
            }
        }
        attributed.append(segment)
    }

    var body: some View {
        Text(Self.attributed(text, theme: theme, resolveLink: resolveLink))
            .environment(\.openURL, OpenURLAction { url in
                guard url.scheme == "concept",
                      let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
                      let value = components.queryItems?.first(where: { $0.name == "p" })?.value else {
                    return .discarded
                }
                onOpen(value)
                return .handled
            })
    }
}

extension MarkdownView {
    struct ToggleTask: View {
        @Environment(\.theme) private var theme
        let checked: Bool
        var body: some View {
            ZStack {
                RoundedRectangle(cornerRadius: 4)
                    .strokeBorder(checked ? theme.accent : theme.textTertiary, lineWidth: 1.25)
                    .frame(width: 15, height: 15)
                if checked {
                    Icon(name: .check, size: 11, color: theme.accent).frame(width: 13, height: 13)
                }
            }
            .padding(.top, 3)
        }
    }
}

extension MarkdownView {
    struct Match { let full: String; let group1: String; let group2: String? }

    static func matches(of pattern: String, in text: String) -> [Match] {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        let range = NSRange(text.startIndex..., in: text)
        return regex.matches(in: text, range: range).compactMap { match in
            guard match.numberOfRanges > 1, let full = Range(match.range, in: text),
                  let g1 = Range(match.range(at: 1), in: text) else { return nil }
            var g2: String?
            if match.numberOfRanges > 2, let r = Range(match.range(at: 2), in: text) { g2 = String(text[r]) }
            return Match(full: String(text[full]), group1: String(text[g1]), group2: g2)
        }
    }
}
