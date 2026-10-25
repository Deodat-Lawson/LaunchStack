import CaptureCore
import CoreServices
import Darwin
import Foundation

struct QuarantinePairing {
    static func discover(bundleURL: URL) -> PairingLink? {
        var candidates = [bundleURL]
        if let original = originalURLIfTranslocated(bundleURL), original != bundleURL { candidates.append(original) }
        for candidate in candidates {
            guard let values = try? candidate.resourceValues(forKeys: [.quarantinePropertiesKey]),
                  let properties = values.quarantineProperties,
                  let value = properties[kLSQuarantineDataURLKey as String]
            else { continue }
            let downloadURL = (value as? URL) ?? (value as? String).flatMap(URL.init(string:))
            if let downloadURL, let link = try? PairingLink.downloadURL(downloadURL) { return link }
        }
        return nil
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
