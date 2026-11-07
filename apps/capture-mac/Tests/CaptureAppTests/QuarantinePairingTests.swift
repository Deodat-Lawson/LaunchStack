import Darwin
import Foundation
import XCTest
@testable import CaptureApp

final class QuarantinePairingTests: XCTestCase {
    func testMatchesExactInstallerWithoutSpotlightIndexing() throws {
        let event = UUID().uuidString
        try withInstaller(event: event, urls: [
            "https://company.example/api/call-notes/capture-app/d/lsp_fresh/LaunchStack-Capture.dmg",
            "https://company.example/employer/documents?feature=calls",
        ]) { file in
            let link = QuarantinePairing.installerLink(at: file, matchingEvent: event)
            XCTAssertEqual(link?.origin.absoluteString, "https://company.example")
            XCTAssertEqual(link?.code, "lsp_fresh")
        }
    }

    func testNeverConnectsUsingAnotherDownloadsInstaller() throws {
        try withInstaller(event: UUID().uuidString, urls: [
            "https://other-company.example/api/call-notes/capture-app/d/lsp_other/LaunchStack-Capture.dmg",
        ]) { file in
            XCTAssertNil(QuarantinePairing.installerLink(at: file, matchingEvent: UUID().uuidString))
        }
    }

    func testRejectsUnrelatedAndInsecureOriginMetadata() throws {
        let event = UUID().uuidString
        try withInstaller(event: event, urls: [
            "https://company.example/employer/documents?feature=calls",
            "http://company.example/api/call-notes/capture-app/d/lsp_insecure/Capture.dmg",
        ]) { file in
            XCTAssertNil(QuarantinePairing.installerLink(at: file, matchingEvent: event))
        }
    }

    func testMalformedMetadataDoesNotCreateAConnection() throws {
        let event = UUID().uuidString
        try withInstaller(event: event, urls: []) { file in
            try attribute("com.apple.metadata:kMDItemWhereFroms", data: Data("not a plist".utf8), at: file)
            XCTAssertNil(QuarantinePairing.installerLink(at: file, matchingEvent: event))
        }
    }

    private func withInstaller(event: String, urls: [String], body: (URL) throws -> Void) throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("LaunchStack-Capture.dmg")
        try Data().write(to: file)
        try attribute("com.apple.quarantine", data: Data("0081;6adda1ee;Chrome;\(event)".utf8), at: file)
        try attribute("com.apple.metadata:kMDItemWhereFroms", data: PropertyListSerialization.data(
            fromPropertyList: urls, format: .binary, options: 0
        ), at: file)
        try body(file)
    }

    private func attribute(_ name: String, data: Data, at url: URL) throws {
        let status = data.withUnsafeBytes { bytes in
            setxattr(url.path, name, bytes.baseAddress, bytes.count, 0, 0)
        }
        if status != 0 { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
    }
}
