import CaptureCore
import Darwin
import Foundation

@MainActor
final class WorkerSupervisor {
    var onEvent: ((WorkerEvent) -> Void)?
    var onIssue: ((String, Bool) -> Void)?
    var onUnauthorized: (() -> Void)?
    var onUpgradeRequired: (() -> Void)?
    var onStarted: (() -> Void)?
    private(set) var processGroup: pid_t?
    private let log: RotatingLog
    private let version: String
    private var connection: DeviceConnection?
    private var input: FileHandle?
    private var output: FileHandle?
    private var errors: FileHandle?
    private var parser = IPCLineParser()
    private var budget = RestartBudget()
    private var restart: Task<Void, Never>?
    private var escalation: Task<Void, Never>?
    private var stopping = false
    private var stopCompletions: [() -> Void] = []

    init(log: RotatingLog, version: String) { self.log = log; self.version = version }

    func start(connection: DeviceConnection) {
        self.connection = connection
        stopping = false
        guard processGroup == nil else { return }
        do { try launch(connection) }
        catch { log.message("Worker could not start"); scheduleRestart(message: "The capture worker could not start.") }
    }

    func retry() {
        budget.reset()
        restart?.cancel()
        restart = nil
        if let connection, processGroup == nil { start(connection: connection) }
    }

    func send(_ type: String) {
        guard let input else { return }
        do {
            var line = try JSONSerialization.data(withJSONObject: ["type": type])
            line.append(0x0A)
            try input.write(contentsOf: line)
        } catch { log.message("Worker input closed") }
    }

    func shutdown(completion: @escaping () -> Void) {
        restart?.cancel()
        restart = nil
        stopping = true
        connection = nil
        guard let pid = processGroup else { completion(); return }
        stopCompletions.append(completion)
        if escalation != nil { return }
        send("shutdown")
        log.message("Worker shutdown requested")
        escalation = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 35_000_000_000)
            guard !Task.isCancelled, let self, self.processGroup == pid else { return }
            self.log.message("Worker drain deadline reached; terminating process group")
            Darwin.kill(-pid, SIGTERM)
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled, self.processGroup == pid else { return }
            self.log.message("Worker termination deadline reached; killing process group")
            Darwin.kill(-pid, SIGKILL)
        }
    }

    private func launch(_ connection: DeviceConnection) throws {
        let bundle = Bundle.main.bundleURL.appendingPathComponent("Contents", isDirectory: true)
        let node = bundle.appendingPathComponent("Helpers/node").path
        let worker = bundle.appendingPathComponent("Resources/worker/main.js").path
        let helper = bundle.appendingPathComponent("Helpers/launchstack-system-audio").path
        guard FileManager.default.isExecutableFile(atPath: node), FileManager.default.fileExists(atPath: worker) else {
            throw CocoaError(.fileNoSuchFile)
        }
        let stdinPipe = Pipe(), stdoutPipe = Pipe(), stderrPipe = Pipe()
        var actions: posix_spawn_file_actions_t?
        var attributes: posix_spawnattr_t?
        var code = posix_spawn_file_actions_init(&actions)
        guard code == 0 else { throw POSIXError(POSIXErrorCode(rawValue: code) ?? .EIO) }
        defer { posix_spawn_file_actions_destroy(&actions) }
        code = posix_spawnattr_init(&attributes)
        guard code == 0 else { throw POSIXError(POSIXErrorCode(rawValue: code) ?? .EIO) }
        defer { posix_spawnattr_destroy(&attributes) }
        for (source, destination) in [
            (stdinPipe.fileHandleForReading.fileDescriptor, STDIN_FILENO),
            (stdoutPipe.fileHandleForWriting.fileDescriptor, STDOUT_FILENO),
            (stderrPipe.fileHandleForWriting.fileDescriptor, STDERR_FILENO),
        ] {
            code = posix_spawn_file_actions_adddup2(&actions, source, destination)
            guard code == 0 else { throw POSIXError(POSIXErrorCode(rawValue: code) ?? .EIO) }
        }
        for handle in [stdinPipe.fileHandleForReading, stdinPipe.fileHandleForWriting, stdoutPipe.fileHandleForReading,
                       stdoutPipe.fileHandleForWriting, stderrPipe.fileHandleForReading, stderrPipe.fileHandleForWriting] {
            code = posix_spawn_file_actions_addclose(&actions, handle.fileDescriptor)
            guard code == 0 else { throw POSIXError(POSIXErrorCode(rawValue: code) ?? .EIO) }
        }
        // An atomic, separate process group lets us terminate Node and all of its
        // capture children without signalling the app or another Terminal job.
        code = posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_SETSIGDEF))
        guard code == 0 else { throw POSIXError(POSIXErrorCode(rawValue: code) ?? .EIO) }
        code = posix_spawnattr_setpgroup(&attributes, 0)
        guard code == 0 else { throw POSIXError(POSIXErrorCode(rawValue: code) ?? .EIO) }
        var defaults = sigset_t()
        sigemptyset(&defaults)
        for number in [SIGTERM, SIGINT, SIGPIPE] { sigaddset(&defaults, number) }
        code = posix_spawnattr_setsigdefault(&attributes, &defaults)
        guard code == 0 else { throw POSIXError(POSIXErrorCode(rawValue: code) ?? .EIO) }
        let args = [node, worker].map { strdup($0) } + [nil]
        let environment = ProcessInfo.processInfo.environment
        let env = ["HOME", "TMPDIR", "LANG", "PATH"].compactMap { key in environment[key].map { "\(key)=\($0)" } }.map { strdup($0) } + [nil]
        defer { args.forEach { free($0) }; env.forEach { free($0) } }
        var pid: pid_t = 0
        code = args.withUnsafeBufferPointer { argv in
            env.withUnsafeBufferPointer { envp in posix_spawn(&pid, node, &actions, &attributes, argv.baseAddress!, envp.baseAddress!) }
        }
        guard code == 0 else { throw POSIXError(POSIXErrorCode(rawValue: code) ?? .EIO) }
        let childPID = pid
        processGroup = pid
        input = stdinPipe.fileHandleForWriting
        output = stdoutPipe.fileHandleForReading
        errors = stderrPipe.fileHandleForReading
        try? stdinPipe.fileHandleForReading.close()
        try? stdoutPipe.fileHandleForWriting.close()
        try? stderrPipe.fileHandleForWriting.close()
        parser.reset()
        output?.readabilityHandler = { [weak self] file in
            let data = file.availableData
            if data.isEmpty { file.readabilityHandler = nil; return }
            Task { @MainActor in self?.receive(data, pid: childPID) }
        }
        let log = self.log
        errors?.readabilityHandler = { file in
            let data = file.availableData
            if data.isEmpty { file.readabilityHandler = nil } else { log.append(data) }
        }
        DispatchQueue.global(qos: .utility).async { [weak self] in
            var status: Int32 = 0
            var waited: pid_t
            repeat { waited = waitpid(childPID, &status, 0) } while waited < 0 && errno == EINTR
            let exitCode = (status & 0x7f) == 0 ? (status >> 8) & 0xff : 128 + (status & 0x7f)
            Task { @MainActor in self?.exited(pid: childPID, code: exitCode) }
        }
        var config = try JSONSerialization.data(withJSONObject: ["origin": connection.origin.absoluteString,
            "deviceToken": connection.token, "appVersion": version, "systemAudioHelperPath": helper])
        config.append(0x0A)
        do { try input?.write(contentsOf: config) }
        catch { Darwin.kill(-pid, SIGTERM) }
        log.message("Worker started (pid \(pid))")
        onStarted?()
    }

    private func receive(_ data: Data, pid: pid_t) {
        guard processGroup == pid else { return }
        do { for event in try parser.append(data) { onEvent?(event) } }
        catch {
            log.message("Invalid worker IPC; restarting worker")
            Darwin.kill(-pid, SIGTERM)
        }
    }

    private func exited(pid: pid_t, code: Int32) {
        guard processGroup == pid else { return }
        // Clean up surviving capture children even when Node exited unexpectedly.
        Darwin.kill(-pid, SIGTERM)
        escalation?.cancel()
        escalation = nil
        output?.readabilityHandler = nil
        errors?.readabilityHandler = nil
        for file in [input, output, errors] { try? file?.close() }
        input = nil; output = nil; errors = nil; processGroup = nil
        log.message("Worker exited (\(code))")
        if stopping {
            let completions = stopCompletions
            stopCompletions.removeAll()
            completions.forEach { $0() }
            return
        }
        if code == 77 { connection = nil; onUnauthorized?(); return }
        if code == 75 { onUpgradeRequired?(); return }
        scheduleRestart(message: "The capture worker stopped unexpectedly (\(code)).")
    }

    private func scheduleRestart(message: String) {
        guard !stopping, connection != nil else { return }
        guard let delay = budget.nextDelay() else {
            onIssue?("\(message) Five restarts failed in ten minutes. Check permissions and choose Retry.", true)
            return
        }
        onIssue?("\(message) Reconnecting in \(Int(delay))s…", false)
        restart = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !Task.isCancelled, let self, let connection = self.connection else { return }
            self.start(connection: connection)
        }
    }
}
