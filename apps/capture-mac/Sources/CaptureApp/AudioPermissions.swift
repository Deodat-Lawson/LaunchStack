import AppKit
import Combine
import Foundation

struct AudioPermission: Decodable {
    let supported: Bool
    let authorized: Bool
    let reason: String
    let message: String
    let state: String

    var label: String {
        if authorized { return "Allowed" }
        switch state {
        case "not_determined": return "Not requested"
        case "restricted": return "Restricted"
        case "unsupported": return "Unavailable"
        default: return "Needs access"
        }
    }
}

struct AudioPermissions: Decodable {
    let microphone: AudioPermission
    let system: AudioPermission
}

@MainActor
final class PermissionController: ObservableObject {
    @Published private(set) var permissions: AudioPermissions?
    @Published private(set) var checking = false
    @Published private(set) var error: String?

    func refresh() {
        guard !checking else { return }
        checking = true
        Task {
            permissions = await Self.runHelper(arguments: ["--status"])
            error = permissions == nil ? "Could not check audio permissions." : nil
            checking = false
        }
    }

    func request(_ source: String) {
        guard !checking else { return }
        checking = true
        Task {
            permissions = await Self.runHelper(arguments: ["--request-permission", source])
            checking = false
            openSettings(source)
        }
    }

    func openSettings(_ source: String) {
        let pane = source == "microphone" ? "Privacy_Microphone" : "Privacy_ScreenCapture"
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)") { NSWorkspace.shared.open(url) }
    }

    private nonisolated static func runHelper(arguments: [String]) async -> AudioPermissions? {
        await Task.detached(priority: .utility) {
            let helper = Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/launchstack-system-audio")
            let process = Process()
            let output = Pipe()
            process.executableURL = helper
            process.arguments = arguments
            process.standardOutput = output
            process.standardError = FileHandle.nullDevice
            do { try process.run() } catch { return nil }
            // Permission requests may wait for a user response; status remains
            // non-prompting. Neither operation runs on the UI thread.
            let data = output.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            return try? JSONDecoder().decode(AudioPermissions.self, from: data)
        }.value
    }
}
