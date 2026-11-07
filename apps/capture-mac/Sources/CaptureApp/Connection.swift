import CaptureCore
import CryptoKit
import Foundation
import Security

struct DeviceConnection: Codable {
    struct User: Codable {
        let id: String
        let name: String?
        let email: String
    }
    struct Company: Codable {
        let id: String
        let name: String

        init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            if let text = try? values.decode(String.self, forKey: .id) {
                id = text
            } else {
                id = String(try values.decode(Int64.self, forKey: .id))
            }
            name = try values.decode(String.self, forKey: .name)
        }
    }
    let origin: URL
    let deviceId: String
    let token: String
    let user: User
    let company: Company
}

enum ConnectionStore {
    private static let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "app.launchstack.capture",
        kSecAttrAccount as String: "paired-device",
    ]

    static func load() throws -> DeviceConnection? {
        var lookup = query
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else { throw KeychainError(status) }
        return try JSONDecoder().decode(DeviceConnection.self, from: data)
    }

    static func save(_ connection: DeviceConnection) throws {
        let attributes: [String: Any] = [
            kSecValueData as String: try JSONEncoder().encode(connection),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            let item = query.merging(attributes) { _, new in new }
            let added = SecItemAdd(item as CFDictionary, nil)
            guard added == errSecSuccess else { throw KeychainError(added) }
        } else if status != errSecSuccess { throw KeychainError(status) }
    }

    static func delete() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError(status) }
    }

    private struct KeychainError: LocalizedError {
        let status: OSStatus
        init(_ status: OSStatus) { self.status = status }
        var errorDescription: String? { "Keychain access failed (\(status)). Unlock your login keychain and try again." }
    }
}

struct ConsumedPairingCodes {
    private let defaults = UserDefaults.standard
    private let key = "consumedPairingCodeHashes"

    private func hash(_ link: PairingLink) -> String {
        SHA256.hash(data: Data("\(link.origin.absoluteString)|\(link.code)".utf8)).map { String(format: "%02x", $0) }.joined()
    }

    func contains(_ link: PairingLink) -> Bool { (defaults.stringArray(forKey: key) ?? []).contains(hash(link)) }

    func insert(_ link: PairingLink) {
        var values = defaults.stringArray(forKey: key) ?? []
        let digest = hash(link)
        if !values.contains(digest) { values.append(digest) }
        defaults.set(values, forKey: key)
    }
}

final class DeviceAPI: NSObject, URLSessionTaskDelegate {
    enum APIError: LocalizedError {
        case status(Int), invalidResponse
        var errorDescription: String? {
            switch self {
            case .status(410): return "This connection code has expired or was used. Sync with the website to get a new one."
            case .status(401): return "This Mac is no longer connected. Sync with the website to reconnect."
            case .status(426): return "Update required. Install the latest LaunchStack Capture to continue."
            case let .status(code): return "LaunchStack could not complete the request (HTTP \(code)). Try again."
            case .invalidResponse: return "The website returned an invalid response."
            }
        }
    }

    private lazy var session = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: nil)

    func pair(_ link: PairingLink, version: String) async throws -> DeviceConnection {
        let body = ["code": link.code, "name": Host.current().localizedName ?? "Mac", "appVersion": version, "os": "macos", "arch": "arm64"]
        let data = try await post(origin: link.origin, path: "api/call-notes/devices/pair", body: body, connection: nil, version: version)
        let result = try JSONDecoder().decode(DeviceConnection.self, from: data)
        guard try PairingLink.origin(from: result.origin) == link.origin, result.origin.path.isEmpty || result.origin.path == "/",
              result.token.hasPrefix("lsc_"), !result.deviceId.isEmpty
        else { throw APIError.invalidResponse }
        return result
    }

    func command(_ kind: String, callId: String? = nil, connection: DeviceConnection, version: String) async throws {
        var body = ["kind": kind]
        if let callId { body["callId"] = callId }
        _ = try await post(origin: connection.origin, path: "api/call-notes/devices/commands", body: body, connection: connection, version: version)
    }

    private func post(origin: URL, path: String, body: [String: String], connection: DeviceConnection?, version: String) async throws -> Data {
        var request = URLRequest(url: origin.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(version, forHTTPHeaderField: "X-LaunchStack-Capture-Version")
        if let connection { request.setValue("Bearer \(connection.token)", forHTTPHeaderField: "Authorization") }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200...299).contains(http.statusCode) else { throw APIError.status(http.statusCode) }
        return data
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        // Never forward connection codes or bearer tokens through redirects.
        completionHandler(nil)
    }
}
