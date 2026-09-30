import SwiftUI

/// Lightweight Markdown rendering for the reading toggle: headings, bold,
/// italic, inline code, lists, task lists, quotes, rules, fenced code and
/// wiki links. Deliberately simple, deterministic and self-contained.
struct MarkdownView: View {
    @Environment(\.theme) private var theme
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
        }
    }

    /// Inline formatting: `code`, **bold**, *italic*, [[wiki links]] (tappable).
    @ViewBuilder
    func inline(_ text: String) -> some View {
        RichText(text: text, onOpen: openPath)
    }
}

/// Renders inline Markdown (code, bold, italic) plus tappable wiki links.
struct RichText: View {
    @Environment(\.theme) private var theme
    let text: String
    let onOpen: (String) -> Void

    static func attributed(_ text: String, theme: Theme) -> AttributedString {
        var attributed = AttributedString(text)
        attributed.font = AppFont.base
        attributed.foregroundColor = theme.text
        for match in MarkdownView.matches(of: "`([^`]+)`", in: text) {
            if let range = attributed.range(of: match.0) {
                attributed[range].font = AppFont.mono(12.5)
                attributed[range].foregroundColor = theme.accent
            }
        }
        for match in MarkdownView.matches(of: "\\*\\*([^*]+)\\*\\*", in: text) {
            if let range = attributed.range(of: match.0) {
                attributed[range].font = AppFont.base.bold()
            }
        }
        for match in MarkdownView.matches(of: "(?<!\\*)\\*([^*]+)\\*(?!\\*)", in: text) {
            if let range = attributed.range(of: match.0) {
                attributed[range].font = AppFont.base.italic()
            }
        }
        // Wiki links become concept://open?p=… URLs.
        for match in MarkdownView.matches(of: "\\[\\[([^\\]|]+)(\\|[^\\]]*)?\\]\\]", in: text) {
            if let range = attributed.range(of: match.0) {
                let target = match.1.trimmingCharacters(in: .whitespaces)
                if let url = URL(string: "concept://open?p=" + (target.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? target)) {
                    attributed[range].link = url
                    attributed[range].foregroundColor = theme.accent
                    attributed[range].underlineStyle = .single
                }
            }
        }
        return attributed
    }

    var body: some View {
        Text(Self.attributed(text, theme: theme))
            .environment(\.openURL, OpenURLAction { url in
                guard url.scheme == "concept" else { return .discarded }
                if let host = url.host(), let decoded = host.removingPercentEncoding {
                    onOpen(decoded)
                    return .handled
                }
                if let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
                   let value = components.queryItems?.first(where: { $0.name == "p" })?.value {
                    onOpen(value)
                    return .handled
                }
                return .discarded
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
    static func matches(of pattern: String, in text: String) -> [(String, String)] {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        let range = NSRange(text.startIndex..., in: text)
        return regex.matches(in: text, range: range).compactMap { match in
            guard match.numberOfRanges > 1, let full = Range(match.range, in: text),
                  let group = Range(match.range(at: 1), in: text) else { return nil }
            return (String(text[full]), String(text[group]))
        }
    }
}
