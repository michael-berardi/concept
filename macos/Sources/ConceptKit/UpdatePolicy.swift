import Foundation

/// Rules for the Mac app's Sparkle updater. Kept here so they are testable without Sparkle.
public enum UpdatePolicy {
    /// Fixed, anonymous user agent for feed requests: no app, OS or machine details.
    public static let userAgent = "concept-update-check"

    /// Committed in Resources/Info.plist until the release key is set; releases refuse it.
    public static let placeholderKey = "REPLACE_WITH_CONCEPT_SPARKLE_EDDSA_PUBLIC_KEY"

    /// Background checks stay off in CI and when `CONCEPT_NO_UPDATE_CHECK=1`.
    /// A check the user asks for (Check Now) is always allowed.
    public static func backgroundChecksAllowed(environment: [String: String]) -> Bool {
        if environment["CONCEPT_NO_UPDATE_CHECK"] == "1" { return false }
        if let ci = environment["CI"], !ci.isEmpty, ci != "0", ci.lowercased() != "false" { return false }
        return true
    }

    /// The updater starts only in a bundle with a feed and a real 32-byte EdDSA public key,
    /// so local and debug builds never show Sparkle errors.
    public static func isConfigured(info: [String: Any]?) -> Bool {
        guard let feed = info?["SUFeedURL"] as? String, URL(string: feed)?.host != nil,
              let key = info?["SUPublicEDKey"] as? String, key != placeholderKey,
              Data(base64Encoded: key)?.count == 32
        else { return false }
        return true
    }
}
