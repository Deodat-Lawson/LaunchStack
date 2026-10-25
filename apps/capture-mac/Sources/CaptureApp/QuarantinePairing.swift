import CaptureCore
import CoreServices
import Darwin
import Foundation

struct QuarantinePairing {
    static func discover(bundleURL: URL) -> PairingLink? {
        var candidates = [bundleURL]
        if let original = originalURLIfTranslocated(bundleURL), original != bundleURL { candidates.append(original) }
        for candidate in candidates {
            if let values = try? candidate.resourceValues(forKeys: [.quarantinePropertiesKey]),
               let properties = values.quarantineProperties,
               let value = properties[kLSQuarantineDataURLKey as String] {
                let downloadURL = (value as? URL) ?? (value as? String).flatMap(URL.init(string:))
                if let downloadURL, let link = try? PairingLink.downloadURL(downloadURL) { return link }
            }
            // Chrome records WhereFroms on the DMG, not the app copied out of it.
            // Match the inherited quarantine event before trusting any download.
            if let link = sourceDownloadLink(for: candidate) { return link }
        }
        return nil
    }

    private static func sourceDownloadLink(for bundleURL: URL) -> PairingLink? {
        guard let event = quarantineEvent(at: bundleURL) else { return nil }
        if let query = MDQueryCreate(
            kCFAllocatorDefault, "kMDItemFSName == 'LaunchStack-Capture*.dmg'c" as CFString, nil, nil
        ), MDQueryExecute(query, CFOptionFlags(1)) {
            defer { MDQueryStop(query) }
            for index in 0..<min(MDQueryGetResultCount(query), 64) {
                let item = unsafeBitCast(MDQueryGetResultAtIndex(query, index), to: MDItem.self)
                guard let path = MDItemCopyAttribute(item, kMDItemPath) as? String else { continue }
                if let link = installerLink(at: URL(fileURLWithPath: path), matchingEvent: event) { return link }
            }
        }
        // A new app may not yet have Spotlight access. macOS prompts for normal
        // Downloads access here; read only Capture installer metadata afterward.
        if let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first,
           let files = try? FileManager.default.contentsOfDirectory(
               at: downloads, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]
           ) {
            for file in files.lazy.filter({
                $0.lastPathComponent.hasPrefix("LaunchStack-Capture") && $0.pathExtension == "dmg"
            }).prefix(64) {
                if let link = installerLink(at: file, matchingEvent: event) { return link }
            }
        }
        return nil
    }

    static func installerLink(at url: URL, matchingEvent event: String) -> PairingLink? {
        guard quarantineEvent(at: url) == event,
              let data = attribute("com.apple.metadata:kMDItemWhereFroms", at: url),
              let urls = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String]
        else { return nil }
        for value in urls {
            if let url = URL(string: value), let link = try? PairingLink.downloadURL(url) { return link }
        }
        return nil
    }

    private static func attribute(_ name: String, at url: URL) -> Data? {
        let count = getxattr(url.path, name, nil, 0, 0, 0)
        guard count > 0, count <= 65_536 else { return nil }
        var bytes = [UInt8](repeating: 0, count: count)
        guard getxattr(url.path, name, &bytes, bytes.count, 0, 0) == count else { return nil }
        return Data(bytes)
    }

    private static func quarantineEvent(at url: URL) -> String? {
        guard let data = attribute("com.apple.quarantine", at: url),
              let value = String(data: data, encoding: .utf8)
        else { return nil }
        let fields = value.split(separator: ";", omittingEmptySubsequences: false)
        guard fields.count >= 4, let event = UUID(uuidString: String(fields[3])) else { return nil }
        return event.uuidString
    }

    private static func originalURLIfTranslocated(_ url: URL) -> URL? {
        guard url.pathComponents.contains("AppTranslocation") else { return nil }
        // macOS has no public reverse-translocation API. Resolve this optional
        // Security SPI dynamically, read metadata only, and fall back to website
        // pairing if it disappears. Never remove or modify quarantine attributes.
        guard let library = dlopen("/System/Library/Frameworks/Security.framework/Security", RTLD_LAZY) else { return nil }
        defer { dlclose(library) }
        guard let symbol = dlsym(library, "SecTranslocateCreateOriginalPathForURL") else { return nil }
        typealias OriginalPath = @convention(c) (CFURL, UnsafeMutablePointer<Unmanaged<CFError>?>?) -> Unmanaged<CFURL>?
        let resolve = unsafeBitCast(symbol, to: OriginalPath.self)
        var error: Unmanaged<CFError>?
        let original = resolve(url as CFURL, &error)?.takeRetainedValue()
        _ = error?.takeRetainedValue()
        return original.map { $0 as URL }
    }
}
