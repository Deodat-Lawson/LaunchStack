import Foundation

public struct RestartBudget {
    private var failures: [Date] = []
    public init() {}

    /// At most five automatic restarts in a rolling ten-minute window.
    public mutating func nextDelay(now: Date = Date()) -> TimeInterval? {
        failures.removeAll { now.timeIntervalSince($0) >= 600 }
        guard failures.count < 5 else { return nil }
        let delay = TimeInterval(1 << failures.count)
        failures.append(now)
        return delay
    }

    public mutating func reset() { failures.removeAll(keepingCapacity: true) }
}

public struct CallEndedTracker {
    private var observedOtherInput = false
    private var silentSince: Date?
    private var sent = false

    public init() {}

    /// A failed CoreAudio query must not be interpreted as silence.
    public mutating func observe(otherInputRunning: Bool?, now: Date = Date()) -> Bool {
        guard !sent else { return false }
        guard let otherInputRunning else {
            silentSince = nil
            return false
        }
        if otherInputRunning {
            observedOtherInput = true
            silentSince = nil
        } else if observedOtherInput {
            if let silentSince {
                if now.timeIntervalSince(silentSince) >= 120 {
                    sent = true
                    return true
                }
            } else {
                silentSince = now
            }
        }
        return false
    }
}
