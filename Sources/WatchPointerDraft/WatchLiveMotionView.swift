// UNVERIFIED local UI draft. Displays public CMDeviceMotion fields and
// labelled OPEN / FIST / REST collection. Local logger hook only.
// Distinct from untested end-to-end transport (WatchMotionWriter).
// #if false so a later Mac/watchOS target does not compile this into AirPointer.app.

#if false
import SwiftUI
import CoreMotion

struct WatchLiveMotionView: View {
    var quaternionText: String
    var rotationRateText: String
    var userAccelText: String
    var gravityText: String
    var onCollect: (String) -> Void
    var onLeftClick: () -> Void
    var onRightClick: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text("Live motion (public Core Motion)").font(.headline)
                Text(quaternionText)
                Text(rotationRateText)
                Text(userAccelText)
                Text(gravityText)
                Text("Collection labels").font(.headline)
                HStack {
                    Button("OPEN") { onCollect("open") }
                    Button("FIST") { onCollect("fist") }
                    Button("REST") { onCollect("rest") }
                }
                Text("REST is negative/unknown, not closed.")
                Text("Clicks (Crown press is not available)")
                HStack {
                    Button("Left click") { onLeftClick() }
                    Button("Right click") { onRightClick() }
                }
            }
        }
    }
}

func formatPublicMotion(_ data: CMDeviceMotion) -> (String, String, String, String) {
    let q = data.attitude.quaternion
    let w = data.rotationRate
    let a = data.userAcceleration
    let g = data.gravity
    return (
        String(format: "q wxyz %.3f %.3f %.3f %.3f", q.w, q.x, q.y, q.z),
        String(format: "gyro rad/s %.3f %.3f %.3f", w.x, w.y, w.z),
        String(format: "userAccel g %.3f %.3f %.3f", a.x, a.y, a.z),
        String(format: "gravity g %.3f %.3f %.3f", g.x, g.y, g.z)
    )
}
#endif
