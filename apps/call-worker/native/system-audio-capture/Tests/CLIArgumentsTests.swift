import Foundation
import XCTest
@testable import LaunchStackSystemAudio

final class CLIArgumentsTests: XCTestCase {
    func testUnqualifiedStatusStillChecksBothSources() throws {
        XCTAssertEqual(try parse(["--status"]), .status(source: nil))
    }

    func testStatusCanSelectOnlyTheRequiredSource() throws {
        XCTAssertEqual(
            try parse(["--status", "--source", "microphone"]),
            .status(source: .microphone)
        )
        XCTAssertEqual(
            try parse(["--status", "--source", "system"]),
            .status(source: .system)
        )
    }

    func testStatusRejectsIncompleteUnknownOrDuplicateSources() {
        for arguments in [
            ["--status", "--source"],
            ["--status", "microphone"],
            ["--status", "--source", "camera"],
            ["--status", "--source", "microphone", "--source", "system"],
            ["--status", "--source", "system", "--sample-rate", "16000"],
            ["--source", "microphone", "--status"],
        ] {
            XCTAssertThrowsError(try parse(arguments), "Accepted invalid arguments: \(arguments)")
        }
    }

    func testCaptureAndPermissionRequestContractsAreUnchanged() throws {
        XCTAssertEqual(try parse(["--sample-rate", "16000"]), .capture(source: .system, sampleRate: 16_000))
        XCTAssertEqual(
            try parse(["--source", "microphone", "--sample-rate", "16000"]),
            .capture(source: .microphone, sampleRate: 16_000)
        )
        XCTAssertEqual(try parse(["--request-permission"]), .requestPermission(.system))
        XCTAssertEqual(try parse(["--request-permission", "microphone"]), .requestPermission(.microphone))
    }

    func testConcurrentStatusProcessesRemainIndependentOfCaptureInventory() throws {
        let executable = Bundle(for: Self.self).bundleURL.deletingLastPathComponent()
            .appendingPathComponent("launchstack-system-audio")
        let environment = ProcessInfo.processInfo.environment.filter {
            ["HOME", "TMPDIR", "LANG", "PATH"].contains($0.key)
        }
        var probes: [(Process, Pipe, Set<String>)] = []
        defer {
            for (process, _, _) in probes where process.isRunning {
                process.terminate()
            }
        }
        for (arguments, expectedSources) in [
            (["--status", "--source", "microphone"], Set(["microphone"])),
            (["--status", "--source", "system"], Set(["system"])),
            (["--status"], Set(["microphone", "system"])),
        ] {
            let process = Process()
            let output = Pipe()
            process.executableURL = executable
            process.arguments = arguments
            process.environment = environment
            process.standardOutput = output
            process.standardError = FileHandle.nullDevice
            try process.run()
            probes.append((process, output, expectedSources))
        }
        for (process, output, expectedSources) in probes {
            let data = output.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()

            XCTAssertEqual(process.terminationStatus, 0)
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: [String: Any]])
            XCTAssertEqual(Set(payload.keys), expectedSources)
            for status in payload.values {
                let authorized = try XCTUnwrap(status["authorized"] as? Bool)
                let supported = try XCTUnwrap(status["supported"] as? Bool)
                XCTAssertEqual(authorized, status["state"] as? String == "authorized")
                XCTAssertFalse(try XCTUnwrap(status["message"] as? String).contains("ScreenCaptureKit"))
                if status["reason"] as? String == "ready" {
                    XCTAssertTrue(authorized)
                    XCTAssertTrue(supported)
                } else {
                    XCTAssertFalse(authorized)
                }
            }
        }
    }

    private func parse(_ arguments: [String]) throws -> Command {
        try CLIArguments.parse(["launchstack-system-audio"] + arguments)
    }
}
