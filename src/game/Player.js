import * as THREE from 'three';

const RADIUS = 0.34;
const HEIGHT = 1.72;
const EYE = 1.58;
const GRAVITY = 24;
const WALK = 5.4;
const ACCEL = 55;
const AIR_ACCEL = 12;
const JUMP = 7.6;
const MOUSE_SENS = 0.0022;
const BOB_FREQ = 9.2;
const BOB_AMP_Y = 0.028;
const BOB_AMP_X = 0.012;

/**
 * First-person character controller. Owns an AABB body resolved against the
 * world's colliders with a per-axis collide-and-slide, plus mouse-look and
 * the "hold point" where a carried crystal floats.
 */
export class Player {
  constructor(camera, input, world, spawn) {
    this.camera = camera;
    this.input = input;
    this.world = world;

    this.pos = new THREE.Vector3(spawn.x, 0, spawn.z); // feet
    this.vel = new THREE.Vector3();
    this.yaw = spawn.yaw ?? 0;
    this.pitch = 0;
    this.grounded = false;
    this.spawn = spawn;
    this._bobPhase = 0;
    this._bobAmount = 0;

    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._holdPoint = new THREE.Vector3();
    this._syncCamera();
  }

  reset(spawn) {
    const s = spawn || this.spawn;
    this.pos.set(s.x, 0, s.z);
    this.vel.set(0, 0, 0);
    this.yaw = s.yaw ?? 0;
    this.pitch = 0;
    this._bobPhase = 0;
    this._bobAmount = 0;
    this._syncCamera();
  }

  update(dt) {
    this._look();
    this._move(dt);
    this._updateBob(dt);
    this._syncCamera();
    this._updateHold(dt);
  }

  _updateBob(dt) {
    const hx = this.vel.x;
    const hz = this.vel.z;
    const speed = Math.sqrt(hx * hx + hz * hz);
    const target = this.grounded ? Math.min(1, speed / WALK) : 0;
    // ease amount so start/stop doesn't pop
    this._bobAmount += (target - this._bobAmount) * Math.min(1, dt * 10);
    if (this._bobAmount > 0.02) {
      this._bobPhase += dt * BOB_FREQ * (0.65 + this._bobAmount * 0.55);
    } else {
      // settle phase toward rest so the next walk doesn't start mid-peak
      this._bobPhase *= 1 - Math.min(1, dt * 4);
    }
  }

  _look() {
    this.yaw -= this.input.mouseDX * MOUSE_SENS;
    this.pitch -= this.input.mouseDY * MOUSE_SENS;
    const lim = Math.PI / 2 - 0.05;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  _move(dt) {
    // desired horizontal direction from WASD in yaw space
    this._fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    // Unified analog movement (keyboard / gamepad stick / touch joystick).
    const { x: ix, z: iz } = this.input.moveVector();

    // Already clamped to the unit disc by moveVector(); scale directly so
    // analog sticks yield proportional (walk-in) speed instead of full tilt.
    const wish = new THREE.Vector3()
      .addScaledVector(this._fwd, iz)
      .addScaledVector(this._right, ix);

    const accel = this.grounded ? ACCEL : AIR_ACCEL;
    const targetX = wish.x * WALK;
    const targetZ = wish.z * WALK;
    this.vel.x = approach(this.vel.x, targetX, accel * dt);
    this.vel.z = approach(this.vel.z, targetZ, accel * dt);

    // jump
    if (this.grounded && (this.input.isDown('Space'))) {
      this.vel.y = JUMP;
      this.grounded = false;
    }
    this.vel.y -= GRAVITY * dt;

    const colliders = this.world.colliders();
    this.grounded = false;
    // Resolve Y first so a rising platform re-seats the feet on its top BEFORE
    // the horizontal passes run. Otherwise a lift that moved up since the last
    // re-seat leaves a residual vertical overlap that the X/Z passes misread as
    // a side collision, ejecting the player sideways off the platform.
    this._moveAxis('y', this.vel.y * dt, colliders);
    this._moveAxis('x', this.vel.x * dt, colliders);
    this._moveAxis('z', this.vel.z * dt, colliders);

    // fell into the void — respawn at level spawn
    if (this.pos.y < -14) this.reset();
  }

  _moveAxis(axis, delta, colliders) {
    if (delta === 0 && axis !== 'y') return;
    this.pos[axis] += delta;
    let box = this._box();
    const EPS = 1e-4;
    for (const c of colliders) {
      // Genuine penetration depth on every axis. Coplanar contact (e.g. feet
      // resting on a floor) gives ~0 overlap and must NOT trigger a push,
      // otherwise horizontal motion would resolve against the floor's side.
      const ox = Math.min(box.max.x, c.max.x) - Math.max(box.min.x, c.min.x);
      const oy = Math.min(box.max.y, c.max.y) - Math.max(box.min.y, c.min.y);
      const oz = Math.min(box.max.z, c.max.z) - Math.max(box.min.z, c.min.z);
      if (ox <= EPS || oy <= EPS || oz <= EPS) continue;

      if (axis === 'y') {
        if (delta <= 0) { this.pos.y += oy; this.grounded = true; }
        else { this.pos.y -= oy; }
        this.vel.y = 0;
      } else {
        const push = axis === 'x' ? ox : oz;
        this.pos[axis] += delta > 0 ? -push : push;
        this.vel[axis] = 0;
      }
      box = this._box();
    }
  }

  _box() {
    return new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(this.pos.x, this.pos.y + HEIGHT / 2, this.pos.z),
      new THREE.Vector3(RADIUS * 2, HEIGHT, RADIUS * 2),
    );
  }

  _syncCamera() {
    const a = this._bobAmount;
    const bobY = Math.sin(this._bobPhase * 2) * BOB_AMP_Y * a;
    const bobX = Math.sin(this._bobPhase) * BOB_AMP_X * a;
    // lateral bob in yaw space (strafe-style sway)
    const lx = Math.cos(this.yaw) * bobX;
    const lz = -Math.sin(this.yaw) * bobX;
    this.camera.position.set(
      this.pos.x + lx,
      this.pos.y + EYE + bobY,
      this.pos.z + lz,
    );
    const euler = new THREE.Euler(this.pitch, this.yaw, bobX * 0.35, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);
  }

  _updateHold(dt) {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this._holdPoint.copy(this.camera.position)
      .addScaledVector(dir, 1.5)
      .add(new THREE.Vector3(0, -0.35, 0));
    this.world.updateHeld(this._holdPoint, dt);
  }

  get holdPoint() { return this._holdPoint; }
  get position() { return this.pos; }
}

function approach(current, target, maxDelta) {
  if (current < target) return Math.min(current + maxDelta, target);
  if (current > target) return Math.max(current - maxDelta, target);
  return current;
}
