import AppKit
import CaptureCore
import Combine
import Foundation
import ServiceManagement
import UserNotifications

@MainActor
final class CaptureModel: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    struct PendingStop { let reason: String; let stopsAt: Date }
    @Published private(set) var connection: DeviceConnection?
    @Published private(set) var capture: CaptureState?
    @Published private(set) var pendingStop: PendingStop?
    @Published private(set) var pairing = false
    @Published private(set) var commandBusy = false
    @Published private(set) var retryAvailable = false
    @Published var error: String?
    @Published private(set) var launchAtLogin = false
    @Published private(set) var loginNeedsApproval = false
    let permissions = PermissionController()
    let version: String
    let log: RotatingLog
    private let api = DeviceAPI()
    private let consumedCodes = ConsumedPairingCodes()
    private let monitor = CallAudioMonitor()
    private let supervisor: WorkerSupervisor
    private let updater: CaptureUpdater
    private var knownOrigin: URL?
    private var attemptedPairing: PairingLink?

    override init() {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0"
        let log = RotatingLog()
        self.version = version
        self.log = log
        supervisor = WorkerSupervisor(log: log, version: version)
        updater = CaptureUpdater(version: version)
        super.init()
        supervisor.onEvent = { [weak self] in self?.receive($0) }
        supervisor.onIssue = { [weak self] message, retry in
            self?.error = message; self?.retryAvailable = retry
            self?.monitor.stop()
        }
        supervisor.onStarted = { [weak self] in self?.error = nil; self?.retryAvailable = false }
        supervisor.onUnauthorized = { [weak self] in self?.disconnect() }
        supervisor.onUpgradeRequired = { [weak self] in
            self?.error = "Update required. Install the latest LaunchStack Capture to continue."
            self?.capture = nil; self?.monitor.stop(); self?.updater.check()
        }
        updater.onError = { [weak self] in self?.error = $0 }
        monitor.workerGroup = { [weak supervisor] in supervisor?.processGroup }
        monitor.onCallEnded = { [weak self] in self?.supervisor.send("call_ended_signal") }
        UNUserNotificationCenter.current().delegate = self
        let action = UNNotificationAction(identifier: "keep_recording", title: "Keep recording", options: [])
        let category = UNNotificationCategory(identifier: "auto_stop_pending", actions: [action], intentIdentifiers: [], options: [])
        UNUserNotificationCenter.current().setNotificationCategories([category])
    }

    func start() {
        if let saved = UserDefaults.standard.string(forKey: "websiteOrigin"), let url = URL(string: saved) {
            knownOrigin = try? PairingLink.origin(from: url)
        }
        do {
            if let connection = try ConnectionStore.load() { connect(connection) }
        } catch { self.error = error.localizedDescription }
        refreshLoginStatus()
        permissions.refresh()
        if connection == nil {
            log.message("Not connected")
            if let link = QuarantinePairing.discover(bundleURL: Bundle.main.bundleURL), !consumedCodes.contains(link) { pair(link) }
        }
    }

    func handle(_ url: URL) {
        do { pair(try PairingLink.deepLink(url)) }
        catch { self.error = error.localizedDescription }
    }

    func refresh() { permissions.refresh(); refreshLoginStatus() }

    private func pair(_ link: PairingLink) {
        guard !pairing, attemptedPairing != link else { return }
        guard !consumedCodes.contains(link) else {
            if connection == nil { error = "This connection code was already used. Sync with the website for a new one." }
            return
        }
        guard capture?.isActive != true else { error = "Stop the current capture before connecting another account."; return }
        attemptedPairing = link
        pairing = true
        error = nil
        rememberOrigin(link.origin)
        Task {
            do {
                let result = try await api.pair(link, version: version)
                consumedCodes.insert(link)
                try ConnectionStore.save(result)
                supervisor.shutdown { self.connect(result) }
            } catch {
                if case DeviceAPI.APIError.status(410) = error { consumedCodes.insert(link) }
                self.error = error is DeviceAPI.APIError || error is PairingLink.InvalidLink ? error.localizedDescription : "Could not connect this Mac. Check the website and your Keychain, then sync again."
            }
            pairing = false
            attemptedPairing = nil
        }
    }

    private func connect(_ connection: DeviceConnection) {
        self.connection = connection
        rememberOrigin(connection.origin)
        updater.configure(connection)
        supervisor.start(connection: connection)
        log.message("Connected to LaunchStack")
    }

    private func rememberOrigin(_ origin: URL) {
        knownOrigin = origin
        UserDefaults.standard.set(origin.absoluteString, forKey: "websiteOrigin")
    }

    private func disconnect() {
        do { try ConnectionStore.delete() }
        catch { self.error = error.localizedDescription }
        connection = nil; capture = nil; pendingStop = nil
        monitor.stop()
        updater.configure(nil)
        supervisor.shutdown {}
        retryAvailable = false
        log.message("Not connected")
    }

    func syncWithWebsite() {
        let origin: URL
        if let knownOrigin { origin = knownOrigin }
        else {
            let alert = NSAlert()
            alert.messageText = "Sync with LaunchStack"
            alert.informativeText = "Enter the address of your LaunchStack website. Connect this Mac from the Calls page that opens."
            let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 340, height: 24))
            field.placeholderString = "https://your-launchstack.example"
            alert.accessoryView = field
            alert.addButton(withTitle: "Open website")
            alert.addButton(withTitle: "Cancel")
            NSApp.activate(ignoringOtherApps: true)
            alert.window.initialFirstResponder = field
            guard alert.runModal() == .alertFirstButtonReturn else { return }
            do {
                guard let value = URL(string: field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)) else { throw PairingLink.InvalidLink.invalidOrigin }
                origin = try PairingLink.origin(from: value)
                rememberOrigin(origin)
            } catch { self.error = error.localizedDescription; return }
        }
        openWebsite(origin: origin, query: [URLQueryItem(name: "feature", value: "calls"), URLQueryItem(name: "captureSetup", value: "1")])
    }

    func openCapture() {
        guard let origin = connection?.origin ?? knownOrigin, let id = capture?.callId else { return }
        openWebsite(origin: origin, query: [URLQueryItem(name: "feature", value: "calls"), URLQueryItem(name: "call", value: id)])
    }

    private func openWebsite(origin: URL, query: [URLQueryItem]) {
        var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
        parts.path = "/"; parts.queryItems = query
        if let url = parts.url { NSWorkspace.shared.open(url) }
    }

    func startCapture() {
        requestNotificationPermission()
        command("start_capture")
    }

    func stopCapture() { command("stop_capture", callId: capture?.callId) }

    private func command(_ kind: String, callId: String? = nil) {
        guard let connection, !commandBusy else { return }
        commandBusy = true; error = nil
        Task {
            defer { commandBusy = false }
            do { try await api.command(kind, callId: callId, connection: connection, version: version) }
            catch DeviceAPI.APIError.status(401) { disconnect() }
            catch DeviceAPI.APIError.status(426) { self.error = "Update required."; updater.check() }
            catch { self.error = error is DeviceAPI.APIError ? error.localizedDescription : "Could not reach LaunchStack. Check your connection and try again." }
        }
    }

    func keepRecording() {
        supervisor.send("keep_recording")
        pendingStop = nil
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["capture_auto_stop"])
    }

    func retry() { error = nil; retryAvailable = false; supervisor.retry() }
    func checkForUpdates() { updater.check() }

    func setLaunchAtLogin(_ enabled: Bool) {
        do {
            if enabled { try SMAppService.mainApp.register() }
            else { try SMAppService.mainApp.unregister() }
        } catch { self.error = "Could not change Launch at login. Check Login Items in System Settings." }
        refreshLoginStatus()
        if loginNeedsApproval { SMAppService.openSystemSettingsLoginItems() }
    }

    private func refreshLoginStatus() {
        launchAtLogin = SMAppService.mainApp.status == .enabled
        loginNeedsApproval = SMAppService.mainApp.status == .requiresApproval
    }

    func shutdown(completion: @escaping () -> Void) {
        monitor.stop()
        supervisor.shutdown(completion: completion)
    }

    private func receive(_ event: WorkerEvent) {
        switch event {
        case let .state(state):
            capture = state
            monitor.update(state)
            if state.state == .idle { pendingStop = nil }
            if state.isActive { requestNotificationPermission() }
        case let .autoStopPending(reason, stopsAt):
            pendingStop = PendingStop(reason: reason, stopsAt: stopsAt)
            let content = UNMutableNotificationContent()
            content.title = "Still recording?"
            content.body = "\(reason == "call_ended" ? "Your call appears to have ended." : "No speech has been heard for a while.") Capture will stop in one minute."
            content.categoryIdentifier = "auto_stop_pending"
            content.sound = .default
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "capture_auto_stop", content: content, trigger: nil))
        case .autoStopCancelled:
            pendingStop = nil
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["capture_auto_stop"])
        }
    }

    private var notificationPermissionRequested = false
    private func requestNotificationPermission() {
        guard !notificationPermissionRequested else { return }
        notificationPermissionRequested = true
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                           withCompletionHandler completionHandler: @escaping () -> Void) {
        Task { @MainActor in
            if response.actionIdentifier == "keep_recording" { self.keepRecording() }
            completionHandler()
        }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                           withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }
}
