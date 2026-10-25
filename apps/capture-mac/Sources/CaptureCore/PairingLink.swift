import Foundation

public struct PairingLink: Equatable {
    public let origin: URL
    public let code: String

    public enum InvalidLink: Error, LocalizedError {
        case invalidOrigin, invalidCode, invalidURL

        public var errorDescription: String? {
            switch self {
            case .invalidOrigin: return "Enter an HTTPS website URL (HTTP is allowed only for localhost)."
            case .invalidCode: return "This connection code is not valid. Get a new code from LaunchStack."
            case .invalidURL: return "This is not a LaunchStack Capture connection link."
            }
        }
    }

    public static func origin(from url: URL) throws -> URL {
        guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil,
              parts.scheme == "https" || (parts.scheme == "http" && ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host))
        else { throw InvalidLink.invalidOrigin }
        parts.path = ""
        parts.query = nil
        parts.fragment = nil
        guard let origin = parts.url else { throw InvalidLink.invalidOrigin }
        return origin
    }

    public static func downloadURL(_ url: URL) throws -> PairingLink {
        let parts = url.path.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 7, parts[0].isEmpty,
              Array(parts[1...4]) == ["api", "call-notes", "capture-app", "d"],
              !parts[6].isEmpty, url.query == nil, url.fragment == nil
        else { throw InvalidLink.invalidURL }
        return try PairingLink(origin: origin(from: url), code: String(parts[5]))
    }

    public static func deepLink(_ url: URL) throws -> PairingLink {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme == "launchstack-capture", parts.host == "pair",
              parts.path.isEmpty || parts.path == "/", parts.fragment == nil,
              parts.user == nil, parts.password == nil, parts.port == nil,
              let query = parts.queryItems,
              query.filter({ $0.name == "origin" }).count == 1,
              query.filter({ $0.name == "code" }).count == 1,
              let originText = query.first(where: { $0.name == "origin" })?.value,
              let originURL = URL(string: originText),
              let code = query.first(where: { $0.name == "code" })?.value
        else { throw InvalidLink.invalidURL }
        let canonicalOrigin = try origin(from: originURL)
        guard originURL.path.isEmpty || originURL.path == "/", originURL.query == nil, originURL.fragment == nil
        else { throw InvalidLink.invalidOrigin }
        return try PairingLink(origin: canonicalOrigin, code: code)
    }

    private init(origin: URL, code: String) throws {
        guard code.hasPrefix("lsp_"), (5...128).contains(code.utf8.count),
              code.utf8.allSatisfy({ (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95 })
        else { throw InvalidLink.invalidCode }
        self.origin = origin
        self.code = code
    }
}
