// Shared exclusive-source adapter. NEW file, not referenced by ClosedCaseSession.
// Mac `build.sh` compiles only Sources/AirPointer/**/*.swift — this folder is outside that glob.
// UNTESTED on hardware. Logically aligned with pointerRouter.js (mandatory session,
// generation, finite receipt, required sensorAgeSeconds, rearm). JS is the verified twin.

public enum PointerInputSource: Equatable {
    case airpods
    case watch
}

public enum PointerCommand: Equatable {
    case move(x: Double, y: Double, displayId: String)
    case click(button: PointerClickButton, x: Double, y: Double)
    case pause
    case swipe(direction: PointerSwipeDirection)
}

public enum PointerClickButton: Equatable {
    case left
    case right
}

public enum PointerSwipeDirection: Equatable {
    case left
    case right
}

public struct PointerSampleMeta: Equatable {
    public var sessionId: String
    public var generation: Int
    public var sensorStamp: Double
    public var hostReceived: Double
    public var receiverNow: Double
    public var sensorAgeSeconds: Double
    public var sequence: Int?
    public init(sessionId: String, generation: Int, sensorStamp: Double, hostReceived: Double, receiverNow: Double, sensorAgeSeconds: Double, sequence: Int?) {
        self.sessionId = sessionId
        self.generation = generation
        self.sensorStamp = sensorStamp
        self.hostReceived = hostReceived
        self.receiverNow = receiverNow
        self.sensorAgeSeconds = sensorAgeSeconds
        self.sequence = sequence
    }
}

public final class PointerSourceRouter {
    public static let shared = PointerSourceRouter()
    public private(set) var active: PointerInputSource = .airpods
    public private(set) var paused = false
    public private(set) var connected = false
    public private(set) var sessionId: String?
    public private(set) var generation = 0
    public private(set) var rearmPending = true
    public private(set) var lastReject: String?
    private var lastSensorStamp: Double?
    private var lastSequence: Int?
    private let staleSeconds = 0.5
    private let futureSlack = 0.05

    public init() {}

    public func select(_ source: PointerInputSource) {
        if source != active { invalidate("switch") }
        active = source
    }

    public func connect(sessionId: String?) {
        connected = true
        self.sessionId = sessionId ?? self.sessionId ?? "sess-router"
        invalidate("connect")
    }

    public func disconnect() {
        connected = false
        invalidate("disconnect")
    }

    public func pauseImmediately() {
        paused = true
        invalidate("pause")
    }

    public func resume() {
        paused = false
        rearmPending = true
        lastSensorStamp = nil
        lastSequence = nil
        generation += 1
    }

    public func allows(_ source: PointerInputSource) -> Bool {
        connected && !paused && active == source
    }

    public func emit(_ source: PointerInputSource, _ command: PointerCommand, meta: PointerSampleMeta) -> PointerCommand? {
        if !connected { return reject("disconnected") }
        if paused { return reject("paused") }
        if active != source { return reject("inactive-source") }
        if sessionId == nil || meta.sessionId != sessionId { return reject("session-mismatch") }
        if meta.generation != generation { return reject("stale-generation") }
        if !meta.receiverNow.isFinite { return reject("missing-receiver-now") }
        if !meta.hostReceived.isFinite { return reject("invalid-host") }
        if !meta.sensorAgeSeconds.isFinite { return reject("missing-sensor-age") }
        if !meta.sensorStamp.isFinite || meta.sensorStamp <= 0 { return reject("invalid-stamp") }
        if let last = lastSensorStamp, meta.sensorStamp <= last { return reject("order-or-replay") }
        if let lastSeq = lastSequence, let seq = meta.sequence, seq <= lastSeq { return reject("order-or-replay") }
        if meta.receiverNow - meta.hostReceived > staleSeconds { return reject("stale-host") }
        if meta.hostReceived - meta.receiverNow > futureSlack { return reject("host-in-future") }
        if meta.sensorAgeSeconds > staleSeconds { return reject("stale-sensor") }
        if meta.sensorAgeSeconds < -futureSlack { return reject("sensor-in-future") }
        lastSensorStamp = meta.sensorStamp
        lastSequence = meta.sequence
        switch command {
        case .click, .swipe:
            if rearmPending { return reject("stale-command-before-rearm") }
        default:
            if rearmPending { rearmPending = false }
        }
        lastReject = nil
        return command
    }

    private func invalidate(_ reason: String) {
        generation += 1
        rearmPending = true
        lastSensorStamp = nil
        lastSequence = nil
        lastReject = reason
    }

    private func reject(_ reason: String) -> PointerCommand? {
        lastReject = reason
        return nil
    }
}
