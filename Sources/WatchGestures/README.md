# Watch gesture modules

Hardware-free detectors for **orientation-relative** wrist motion:

- Modes: `paused` | `suppress` | `turnover` | `swipe` | `click` | `pointing`
- Startup, resume, and delivery **gaps** enter suppress until quiet
- Click is a **rising** poke with **release hysteresis** (sustained pitch does not retrigger every cooldown)
- Swipe uses **wrapped** yaw deltas; displacement and rate signs must agree
- Immediate pause

Digital Crown **press** is not used (unsupported public API). Right-click is an in-app button in the Watch draft, not a crown press.
