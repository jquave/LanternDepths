# THE LANTERN DEPTHS

An atmospheric, first-person 3D puzzle game built with **Three.js**.
Carry glowing crystals through the dark, seat them in sockets to wake the
beacons, and open the way deeper. Lit beacons summon bridges of light across
chasms — the darkness only yields to a path you illuminate yourself.

> *"Carry the light. Wake the beacons. Descend."*

## Play

No build step, no install. Any static server works; a zero-dependency one ships
with the repo:

```bash
node server.js        # → http://localhost:8080
# or
npm start
```

Open the URL, click **ENTER THE DEPTHS**, and click the canvas to capture the
mouse.

### Controls

| Key | Action |
|-----|--------|
| `W A S D` / arrows | Move |
| Mouse | Look |
| `E` | Grab / release the nearest crystal |
| `Space` | Jump |
| `R` | Restart the current level |
| `Esc` | Pause (releases the mouse) |

**Gamepad** (Standard mapping, auto-detected): left stick moves, right stick
looks, **A/✕** jumps, **X/▢** grabs/releases, **Start** pauses. **Touch/mobile:**
an on-screen joystick (bottom-left) moves, drag anywhere to look, and the
**JUMP** / **LIGHT** buttons (bottom-right) act — the touch overlay appears
automatically on touch devices. All three input paths fold into one
device-agnostic `Input` (`moveVector()` + `mouseDX/DY` + `isDown`/`pressed`), so
the player controller never branches on device.

Mute / unmute lives on the title screen and pause menu (**SOUND ON / SOUND OFF**).
Preference is saved in `localStorage`. Audio is procedural Web Audio (no sample
files) and only starts after a user gesture (ENTER or canvas click).

## The four depths

1. **The First Ember** — learn to carry light and seat it in a socket.
2. **The Broken Span** — lit beacons raise bridges of light across the chasm.
3. **The Lantern Heart** — climb, carry, and kindle in order; only a lit path
   reaches the final socket.
4. **The Rising Dark** — some depths are climbed, not crossed. Waking a beacon
   arms a **moving light-lift** that rises from the stone to carry you upward;
   ride it to kindle the next height.

Progress unlocks are saved to `localStorage`, and every level is selectable
from the title screen once reached.

## Architecture

Everything is plain ES modules — no bundler. `src/index.html` uses an import map
so `import 'three'` resolves to the vendored copy in `src/vendor/three/`.

```
src/
  index.html            entry + import map
  main.js               bootstraps Engine + Input + Game
  styles/game.css       all HUD / menu / overlay styling
  engine/
    Engine.js           renderer, camera, bloom + vignette post, render loop
    Input.js            unified keyboard + mouse + gamepad + touch input
    Audio.js            procedural ambient drone + SFX (Web Audio API)
    Juice.js            particle bursts + camera shake (event-driven)
  game/
    Game.js             state machine, level lifecycle, per-frame step
    World.js            builds a level, simulates crystals/beacons/bridges/exit
    Player.js           first-person AABB + footstep head-bob controller
    UI.js               DOM overlay controller (menu, HUD, banners)
  levels/
    levels.js           data-driven level definitions (pure data, no code)
  vendor/three/         pinned Three.js r160 + the addons we use
```

### Design notes

- **Levels are pure data.** A new level is a new object in `levels.js`:
  static `boxes`, `crystals`, `beacons`, light-`bridges` (gated on a beacon id),
  moving `movers` (beacon-armed light-lifts), and an `exit`. No engine changes
  required.
- **Collision** is AABB collide-and-slide. The player, dropped crystals,
  active light-bridges, and moving lifts all share one collider set, so you can
  stand on a placed crystal or a lit bridge — and ride a rising lift, which
  carries you because the controller re-seats the body on the platform each
  frame.
- **Atmosphere** comes from fog, low ambient light, emissive crystals each
  casting a point light, drifting dust motes, bloom + vignette post, footstep
  head-bob, event particle bursts / camera shake, and a procedural cavern drone
  with grab / place / beacon / exit / victory cues.
- **World events** (`grab`, `release`, `beacon-lit`, `exit-open`) are queued on
  `World.events` each frame so audio and juice stay decoupled from sim.

## Test

A headless Chromium smoke test boots the game, drives the player, forces a
render, and deterministically solves every level to verify the beacon → exit
win logic (and that beacon-armed lifts travel):

```bash
npm test
```

> The test requires a local Puppeteer/Chromium. It steps the simulation with a
> fixed timestep rather than trusting the headless `requestAnimationFrame`
> clock, which Chromium throttles for backgrounded pages.

## Roadmap

See `TURN.md` for the current hand-off. Input breadth (gamepad + touch/mobile)
is now shipped. Near-term ideas: more mechanics (mirrors that redirect a beam,
timed/relay beacons, free-running or horizontal lifts), a fifth depth, or a
settings panel (look-sensitivity / invert-Y / audio sliders).
