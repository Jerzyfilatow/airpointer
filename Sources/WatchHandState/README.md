# Experimental hand-state module (opt-in)

Bounded OPEN / FIST / REST collector and classifier. **Not** established physiology. **Not** static-fist hardware detection. Synthetic accuracy is **not** hardware validation.

- Collection labels: `open`, `fist`, `rest`. **REST is negative/unknown, not “closed”.**
- Inference (only after per-user + context calibration): `open` | `closed` | `UNKNOWN`.
- Overlap or non-separable data ⇒ `UNKNOWN`. Untrained / new user / new context ⇒ `UNKNOWN`.
- **Not wired** to cursor or click. Arming required. Cooldown applies. `UNKNOWN` ⇒ no action.
- Local logging only. No uploads, no health datasets, no secrets. Pseudonymous `user-local-*` / `sess-*`.
- Schema records version, units, coordinate frame, monotonic timestamp, sequence, wrist side/position, strap-fit.
- No HealthKit, optics, or PPG.

Watch UI draft (untested on device) lives in `Sources/WatchPointerDraft/` and only displays public Core Motion fields plus labelled collection buttons and a local stream hook. That local UI+hook draft is **not** end-to-end Watch→Mac transport (`WatchMotionWriter` is a separate unverified sketch).

Workspace folder: `7-hand-state-experimental`.
