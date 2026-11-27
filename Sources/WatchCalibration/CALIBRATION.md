# Angular corner calibration — derivation and assumptions

This is isolated math, not a hardware-validated Watch pointer. Axis signs in `wristNeutral.js` are a **synthetic test convention**, not a measured Core Motion device-frame mapping.

## Relative orientation

Let `q_n` be the per-wrist, per-crown **neutral** quaternion and `q` the current attitude.

```
q_rel = inverse(q_n) * q
r     = rotation(q_rel)   // Orientation.js rotation(): 2 atan2 axis-angle vector
(ax, ay, roll) = (r_x * s_x, r_y * s_y, r_z * s_x)
```

`s_x, s_y` come from `axisSigns(wrist, crown)`. Neutral is **not** subtracted in Euclidean translation; there is **no** dead-reckoning of linear IMU motion. Gyro bias and gravity correction still exist on the AirPods path (`Orientation.js`); they are not re-derived here.

**Drift:** integrating angular rate without a heading reference yaw-drifts. Four corner poses are assumed to stay valid only while the relative map has not drifted past the residual/clamp behavior. This draft does not estimate that time.

## Bilinear screen map

Corners TL, TR, BL, BR live in the `(ax, ay)` plane. With `u=0` left, `v=0` top:

```
P(u,v) = (1-u)(1-v) TL + u(1-v) TR + (1-u)v BL + uv BR
```

A calibration is accepted only if the quad is **strictly convex** (consistent turns TL→TR→BR→BL), opposite edges do not cross, vertices are separated, and the Jacobian of `P` does **not** change sign or drop below `MIN_JAC` on the unit square (extrema at `{0,1}²` because `det` is affine in `u,v`). Inverse Newton is accepted only with a small residual; a finite `(u,v)` with a large residual is a failure.

## Display / CGEvent convention

`toEvent` matches `screenPoint` in `Sources/AirPointer/App/AirPointer.swift` lines 5–8, using bounds from `CGDisplayBounds` (`ClosedCaseSession.swift` 918–925).

Apple: `CGDisplayBounds` returns a rectangle in the global display coordinate space **relative to the upper-left corner of the main display**  
https://developer.apple.com/documentation/coregraphics/cgdisplaybounds(_:)

`CGEvent.location` is that Quartz mouse location; `unflippedLocation` is the opposite vertical convention  
https://developer.apple.com/documentation/coregraphics/cgevent/location

So **y increases downward**. `v=0` (top / TL) maps to `originY+1`. Negative `originX`/`originY` are legal (display left of or above the main display). Non-finite `u,v` are **rejected**, not snapped to an edge.

`mirroredGroup` is a **caller-supplied topology descriptor**. Discovering a real macOS mirror set is **unimplemented**.

## What this does not do

- No Watch hardware attitude frame verification.
- No optical / HealthKit / PPG / static-fist physiology.
- No claim that a Watch app is complete.
