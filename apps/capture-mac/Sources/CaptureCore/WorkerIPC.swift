import Foundation

public struct CaptureState: Decodable, Equatable {
    public enum Mode: String, Decodable {
        case idle, starting, capturing, paused, stopping
    }

    public struct Channels: Decodable, Equatable {
        public let microphone: Bool
        public let system: Bool
    }

    public let state: Mode
    public let callId: String?
    public let title: String?
    public let startedAt: String?
    public let channels: Channels
    public let segments: Int
    public let lastSegmentAt: String?

    public var isActive: Bool { state != .idle }
    public var startDate: Date? { startedAt.flatMap(IPCDate.parse) }
}

public enum WorkerEvent: Decodable, Equatable {
    case state(CaptureState)
    case autoStopPending(reason: String, stopsAt: Date)
    case autoStopCancelled

    private enum CodingKeys: String, CodingKey { case type, reason, stopsAt }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        switch try values.decode(String.self, forKey: .type) {
        case "state": self = .state(try CaptureState(from: decoder))
        case "auto_stop_pending":
            let reason = try values.decode(String.self, forKey: .reason)
            let text = try values.decode(String.self, forKey: .stopsAt)
            guard ["silence", "call_ended"].contains(reason), let date = IPCDate.parse(text) else {
                throw DecodingError.dataCorruptedError(forKey: .stopsAt, in: values, debugDescription: "Invalid automatic stop event")
            }
            self = .autoStopPending(reason: reason, stopsAt: date)
        case "auto_stop_cancelled": self = .autoStopCancelled
        default:
            throw DecodingError.dataCorruptedError(forKey: .type, in: values, debugDescription: "Unknown IPC event")
        }
    }
}

public enum IPCDate {
    public static func parse(_ text: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: text) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: text)
    }
}

public struct IPCLineParser {
    public enum ParserError: Error { case oversizedLine }
    private var buffer = Data()
    private let maxLineBytes: Int

    public init(maxLineBytes: Int = 1_048_576) { self.maxLineBytes = maxLineBytes }

    public mutating func append(_ data: Data) throws -> [WorkerEvent] {
        buffer.append(data)
        var events: [WorkerEvent] = []
        let decoder = JSONDecoder()
        while let end = buffer.firstIndex(of: 0x0A) {
            guard buffer.distance(from: buffer.startIndex, to: end) <= maxLineBytes else {
                buffer.removeAll(keepingCapacity: false)
                throw ParserError.oversizedLine
            }
            let line = buffer[..<end]
            if !line.isEmpty { events.append(try decoder.decode(WorkerEvent.self, from: line)) }
            buffer.removeSubrange(...end)
        }
        guard buffer.count <= maxLineBytes else {
            buffer.removeAll(keepingCapacity: false)
            throw ParserError.oversizedLine
        }
        return events
    }

    public mutating func reset() { buffer.removeAll(keepingCapacity: true) }
}
