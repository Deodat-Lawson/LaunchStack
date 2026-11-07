import Foundation
import XCTest
@testable import CaptureCore

final class CaptureCoreTests: XCTestCase {
    func testQuarantineDownloadURL() throws {
        let link = try PairingLink.downloadURL(URL(string: "https://launch.example/api/call-notes/capture-app/d/lsp_abc-123/LaunchStack-Capture.dmg")!)
        XCTAssertEqual(link.origin.absoluteString, "https://launch.example")
        XCTAssertEqual(link.code, "lsp_abc-123")
        let local = try PairingLink.downloadURL(URL(string: "http://localhost:3000/api/call-notes/capture-app/d/lsp_dev/Capture.dmg")!)
        XCTAssertEqual(local.origin.absoluteString, "http://localhost:3000")
    }

    func testQuarantineRejectsUnrelatedAndUnsafeURLs() {
        for text in [
            "https://launch.example/api/call-notes/capture-app/d/lsp_abc",
            "https://launch.example/api/call-notes/capture-app/d/lsp_abc/Capture.dmg/extra",
            "https://launch.example/api/call-notes/capture-app/d/no_code/Capture.dmg",
            "http://launch.example/api/call-notes/capture-app/d/lsp_abc/Capture.dmg",
            "https://user:secret@launch.example/api/call-notes/capture-app/d/lsp_abc/Capture.dmg",
            "https://launch.example/api/call-notes/capture-app/d/lsp_a%2Fb/Capture.dmg",
        ] { XCTAssertThrowsError(try PairingLink.downloadURL(URL(string: text)!)) }
    }

    func testDeepLink() throws {
        let link = try PairingLink.deepLink(URL(string: "launchstack-capture://pair?origin=https%3A%2F%2Flaunch.example&code=lsp_code_123")!)
        XCTAssertEqual(link.origin.absoluteString, "https://launch.example")
        XCTAssertEqual(link.code, "lsp_code_123")
    }

    func testDeepLinkRejectsAmbiguousAndUnsafeValues() {
        for text in [
            "launchstack-capture://other?origin=https://launch.example&code=lsp_code",
            "launchstack-capture://pair?origin=https://launch.example&origin=https://other.example&code=lsp_code",
            "launchstack-capture://pair?origin=https://launch.example&code=lsp_a&code=lsp_b",
            "launchstack-capture://pair?origin=https://launch.example/path&code=lsp_code",
            "launchstack-capture://pair?origin=file:///tmp&code=lsp_code",
            "launchstack-capture://pair?origin=https://launch.example&code=lsp_%0Aevil",
        ] { XCTAssertThrowsError(try PairingLink.deepLink(URL(string: text)!)) }
    }

    func testRestartBackoffAndRollingBudget() {
        var budget = RestartBudget()
        let start = Date(timeIntervalSince1970: 1_000)
        for delay in [1.0, 2, 4, 8, 16] { XCTAssertEqual(budget.nextDelay(now: start), delay) }
        XCTAssertNil(budget.nextDelay(now: start.addingTimeInterval(599)))
        XCTAssertEqual(budget.nextDelay(now: start.addingTimeInterval(600)), 1)
        budget.reset()
        XCTAssertEqual(budget.nextDelay(now: start), 1)
    }

    func testIPCPartialAndCoalescedLines() throws {
        var parser = IPCLineParser()
        let state = "{\"type\":\"state\",\"state\":\"capturing\",\"callId\":\"call_1\",\"title\":\"Planning\",\"startedAt\":\"2026-10-25T01:00:00.000Z\",\"channels\":{\"microphone\":true,\"system\":false},\"segments\":3}"
        XCTAssertTrue(try parser.append(Data(state.prefix(20).utf8)).isEmpty)
        let events = try parser.append(Data((state.dropFirst(20) + "\n{\"type\":\"auto_stop_cancelled\"}\n").utf8))
        XCTAssertEqual(events.count, 2)
        guard case let .state(value) = events[0] else { return XCTFail("Expected state") }
        XCTAssertEqual(value.callId, "call_1")
        XCTAssertEqual(value.segments, 3)
        XCTAssertTrue(value.channels.microphone)
        XCTAssertFalse(value.channels.system)
        XCTAssertNotNil(value.startDate)
        XCTAssertEqual(events[1], .autoStopCancelled)
    }

    func testIPCPendingDateAndMalformedLines() throws {
        var parser = IPCLineParser()
        let events = try parser.append(Data("{\"type\":\"auto_stop_pending\",\"reason\":\"call_ended\",\"stopsAt\":\"2026-10-25T01:01:00Z\"}\r\n".utf8))
        guard case let .autoStopPending(reason, _) = events[0] else { return XCTFail("Expected pending") }
        XCTAssertEqual(reason, "call_ended")
        XCTAssertThrowsError(try parser.append(Data("not JSON\n".utf8)))
        parser.reset()
        XCTAssertThrowsError(try parser.append(Data("{\"type\":\"unknown\"}\n".utf8)))
    }

    func testIPCBoundsUnterminatedAndTerminatedLines() {
        var parser = IPCLineParser(maxLineBytes: 8)
        XCTAssertThrowsError(try parser.append(Data("123456789".utf8)))
        XCTAssertThrowsError(try parser.append(Data("123456789\n".utf8)))
    }

    func testCallEndedRequiresObservedInputAndContinuousSilence() {
        var tracker = CallEndedTracker()
        let start = Date(timeIntervalSince1970: 1_000)
        XCTAssertFalse(tracker.observe(otherInputRunning: false, now: start))
        XCTAssertFalse(tracker.observe(otherInputRunning: false, now: start.addingTimeInterval(500)))
        XCTAssertFalse(tracker.observe(otherInputRunning: true, now: start))
        XCTAssertFalse(tracker.observe(otherInputRunning: false, now: start.addingTimeInterval(1)))
        XCTAssertFalse(tracker.observe(otherInputRunning: nil, now: start.addingTimeInterval(100)))
        XCTAssertFalse(tracker.observe(otherInputRunning: false, now: start.addingTimeInterval(101)))
        XCTAssertFalse(tracker.observe(otherInputRunning: false, now: start.addingTimeInterval(220)))
        XCTAssertTrue(tracker.observe(otherInputRunning: false, now: start.addingTimeInterval(221)))
        XCTAssertFalse(tracker.observe(otherInputRunning: false, now: start.addingTimeInterval(500)))
    }
}
