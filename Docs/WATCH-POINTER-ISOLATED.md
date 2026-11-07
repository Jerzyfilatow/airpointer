# Watch pointer — isolated local project (hardware-free)

This is a **Cursor editor layout** for later safe fetch/checkout on a Mac. It is **not** a second cloud project.

**Status:** isolated algorithm + draft scaffolds only. **Watch support does not work on hardware from this change.** Watch model/OS are unknown. No Xcode build, signing, install, or app launch is included.

**AirPods path:** every file that existed at `a73cc798e71a2e4c568f5a2ec8a351a58cd8e311` under `Sources/AirPointer/`, `Sources/ClosedCaseMotion/`, `Sources/ClosedCaseRestore/`, `build.sh`, and `Tests/TapFixtures.csv` is **byte-identical**. The Mac app glob `Sources/AirPointer/**/*.swift` is unchanged, so `zsh ./build.sh` does not pick up these new folders. The only existing tracked-file delta is `README.md` (project-layout tree + pointer to this guide).

Static-fist optical sensing is **out of scope** (research only; no public API). There is **no established physiological mapping** from Watch IMU to an open or closed hand, and these drafts do **not** claim actual static-fist detectability. Synthetic classifier scores are **not** hardware validation.

## 7-item folder mapping

| # | Role | Path (relative to repo root) | Workspace folder name |
|---|---|---|---|
| 1 | Existing AirPods code **UNTOUCHED** | `Sources/AirPointer/` (plus helpers `Sources/ClosedCaseMotion/`, `Sources/ClosedCaseRestore/` — same rule, not a workspace root of their own) | `1-airpods-untouched` |
| 2 | Shared controller interface / adapter (**new**, not wired into session) | `Sources/PointerAdapter/` | `2-shared-adapter` |
| 3 | Watch-only app draft (unverified hardware gate) | `Sources/WatchPointerDraft/` | `3-watch-draft` |
| 4 | Calibration modules (angular corners + display + wrist/crown) | `Sources/WatchCalibration/` | `4-calibration` |
| 5 | Gesture modules (turnover, swipe, click, immediate pause) | `Sources/WatchGestures/` | `5-gestures` |
| 6 | Hardware-free tests (Node; no Apple SDK) | `Tests/HardwareFree/` | `6-hardware-free-tests` |
| 7 | Experimental hand-state collector + bounded classifier (**opt-in, not wired to cursor/click**) | `Sources/WatchHandState/` | `7-hand-state-experimental` |

Open locally with `AirPointer.code-workspace` (relative paths only; **no** tasks, launch configs, or extension recommendations).

## Digital Crown press — official public API

**Unsupported.** Do not intercept a Digital Crown **press** for left/right click.

- Human Interface Guidelines: “Apps don’t respond to presses on the Digital Crown because watchOS reserves these interactions for system-provided functionality like revealing the Home Screen.”  
  https://developer.apple.com/design/human-interface-guidelines/digital-crown
- `WKCrownSequencer` reports **rotation** (`rotationsPerSecond`, `isIdle`), not a press.  
  https://developer.apple.com/documentation/watchkit/wkcrownsequencer
- `WKCrownDelegate` is `crownDidRotate` and `crownDidBecomeIdle` only.  
  https://developer.apple.com/documentation/watchkit/wkcrowndelegate
- SwiftUI `digitalCrownRotation` tracks **rotation** only.  
  https://developer.apple.com/documentation/swiftui/view/digitalcrownrotation(_:)

**Crown rotation is not press.** Do not treat rotational delta as a click.

**In-app alternatives (draft):** Watch-face **Left click** and **Right click** buttons; IMU angular poke as a safe click-intent with cooldown/hysteresis. Double Tap is a separate, hardware-limited primary-action API (Series 9 / Ultra 2) and is not wired here.

## Transport (proposed, unverified)

- **Direct (preferred sketch):** Watch `CBCentralManager` connects to a Mac `CBPeripheralManager`. The Watch **writes** motion packets to a **writable GATT characteristic**. The Mac handles `didReceiveWrite`. This is **not** Watch notifications (Watch cannot advertise as a peripheral on watchOS).
- **Phone relay:** WatchConnectivity Watch ↔ iPhone, then a separate iPhone → Mac hop. WCSession is **not** a native macOS Watch↔Mac API.
- Neither path is implemented against hardware. Pairing, tokens, and Core Bluetooth permissions are later Mac/Watch work.

Do **not** use a workout or extended-runtime session as a fake background mode.

## How to run isolated tests

```sh
node Tests/HardwareFree/run.mjs
```

Measured on this branch (`node` v22.23.4): **80 passed, 0 failed, exit 0**. Repairs used: 0 of 3 per unit. Does not build `AirPointer.app` and does not validate Watch hardware.

## Later Mac sync (not this agent)

After this branch is on the fork remote, a human can fetch/checkout `cursor/watch-pointer-core-74b0` in `/Users/jerzyfilatow/repos/airpointer-fork` and open `AirPointer.code-workspace`. This agent must not access that Mac clone.
