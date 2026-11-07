# Shared pointer adapter

Boundary between the **untouched** AirPods session and a future Watch source.

- Exclusive selector: one of `airpods` | `watch`.
- Immediate pause blocks every source.
- Commands: move, click, pause, swipe.
- **Not wired** into `ClosedCaseSession`. No HID `CGEvent` here, so this folder cannot silently move the Mac cursor.
- JS (`pointerRouter.js`) is what the hardware-free tests run. Swift is a later-Mac type mirror.

Default `active = airpods` preserves today’s product if this router is adopted later without selecting Watch.
