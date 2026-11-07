// Shared exclusive-source adapter. NEW file, not referenced by ClosedCaseSession.
// Mac `build.sh` compiles only Sources/AirPointer/**/*.swift — this folder is outside that glob.
// UNVERIFIED on hardware. Do not treat as a live HID path.

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

public final class PointerSourceRouter {
    public static let shared = PointerSourceRouter()
    public private(set) var active: PointerInputSource = .airpods
    public private(set) var paused = false

    public init() {}

    public func select(_ source: PointerInputSource) {
        active = source
    }

    public func pauseImmediately() {
        paused = true
    }

    public func resume() {
        paused = false
    }

    public func allows(_ source: PointerInputSource) -> Bool {
        !paused && active == source
    }

    public func emit(_ source: PointerInputSource, _ command: PointerCommand) -> PointerCommand? {
        allows(source) ? command : nil
    }
}
