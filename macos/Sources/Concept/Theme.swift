import SwiftUI

/// Design tokens per docs/SPEC.md "Design language": quiet, precise,
/// Apple-grade restraint. OLED black is the default; hairline 1px borders at
/// ~8% white on dark; one accent used sparingly; no drop shadows on dark.
public struct Theme: Equatable, Sendable {
    public var name: String
    public var isDark: Bool
    public var canvas: Color        // window background (#000 for OLED)
    public var surface: Color       // sidebar / panels
    public var surfaceRaised: Color // cards, inputs (elevation via lighter surface)
    public var text: Color
    public var textSecondary: Color
    public var textTertiary: Color
    public var hairline: Color      // 1px borders
    public var accent: Color
    public var selection: Color     // subtle row highlight

    public init(name: String, isDark: Bool, canvas: String, surface: String,
                surfaceRaised: String, text: String, textSecondary: String,
                textTertiary: String, hairline: String, accent: String, selection: String) {
        self.name = name
        self.isDark = isDark
        self.canvas = Color(hex: canvas)
        self.surface = Color(hex: surface)
        self.surfaceRaised = Color(hex: surfaceRaised)
        self.text = Color(hex: text)
        self.textSecondary = Color(hex: textSecondary)
        self.textTertiary = Color(hex: textTertiary)
        self.hairline = Color(hex: hairline)
        self.accent = Color(hex: accent)
        self.selection = Color(hex: selection)
    }

    public static let oled = Theme(
        name: "OLED", isDark: true,
        canvas: "#000000", surface: "#0a0a0a", surfaceRaised: "#111111",
        text: "#f2f2f2", textSecondary: "#9a9a9a", textTertiary: "#5c5c5c",
        hairline: "#141414", accent: "#5e8bff", selection: "#16181d")

    public static let graphite = Theme(
        name: "Graphite", isDark: true,
        canvas: "#1e1e1e", surface: "#252525", surfaceRaised: "#2d2d2d",
        text: "#e8e8e8", textSecondary: "#a0a0a0", textTertiary: "#6b6b6b",
        hairline: "#333333", accent: "#8fa8c8", selection: "#33383f")

    public static let paper = Theme(
        name: "Paper", isDark: false,
        canvas: "#faf7f2", surface: "#f3efe8", surfaceRaised: "#ffffff",
        text: "#2b2723", textSecondary: "#6f675e", textTertiary: "#a49a8e",
        hairline: "#e5ddd0", accent: "#b4552d", selection: "#f0e4da")

    public static let snow = Theme(
        name: "Snow", isDark: false,
        canvas: "#ffffff", surface: "#f6f7f9", surfaceRaised: "#ffffff",
        text: "#1c1f24", textSecondary: "#5d646e", textTertiary: "#9aa1ab",
        hairline: "#e6e8ec", accent: "#2f6fed", selection: "#e9effc")

    public static let midnight = Theme(
        name: "Midnight", isDark: true,
        canvas: "#0a0e1a", surface: "#101627", surfaceRaised: "#171f36",
        text: "#e6eaf4", textSecondary: "#8d96ad", textTertiary: "#5a6478",
        hairline: "#1d2740", accent: "#5aa9ff", selection: "#182338")

    public static let forest = Theme(
        name: "Forest", isDark: true,
        canvas: "#0d1210", surface: "#131a16", surfaceRaised: "#1a231e",
        text: "#e4ebe6", textSecondary: "#8fa096", textTertiary: "#5d6c63",
        hairline: "#202b25", accent: "#6fbf8f", selection: "#1a2620")

    public static let all: [Theme] = [.oled, .graphite, .paper, .snow, .midnight, .forest]

    public static func named(_ name: String) -> Theme {
        all.first(where: { $0.name.lowercased() == name.lowercased() }) ?? .oled
    }
}

public extension Color {
    init(hex: String) {
        var value: UInt64 = 0
        var hexString = hex.trimmingCharacters(in: .whitespaces)
        if hexString.hasPrefix("#") { hexString.removeFirst() }
        Scanner(string: hexString).scanHexInt64(&value)
        let r = Double((value >> 16) & 0xFF) / 255.0
        let g = Double((value >> 8) & 0xFF) / 255.0
        let b = Double(value & 0xFF) / 255.0
        self.init(.sRGB, red: r, green: g, blue: b, opacity: 1)
    }
}

// MARK: - Environment

struct ThemeKey: EnvironmentKey {
    static let defaultValue = Theme.oled
}

extension EnvironmentValues {
    var theme: Theme {
        get { self[ThemeKey.self] }
        set { self[ThemeKey.self] = newValue }
    }
}

// MARK: - Shared primitives

/// Hairline divider, 1px.
struct Hairline: View {
    @Environment(\.theme) private var theme
    var horizontal = true

    var body: some View {
        Rectangle()
            .fill(theme.hairline)
            .frame(width: horizontal ? nil : 1, height: horizontal ? 1 : nil)
    }
}

/// Quiet text styles used across the app.
enum AppFont {
    static func mono(_ size: CGFloat = 13) -> Font {
        .system(size: size, design: .monospaced)
    }

    static let base = Font.system(size: 14)
    static let small = Font.system(size: 12)
    static let micro = Font.system(size: 11)
    static let title = Font.system(size: 20, weight: .semibold)
    static let heading = Font.system(size: 16, weight: .semibold)
}

/// Small rounded label used for statuses and Retex badges. Quiet, no chips
/// clutter: 1px hairline, tinted text only.
struct Badge: View {
    @Environment(\.theme) private var theme
    let text: String
    var color: Color?

    var body: some View {
        Text(text)
            .font(AppFont.micro)
            .foregroundStyle(color ?? theme.textSecondary)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .overlay(
                RoundedRectangle(cornerRadius: 4)
                    .strokeBorder((color ?? theme.textSecondary).opacity(0.35), lineWidth: 1)
            )
    }
}

/// Palette for select/status options (gray, blue, green, orange, purple, red, yellow).
func statusColor(_ id: String, theme: Theme) -> Color {
    switch id.lowercased() {
    case "blue", "qualified", "doing", "active", "logged": return theme.accent
    case "green", "won", "done", "customer": return Color(hex: "#57b581")
    case "orange", "proposal", "review": return Color(hex: "#d98e4a")
    case "purple", "negotiation": return Color(hex: "#a08bd8")
    case "red", "lost": return Color(hex: "#d86b6b")
    case "yellow", "planned": return Color(hex: "#c9b458")
    default: return theme.textSecondary
    }
}
