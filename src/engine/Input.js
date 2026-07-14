/**
 * Centralized input for keyboard, mouse, gamepad, and touch. Tracks held keys
 * and one-shot "pressed this frame" edges, plus accumulated look deltas and a
 * unified analog movement vector. Gamepad and touch are folded into the SAME
 * held/pressed/mouse-delta primitives so Player and Game never learn about the
 * device: keyboard `W`, a left-stick push, and a touch joystick all surface
 * through `moveVector()`; mouse, right-stick, and look-drag all surface through
 * `mouseDX/mouseDY`; jump/grab all surface through `isDown`/`pressed`.
 */

// Right-stick look, expressed as mouse-pixels-per-second at full deflection so
// it can share the pointer's MOUSE_SENS in Player. ~2.8 rad/s at that sens.
const GAMEPAD_LOOK = 1280;
const STICK_DEADZONE = 0.18;

// Standard Gamepad mapping: 0=A/cross (jump), 2=X/square (grab), 9=Start (pause).
const PAD_JUMP = 0;
const PAD_GRAB = 2;
const PAD_PAUSE = 9;

export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.held = new Set();
    this._pressedEdge = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;
    this._listeners = { lock: new Set(), unlock: new Set() };

    // Analog movement contributed by gamepad stick / touch joystick, in the
    // same {x: strafe-right, z: forward} space keyboard uses. Persist across
    // frames (a held stick is continuous state, not a per-frame edge).
    this._padMove = { x: 0, z: 0 };
    this._touchMove = { x: 0, z: 0 };
    this.gamepad = null;
    this._padPrev = new Map();

    this.gamepadLookSpeed = GAMEPAD_LOOK;
    this.touchLookScale = 0.9;
    // Do NOT use maxTouchPoints / ontouchstart alone — Windows Chrome often
    // reports a digitizer even on pure mouse desktops, which would flash the
    // on-screen joystick. Prefer coarse primary pointer (phones/tablets);
    // hybrids still unlock on the first real touchstart in _setupTouch().
    this.touchEnabled = prefersTouchUI();

    this._onKeyDown = (e) => {
      const code = e.code;
      if (!this.held.has(code)) this._pressedEdge.add(code);
      this.held.add(code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) {
        e.preventDefault();
      }
    };
    this._onKeyUp = (e) => this.held.delete(e.code);

    this._onMouseMove = (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    };

    this._onPointerLockChange = () => {
      this.locked = document.pointerLockElement === this.dom;
      const set = this.locked ? this._listeners.lock : this._listeners.unlock;
      for (const fn of set) fn();
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
    // Losing focus should never leave keys "stuck" down.
    window.addEventListener('blur', () => this.held.clear());
    // A gamepad may appear/disappear at any time; polling handles the rest.
    window.addEventListener('gamepadconnected', () => { /* polled in update() */ });

    this._setupTouch();
  }

  requestLock() {
    if (this.dom.requestPointerLock) this.dom.requestPointerLock();
  }

  exitLock() {
    if (document.exitPointerLock) document.exitPointerLock();
  }

  onLock(fn) { this._listeners.lock.add(fn); }
  onUnlock(fn) { this._listeners.unlock.add(fn); }

  isDown(code) { return this.held.has(code); }

  /** True only on the first frame the key/button went down. */
  pressed(code) { return this._pressedEdge.has(code); }

  /**
   * Unified analog movement in {x: strafe-right, z: forward}, clamped to the
   * unit disc. Combines keyboard (digital ±1), gamepad left stick, and the
   * on-screen touch joystick so the caller stays device-agnostic.
   */
  moveVector() {
    let x = 0, z = 0;
    if (this.held.has('KeyW') || this.held.has('ArrowUp')) z += 1;
    if (this.held.has('KeyS') || this.held.has('ArrowDown')) z -= 1;
    if (this.held.has('KeyD') || this.held.has('ArrowRight')) x += 1;
    if (this.held.has('KeyA') || this.held.has('ArrowLeft')) x -= 1;
    x += this._padMove.x + this._touchMove.x;
    z += this._padMove.z + this._touchMove.z;
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    return { x, z };
  }

  /** Poll continuous devices (gamepad). Call once per frame before consumers. */
  update(dt) {
    this._pollGamepad(dt);
  }

  _pollGamepad(dt) {
    const pads = (typeof navigator !== 'undefined' && navigator.getGamepads)
      ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) { if (p && p.connected) { pad = p; break; } }
    this.gamepad = pad;
    if (!pad) {
      this._padMove.x = 0;
      this._padMove.z = 0;
      // Release any virtual buttons the pad was holding.
      for (const [code, was] of this._padPrev) {
        if (was) this.held.delete(code);
        this._padPrev.set(code, false);
      }
      return;
    }

    const ax = pad.axes || [];
    const lx = deadzone(ax[0] ?? 0);
    const ly = deadzone(ax[1] ?? 0);
    this._padMove.x = lx;
    this._padMove.z = -ly; // stick up (negative axis) = forward

    const rx = deadzone(ax[2] ?? 0);
    const ry = deadzone(ax[3] ?? 0);
    this.mouseDX += rx * this.gamepadLookSpeed * dt;
    this.mouseDY += ry * this.gamepadLookSpeed * dt;

    this._padButton(pad, PAD_JUMP, 'Space');
    this._padButton(pad, PAD_GRAB, 'KeyE');
    this._padButton(pad, PAD_PAUSE, 'Pad:Pause');
  }

  _padButton(pad, index, code) {
    const btn = pad.buttons && pad.buttons[index];
    const down = !!(btn && btn.pressed);
    const was = this._padPrev.get(code) || false;
    if (down && !was) this._setVirtual(code, true);
    else if (!down && was) this._setVirtual(code, false);
    this._padPrev.set(code, down);
  }

  /** Emulate a keydown/keyup for a synthetic control (gamepad/touch button). */
  _setVirtual(code, down) {
    if (down) {
      if (!this.held.has(code)) this._pressedEdge.add(code);
      this.held.add(code);
    } else {
      this.held.delete(code);
    }
  }

  // ------------------------------------------------------------------ touch
  _setupTouch() {
    if (typeof document === 'undefined' || !document.body) return;

    const root = document.createElement('div');
    root.id = 'touch-controls';
    root.className = 'touch-controls';
    root.innerHTML = `
      <div id="touch-look" class="touch-look"></div>
      <div id="touch-stick" class="touch-stick"><div class="touch-knob"></div></div>
      <button id="touch-grab" class="touch-btn touch-grab" type="button">LIGHT</button>
      <button id="touch-jump" class="touch-btn touch-jump" type="button">JUMP</button>
    `;
    document.body.appendChild(root);
    this.touchRoot = root;

    document.body.classList.toggle('has-touch', this.touchEnabled);
    // Hybrid (Surface, touch laptop): keep mouse UI until an actual finger
    // touch. Ignore mouse-synthesized events; only real touch starts count.
    window.addEventListener('touchstart', () => {
      this.touchEnabled = true;
      document.body.classList.add('has-touch');
    }, { once: true, passive: true });

    this._wireStick(root.querySelector('#touch-stick'), root.querySelector('.touch-knob'));
    this._wireLook(root.querySelector('#touch-look'));
    this._wireTouchButton(root.querySelector('#touch-jump'), 'Space');
    this._wireTouchButton(root.querySelector('#touch-grab'), 'KeyE');
  }

  _wireStick(stick, knob) {
    let id = null, cx = 0, cy = 0, r = 1;
    const reset = () => {
      id = null;
      this._touchMove.x = 0;
      this._touchMove.z = 0;
      knob.style.transform = 'translate(0px, 0px)';
    };
    const move = (e) => {
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > r) { dx *= r / len; dy *= r / len; }
      this._touchMove.x = dx / r;
      this._touchMove.z = -dy / r; // up = forward
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    stick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      id = e.pointerId;
      stick.setPointerCapture(e.pointerId);
      const b = stick.getBoundingClientRect();
      cx = b.left + b.width / 2;
      cy = b.top + b.height / 2;
      r = b.width / 2;
      move(e);
    });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
    const end = (e) => { if (e.pointerId === id) reset(); };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
  }

  _wireLook(zone) {
    let id = null, lx = 0, ly = 0;
    zone.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      lx = e.clientX; ly = e.clientY;
      zone.setPointerCapture(e.pointerId);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      this.mouseDX += (e.clientX - lx) * this.touchLookScale;
      this.mouseDY += (e.clientY - ly) * this.touchLookScale;
      lx = e.clientX; ly = e.clientY;
    });
    const end = (e) => { if (e.pointerId === id) id = null; };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  _wireTouchButton(el, code) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._setVirtual(code, true);
    });
    const up = (e) => { e.preventDefault(); this._setVirtual(code, false); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  }

  /** Consume per-frame deltas/edges. Call at end of each update. */
  endFrame() {
    this._pressedEdge.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }
}

function deadzone(v, dz = STICK_DEADZONE) {
  const a = Math.abs(v);
  if (a < dz) return 0;
  return Math.sign(v) * ((a - dz) / (1 - dz));
}

/** True when the primary pointer is finger-sized (phones / pure tablets). */
function prefersTouchUI() {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}
