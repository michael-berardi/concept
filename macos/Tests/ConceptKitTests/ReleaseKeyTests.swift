import CryptoKit
import Foundation
import Testing
@testable import ConceptKit

/// Release scripts and Sparkle settings: the shipped feed must be signed with the key the app trusts.
@Suite("Updates and release signing")
struct ReleaseKeyTests {
    private let root = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

    private func tempDir() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("concept-release-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    /// A copy of the real Info.plist with only SUPublicEDKey replaced.
    private func plist(key: String, in dir: URL) throws -> URL {
        let url = dir.appendingPathComponent("Info.plist")
        var info = try #require(NSDictionary(contentsOf: root.appendingPathComponent("Resources/Info.plist")) as? [String: Any])
        info["SUPublicEDKey"] = key
        try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0).write(to: url)
        return url
    }

    @discardableResult
    private func run(_ script: String, _ args: [String], env: [String: String] = [:]) throws -> (status: Int32, output: String) {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/sh")
        task.arguments = [root.appendingPathComponent("scripts/\(script)").path] + args
        task.environment = ProcessInfo.processInfo.environment.merging(env) { $1 }
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = pipe
        try task.run()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        task.waitUntilExit()
        return (task.terminationStatus, String(decoding: data, as: UTF8.self))
    }

    @Test("Shipped Info.plist: daily checks on, automatic install off, HTTPS feed")
    func shippedDefaults() throws {
        let info = try #require(NSDictionary(contentsOf: root.appendingPathComponent("Resources/Info.plist")) as? [String: Any])
        #expect(info["SUEnableAutomaticChecks"] as? Bool == true)
        #expect(info["SUAutomaticallyUpdate"] as? Bool == false)
        #expect(info["SUAllowsAutomaticUpdates"] as? Bool == true)
        #expect(info["SUScheduledCheckInterval"] as? Int == 86_400)
        #expect(info["SUEnableSystemProfiling"] as? Bool != true)
        #expect(info["SUVerifyUpdateBeforeExtraction"] as? Bool == true)
        #expect((info["SUFeedURL"] as? String)?.hasPrefix("https://github.com/") == true)
        #expect((info["SUFeedURL"] as? String)?.hasSuffix("/releases/latest/download/appcast.xml") == true)
    }

    @Test("Release guard refuses the placeholder and malformed keys")
    func releaseGuard() throws {
        let dir = try tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let placeholder = try run("check-release-key.sh", [try plist(key: UpdatePolicy.placeholderKey, in: dir).path])
        #expect(placeholder.status != 0)
        #expect(placeholder.output.contains("placeholder"))
        #expect(try run("check-release-key.sh", [try plist(key: "not-a-key", in: dir).path]).status != 0)
        let real = Curve25519.Signing.PrivateKey().publicKey.rawRepresentation.base64EncodedString()
        #expect(try run("check-release-key.sh", [try plist(key: real, in: dir).path]).status == 0)
        // The committed plist carries the real release key, so a release build is allowed.
        #expect(try run("check-release-key.sh", []).status == 0)
    }

    @Test("Appcast enclosure verifies against the app's key; a tampered ZIP does not")
    func appcastSignature() throws {
        let signer = root.appendingPathComponent(".build/artifacts/sparkle/Sparkle/bin/sign_update")
        try #require(FileManager.default.isExecutableFile(atPath: signer.path), "resolve Sparkle first (swift build)")
        let dir = try tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let key = Curve25519.Signing.PrivateKey()
        let keyFile = dir.appendingPathComponent("ed25519.key")
        try key.rawRepresentation.base64EncodedString().write(to: keyFile, atomically: true, encoding: .utf8)
        let info = try plist(key: key.publicKey.rawRepresentation.base64EncodedString(), in: dir)
        let zip = dir.appendingPathComponent("Concept-macos-universal.zip")
        let payload = Data("release archive".utf8)
        try payload.write(to: zip)

        let result = try run("appcast.sh", [zip.path, info.path], env: ["SPARKLE_KEY_FILE": keyFile.path])
        #expect(result.status == 0, "\(result.output)")
        let xml = try String(contentsOf: dir.appendingPathComponent("appcast.xml"), encoding: .utf8)
        let plistInfo = try #require(NSDictionary(contentsOf: info) as? [String: Any])
        let version = try #require(plistInfo["CFBundleShortVersionString"] as? String)
        let repoURL = try #require((plistInfo["SUFeedURL"] as? String)?.components(separatedBy: "/releases/").first)
        #expect(xml.contains("<sparkle:shortVersionString>\(version)</sparkle:shortVersionString>"))
        #expect(xml.contains("url=\"\(repoURL)/releases/download/v\(version)/Concept-macos-universal.zip\""))
        #expect(xml.contains("sparkle:format=\"markdown\""))
        #expect(xml.contains("length=\"\(payload.count)\""))

        let signature = try #require(xml.firstMatch(of: /sparkle:edSignature="([^"]+)"/).map { String($0.1) })
        let sig = try #require(Data(base64Encoded: signature))
        #expect(key.publicKey.isValidSignature(sig, for: payload))
        #expect(!key.publicKey.isValidSignature(sig, for: Data("tampered archive".utf8)))
    }

    @Test("Updater starts only with a feed and a real key; background checks honor CI and opt-out")
    func policy() {
        let real = Curve25519.Signing.PrivateKey().publicKey.rawRepresentation.base64EncodedString()
        let feed = "https://github.com/example/concept/releases/latest/download/appcast.xml"
        #expect(UpdatePolicy.isConfigured(info: ["SUFeedURL": feed, "SUPublicEDKey": real]))
        #expect(!UpdatePolicy.isConfigured(info: ["SUFeedURL": feed, "SUPublicEDKey": UpdatePolicy.placeholderKey]))
        #expect(!UpdatePolicy.isConfigured(info: ["SUFeedURL": feed, "SUPublicEDKey": "AAAA"]))
        #expect(!UpdatePolicy.isConfigured(info: ["SUPublicEDKey": real]))
        #expect(!UpdatePolicy.isConfigured(info: nil))

        #expect(UpdatePolicy.backgroundChecksAllowed(environment: [:]))
        #expect(UpdatePolicy.backgroundChecksAllowed(environment: ["CI": "false", "CONCEPT_NO_UPDATE_CHECK": "0"]))
        #expect(!UpdatePolicy.backgroundChecksAllowed(environment: ["CI": "true"]))
        #expect(!UpdatePolicy.backgroundChecksAllowed(environment: ["CI": "1"]))
        #expect(!UpdatePolicy.backgroundChecksAllowed(environment: ["CONCEPT_NO_UPDATE_CHECK": "1"]))
        #expect(UpdatePolicy.userAgent == "concept-update-check")
    }
}
