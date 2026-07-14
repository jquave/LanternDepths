/**
 * Data-driven level definitions. Everything the game renders and simulates
 * comes from these objects, so new levels are pure data — no code changes.
 *
 * Coordinate convention: floors sit at y = 0, +Y is up. Boxes are defined by
 * center position [x,y,z] and full size [w,h,d].
 *
 * Entities:
 *   boxes    - static solid geometry (walls, floors, pillars, ledges)
 *   crystals - grabbable light-cores the player carries
 *   beacons  - floor sockets that "light" when a crystal rests in them
 *   bridges  - spans that only become solid + visible once `requires` beacon lit
 *   movers   - vertical light-lifts. Rise/fall along +Y on an eased cycle; a
 *              lift with `requires` stays dormant at its base until that beacon
 *              is lit. The player rides one up because the character controller
 *              re-seats the body on the platform top every frame.
 *              { id, pos:[x,baseY,z], size:[w,h,d], travel, speed, requires? }
 *   exit     - the portal; opens once every beacon in the level is lit
 */

const AMBER = 0xffb347;
const CYAN = 0x7fe9ff;
const VIOLET = 0xc79bff;
const GREEN = 0x9dffbf;

export const LEVELS = [
  // ------------------------------------------------------------------ 1
  {
    id: 'descent',
    name: 'I · The First Ember',
    subtitle: 'Every depth begins with a single light.',
    quote: 'Carry the ember to its socket, and the way down will open.',
    palette: { floor: 0x2a2f3d, wall: 0x1b1f2b, accent: AMBER },
    fog: { color: 0x090b12, near: 6, far: 46 },
    ambient: 0.16,
    spawn: { x: 0, z: 9, yaw: 0 },
    boxes: [
      { pos: [0, -0.5, 0], size: [22, 1, 30], role: 'floor' },
      { pos: [0, 3, -15.5], size: [22, 8, 1], role: 'wall' },
      { pos: [-11, 3, 0], size: [1, 8, 30], role: 'wall' },
      { pos: [11, 3, 0], size: [1, 8, 30], role: 'wall' },
      { pos: [0, 3, 15.5], size: [22, 8, 1], role: 'wall' },
      { pos: [-4.5, 0.4, -2], size: [3, 0.8, 3], role: 'ledge' },
    ],
    crystals: [{ pos: [4.5, 0.9, 3], color: AMBER }],
    beacons: [{ id: 'a', pos: [-4.5, -6], color: AMBER }],
    bridges: [],
    exit: { pos: [0, 0, -14] },
  },

  // ------------------------------------------------------------------ 2
  {
    id: 'crossing',
    name: 'II · The Broken Span',
    subtitle: 'Light remembers the shape of a bridge.',
    quote: 'Wake the near beacon; the chasm will answer with a path of light.',
    palette: { floor: 0x252b3a, wall: 0x171b26, accent: CYAN },
    fog: { color: 0x070a12, near: 5, far: 52 },
    ambient: 0.14,
    spawn: { x: 0, z: 12, yaw: 0 },
    boxes: [
      // entry platform
      { pos: [0, -0.5, 9], size: [14, 1, 10], role: 'floor' },
      // far platform (across the chasm)
      { pos: [0, -0.5, -12], size: [16, 1, 12], role: 'floor' },
      // side walls framing the whole space
      { pos: [-8.5, 4, -1], size: [1, 10, 44], role: 'wall' },
      { pos: [8.5, 4, -1], size: [1, 10, 44], role: 'wall' },
      { pos: [0, 4, 14.5], size: [18, 10, 1], role: 'wall' },
      { pos: [0, 4, -18.5], size: [18, 10, 1], role: 'wall' },
      // a small island in the middle holding beacon B
      { pos: [0, -0.5, -1], size: [5, 1, 4], role: 'floor' },
    ],
    crystals: [
      { pos: [-3, 0.9, 9], color: CYAN },
      { pos: [3, 0.9, 9], color: CYAN },
    ],
    beacons: [
      { id: 'near', pos: [0, 6], color: CYAN }, // on entry platform
      { id: 'far', pos: [0, -1], color: CYAN }, // on the middle island
    ],
    bridges: [
      // span from entry platform to the middle island — needs 'near' lit
      { pos: [0, -0.1, 3.5], size: [3, 0.3, 5], requires: 'near', color: CYAN },
      // span from island to far platform — needs 'far' lit
      { pos: [0, -0.1, -6.5], size: [3, 0.3, 6], requires: 'far', color: CYAN },
    ],
    exit: { pos: [0, 0, -16] },
  },

  // ------------------------------------------------------------------ 3
  {
    id: 'lantern',
    name: 'III · The Lantern Heart',
    subtitle: 'Three lights, one darkness to undo.',
    quote: 'Climb, carry, and kindle. Only a lit path leads to the last socket.',
    palette: { floor: 0x2b2740, wall: 0x18162a, accent: VIOLET },
    fog: { color: 0x0a0714, near: 6, far: 58 },
    ambient: 0.13,
    spawn: { x: 0, z: 13, yaw: 0 },
    boxes: [
      // entry platform (z 4..16)
      { pos: [0, -0.5, 10], size: [18, 1, 12], role: 'floor' },
      // mid platform (z -8..0)
      { pos: [0, -0.5, -4], size: [10, 1, 8], role: 'floor' },
      // far platform (z -22..-14)
      { pos: [0, -0.5, -18], size: [12, 1, 8], role: 'floor' },
      // perimeter walls
      { pos: [-10, 5, -4], size: [1, 12, 46], role: 'wall' },
      { pos: [10, 5, -4], size: [1, 12, 46], role: 'wall' },
      { pos: [0, 5, 16.5], size: [22, 12, 1], role: 'wall' },
      { pos: [0, 5, -22.5], size: [22, 12, 1], role: 'wall' },
      // steps up to the high pillar (left of entry)
      { pos: [-4, 0.5, 6], size: [2.4, 1, 2.4], role: 'ledge' },
      { pos: [-6, 1, 3], size: [3.6, 2, 3.6], role: 'ledge' }, // top at y=2
    ],
    crystals: [
      { pos: [-3, 0.9, 12], color: VIOLET }, // carry up the steps to 'high'
      { pos: [3, 0.9, 12], color: GREEN }, // carry across to 'mid'
      { pos: [3, 0.9, -4], color: AMBER }, // waits on mid platform, carry to 'far'
    ],
    beacons: [
      { id: 'high', pos: [-6, 3], y: 2, color: VIOLET }, // atop the pillar
      { id: 'mid', pos: [-2, -4], color: GREEN },
      { id: 'far', pos: [0, -18], color: AMBER },
    ],
    bridges: [
      // entry -> mid, appears once 'high' is lit
      { pos: [0, -0.1, 2], size: [3.5, 0.3, 5], requires: 'high', color: VIOLET },
      // mid -> far, appears once 'mid' is lit
      { pos: [0, -0.1, -11], size: [3.5, 0.3, 7], requires: 'mid', color: GREEN },
    ],
    exit: { pos: [0, 0, -20] },
  },

  // ------------------------------------------------------------------ 4
  {
    id: 'ascent',
    name: 'IV · The Rising Dark',
    subtitle: 'Some depths are climbed, not crossed.',
    quote: 'Wake a light and the stone will rise to carry you. Ride it, and kindle the height.',
    palette: { floor: 0x2b3324, wall: 0x14180f, accent: GREEN },
    fog: { color: 0x080a06, near: 6, far: 60 },
    ambient: 0.13,
    spawn: { x: 0, z: 13, yaw: 0 },
    boxes: [
      // entry floor (z 5..17), top y=0
      { pos: [0, -0.5, 11], size: [16, 1, 12], role: 'floor' },
      // mid ledge (z -6..0), top y=4
      { pos: [0, 3.5, -3], size: [9, 1, 6], role: 'floor' },
      // high ledge (z -16..-10), top y=8 — holds the last beacon + the exit
      { pos: [0, 7.5, -13], size: [11, 1, 6], role: 'floor' },
      // perimeter walls (tall — this is a shaft)
      { pos: [-9, 7, -3], size: [1, 20, 46], role: 'wall' },
      { pos: [9, 7, -3], size: [1, 20, 46], role: 'wall' },
      { pos: [0, 7, 16.5], size: [20, 20, 1], role: 'wall' },
      { pos: [0, 7, -18.5], size: [20, 20, 1], role: 'wall' },
      // guide ledges beside each lift landing for readability
      { pos: [-6, 0.4, 3], size: [2, 0.8, 2], role: 'ledge' },
    ],
    crystals: [
      { pos: [4, 0.9, 11], color: GREEN }, // -> ground beacon (arms lift A)
      { pos: [-4, 0.9, 11], color: CYAN }, // carry up lift A -> mid beacon (arms lift B)
      { pos: [3, 4.9, -3], color: AMBER }, // waits on mid ledge, ride lift B -> high beacon
    ],
    beacons: [
      { id: 'ground', pos: [-5, 11], color: GREEN }, // on entry floor
      { id: 'mid', pos: [0, -3], y: 4, color: CYAN }, // on mid ledge
      { id: 'high', pos: [0, -13], y: 8, color: AMBER }, // on high ledge
    ],
    bridges: [],
    movers: [
      // lift A: entry (y0) -> mid ledge (y4), armed by 'ground'
      { id: 'liftA', pos: [0, 0, 2.5], size: [4, 0.5, 4], travel: 4, speed: 1.15, requires: 'ground', color: GREEN },
      // lift B: mid ledge (y4) -> high ledge (y8), armed by 'mid'
      { id: 'liftB', pos: [0, 4, -8], size: [4, 0.5, 4], travel: 4, speed: 1.0, requires: 'mid', color: CYAN },
    ],
    exit: { pos: [0, 8, -13] },
  },
];
