import AppKit
import Darwin
import SwiftUI

@MainActor
private enum CaptureRuntime {
    static let model = CaptureModel()
}

@main
struct LaunchStackCapture: App {
    @NSApplicationDelegateAdaptor(CaptureAppDelegate.self) private var delegate
    @StateObject private var model = CaptureRuntime.model

    var body: some Scene {
        MenuBarExtra {
            CaptureMenu(model: model)
        } label: {
            Image(systemName: model.capture?.isActive == true ? "record.circle.fill" : "waveform.circle")
                .accessibilityLabel("LaunchStack Capture")
        }
        .menuBarExtraStyle(.window)
    }
}

@MainActor
final class CaptureAppDelegate: NSObject, NSApplicationDelegate {
    private var terminationSource: DispatchSourceSignal?
    private var terminating = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        signal(SIGPIPE, SIG_IGN)
        signal(SIGTERM, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        source.setEventHandler {
            // terminateLater runs a nested AppKit loop. Do not enter it while
            // holding the serial main dispatch queue: worker drain callbacks
            // and the termination reply must still be able to run.
            RunLoop.main.perform(inModes: [.common]) { NSApp.terminate(nil) }
        }
        source.resume()
        terminationSource = source
        CaptureRuntime.model.start()
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        urls.forEach { CaptureRuntime.model.handle($0) }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !terminating else { return .terminateLater }
        terminating = true
        CaptureRuntime.model.shutdown {
            RunLoop.main.perform(inModes: [.common]) { NSApp.reply(toApplicationShouldTerminate: true) }
        }
        return .terminateLater
    }

    func applicationWillTerminate(_ notification: Notification) {
        CaptureRuntime.model.log.message("Capture app quit cleanly")
    }
}
