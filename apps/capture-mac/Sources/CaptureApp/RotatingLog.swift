import Foundation
import OSLog

final class RotatingLog: @unchecked Sendable {
    private let lock = NSLock()
    private let fileURL: URL
    private let limit = 2 * 1_024 * 1_024
    private let logger = Logger(subsystem: "app.launchstack.capture", category: "supervisor")

    init() {
        let directory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/LaunchStack Capture", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        fileURL = directory.appendingPathComponent("capture.log")
    }

    func message(_ text: String) {
        logger.info("\(text, privacy: .public)")
        append(Data("\(ISO8601DateFormatter().string(from: Date())) \(text)\n".utf8))
    }

    func append(_ data: Data) {
        guard !data.isEmpty else { return }
        lock.lock()
        defer { lock.unlock() }
        let manager = FileManager.default
        let size = (try? manager.attributesOfItem(atPath: fileURL.path)[.size] as? NSNumber)?.intValue ?? 0
        if size + data.count > limit {
            try? manager.removeItem(at: fileURL.appendingPathExtension("3"))
            for number in stride(from: 2, through: 1, by: -1) {
                try? manager.moveItem(at: fileURL.appendingPathExtension(String(number)), to: fileURL.appendingPathExtension(String(number + 1)))
            }
            try? manager.moveItem(at: fileURL, to: fileURL.appendingPathExtension("1"))
        }
        if !manager.fileExists(atPath: fileURL.path) { manager.createFile(atPath: fileURL.path, contents: nil, attributes: [.posixPermissions: 0o600]) }
        guard let file = try? FileHandle(forWritingTo: fileURL) else { return }
        defer { try? file.close() }
        _ = try? file.seekToEnd()
        try? file.write(contentsOf: data)
    }
}
