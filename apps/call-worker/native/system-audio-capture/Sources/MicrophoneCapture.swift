import AVFAudio
import AVFoundation
import CoreAudio
import Foundation

private final class MicrophonePCMConverter {
    static let preferredInputFrames: AVAudioFrameCount = 4_096
    private static let maxInputFrames: AVAudioFrameCount = 65_536
    private static let maxOutputFrames = 262_144
    private static let conversionLoopLimit = 64

    private let inputFormat: AVAudioFormat
    private let converter: AVAudioConverter
    private let outputBuffer: AVAudioPCMBuffer

    init(inputFormat: AVAudioFormat, sampleRate: Int) throws {
        guard inputFormat.sampleRate.isFinite,
              inputFormat.sampleRate > 0,
              inputFormat.channelCount > 0,
              let outputFormat = AVAudioFormat(
                  commonFormat: .pcmFormatInt16,
                  sampleRate: Double(sampleRate),
                  channels: 1,
                  interleaved: true
              ),
              let converter = AVAudioConverter(from: inputFormat, to: outputFormat) else {
            throw HelperError.conversion(
                "AVAudioConverter cannot convert the microphone input format to mono signed-16-bit PCM"
            )
        }

        let ratio = Double(sampleRate) / inputFormat.sampleRate
        let capacity = ceil(Double(Self.preferredInputFrames) * ratio) + 128
        guard capacity.isFinite, capacity > 0,
              capacity <= Double(Self.maxOutputFrames),
              let outputBuffer = AVAudioPCMBuffer(
                  pcmFormat: outputFormat,
                  frameCapacity: AVAudioFrameCount(max(1_024, capacity))
              ) else {
            throw HelperError.conversion("could not allocate a bounded microphone conversion buffer")
        }

        converter.downmix = true
        converter.primeMethod = .none
        self.inputFormat = inputFormat
        self.converter = converter
        self.outputBuffer = outputBuffer
    }

    func write(buffer: AVAudioPCMBuffer, to writer: PCMOutputWriter) throws {
        guard inputFormat.isEqual(buffer.format) else {
            throw HelperError.conversion("microphone input format changed; restart capture")
        }
        guard buffer.frameLength > 0 else { return }
        guard buffer.frameLength <= Self.maxInputFrames else {
            throw HelperError.conversion("microphone input exceeded the bounded audio buffer")
        }

        // Keep the converter alive across taps so fractional resampling state
        // is not discarded. The tap buffer stays valid throughout this call;
        // the reusable output buffer avoids copying/allocating per callback.
        var suppliedInput = false
        for _ in 0..<Self.conversionLoopLimit {
            outputBuffer.frameLength = 0
            var conversionError: NSError?
            let status = converter.convert(to: outputBuffer, error: &conversionError) {
                _, inputStatus in
                guard !suppliedInput else {
                    inputStatus.pointee = .noDataNow
                    return nil
                }
                suppliedInput = true
                inputStatus.pointee = .haveData
                return buffer
            }

            if let conversionError {
                throw HelperError.conversion(
                    "microphone PCM conversion failed: \(conversionError.localizedDescription)"
                )
            }
            if status == .error {
                throw HelperError.conversion("microphone PCM conversion failed without an error description")
            }
            if outputBuffer.frameLength > 0 {
                try writer.write(buffer: outputBuffer)
            }

            switch status {
            case .inputRanDry:
                return
            case .haveData:
                guard outputBuffer.frameLength > 0 else {
                    throw HelperError.conversion("microphone PCM converter made no progress")
                }
            case .endOfStream:
                throw HelperError.conversion("microphone PCM converter ended unexpectedly")
            case .error:
                return
            @unknown default:
                throw HelperError.conversion("microphone PCM converter returned an unknown output status")
            }
        }
        throw HelperError.conversion("microphone PCM converter did not drain a bounded input buffer")
    }
}

final class MicrophoneCapture {
    private let engine: AVAudioEngine
    private let inputFormat: AVAudioFormat
    private let converter: MicrophonePCMConverter
    private let writer: PCMOutputWriter
    private let controlQueue = DispatchQueue(
        label: "com.launchstack.call-notes.microphone-control",
        qos: .userInitiated
    )
    private var tapInstalled = false
    private var configurationObserver: NSObjectProtocol?

    private let stateLock = NSLock()
    private var completion: CheckedContinuation<Void, Error>?
    private var stopRequested = false
    private var finished = false
    private var failure: Error?

    private init(
        engine: AVAudioEngine,
        inputFormat: AVAudioFormat,
        converter: MicrophonePCMConverter,
        writer: PCMOutputWriter
    ) {
        self.engine = engine
        self.inputFormat = inputFormat
        self.converter = converter
        self.writer = writer
    }

    static func make(sampleRate: Int) throws -> MicrophoneCapture {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            break
        case .notDetermined:
            throw HelperError.permissionDenied(
                "Microphone permission has not been requested; run --request-permission microphone"
            )
        case .denied:
            throw HelperError.permissionDenied(
                "Microphone permission is denied; enable it for LaunchStack Capture in System Settings > Privacy & Security > Microphone"
            )
        case .restricted:
            throw HelperError.permissionDenied("Microphone access is restricted by macOS or device policy")
        @unknown default:
            throw HelperError.permissionDenied("macOS reported an unknown microphone permission state")
        }

        // An input node can assert when there is no default hardware input.
        // Check CoreAudio before asking AVAudioEngine to construct that node.
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var device = AudioDeviceID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        let status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            &size,
            &device
        )
        guard status == noErr, device != AudioDeviceID(kAudioObjectUnknown) else {
            throw HelperError.capture("no default microphone input device is available (OSStatus \(status))")
        }

        let engine = AVAudioEngine()
        let inputFormat = engine.inputNode.outputFormat(forBus: 0)
        guard inputFormat.sampleRate.isFinite,
              inputFormat.sampleRate > 0,
              inputFormat.channelCount > 0 else {
            throw HelperError.capture("the default microphone input has no usable audio format")
        }
        return MicrophoneCapture(
            engine: engine,
            inputFormat: inputFormat,
            converter: try MicrophonePCMConverter(inputFormat: inputFormat, sampleRate: sampleRate),
            writer: try PCMOutputWriter()
        )
    }

    func run() async throws {
        let signalMonitor = SignalMonitor { [weak self] in
            self?.requestStop()
        }
        defer { signalMonitor.stop() }

        try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation {
                (continuation: CheckedContinuation<Void, Error>) in
                setCompletion(continuation)
                controlQueue.async { [self] in
                    beginCapture()
                }
            }
        }, onCancel: {
            requestStop()
        })
    }

    private func beginCapture() {
        guard !isStopping else {
            finish()
            return
        }

        engine.inputNode.installTap(
            onBus: 0,
            bufferSize: MicrophonePCMConverter.preferredInputFrames,
            format: inputFormat
        ) { [weak self] buffer, _ in
            self?.consume(buffer)
        }
        tapInstalled = true
        engine.prepare()
        do {
            try engine.start()
        } catch {
            recordFailure(HelperError.capture("could not start microphone capture: \(error.localizedDescription)"))
            stopCapture()
            return
        }

        configurationObserver = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange,
            object: engine,
            queue: nil
        ) { [weak self] _ in
            self?.controlQueue.async { [weak self] in
                guard let self, !self.isStopping else { return }
                self.recordFailure(
                    HelperError.capture("microphone input configuration changed; restart capture")
                )
                self.requestStop()
            }
        }
    }

    private var isStopping: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return stopRequested || finished || terminationFlag.pointee != 0
    }

    private func consume(_ buffer: AVAudioPCMBuffer) {
        guard !isStopping else { return }
        do {
            try converter.write(buffer: buffer, to: writer)
        } catch {
            if terminationFlag.pointee == 0 {
                recordFailure(error)
            }
            requestStop()
        }
    }

    private func requestStop() {
        stateLock.lock()
        guard !stopRequested, !finished else {
            stateLock.unlock()
            return
        }
        stopRequested = true
        stateLock.unlock()
        controlQueue.async { [self] in
            stopCapture()
        }
    }

    private func stopCapture() {
        stateLock.lock()
        let alreadyFinished = finished
        stateLock.unlock()
        guard !alreadyFinished else { return }

        if let configurationObserver {
            NotificationCenter.default.removeObserver(configurationObserver)
            self.configurationObserver = nil
        }
        engine.stop()
        if tapInstalled {
            engine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        finish()
    }

    private func recordFailure(_ error: Error) {
        stateLock.lock()
        if failure == nil, !finished {
            failure = error
        }
        stateLock.unlock()
    }

    private func setCompletion(_ continuation: CheckedContinuation<Void, Error>) {
        stateLock.lock()
        if finished {
            let failure = self.failure
            stateLock.unlock()
            if let failure {
                continuation.resume(throwing: failure)
            } else {
                continuation.resume(returning: ())
            }
            return
        }
        completion = continuation
        stateLock.unlock()
    }

    private func finish() {
        stateLock.lock()
        guard !finished else {
            stateLock.unlock()
            return
        }
        finished = true
        let completion = self.completion
        self.completion = nil
        let failure = self.failure
        stateLock.unlock()

        if let failure {
            completion?.resume(throwing: failure)
        } else {
            completion?.resume(returning: ())
        }
    }
}
