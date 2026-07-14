import * as THREE from 'three';

const MAX_PARTICLES = 256;
const PARTICLE_LIFE = 0.85;

/**
 * Visual juice: camera shake + one-shot particle bursts driven by world events.
 * Head-bob lives on the Player (needs velocity/grounded); vignette lives on Engine.
 */
export class Juice {
  constructor(scene) {
    this.scene = scene;
    this.shake = 0;
    this._shakeSeed = Math.random() * 1000;

    this._count = 0;
    this._life = new Float32Array(MAX_PARTICLES);
    this._vel = new Float32Array(MAX_PARTICLES * 3);

    const geo = new THREE.BufferGeometry();
    this._positions = new Float32Array(MAX_PARTICLES * 3);
    this._colors = new Float32Array(MAX_PARTICLES * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this._positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this._colors, 3));
    geo.setDrawRange(0, 0);

    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.09,
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);

    this._tmp = new THREE.Vector3();
  }

  /** Soft punch for camera — decays over ~0.4s. */
  punch(amount = 0.12) {
    this.shake = Math.min(0.35, this.shake + amount);
  }

  /**
   * Spawn a burst of additive particles at world position.
   * @param {THREE.Vector3} pos
   * @param {number|THREE.Color} color
   * @param {number} [count=18]
   * @param {number} [speed=2.8]
   */
  burst(pos, color, count = 18, speed = 2.8) {
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    const n = Math.min(count, MAX_PARTICLES - this._count);
    for (let i = 0; i < n; i++) {
      const idx = this._count++;
      const o = idx * 3;
      this._positions[o] = pos.x + (Math.random() - 0.5) * 0.12;
      this._positions[o + 1] = pos.y + (Math.random() - 0.5) * 0.12;
      this._positions[o + 2] = pos.z + (Math.random() - 0.5) * 0.12;
      this._colors[o] = c.r;
      this._colors[o + 1] = c.g;
      this._colors[o + 2] = c.b;
      // hemispheric spray, bias upward
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.55;
      const s = speed * (0.45 + Math.random() * 0.7);
      this._vel[o] = Math.sin(phi) * Math.cos(theta) * s;
      this._vel[o + 1] = Math.cos(phi) * s * 0.85 + 0.6;
      this._vel[o + 2] = Math.sin(phi) * Math.sin(theta) * s;
      this._life[idx] = PARTICLE_LIFE * (0.65 + Math.random() * 0.45);
    }
    this.points.geometry.setDrawRange(0, this._count);
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  /**
   * Apply residual shake to a camera that has already been placed by the player.
   * Call after player.update each frame while playing.
   */
  applyCameraShake(camera, dt) {
    if (this.shake <= 0.0005) {
      this.shake = 0;
      return;
    }
    this._shakeSeed += dt * 42;
    const s = this.shake;
    camera.position.x += Math.sin(this._shakeSeed * 1.7) * s * 0.55;
    camera.position.y += Math.cos(this._shakeSeed * 2.1) * s * 0.35;
    camera.position.z += Math.sin(this._shakeSeed * 1.3 + 1.2) * s * 0.45;
    // subtle roll so the punch reads in FOV, not just translation
    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    euler.z += Math.sin(this._shakeSeed * 3.1) * s * 0.08;
    camera.quaternion.setFromEuler(euler);
    this.shake = Math.max(0, this.shake - dt * 1.85);
  }

  update(dt) {
    if (this._count === 0) return;
    let write = 0;
    for (let i = 0; i < this._count; i++) {
      let life = this._life[i] - dt;
      if (life <= 0) continue;
      const o = i * 3;
      const wo = write * 3;
      this._vel[o + 1] -= 3.2 * dt; // light gravity
      this._positions[wo] = this._positions[o] + this._vel[o] * dt;
      this._positions[wo + 1] = this._positions[o + 1] + this._vel[o + 1] * dt;
      this._positions[wo + 2] = this._positions[o + 2] + this._vel[o + 2] * dt;
      this._vel[wo] = this._vel[o];
      this._vel[wo + 1] = this._vel[o + 1];
      this._vel[wo + 2] = this._vel[o + 2];
      // fade color toward black as life ends
      const t = life / PARTICLE_LIFE;
      this._colors[wo] = this._colors[o] * t;
      this._colors[wo + 1] = this._colors[o + 1] * t;
      this._colors[wo + 2] = this._colors[o + 2] * t;
      this._life[write] = life;
      write++;
    }
    this._count = write;
    this.points.geometry.setDrawRange(0, this._count);
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  clear() {
    this._count = 0;
    this.shake = 0;
    this.points.geometry.setDrawRange(0, 0);
  }

  dispose() {
    this.clear();
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
