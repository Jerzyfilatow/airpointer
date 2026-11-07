# Shared pointer adapter

Boundary between the **untouched** AirPods session and a future Watch source.

- Exclusive selector: one of `airpods` | `watch`.
- Mandatory session id + generation on every emit. Finite receiver/host receipt and **required** `sensorAgeSeconds` (unknown or host-only freshness ⇒ reject before rearm). Rearm after pause/switch/disconnect.
- A click or swipe queued across a switch is rejected until a fresh non-click sample rearms.
- **Not wired** into `ClosedCaseSession`. No HID `CGEvent` here.
- JS (`pointerRouter.js`) is the hardware-free tested twin. Swift (`PointerSourceRouter.swift`) is **logically aligned and UNTESTED** (not compiled by `build.sh`, no XCTest in this PR).

Default `active = airpods`. Connect is required before emit.
