// UNVERIFIED HARDWARE GATE. Not compiled by build.sh. Not run on a Watch.
// Foreground Core Motion only. No HKWorkoutSession. No fake background mode.

#if false
import CoreMotion
import Foundation

final class WatchMotionSession {
    private let motion = CMMotionManager()
    var onSample: ((CMDeviceMotion) -> Void)?

    func start() {
        guard motion.isDeviceMotionAvailable else { return }
        motion.deviceMotionUpdateInterval = 1.0 / 50.0
        motion.startDeviceMotionUpdates(to: .main) { [weak self] data, _ in
            guard let data else { return }
            self?.onSample?(data)
        }
    }

    func stop() {
        motion.stopDeviceMotionUpdates()
    }
}
#endif
