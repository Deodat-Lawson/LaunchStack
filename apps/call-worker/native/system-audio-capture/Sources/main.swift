import AVFAudio
import CoreGraphics
import CoreMedia
import Darwin
import Foundation
import ScreenCaptureKit

private enum HelperError: Error {
    case usage(String)
    case unsupported(String)
    case permissionDenied(String)
    case capture(String)
    case conversion(String)
    case output(String)

    var exitCode: Int32 {
        switch self {
        case .usage:
            return 64
        case .unsupported:
            return 3
        case .permissionDenied:
            return 2
        case .capture, .conversion, .output:
            return 1
        }
    }

    var message: String {
        switch self {
        case let .usage(message),
             let .unsupported(message),
             let .permissionDenied(message),
             let .capture(message),
             let .conversion(message),
             let .output(message):
            return message
        }
    }
}

private enum Command {
    case status
    case requestPermission
    case capture(sampleRate: Int)
}

private enum CLIArguments {
    static func parse(_ arguments: [String]) throws -> Command {
        let arguments = Array(arguments.dropFirst())

        if arguments == ["--status"] {
            return .status
        }
        if arguments == ["--request-permission"] {
            return .requestPermission
        }
        guard arguments.count == 2, arguments[0] == "--sample-rate" else {
            throw HelperError.usage(
                "usage: launchstack-system-audio --status | --request-permission | --sample-rate <8000-192000>"
            )
        }

        let value = arguments[1]
        guard let sampleRate = Int(value), (8_000...192_000).contains(sampleRate) else {
            throw HelperError.usage(
                "--sample-rate must be an integer between 8000 and 192000 Hz"
            )
        }
        return .capture(sampleRate: sampleRate)
    }
}

private struct StatusPayload: Encodable {
    let supported: Bool
    let authorized: Bool
    let reason: String
    let message: String

    static func ready() -> StatusPayload {
        StatusPayload(
            supported: true,
            authorized: true,
            reason: "ready",
            message: "ScreenCaptureKit system-audio capture is available"
        )
    }

    static func unsupported(_ message: String) -> StatusPayload {
        StatusPayload(
            supported: false,
            authorized: false,
            reason: "unsupported",
            message: message
        )
    }

    static func permissionDenied(_ message: String) -> StatusPayload {
        StatusPayload(
            supported: true,
            authorized: false,
            reason: "permission_denied",
            message: message
        )
    }
}

private enum PermissionProbe {
    static func status() async -> StatusPayload {
        guard #available(macOS 14.0, *) else {
            return .unsupported("macOS 14.0 or newer is required")
        }

        // Preflight is deliberately non-prompting. The UI owns the user-facing
        // permission request and may invoke --request-permission when needed.
        guard CGPreflightScreenCaptureAccess() else {
            return .permissionDenied(
                "Screen Recording permission is not granted; enable it for launchstack-system-audio in System Settings > Privacy & Security > Screen Recording"
            )
        }

        do {
            let content = try await SCShareableContent.excludingDesktopWindows(
                false,
                onScreenWindowsOnly: false
            )
            guard !content.displays.isEmpty else {
                return .permissionDenied(
                    "ScreenCaptureKit found no capturable display; connect or unlock a macOS display and try again"
                )
            }
            return .ready()
        } catch {
            return .permissionDenied(
                "ScreenCaptureKit could not enumerate shareable content: \(error.localizedDescription)"
            )
        }
    }

    static func requestPermission() async -> StatusPayload {
        guard #available(macOS 14.0, *) else {
            return .unsupported("macOS 14.0 or newer is required")
        }

        if !CGPreflightScreenCaptureAccess() {
            _ = CGRequestScreenCaptureAccess()
        }
        return await status()
    }
}

private func writeStatus(_ payload: StatusPayload) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    var data = try encoder.encode(payload)
    data.append(0x0A)
    try FileHandle.standardOutput.write(contentsOf: data)
}

private func writeDiagnostic(_ message: String) {
    let data = Data("launchstack-system-audio: \(message)\n".utf8)
    try? FileHandle.standardError.write(contentsOf: data)
}

// A signal handler may only perform async-signal-safe operations. A single
// Int32 flag is enough; a DispatchSourceTimer below observes it outside the
// signal context and performs the actual ScreenCaptureKit shutdown.
private let terminationFlag: UnsafeMutablePointer<Int32> = {
    let pointer = UnsafeMutablePointer<Int32>.allocate(capacity: 1)
    pointer.initialize(to: 0)
    return pointer
}()

private func handleTerminationSignal(_ signalNumber: Int32) {
    terminationFlag.pointee = 1
}

private func installSignalHandlers() {
    terminationFlag.pointee = 0
    _ = Darwin.signal(SIGINT, handleTerminationSignal)
    _ = Darwin.signal(SIGTERM, handleTerminationSignal)
    _ = Darwin.signal(SIGPIPE, SIG_IGN)
}

private final class SignalMonitor {
    private let timer: DispatchSourceTimer

    init(handler: @escaping () -> Void) {
        timer = DispatchSource.makeTimerSource(
            flags: [],
            queue: DispatchQueue.global(qos: .utility)
        )
        timer.schedule(
            deadline: .now(),
            repeating: .milliseconds(50),
            leeway: .milliseconds(10)
        )
        timer.setEventHandler {
            if terminationFlag.pointee != 0 {
                handler()
            }
        }
        timer.resume()
    }

    func stop() {
        timer.setEventHandler {}
        timer.cancel()
    }

    deinit {
        timer.cancel()
    }
}

private final class PCMOutputWriter {
    private static let chunkSize = 64 * 1024
    private static let backpressureTimeoutNanoseconds: UInt64 = 1_000_000_000

    private let lock = NSLock()
    private var scratch = [UInt8](repeating: 0, count: PCMOutputWriter.chunkSize)
    private let originalFlags: Int32
    private var restored = false

    init() throws {
        let flags = Darwin.fcntl(STDOUT_FILENO, F_GETFL)
        guard flags >= 0 else {
            throw HelperError.output("could not inspect stdout: \(String(cString: strerror(errno)))")
        }
        originalFlags = flags

        guard Darwin.fcntl(STDOUT_FILENO, F_SETFL, flags | O_NONBLOCK) >= 0 else {
            throw HelperError.output(
                "could not configure bounded non-blocking stdout writes: \(String(cString: strerror(errno)))"
            )
        }
    }

    deinit {
        restoreFlags()
    }

    func write(buffer: AVAudioPCMBuffer) throws {
        guard buffer.format.channelCount == 1,
              let channelData = buffer.int16ChannelData else {
            throw HelperError.output("converted audio buffer was not mono signed 16-bit PCM")
        }

        let samples = channelData[0]
        let frameCount = Int(buffer.frameLength)
        guard frameCount > 0 else { return }

        lock.lock()
        defer { lock.unlock() }

        var frameOffset = 0
        try scratch.withUnsafeMutableBytes { rawBuffer in
            guard let baseAddress = rawBuffer.baseAddress else {
                throw HelperError.output("could not allocate a PCM output chunk")
            }

            while frameOffset < frameCount {
                if terminationFlag.pointee != 0 {
                    throw HelperError.output("capture interrupted while stdout was backpressured")
                }

                let framesThisChunk = min(
                    frameCount - frameOffset,
                    PCMOutputWriter.chunkSize / MemoryLayout<Int16>.size
                )
                for index in 0..<framesThisChunk {
                    let sample = UInt16(bitPattern: samples[frameOffset + index]).littleEndian
                    rawBuffer[index * 2] = UInt8(truncatingIfNeeded: sample)
                    rawBuffer[index * 2 + 1] = UInt8(truncatingIfNeeded: sample >> 8)
                }

                try writeBytes(
                    baseAddress,
                    count: framesThisChunk * MemoryLayout<Int16>.size
                )
                frameOffset += framesThisChunk
            }
        }
    }

    private func writeBytes(_ baseAddress: UnsafeMutableRawPointer, count: Int) throws {
        var offset = 0
        let deadline = DispatchTime.now().uptimeNanoseconds
            + PCMOutputWriter.backpressureTimeoutNanoseconds

        while offset < count {
            if terminationFlag.pointee != 0 {
                throw HelperError.output("capture interrupted while stdout was backpressured")
            }

            let bytesToWrite = min(count - offset, PCMOutputWriter.chunkSize)
            let written = Darwin.write(
                STDOUT_FILENO,
                baseAddress.advanced(by: offset),
                bytesToWrite
            )
            if written > 0 {
                offset += written
                continue
            }

            if written == 0 {
                throw HelperError.output("stdout closed while writing PCM audio")
            }

            let writeError = errno
            if writeError == EINTR {
                continue
            }
            if writeError == EAGAIN || writeError == EWOULDBLOCK {
                if DispatchTime.now().uptimeNanoseconds >= deadline {
                    throw HelperError.output(
                        "stdout is not being consumed; PCM write backpressure exceeded 1 second"
                    )
                }
                usleep(1_000)
                continue
            }

            throw HelperError.output(
                "could not write PCM audio to stdout: \(String(cString: strerror(writeError)))"
            )
        }
    }

    private func restoreFlags() {
        lock.lock()
        defer { lock.unlock() }
        guard !restored else { return }
        _ = Darwin.fcntl(STDOUT_FILENO, F_SETFL, originalFlags)
        restored = true
    }
}

private final class RetainedAudioBufferList {
    let pointer: UnsafeMutablePointer<AudioBufferList>
    private let retainedBlockBuffer: CMBlockBuffer?

    init(sampleBuffer: CMSampleBuffer) throws {
        var requiredSize = 0
        _ = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: &requiredSize,
            bufferListOut: nil,
            bufferListSize: 0,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: 0,
            blockBufferOut: nil
        )
        guard requiredSize > 0 else {
            throw HelperError.conversion("CMSampleBuffer did not expose an audio buffer list")
        }

        let allocatedPointer = UnsafeMutableRawPointer.allocate(
            byteCount: requiredSize,
            alignment: MemoryLayout<AudioBufferList>.alignment
        ).assumingMemoryBound(to: AudioBufferList.self)

        var blockBuffer: CMBlockBuffer?
        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: allocatedPointer,
            bufferListSize: requiredSize,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: 0,
            blockBufferOut: &blockBuffer
        )
        guard status == 0 else {
            allocatedPointer.deallocate()
            throw HelperError.conversion(
                "could not access CMSampleBuffer audio data (OSStatus \(status))"
            )
        }

        pointer = allocatedPointer
        retainedBlockBuffer = blockBuffer
    }

    deinit {
        pointer.deallocate()
    }
}

private final class PCMConverter {
    private static let maxInputFrames = 4_096
    private static let maxOutputFrames = 262_144
    private static let conversionLoopLimit = 16

    private let targetFormat: AVAudioFormat
    private let targetSampleRate: Double

    init(sampleRate: Int) throws {
        guard let targetFormat = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: Double(sampleRate),
            channels: 1,
            interleaved: true
        ) else {
            throw HelperError.conversion(
                "could not create a mono signed-16-bit target format at \(sampleRate) Hz"
            )
        }
        self.targetFormat = targetFormat
        self.targetSampleRate = Double(sampleRate)
    }

    func write(sampleBuffer: CMSampleBuffer, to writer: PCMOutputWriter) throws {
        guard let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer),
              let sourceDescription = CMAudioFormatDescriptionGetStreamBasicDescription(
                  formatDescription
              ) else {
            throw HelperError.conversion("audio sample had no valid format description")
        }

        let sourceASBD = sourceDescription.pointee
        guard sourceASBD.mFormatID == kAudioFormatLinearPCM else {
            throw HelperError.conversion(
                "ScreenCaptureKit returned a non-linear-PCM audio format (format ID \(sourceASBD.mFormatID))"
            )
        }
        guard sourceASBD.mBytesPerFrame > 0,
              sourceASBD.mSampleRate.isFinite,
              sourceASBD.mSampleRate > 0 else {
            throw HelperError.conversion("audio sample had an invalid source sample rate or frame size")
        }

        let sourceFormat = AVAudioFormat(
            cmAudioFormatDescription: formatDescription
        )

        let sampleCount = CMSampleBufferGetNumSamples(sampleBuffer)
        guard sampleCount > 0 else { return }
        let totalFrames = Int(sampleCount)
        let retainedBuffers = try RetainedAudioBufferList(sampleBuffer: sampleBuffer)
        let sourceBuffers = UnsafeMutableAudioBufferListPointer(retainedBuffers.pointer)

        let actualChannelCount = sourceBuffers.reduce(0) { count, buffer in
            count + Int(buffer.mNumberChannels)
        }
        guard actualChannelCount == Int(sourceFormat.channelCount) else {
            throw HelperError.conversion(
                "audio buffer channel layout (\(actualChannelCount)) does not match its format (\(sourceFormat.channelCount))"
            )
        }
        guard !sourceBuffers.isEmpty else {
            throw HelperError.conversion("audio sample had no audio buffers")
        }

        let sourceBytesPerFrame = Int(sourceASBD.mBytesPerFrame)
        let ratio = targetSampleRate / sourceFormat.sampleRate
        guard ratio.isFinite, ratio > 0 else {
            throw HelperError.conversion("could not derive a finite audio sample-rate conversion ratio")
        }

        var frameOffset = 0
        while frameOffset < totalFrames {
            let outputBound = Double(PCMConverter.maxOutputFrames - 128) / ratio
            let inputBound: Int
            if outputBound < 1 {
                inputBound = 1
            } else if outputBound >= Double(Int.max) {
                inputBound = PCMConverter.maxInputFrames
            } else {
                inputBound = max(1, Int(outputBound))
            }
            let inputFrameCount = min(
                totalFrames - frameOffset,
                PCMConverter.maxInputFrames,
                inputBound
            )

            let inputBuffer = try makeInputBuffer(
                format: sourceFormat,
                sourceBuffers: sourceBuffers,
                sourceBytesPerFrame: sourceBytesPerFrame,
                frameOffset: frameOffset,
                frameCount: inputFrameCount
            )

            let estimatedOutputFrames = max(
                1,
                Int(ceil(Double(inputFrameCount) * ratio)) + 128
            )
            guard estimatedOutputFrames <= PCMConverter.maxOutputFrames else {
                throw HelperError.conversion(
                    "audio conversion buffer would exceed the bounded output buffer"
                )
            }
            guard let outputBuffer = AVAudioPCMBuffer(
                pcmFormat: targetFormat,
                frameCapacity: AVAudioFrameCount(estimatedOutputFrames)
            ) else {
                throw HelperError.conversion("could not allocate a bounded audio conversion buffer")
            }

            guard let converter = AVAudioConverter(
                from: sourceFormat,
                to: targetFormat
            ) else {
                throw HelperError.conversion(
                    "AVAudioConverter cannot convert the source audio layout/rate to mono PCM"
                )
            }
            converter.downmix = true
            converter.primeMethod = .none

            var suppliedInput = false
            var finished = false
            var conversionIterations = 0
            while !finished {
                conversionIterations += 1
                guard conversionIterations <= PCMConverter.conversionLoopLimit else {
                    throw HelperError.conversion(
                        "AVAudioConverter did not drain a bounded audio sample"
                    )
                }

                outputBuffer.frameLength = 0
                var conversionError: NSError?
                let status = converter.convert(to: outputBuffer, error: &conversionError) {
                    _, inputStatus in
                    if suppliedInput {
                        inputStatus.pointee = .endOfStream
                        return nil
                    }
                    suppliedInput = true
                    inputStatus.pointee = .haveData
                    return inputBuffer
                }

                if let conversionError {
                    throw HelperError.conversion(
                        "AVAudioConverter failed: \(conversionError.localizedDescription)"
                    )
                }
                if status == .error {
                    throw HelperError.conversion(
                        "AVAudioConverter failed without an error description"
                    )
                }

                if outputBuffer.frameLength > 0 {
                    try writer.write(buffer: outputBuffer)
                }

                switch status {
                case .haveData:
                    // A full output buffer means the converter may still hold
                    // input. Re-enter it with the same EOS-aware input block.
                    finished = outputBuffer.frameLength < outputBuffer.frameCapacity
                case .inputRanDry, .endOfStream:
                    finished = true
                case .error:
                    finished = true
                @unknown default:
                    throw HelperError.conversion("AVAudioConverter returned an unknown output status")
                }
            }

            frameOffset += inputFrameCount
        }
    }

    private func makeInputBuffer(
        format: AVAudioFormat,
        sourceBuffers: UnsafeMutableAudioBufferListPointer,
        sourceBytesPerFrame: Int,
        frameOffset: Int,
        frameCount: Int
    ) throws -> AVAudioPCMBuffer {
        guard let inputBuffer = AVAudioPCMBuffer(
            pcmFormat: format,
            frameCapacity: AVAudioFrameCount(frameCount)
        ) else {
            throw HelperError.conversion("could not allocate a bounded source audio buffer")
        }
        inputBuffer.frameLength = AVAudioFrameCount(frameCount)

        let destinationBuffers = UnsafeMutableAudioBufferListPointer(
            inputBuffer.mutableAudioBufferList
        )
        guard sourceBuffers.count == destinationBuffers.count else {
            throw HelperError.conversion("source audio buffer layout changed while copying PCM")
        }

        let byteOffset = frameOffset * sourceBytesPerFrame
        let byteCount = frameCount * sourceBytesPerFrame
        for index in 0..<sourceBuffers.count {
            let sourceBuffer = sourceBuffers[index]
            let destinationBuffer = destinationBuffers[index]
            guard let sourceData = sourceBuffer.mData,
                  let destinationData = destinationBuffer.mData else {
                throw HelperError.conversion("audio buffer contained a null data pointer")
            }
            guard byteOffset <= Int(sourceBuffer.mDataByteSize),
                  byteCount <= Int(sourceBuffer.mDataByteSize) - byteOffset else {
                throw HelperError.conversion("audio sample buffer ended before its declared frame count")
            }
            guard byteCount <= Int(destinationBuffer.mDataByteSize) else {
                throw HelperError.conversion("bounded source buffer is smaller than the requested PCM chunk")
            }

            memcpy(
                destinationData,
                sourceData.advanced(by: byteOffset),
                byteCount
            )
        }

        return inputBuffer
    }
}

private final class SystemAudioCapture: NSObject, SCStreamOutput, SCStreamDelegate {
    private let filter: SCContentFilter
    private let configuration: SCStreamConfiguration
    private let converter: PCMConverter
    private let writer: PCMOutputWriter
    private let sampleQueue = DispatchQueue(
        label: "com.launchstack.call-notes.system-audio-samples",
        qos: .userInitiated
    )
    private lazy var stream: SCStream = SCStream(
        filter: filter,
        configuration: configuration,
        delegate: self
    )

    private let stateLock = NSLock()
    private var completion: CheckedContinuation<Void, Error>?
    private var started = false
    private var stopRequested = false
    private var stopIssued = false
    private var finished = false
    private var failure: Error?

    private init(
        filter: SCContentFilter,
        configuration: SCStreamConfiguration,
        converter: PCMConverter,
        writer: PCMOutputWriter
    ) {
        self.filter = filter
        self.configuration = configuration
        self.converter = converter
        self.writer = writer
    }

    static func make(sampleRate: Int) async throws -> SystemAudioCapture {
        guard #available(macOS 14.0, *) else {
            throw HelperError.unsupported("macOS 14.0 or newer is required for system-audio capture")
        }
        guard CGPreflightScreenCaptureAccess() else {
            throw HelperError.permissionDenied(
                "Screen Recording permission is not granted; run --request-permission or enable it in System Settings > Privacy & Security > Screen Recording"
            )
        }

        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(
                false,
                onScreenWindowsOnly: false
            )
        } catch {
            throw HelperError.capture(
                "ScreenCaptureKit could not enumerate shareable content: \(error.localizedDescription)"
            )
        }
        guard let display = content.displays.first else {
            throw HelperError.capture(
                "ScreenCaptureKit found no capturable display; connect or unlock a macOS display"
            )
        }

        let configuration = SCStreamConfiguration()
        configuration.capturesAudio = true
        configuration.sampleRate = sampleRate
        // Request the native two-channel system mix. PCMConverter performs
        // layout-aware downmixing to the mono wire format below.
        configuration.channelCount = 2
        configuration.excludesCurrentProcessAudio = true
        configuration.queueDepth = 1

        let filter = SCContentFilter(
            display: display,
            excludingApplications: [],
            exceptingWindows: []
        )
        let converter = try PCMConverter(sampleRate: sampleRate)
        let writer = try PCMOutputWriter()
        return SystemAudioCapture(
            filter: filter,
            configuration: configuration,
            converter: converter,
            writer: writer
        )
    }

    func run() async throws {
        do {
            try stream.addStreamOutput(
                self,
                type: .audio,
                sampleHandlerQueue: sampleQueue
            )
        } catch {
            throw HelperError.capture(
                "ScreenCaptureKit could not attach its audio output: \(error.localizedDescription)"
            )
        }

        let signalMonitor = SignalMonitor { [weak self] in
            self?.requestStop()
        }
        defer { signalMonitor.stop() }

        try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation {
                (continuation: CheckedContinuation<Void, Error>) in
                setCompletion(continuation)
                beginCapture()
            }
        }, onCancel: {
            requestStop()
        })
    }

    private func beginCapture() {
        stream.startCapture { [weak self] error in
            guard let self else { return }
            if let error {
                self.recordFailure(
                    HelperError.capture("ScreenCaptureKit could not start audio capture: \(error.localizedDescription)")
                )
                self.finish()
                return
            }

            self.stateLock.lock()
            self.started = true
            let shouldStop = self.stopRequested
            self.stateLock.unlock()
            if shouldStop {
                self.stopCaptureIfNeeded()
            }
        }
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

    private func requestStop() {
        stateLock.lock()
        guard !stopRequested else {
            stateLock.unlock()
            return
        }
        stopRequested = true
        let hasStarted = started
        stateLock.unlock()

        if hasStarted {
            stopCaptureIfNeeded()
        }
    }

    private func stopCaptureIfNeeded() {
        stateLock.lock()
        guard started, !stopIssued, !finished else {
            stateLock.unlock()
            return
        }
        stopIssued = true
        stateLock.unlock()

        stream.stopCapture { [weak self] error in
            guard let self else { return }
            if let error {
                self.recordFailure(
                    HelperError.capture("ScreenCaptureKit could not stop cleanly: \(error.localizedDescription)")
                )
            }
            self.finish()
        }
    }

    private func recordFailure(_ error: Error) {
        stateLock.lock()
        if failure == nil {
            failure = error
        }
        stateLock.unlock()
    }

    private func finish() {
        stateLock.lock()
        guard !finished else {
            stateLock.unlock()
            return
        }
        finished = true
        let continuation = completion
        completion = nil
        let failure = self.failure
        stateLock.unlock()

        guard let continuation else { return }
        if let failure {
            continuation.resume(throwing: failure)
        } else {
            continuation.resume(returning: ())
        }
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard type == .audio else { return }
        do {
            try converter.write(sampleBuffer: sampleBuffer, to: writer)
        } catch {
            if terminationFlag.pointee == 0 {
                recordFailure(error)
            }
            requestStop()
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        recordFailure(
            HelperError.capture("ScreenCaptureKit stopped unexpectedly: \(error.localizedDescription)")
        )
        finish()
    }
}

@main
@MainActor
private struct LaunchStackSystemAudio {
    static func main() async {
        do {
            let command = try CLIArguments.parse(CommandLine.arguments)
            switch command {
            case .status:
                let payload = await PermissionProbe.status()
                try writeStatus(payload)
                exit(statusExitCode(payload))
            case .requestPermission:
                let payload = await PermissionProbe.requestPermission()
                try writeStatus(payload)
                exit(statusExitCode(payload))
            case let .capture(sampleRate):
                installSignalHandlers()
                let capture = try await SystemAudioCapture.make(sampleRate: sampleRate)
                try await capture.run()
                exit(0)
            }
        } catch let error as HelperError {
            writeDiagnostic(error.message)
            exit(error.exitCode)
        } catch {
            writeDiagnostic(error.localizedDescription)
            exit(1)
        }
    }

    private static func statusExitCode(_ payload: StatusPayload) -> Int32 {
        guard payload.supported, payload.authorized, payload.reason == "ready" else {
            return payload.reason == "unsupported" ? 3 : 2
        }
        return 0
    }
}
