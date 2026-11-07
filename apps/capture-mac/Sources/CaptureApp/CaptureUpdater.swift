import Foundation
import Sparkle

@MainActor
final class CaptureUpdater: NSObject, SPUUpdaterDelegate {
    var onError: ((String) -> Void)?
    private var connection: DeviceConnection?
    private var started = false
    private let version: String
    private lazy var controller = SPUStandardUpdaterController(startingUpdater: false, updaterDelegate: self, userDriverDelegate: nil)

    init(version: String) { self.version = version; super.init() }

    func configure(_ connection: DeviceConnection?) {
        self.connection = connection
        // Sparkle's SPUUpdater.httpHeaders explicitly covers appcast, release
        // notes AND archive downloads (not only the feed request).
        controller.updater.httpHeaders = connection.map {
            ["Authorization": "Bearer \($0.token)", "X-LaunchStack-Capture-Version": version]
        }
        guard connection != nil, hasSigningKey else { return }
        do {
            if !started { try controller.updater.start(); started = true }
            else { controller.updater.resetUpdateCycle() }
        } catch { onError?("The update service could not start. Check this build's signing configuration.") }
    }

    func check() {
        guard connection != nil else { onError?("Sync with the website before checking for updates."); return }
        guard hasSigningKey else { onError?("This development build has no Sparkle public signing key. Build a release with SPARKLE_PUBLIC_ED_KEY to enable updates."); return }
        guard started, controller.updater.canCheckForUpdates else { return }
        controller.checkForUpdates(nil)
    }

    private var hasSigningKey: Bool { !(Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String ?? "").isEmpty }

    nonisolated func feedURLString(for updater: SPUUpdater) -> String? {
        // Sparkle 2.8's Objective-C protocol lacks actor annotations, but its
        // delegate API guarantees the main thread. Enforce that boundary here.
        MainActor.assumeIsolated {
            connection?.origin.appendingPathComponent("api/call-notes/devices/appcast.xml").absoluteString
        }
    }

    nonisolated func updater(_ updater: SPUUpdater, mayPerform updateCheck: SPUUpdateCheck) throws {
        try MainActor.assumeIsolated {
            guard connection != nil else {
                throw NSError(domain: "app.launchstack.capture", code: 1, userInfo: [NSLocalizedDescriptionKey: "Connect this Mac before checking for updates."])
            }
        }
    }
}
