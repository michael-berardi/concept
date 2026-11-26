import AppKit
import ConceptKit
import Sparkle
import SwiftUI

/// Signed Sparkle updates: a daily anonymous appcast check, opt-in automatic installation.
/// The feed and EdDSA public key come from Info.plist; the private key never ships.
@MainActor
final class Updates: NSObject, ObservableObject {
    static let shared = Updates()

    /// Saves pending edits and reports whether work is still running; a relaunch waits until it is not.
    var readyToRelaunch: () -> Bool = { true }

    private var controller: SPUStandardUpdaterController?
    private var pendingInstall: (() -> Void)?

    /// False in local and debug builds without a real signing key.
    var isAvailable: Bool { controller != nil }

    private override init() {
        super.init()
        guard UpdatePolicy.isConfigured(info: Bundle.main.infoDictionary) else { return }
        let controller = SPUStandardUpdaterController(
            startingUpdater: false, updaterDelegate: self, userDriverDelegate: nil)
        controller.updater.userAgentString = UpdatePolicy.userAgent
        controller.startUpdater()
        self.controller = controller
    }

    func checkForUpdates() {
        NSApp.activate(ignoringOtherApps: true)
        controller?.checkForUpdates(nil)
    }

    var automaticChecks: Bool {
        get { controller?.updater.automaticallyChecksForUpdates ?? false }
        set {
            controller?.updater.automaticallyChecksForUpdates = newValue
            objectWillChange.send()
        }
    }

    var automaticInstalls: Bool {
        get { controller?.updater.automaticallyDownloadsUpdates ?? false }
        set {
            controller?.updater.automaticallyDownloadsUpdates = newValue
            objectWillChange.send()
        }
    }

    private func relaunchWhenReady() {
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(2))
            guard let self, let install = self.pendingInstall else { return }
            if self.readyToRelaunch() {
                self.pendingInstall = nil
                install()
            } else {
                self.relaunchWhenReady()
            }
        }
    }
}

extension Updates: SPUUpdaterDelegate {
    nonisolated func updater(_ updater: SPUUpdater, mayPerform updateCheck: SPUUpdateCheck) throws {
        guard updateCheck == .updatesInBackground,
              !UpdatePolicy.backgroundChecksAllowed(environment: ProcessInfo.processInfo.environment)
        else { return }
        throw NSError(domain: "Concept.Updates", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "Automatic update checks are off."])
    }

    nonisolated func updater(_ updater: SPUUpdater, shouldPostponeRelaunchForUpdate item: SUAppcastItem,
                             untilInvokingBlock installHandler: @escaping () -> Void) -> Bool {
        // Sparkle calls this and expects the handler on the main thread.
        nonisolated(unsafe) let install = installHandler
        return MainActor.assumeIsolated {
            if readyToRelaunch() { return false }
            pendingInstall = install
            relaunchWhenReady()
            return true
        }
    }
}

/// Settings → Updates: two toggles, then the version and Check Now on one row.
struct UpdatesSettingsView: View {
    @ObservedObject private var updates = Updates.shared

    private var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"
    }

    var body: some View {
        Form {
            Section("Updates") {
                Toggle("Check for updates automatically", isOn: $updates.automaticChecks)
                Toggle("Install updates automatically", isOn: $updates.automaticInstalls)
                    .disabled(!updates.automaticChecks)
                HStack {
                    Text("Version \(version)").foregroundStyle(.secondary)
                    Spacer()
                    Button("Check Now") { updates.checkForUpdates() }
                }
            }
        }
        .formStyle(.grouped)
        .toggleStyle(.switch)
        .disabled(!updates.isAvailable)
        .scrollDisabled(true)
        .frame(width: 460)
        .fixedSize(horizontal: false, vertical: true)
    }
}
