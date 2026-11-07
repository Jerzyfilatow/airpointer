# Digital Crown press — public API check

**Result: no public API to intercept Digital Crown press for app clicks.**

Official docs:

- https://developer.apple.com/design/human-interface-guidelines/digital-crown  
  “Apps don’t respond to presses on the Digital Crown because watchOS reserves these interactions for system-provided functionality like revealing the Home Screen.”
- https://developer.apple.com/documentation/watchkit/wkcrownsequencer — rotation rate and idle only.
- https://developer.apple.com/documentation/watchkit/wkcrowndelegate — `crownDidRotate`, `crownDidBecomeIdle` only.
- https://developer.apple.com/documentation/swiftui/view/digitalcrownrotation(_:) — rotation binding only.

Crown **rotation is not press**. Do not map rotational delta to left/right mouse click.

## In-app alternatives (draft)

1. On-screen **Left click** and **Right click** buttons in the Watch UI.
2. IMU angular poke click-intent in `Sources/WatchGestures/` (cooldown, hysteresis, pause).
3. Optional later: Double Tap as a single primary control on Series 9 / Ultra 2 only — not implemented here.
