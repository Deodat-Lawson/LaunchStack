import AppKit
import CaptureCore
import SwiftUI

struct CaptureMenu: View {
    @ObservedObject var model: CaptureModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Image(systemName: "waveform.circle.fill").font(.title2).foregroundStyle(.tint)
                Text("LaunchStack Capture").font(.headline)
                Spacer()
                if model.pairing { ProgressView().controlSize(.small) }
            }
            VStack(alignment: .leading, spacing: 3) {
                if let connection = model.connection {
                    Text(connection.company.name).font(.subheadline.weight(.medium))
                    Text(connection.user.email).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                } else {
                    Text(model.pairing ? "Connecting…" : "Not connected").font(.subheadline).foregroundStyle(.secondary)
                }
                Button("Sync with website", action: model.syncWithWebsite).buttonStyle(.link).padding(.top, 3)
            }
            Divider()
            if let capture = model.capture, capture.isActive {
                captureSection(capture)
            } else {
                Button(action: model.startCapture) {
                    Label(model.commandBusy ? "Starting capture…" : "Start capture", systemImage: "record.circle")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.connection == nil || model.commandBusy || model.pairing || model.retryAvailable)
                Text("Records your microphone and the call’s audio. Everyone on the call should know you’re recording.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            if let pending = model.pendingStop {
                VStack(alignment: .leading, spacing: 8) {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        Label("Stopping in \(max(0, Int(pending.stopsAt.timeIntervalSince(context.date))))s", systemImage: "timer")
                            .font(.subheadline.weight(.medium)).monospacedDigit()
                    }
                    Text(pending.reason == "call_ended" ? "Your call appears to have ended." : "No speech has been heard for a while.")
                        .font(.caption).foregroundStyle(.secondary)
                    Button("Keep recording", action: model.keepRecording).buttonStyle(.bordered)
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
            }
            if let error = model.error {
                VStack(alignment: .leading, spacing: 6) {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    if model.retryAvailable { Button("Retry", action: model.retry).buttonStyle(.bordered) }
                }
            }
            Divider()
            PermissionRows(controller: model.permissions)
            Divider()
            Toggle("Launch at login", isOn: Binding(get: { model.launchAtLogin }, set: model.setLaunchAtLogin))
                .toggleStyle(.switch).controlSize(.small)
            if model.loginNeedsApproval {
                Text("Approval needed in System Settings → Login Items.").font(.caption).foregroundStyle(.secondary)
            }
            HStack {
                Button("Check for updates…", action: model.checkForUpdates).buttonStyle(.link)
                Spacer()
                Text(model.version).font(.caption).foregroundStyle(.tertiary)
            }
            Button("Quit LaunchStack Capture") { NSApp.terminate(nil) }.buttonStyle(.link)
        }
        .padding(16).frame(width: 350)
        .onAppear { model.refresh() }
    }

    @ViewBuilder
    private func captureSection(_ capture: CaptureState) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(capture.title ?? "Call capture").font(.headline).lineLimit(2)
                Spacer()
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text(elapsed(start: capture.startDate, now: context.date)).monospacedDigit().font(.subheadline)
                }
            }
            HStack {
                Label(capture.state.rawValue.capitalized, systemImage: capture.state == .paused ? "pause.circle.fill" : "record.circle")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
                Text("\(capture.segments) segment\(capture.segments == 1 ? "" : "s")").font(.caption).foregroundStyle(.secondary).monospacedDigit()
            }
            HStack(spacing: 14) {
                channel("Microphone", symbol: "mic.fill", active: capture.channels.microphone)
                channel("System audio", symbol: "speaker.wave.2.fill", active: capture.channels.system)
            }
            HStack {
                Button(action: model.stopCapture) { Label("Stop", systemImage: "stop.fill") }
                    .buttonStyle(.bordered).disabled(model.commandBusy || capture.state == .stopping)
                Spacer()
                Button("Open in LaunchStack", action: model.openCapture).buttonStyle(.link).disabled(capture.callId == nil)
            }
        }
    }

    private func channel(_ title: String, symbol: String, active: Bool) -> some View {
        Label(title, systemImage: symbol).font(.caption)
            .foregroundStyle(active ? Color.primary : Color.secondary)
            .accessibilityLabel("\(title), \(active ? "active" : "unavailable")")
            .help(active ? "Capturing \(title.lowercased())" : "\(title) is not capturing")
    }

    private func elapsed(start: Date?, now: Date) -> String {
        let seconds = max(0, Int(start.map { now.timeIntervalSince($0) } ?? 0))
        if seconds >= 3_600 { return String(format: "%d:%02d:%02d", seconds / 3_600, seconds / 60 % 60, seconds % 60) }
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}

private struct PermissionRows: View {
    @ObservedObject var controller: PermissionController

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Permissions").font(.caption.weight(.medium)).foregroundStyle(.secondary)
            row("Microphone", source: "microphone", symbol: "mic", permission: controller.permissions?.microphone)
            row("Screen & system audio", source: "system", symbol: "display", permission: controller.permissions?.system)
            if let error = controller.error { Text(error).font(.caption).foregroundStyle(.secondary) }
        }
    }

    private func row(_ title: String, source: String, symbol: String, permission: AudioPermission?) -> some View {
        HStack(spacing: 8) {
            Image(systemName: symbol).frame(width: 16).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline)
                Text(permission?.label ?? "Checking…").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Button(permission?.authorized == true ? "Settings…" : "Allow…") {
                if permission?.authorized == true { controller.openSettings(source) }
                else { controller.request(source) }
            }
            .controlSize(.small).disabled(controller.checking)
            .help(permission?.message ?? "Check privacy permissions")
            .accessibilityLabel("\(title) privacy settings")
        }
    }
}
