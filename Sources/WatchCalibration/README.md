# Calibration modules

Angular pointing from a wrist/crown **neutral quaternion** plus four corner poses **TL / TR / BL / BR**.

- Relative orientation only (not dead-reckoning translation).
- Per-wrist and crown-orientation keys (`WKInterfaceDevice` wristLocation / crownOrientation are the intended later hardware reads; mapping signs here are synthetic).
- Display mapping uses CG-style origins (including negative) and one logical target when displays are mirrored.
- Motion clock rejects stale, replayed, and out-of-order stamps.
