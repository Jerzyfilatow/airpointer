# Watch pointer — isolated local project (hardware-free)

This is a **Cursor editor layout** for later safe fetch/checkout on a Mac. It is **not** a second cloud project and it is **not** a complete Watch app.

**Status:** isolated algorithm + draft scaffolds only. **Watch support does not work on hardware from this change.** Watch model/OS are unknown. No Xcode build, signing, install, or app launch is included.

**AirPods path:** every file that existed at `a73cc798e71a2e4c568f5a2ec8a351a58cd8e311` under `Sources/AirPointer/`, `Sources/ClosedCaseMotion/`, `Sources/ClosedCaseRestore/`, `build.sh`, and `Tests/TapFixtures.csv` is **byte-identical**. The Mac app glob `Sources/AirPointer/**/*.swift` is unchanged. The only existing tracked-file delta is `README.md` (project-layout tree + pointer to this guide).

**Not delivered:** a real labelled collector/export, authenticated Watch→Mac transport, or a Mac GATT receiver. The Watch Swift files are wrapped in `#if false` and sit **outside** `Sources/AirPointer/**/*.swift`, so they are **uncompiled** by `zsh ./build.sh`. `Sources/PointerAdapter/` is **not wired** into `ClosedCaseSession`.

Static-fist optical sensing is **out of scope**. There is **no established physiological mapping** from Watch IMU to an open or closed hand. Synthetic classifier scores are **not** hardware validation. No HealthKit, PPG, or health datasets.

## 7-item folder mapping

| # | Role | Path | Workspace folder |
|---|---|---|---|
| 1 | Existing AirPods code **UNTOUCHED** | `Sources/AirPointer/` (+ `ClosedCaseMotion/`, `ClosedCaseRestore/`) | `1-airpods-untouched` |
| 2 | Shared controller (**not wired** into the session) | `Sources/PointerAdapter/` | `2-shared-adapter` |
| 3 | Watch-only **uncompiled** draft (`#if false`) | `Sources/WatchPointerDraft/` | `3-watch-draft` |
| 4 | Calibration (see `Sources/WatchCalibration/CALIBRATION.md`) | `Sources/WatchCalibration/` | `4-calibration` |
| 5 | Gestures (turnover, swipe, poke click, pause) | `Sources/WatchGestures/` | `5-gestures` |
| 6 | Hardware-free tests | `Tests/HardwareFree/` | `6-hardware-free-tests` |
| 7 | Experimental hand-state (**opt-in, not wired to cursor/click**) | `Sources/WatchHandState/` | `7-hand-state-experimental` |

Open locally with `AirPointer.code-workspace` (relative paths only; **no** tasks, launch configs, or extension recommendations).

## Existing Bluetooth → orientation → cursor / front-tap (source lines)

This is the **AirPods** path that already ships. Watch does not reuse it.

1. **Private AACP over L2CAP PSM 0x1001** (not public Core Motion on Mac). Channel open: `Sources/ClosedCaseMotion/CaseSustainedRenewal.m` lines 25–27, 1490–1491 (`openL2CAPChannel:0x1001`).
2. **Motion rows.** Accel service 11 / gyro service 12, 28-byte reports, sensor microseconds + host uptime, `x,y,z` as int32. Streamed as `sequence,service,stamp_us,host_uptime,x,y,z`: `CaseSustainedRenewal.m` 275–291. Interval 5000 µs is a helper sensor setting, not a public API.
3. **Scale.** `Orientation.js` `feed` (lines 56–65) rejects bad service/stamp/replay; `vector = raw * 1e-5`. Gyro is treated as **degrees/s** and converted with `* π/180` at line 86. AirPods gyro units are **not** Core Motion rad/s.
4. **Orientation.** Gyro integration + gravity correction: `Orientation.js` 85–98. Short drop `<2s` holds pose; longer drop `reset()` (lines 62–63).
5. **Cursor.** Three-dot `Grip.point` (`Orientation.js` 133–137) → normalized `(x,y)` with `y` smaller toward the “up” calibration. `ClosedCaseSession.swift` 918–926 takes `CGDisplayBounds` and posts `CGEvent` at `screenPoint` (`AirPointer.swift` 5–8): `y = bounds.minY + 1 + normalized.y * (bounds.height - 2)` — Quartz global coordinates with origin at the **upper-left of the main display**, y **down** ([CGDisplayBounds](https://developer.apple.com/documentation/coregraphics/cgdisplaybounds(_:))). Accessibility: `AXIsProcessTrusted` at `ClosedCaseSession.swift` 919.
6. **Front tap.** `ClosedCaseTap.swift` 1–21, 43–50, 66–78: spike along `tapDirection` on accel service 11, gyro in **deg/s**, cooldowns; not a Watch gesture.

Watch IMU, if ever wired, would be public `CMDeviceMotion` (attitude quaternion, `rotationRate` in **rad/s**, `userAcceleration` in g) — a **different** unit and transport than the rows above.

## Digital Crown press — official public API

**Unsupported.** Do not intercept a Digital Crown **press** for left/right click.

- HIG: watchOS reserves Crown **presses** for system UI. https://developer.apple.com/design/human-interface-guidelines/digital-crown
- `WKCrownSequencer` / `WKCrownDelegate` / `digitalCrownRotation` are **rotation** only.

**Crown rotation is not press.** Draft alternatives: on-screen Left/Right buttons; IMU poke with release hysteresis. See `Sources/WatchPointerDraft/CROWN-PRESS.md`.

## Transport (proposed, unverified)

- **Direct sketch:** Watch `CBCentralManager` **writes** to a writable characteristic on a Mac `CBPeripheralManager`. Not notifications (watchOS cannot advertise as a peripheral). `WatchMotionWriter.swift` is `#if false` and **untested**.
- **Phone relay:** WatchConnectivity is Watch↔iPhone, not native macOS.
- Missing: pairing, tokens, encrypted/authenticated session, Mac receiver, export of labelled samples.

Do **not** use a workout or extended-runtime session as a fake background mode.

Local Watch UI (`WatchLiveMotionView.swift`, `#if false`) may show public Core Motion fields and OPEN/FIST/REST buttons that call an in-process hook. That is **not** end-to-end transport.

## How to run isolated tests

```sh
node Tests/HardwareFree/run.mjs
```

Measured (this repair pass, `node` v22.23.4): **17 cases passed, 0 failed; 118 assertions; exit 0**. Repairs used: gestures 1/3, hand-state 2/3, others 0/3. Does not build `AirPointer.app` and does not validate Watch hardware or physiology.

## Later Mac sync (not this agent)

After this branch is on the fork remote, a human can fetch/checkout `cursor/watch-pointer-core-74b0` in `/Users/jerzyfilatow/repos/airpointer-fork` and open `AirPointer.code-workspace`. This agent must not access that Mac clone.
