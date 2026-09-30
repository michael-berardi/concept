import SwiftUI

/// Thin-stroke icon set, drawn as vector paths on a 24×24 grid with a 1.5pt
/// stroke. One consistent family; no emoji anywhere in the UI.
struct Icon: View {
    enum Name: String, CaseIterable {
        case page, database, board, vault, search, graph, sync, syncDone, check
        case plus, chevronRight, chevronDown, tag, calendar, person, doc
        case link, settings, close, dots, trash, eye, source, columns
    }

    let name: Name
    var size: CGFloat = 16
    var color: Color?

    @Environment(\.theme) private var theme

    var body: some View {
        Canvas { context, canvasSize in
            let scale = min(canvasSize.width, canvasSize.height) / 24
            context.translateBy(x: (canvasSize.width - 24 * scale) / 2,
                                y: (canvasSize.height - 24 * scale) / 2)
            context.scaleBy(x: scale, y: scale)
            var path = Path()
            draw(name, into: &path)
            context.stroke(path, with: .color(color ?? theme.textSecondary),
                           style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
        }
        .frame(width: size, height: size)
        .accessibilityLabel(name.rawValue)
    }

    private func draw(_ name: Name, into path: inout Path) {
        func line(_ x1: CGFloat, _ y1: CGFloat, _ x2: CGFloat, _ y2: CGFloat) {
            path.move(to: CGPoint(x: x1, y: y1))
            path.addLine(to: CGPoint(x: x2, y: y2))
        }
        func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) {
            path.addRoundedRect(in: CGRect(x: x, y: y, width: w, height: h), cornerSize: CGSize(width: 2, height: 2))
        }
        func curve(_ points: [CGPoint]) {
            guard let first = points.first else { return }
            path.move(to: first)
            for p in points.dropFirst() { path.addLine(to: p) }
        }
        switch name {
        case .page: // document with folded corner
            curve([CGPoint(x: 6, y: 3), CGPoint(x: 14, y: 3), CGPoint(x: 18, y: 7), CGPoint(x: 18, y: 21), CGPoint(x: 6, y: 21), CGPoint(x: 6, y: 3)])
            curve([CGPoint(x: 14, y: 3), CGPoint(x: 14, y: 7), CGPoint(x: 18, y: 7)])
            line(9, 12, 15, 12); line(9, 16, 15, 16)
        case .database: // cylinder
            path.addEllipse(in: CGRect(x: 5, y: 4, width: 14, height: 5))
            curve([CGPoint(x: 5, y: 9), CGPoint(x: 5, y: 18)])
            curve([CGPoint(x: 19, y: 9), CGPoint(x: 19, y: 18)])
            curve([CGPoint(x: 5, y: 13.5), CGPoint(x: 19, y: 13.5)])
            path.addEllipse(in: CGRect(x: 5, y: 15, width: 14, height: 5))
        case .board: // columns
            rect(4, 4, 5, 16); rect(10.5, 4, 5, 11); rect(17, 4, 3.5, 14)
        case .columns:
            rect(4, 4, 5, 16); rect(10.5, 4, 9.5, 16)
        case .vault: // folder
            curve([CGPoint(x: 3, y: 6), CGPoint(x: 9, y: 6), CGPoint(x: 11, y: 8), CGPoint(x: 21, y: 8), CGPoint(x: 21, y: 19), CGPoint(x: 3, y: 19), CGPoint(x: 3, y: 6)])
        case .search:
            path.addEllipse(in: CGRect(x: 4.5, y: 4.5, width: 11, height: 11))
            line(13.5, 13.5, 20, 20)
        case .graph: // nodes + edges
            path.addEllipse(in: CGRect(x: 3, y: 3, width: 5, height: 5))
            path.addEllipse(in: CGRect(x: 16, y: 6, width: 5, height: 5))
            path.addEllipse(in: CGRect(x: 8, y: 16, width: 5, height: 5))
            line(8, 6, 16, 8); line(6, 8, 9, 16); line(18, 11, 12, 16)
        case .sync: // circular arrows
            path.addEllipse(in: CGRect(x: 5, y: 5, width: 14, height: 14))
            line(19, 5, 19, 10); line(19, 10, 14, 10)
            line(5, 19, 5, 14); line(5, 14, 10, 14)
        case .syncDone:
            path.addEllipse(in: CGRect(x: 4, y: 4, width: 16, height: 16))
            line(8.5, 12.5, 11, 15); line(11, 15, 15.5, 9.5)
        case .check:
            line(5, 13, 10, 18); line(10, 18, 19, 6)
        case .plus:
            line(12, 5, 12, 19); line(5, 12, 19, 12)
        case .chevronRight:
            line(9, 5, 15, 12); line(15, 12, 9, 19)
        case .chevronDown:
            line(5, 9, 12, 15); line(12, 15, 19, 9)
        case .tag:
            curve([CGPoint(x: 4, y: 4), CGPoint(x: 12, y: 4), CGPoint(x: 20, y: 12), CGPoint(x: 12, y: 20), CGPoint(x: 4, y: 12), CGPoint(x: 4, y: 4)])
            path.addEllipse(in: CGRect(x: 7.5, y: 7.5, width: 3, height: 3))
        case .calendar:
            rect(4, 5, 16, 15)
            line(4, 10, 20, 10); line(8, 3, 8, 7); line(16, 3, 16, 7)
        case .person:
            path.addEllipse(in: CGRect(x: 9, y: 4, width: 6, height: 6))
            curve([CGPoint(x: 5, y: 20), CGPoint(x: 5, y: 15), CGPoint(x: 9, y: 12.5), CGPoint(x: 15, y: 12.5), CGPoint(x: 19, y: 15), CGPoint(x: 19, y: 20)])
        case .doc:
            rect(5, 3, 14, 18)
            line(8, 8, 16, 8); line(8, 12, 16, 12); line(8, 16, 13, 16)
        case .link:
            curve([CGPoint(x: 10, y: 14), CGPoint(x: 14, y: 10)])
            curve([CGPoint(x: 8, y: 16), CGPoint(x: 5.5, y: 13.5), CGPoint(x: 5.5, y: 10.5), CGPoint(x: 9, y: 8), CGPoint(x: 11.5, y: 8.5)])
            curve([CGPoint(x: 16, y: 8), CGPoint(x: 18.5, y: 10.5), CGPoint(x: 18.5, y: 13.5), CGPoint(x: 15, y: 16), CGPoint(x: 12.5, y: 15.5)])
        case .settings:
            path.addEllipse(in: CGRect(x: 9, y: 9, width: 6, height: 6))
            path.addEllipse(in: CGRect(x: 5, y: 5, width: 14, height: 14))
        case .close:
            line(6, 6, 18, 18); line(18, 6, 6, 18)
        case .dots:
            path.addEllipse(in: CGRect(x: 5, y: 11, width: 2, height: 2))
            path.addEllipse(in: CGRect(x: 11, y: 11, width: 2, height: 2))
            path.addEllipse(in: CGRect(x: 17, y: 11, width: 2, height: 2))
        case .trash:
            line(4, 7, 20, 7)
            curve([CGPoint(x: 9, y: 7), CGPoint(x: 9, y: 4), CGPoint(x: 15, y: 4), CGPoint(x: 15, y: 7)])
            curve([CGPoint(x: 6, y: 7), CGPoint(x: 7, y: 20), CGPoint(x: 17, y: 20), CGPoint(x: 18, y: 7)])
            line(10, 11, 10, 16); line(14, 11, 14, 16)
        case .eye:
            curve([CGPoint(x: 3, y: 12), CGPoint(x: 8, y: 6.5), CGPoint(x: 16, y: 6.5), CGPoint(x: 21, y: 12), CGPoint(x: 16, y: 17.5), CGPoint(x: 8, y: 17.5), CGPoint(x: 3, y: 12)])
            path.addEllipse(in: CGRect(x: 9.5, y: 9.5, width: 5, height: 5))
        case .source:
            line(5, 7, 19, 7)
            line(7, 12, 17, 12)
            line(9, 17, 15, 17)
        }
    }
}
