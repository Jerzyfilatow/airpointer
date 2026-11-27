# Experimental hand-state module (opt-in)

Bounded OPEN / FIST / REST collector and classifier. **Not** established physiology. **Not** static-fist hardware detection. Synthetic scores are **not** hardware validation.

- Collection labels: `open`, `fist`, `rest`. **REST is negative/unknown, not “closed”.** Training requires enough REST samples **and** REST separable from both OPEN and FIST. REST=OPEN or REST=FIST ⇒ `nonseparable` ⇒ inference `UNKNOWN`.
- Inference (only after per-user + context calibration): `open` | `closed` | `UNKNOWN`.
- Units: `userAcceleration` **g**, `rotationRate` **rad/s** (Core Motion). Features are **windowed mean and variance of magnitudes**, not instantaneous squares.
- Authoritative **receiver** `now` is required. Per-session replay / out-of-order / future / stale ⇒ `UNKNOWN`.
- **Not wired** to cursor or click. Arming required. Cooldown. `UNKNOWN` ⇒ no action.
- Local logging only. Pseudonymous `user-local-*` / `sess-*`. Schema v2 records units, frame, monotonic sensor timestamp, sequence, wrist, strap-fit.
- No HealthKit, optics, or PPG. No real collector/export/authenticated transport in this folder.

Watch UI draft (untested, `#if false`) is in `Sources/WatchPointerDraft/`. That local UI+hook is **not** end-to-end Watch→Mac transport.

Workspace folder: `7-hand-state-experimental`.
