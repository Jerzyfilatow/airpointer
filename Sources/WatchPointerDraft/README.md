# Watch-only app draft — UNVERIFIED HARDWARE GATE

**This is not a working Watch product and not a complete Watch app.** Every Swift file here is wrapped in `#if false` and lives outside `Sources/AirPointer/**/*.swift`, so `build.sh` does not compile it. Watch model and OS are unknown. Nothing here was built, signed, installed, or run on a device.

There is **no** real labelled collector/export, **no** authenticated transport, and **no** Mac GATT receiver in this tree.

## What this folder is

- A **local UI + hook draft**: show publicly documented Core Motion values (`CMDeviceMotion` attitude, rotationRate, userAcceleration, gravity) and labelled **OPEN / FIST / REST** collection buttons that append to a **local** logger.
- Stream hooks stay in-process. They are **not** an end-to-end Watch→Mac transport.

## What this folder is not

- Not a tested GATT/WatchConnectivity path.
- Not HealthKit, optics, camera, or PPG.
- Not a Digital Crown **press** handler (see `CROWN-PRESS.md`).
- Not a workout or extended-runtime background trick.

## Transport sketches (both unverified)

1. **Direct:** Watch `CBCentralManager` **writes** packets to a writable characteristic on a Mac `CBPeripheralManager`. Not notifications from the Watch (watchOS cannot advertise as a peripheral).
2. **Phone relay:** WatchConnectivity to iPhone, then a separate iPhone→Mac hop. WCSession is not native macOS Watch↔Mac.

Pairing, tokens, Info.plist Bluetooth usage strings, and Xcode device install remain later Mac/Watch work.
