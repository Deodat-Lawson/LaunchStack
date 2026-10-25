import CaptureCore
import CoreAudio
import Darwin
import Foundation

@MainActor
final class CallAudioMonitor {
    var onCallEnded: (() -> Void)?
    var workerGroup: (() -> pid_t?)?
    private var timer: Timer?
    private var callId: String?
    private var tracker = CallEndedTracker()

    func update(_ state: CaptureState) {
        guard let id = state.callId, state.isActive else { stop(); return }
        guard state.state == .capturing else {
            timer?.invalidate()
            timer = nil
            return
        }
        if callId != id { stop(); callId = id; tracker = CallEndedTracker() }
        guard timer == nil else { return }
        sample()
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.sample() }
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        callId = nil
        tracker = CallEndedTracker()
    }

    private func sample() {
        if tracker.observe(otherInputRunning: otherProcessHasRunningInput()) { onCallEnded?() }
    }

    private func otherProcessHasRunningInput() -> Bool? {
        guard #available(macOS 14.2, *) else { return nil }
        var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyProcessObjectList,
                                                mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        let system = AudioObjectID(kAudioObjectSystemObject)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(system, &address, 0, nil, &size) == noErr else { return nil }
        var objects = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
        guard !objects.isEmpty else { return false }
        let status = objects.withUnsafeMutableBytes { bytes in
            AudioObjectGetPropertyData(system, &address, 0, nil, &size, bytes.baseAddress!)
        }
        guard status == noErr else { return nil }
        let count = min(objects.count, Int(size) / MemoryLayout<AudioObjectID>.size)
        let group = workerGroup?()
        var incomplete = false
        for object in objects.prefix(count) {
            var rawPID: UInt32 = 0
            var running: UInt32 = 0
            guard read(object, selector: kAudioProcessPropertyPID, into: &rawPID),
                  rawPID > 0, rawPID <= UInt32(Int32.max) else { incomplete = true; continue }
            let pid = pid_t(rawPID)
            if pid == getpid() || (group != nil && getpgid(pid) == group!) { continue }
            guard read(object, selector: kAudioProcessPropertyIsRunningInput, into: &running) else { incomplete = true; continue }
            if running != 0 { return true }
        }
        return incomplete ? nil : false
    }

    private func read(_ object: AudioObjectID, selector: AudioObjectPropertySelector, into value: inout UInt32) -> Bool {
        var address = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var size = UInt32(MemoryLayout<UInt32>.size)
        return AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr
    }
}
