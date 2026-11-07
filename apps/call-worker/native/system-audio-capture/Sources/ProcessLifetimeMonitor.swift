import Darwin
import Foundation

/// The worker owns this process. Neither silence nor a stalled capture API may
/// keep it alive after the worker or its PCM reader has gone away.
final class ProcessLifetimeMonitor {
    private let timer: DispatchSourceTimer

    init() throws {
        var stdoutInfo = stat()
        guard Darwin.fstat(STDOUT_FILENO, &stdoutInfo) == 0 else {
            throw HelperError.output("could not inspect stdout for disconnect monitoring")
        }
        let kind = stdoutInfo.st_mode & mode_t(S_IFMT)
        let descriptor: Int32
        if kind == mode_t(S_IFIFO) || kind == mode_t(S_IFSOCK) {
            descriptor = Darwin.kqueue()
            guard descriptor >= 0 else {
                throw HelperError.output("could not create stdout disconnect monitor")
            }
            var change = kevent64_s()
            change.ident = UInt64(STDOUT_FILENO)
            change.filter = Int16(EVFILT_WRITE)
            change.flags = UInt16(EV_ADD | EV_ENABLE | EV_CLEAR)
            guard Darwin.kevent64(descriptor, &change, 1, nil, 0, 0, nil) >= 0 else {
                Darwin.close(descriptor)
                throw HelperError.output("could not watch stdout for reader disconnect")
            }
        } else {
            // Files and terminals have no pipe reader to monitor. In
            // particular, /dev/null is a valid output but not kqueue-able.
            descriptor = -1
        }

        timer = DispatchSource.makeTimerSource(
            flags: [],
            queue: DispatchQueue.global(qos: .userInitiated)
        )
        timer.schedule(
            deadline: .now(),
            repeating: .milliseconds(50),
            leeway: .milliseconds(10)
        )
        timer.setEventHandler {
            if Darwin.getppid() == 1 {
                Darwin._exit(0)
            }

            // EVFILT_WRITE reports EV_EOF when a pipe/socket reader closes,
            // even without audio callbacks. EV_CLEAR avoids continuously
            // receiving ordinary writable notifications during silence.
            guard descriptor >= 0 else { return }
            var event = kevent64_s()
            var timeout = timespec(tv_sec: 0, tv_nsec: 0)
            if Darwin.kevent64(descriptor, nil, 0, &event, 1, 0, &timeout) > 0,
               event.flags & UInt16(EV_EOF | EV_ERROR) != 0 {
                // Do not wait on AVAudioEngine/ScreenCaptureKit shutdown: the
                // OS tears down their resources on process exit, including if
                // their start/stop callback is currently stalled.
                Darwin._exit(0)
            }
        }
        timer.setCancelHandler {
            if descriptor >= 0 {
                Darwin.close(descriptor)
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
