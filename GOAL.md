# Goal

Improve this 3D, atmospheric, multi-level, production quality, release-ready AAA puzzle game and bring it to the next level. You determine how to take next steps to VASTLY improve it. Prioritize what's most important and go.


Agents must read this file every turn and keep progress aligned with it.
Update checkboxes when a criterion is met.
Primary code lives in **`src/`**. Root `GOAL.md` is for the round-robin
orchestrator;

---

## Progress checklist

The game is **THE LANTERN DEPTHS** (Three.js, first-person atmospheric puzzle).
Run: `node server.js` → http://localhost:8080. Test: `npm test`.

- [x] 3D rendering pipeline (Three.js r160, bloom post-processing, shadows)
- [x] Atmospheric presentation (fog, low-key lighting, emissive crystals, drifting dust)
- [x] First-person controller with AABB collision, gravity, jump
- [x] Core puzzle mechanic (carry crystals → light beacons → raise light-bridges → open exit)
- [x] Multi-level (3 hand-designed, data-driven levels of escalating difficulty)
- [x] Release-ready shell (title, level-select, pause, victory, HUD; saved unlocks)
- [x] Automated verification (deterministic headless smoke test; all levels solvable)
- [x] Audio (ambient bed + SFX) — procedural Web Audio, mute toggle, event-driven
- [x] More levels / a new mechanic — Level IV "The Rising Dark" + beacon-armed moving light-lifts (vertical platforms that carry the player)
- [x] Juice & polish (head-bob, particle bursts, vignette, better materials)
- [x] Input breadth — gamepad (analog sticks, A jump / X light / Start pause) + touch (on-screen joystick, look-drag, action buttons), all folded into one device-agnostic Input

See `TURN.md` for the current hand-off and detailed next steps.