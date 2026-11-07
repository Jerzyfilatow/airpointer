# Calibration modules

Angular pointing from a wrist/crown **neutral quaternion** plus four corner poses **TL / TR / BL / BR**.

See **[CALIBRATION.md](CALIBRATION.md)** for the derivation (`q_rel = q_n⁻¹ q`), bilinear inverse, Jacobian/convexity gates, CGEvent y-down mapping, and drift limits.

- Relative orientation only (not dead-reckoning translation).
- Per-wrist and crown-orientation keys. Mapping signs here are **synthetic**.
- Display mapping matches `AirPointer.swift` `screenPoint` + `CGDisplayBounds` (y down from the main display’s upper-left). Non-finite inputs are rejected.
- `mirroredGroup` is a caller descriptor; OS mirror discovery is unimplemented.
- Motion clock: sensor stamp vs receiver `now` vs host-received — not the same clock.
