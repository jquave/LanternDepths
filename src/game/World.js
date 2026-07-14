import * as THREE from 'three';

const UP_EPS = 0.35; // vertical tolerance for "a crystal rests in this beacon"

/**
 * Builds and simulates a single level: static geometry, grabbable crystals,
 * beacons (sockets), light-bridges, the exit portal, and atmosphere.
 *
 * Collision is AABB-based. `colliders()` returns the set the player tests
 * against each frame (static boxes + active bridges + settled crystals).
 */
export class World {
  constructor(scene, level) {
    this.scene = scene;
    this.level = level;
    this.root = new THREE.Group();
    scene.add(this.root);

    this.staticBoxes = []; // {box: Box3, mesh}
    this.crystals = [];
    this.beacons = [];
    this.bridges = [];
    this.movers = []; // vertical light-lifts (see _buildMovers)
    this.grabbed = null;
    this.exitOpen = false;
    this._litCount = 0;
    this._exitWasOpen = false;
    /** One-shot game events drained each frame by Game (for audio/juice). */
    this.events = [];

    this._buildAtmosphere();
    this._buildGeometry();
    this._buildCrystals();
    this._buildBeacons();
    this._buildBridges();
    this._buildMovers();
    this._buildExit();
    this._buildDust();
  }

  // ---------------------------------------------------------------- build
  _buildAtmosphere() {
    const f = this.level.fog;
    this.scene.fog = new THREE.Fog(f.color, f.near, f.far);
    this.scene.background = new THREE.Color(f.color);

    const amb = new THREE.AmbientLight(0x8095c0, this.level.ambient);
    this.root.add(amb);

    // Cool key light from above for gentle shape definition.
    const key = new THREE.DirectionalLight(0x9fb4e8, 0.28);
    key.position.set(-8, 22, 10);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 80;
    key.shadow.camera.left = -30;
    key.shadow.camera.right = 30;
    key.shadow.camera.top = 30;
    key.shadow.camera.bottom = -30;
    key.shadow.bias = -0.0008;
    this.root.add(key);
  }

  _buildGeometry() {
    const p = this.level.palette;
    const floorMat = new THREE.MeshStandardMaterial({
      color: p.floor, roughness: 0.88, metalness: 0.06,
    });
    const wallMat = new THREE.MeshStandardMaterial({
      color: p.wall, roughness: 0.94, metalness: 0.03,
    });
    const ledgeMat = new THREE.MeshStandardMaterial({
      color: p.floor, roughness: 0.72, metalness: 0.12,
      emissive: new THREE.Color(p.accent), emissiveIntensity: 0.045,
    });

    for (const b of this.level.boxes) {
      const geo = new THREE.BoxGeometry(b.size[0], b.size[1], b.size[2]);
      const mat = b.role === 'wall' ? wallMat : b.role === 'ledge' ? ledgeMat : floorMat;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(b.pos[0], b.pos[1], b.pos[2]);
      mesh.castShadow = b.role !== 'floor';
      mesh.receiveShadow = true;
      this.root.add(mesh);

      const box = new THREE.Box3().setFromCenterAndSize(
        mesh.position,
        new THREE.Vector3(b.size[0], b.size[1], b.size[2]),
      );
      this.staticBoxes.push({ box, mesh });

      // faint edge glow strip on top of floors for readability in the dark
      if (b.role === 'floor') {
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(geo),
          new THREE.LineBasicMaterial({ color: p.accent, transparent: true, opacity: 0.12 }),
        );
        edges.position.copy(mesh.position);
        this.root.add(edges);
      }
    }
  }

  _buildCrystals() {
    for (const c of this.level.crystals) {
      const color = new THREE.Color(c.color);
      const geo = new THREE.OctahedronGeometry(0.5, 0);
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 1.55,
        roughness: 0.18,
        metalness: 0.22,
        flatShading: true,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(c.pos[0], c.pos[1], c.pos[2]);
      mesh.castShadow = true;
      this.root.add(mesh);

      const light = new THREE.PointLight(color, 6, 12, 2);
      light.position.copy(mesh.position);
      this.root.add(light);

      const crystal = {
        mesh, light, color,
        vel: new THREE.Vector3(),
        grabbed: false,
        placedBeacon: null,
        home: mesh.position.clone(),
        half: 0.42,
      };
      this.crystals.push(crystal);
    }
  }

  _buildBeacons() {
    for (const b of this.level.beacons) {
      const color = new THREE.Color(b.color);
      const y = b.y || 0;
      const group = new THREE.Group();
      group.position.set(b.pos[0], y + 0.02, b.pos[1]);

      // socket ring on the floor
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.85, 0.07, 10, 40),
        new THREE.MeshStandardMaterial({
          color, emissive: color, emissiveIntensity: 0.15, roughness: 0.5,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      group.add(ring);

      // inner disc that brightens when lit
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(0.8, 40),
        new THREE.MeshStandardMaterial({
          color, emissive: color, emissiveIntensity: 0.05,
          transparent: true, opacity: 0.5, side: THREE.DoubleSide,
        }),
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.01;
      group.add(disc);

      // beam of light that rises when lit
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.7, 8, 20, 1, true),
        new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0, side: THREE.DoubleSide,
          depthWrite: false, blending: THREE.AdditiveBlending,
        }),
      );
      beam.position.y = 4;
      group.add(beam);

      const light = new THREE.PointLight(color, 0, 10, 2);
      light.position.y = 1.2;
      group.add(light);

      this.root.add(group);
      this.beacons.push({
        id: b.id, color, group, ring, disc, beam, light,
        pos: new THREE.Vector3(b.pos[0], y, b.pos[1]),
        surfaceY: y, radius: 1.0, lit: false, glow: 0,
      });
    }
  }

  _buildBridges() {
    for (const b of this.level.bridges) {
      const color = new THREE.Color(b.color || this.level.palette.accent);
      const geo = new THREE.BoxGeometry(b.size[0], b.size[1], b.size[2]);
      const mat = new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 0.9,
        transparent: true, opacity: 0, roughness: 0.3,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(b.pos[0], b.pos[1], b.pos[2]);
      mesh.receiveShadow = true;
      this.root.add(mesh);

      const box = new THREE.Box3().setFromCenterAndSize(
        mesh.position,
        new THREE.Vector3(b.size[0], b.size[1], b.size[2]),
      );
      this.bridges.push({ requires: b.requires, mesh, box, active: false, t: 0 });
    }
  }

  /**
   * Light-lifts: emissive platforms that rise and fall on an eased cycle along
   * +Y. A lift with `requires` sits dormant at its base until that beacon is
   * lit, then begins to travel — the player rides it up because the per-frame
   * vertical collision re-seats the body on the platform top each step.
   */
  _buildMovers() {
    for (const m of this.level.movers || []) {
      const color = new THREE.Color(m.color || this.level.palette.accent);
      const size = new THREE.Vector3(m.size[0], m.size[1], m.size[2]);

      const group = new THREE.Group();
      group.position.set(m.pos[0], 0, m.pos[2]);
      this.root.add(group);

      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, size.y, size.z),
        new THREE.MeshStandardMaterial({
          color, emissive: color, emissiveIntensity: 0.6,
          roughness: 0.35, metalness: 0.15,
        }),
      );
      slab.castShadow = true;
      slab.receiveShadow = true;
      group.add(slab);

      // rim glow so the lift reads clearly against the dark and its emissive
      // edge catches the bloom pass
      const rim = new THREE.LineSegments(
        new THREE.EdgesGeometry(slab.geometry),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 }),
      );
      slab.add(rim);

      const light = new THREE.PointLight(color, 2.2, 9, 2);
      light.position.y = 0.4;
      group.add(light);

      const box = new THREE.Box3();
      this.movers.push({
        id: m.id, requires: m.requires || null,
        group, slab, light, color, size,
        baseY: m.pos[1], travel: m.travel ?? 4,
        speed: m.speed ?? 1.1, phase: m.phase ?? 0,
        box, active: false,
      });
    }
    // seat every lift at its starting height so first-frame colliders are valid
    this._updateMovers(0, 0);
  }

  _beaconLit(id) {
    const b = this.beacons.find((x) => x.id === id);
    return !!(b && b.lit);
  }

  _buildExit() {
    const e = this.level.exit;
    const color = new THREE.Color(0xfff2d0);
    const group = new THREE.Group();
    group.position.set(e.pos[0], e.pos[1], e.pos[2]);

    const frame = new THREE.Mesh(
      new THREE.TorusGeometry(1.5, 0.16, 12, 40),
      new THREE.MeshStandardMaterial({
        color: 0x2a2f3d, emissive: color, emissiveIntensity: 0.0,
        roughness: 0.4, metalness: 0.5,
      }),
    );
    frame.position.y = 1.7;
    group.add(frame);

    const portal = new THREE.Mesh(
      new THREE.CircleGeometry(1.4, 40),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    portal.position.y = 1.7;
    group.add(portal);

    const light = new THREE.PointLight(color, 0, 14, 2);
    light.position.y = 1.7;
    group.add(light);

    this.root.add(group);
    this.exit = {
      group, frame, portal, light,
      pos: new THREE.Vector3(e.pos[0], e.pos[1] + 1.0, e.pos[2]),
      glow: 0,
    };
  }

  _buildDust() {
    const count = 320;
    const positions = new Float32Array(count * 3);
    const b = this._levelBounds();
    for (let i = 0; i < count; i++) {
      positions[i * 3] = b.minX + Math.random() * (b.maxX - b.minX);
      positions[i * 3 + 1] = Math.random() * 9;
      positions[i * 3 + 2] = b.minZ + Math.random() * (b.maxZ - b.minZ);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xfff0d0, size: 0.05, transparent: true, opacity: 0.5,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.dust = new THREE.Points(geo, mat);
    this.root.add(this.dust);
    this._dustBounds = b;
  }

  _levelBounds() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const b of this.level.boxes) {
      minX = Math.min(minX, b.pos[0] - b.size[0] / 2);
      maxX = Math.max(maxX, b.pos[0] + b.size[0] / 2);
      minZ = Math.min(minZ, b.pos[2] - b.size[2] / 2);
      maxZ = Math.max(maxZ, b.pos[2] + b.size[2] / 2);
    }
    return { minX, maxX, minZ, maxZ };
  }

  // ---------------------------------------------------------------- query
  /** AABB colliders the player collides with this frame. */
  colliders() {
    const list = [];
    for (const s of this.staticBoxes) list.push(s.box);
    for (const b of this.bridges) if (b.active) list.push(b.box);
    for (const m of this.movers) list.push(m.box);
    for (const c of this.crystals) {
      if (c.grabbed) continue;
      list.push(this._crystalBox(c));
    }
    return list;
  }

  _crystalBox(c) {
    return new THREE.Box3().setFromCenterAndSize(
      c.mesh.position,
      new THREE.Vector3(c.half * 2, c.half * 2, c.half * 2),
    );
  }

  get litTotal() { return this.beacons.length; }
  get litCount() { return this._litCount; }

  // -------------------------------------------------------------- grabbing
  /**
   * Toggle grab/release nearest crystal.
   * @returns {'grab'|'release'|null}
   */
  tryGrab(holdPoint) {
    if (this.grabbed) {
      this.release();
      this.events.push({ type: 'release' });
      return 'release';
    }
    let best = null, bestD = 2.6 * 2.6;
    for (const c of this.crystals) {
      const d = c.mesh.position.distanceToSquared(holdPoint);
      if (d < bestD) { best = c; bestD = d; }
    }
    if (best) {
      best.grabbed = true;
      best.vel.set(0, 0, 0);
      best.placedBeacon = null;
      this.grabbed = best;
      this.events.push({ type: 'grab' });
      return 'grab';
    }
    return null;
  }

  release() {
    if (!this.grabbed) return;
    this.grabbed.grabbed = false;
    this.grabbed.vel.set(0, 0, 0);
    this.grabbed = null;
  }

  updateHeld(holdPoint, dt) {
    if (!this.grabbed) return;
    // Smooth floaty follow toward the hold point in front of the camera.
    this.grabbed.mesh.position.lerp(holdPoint, Math.min(1, dt * 12));
  }

  // ---------------------------------------------------------------- update
  update(dt, elapsed) {
    this._updateMovers(dt, elapsed);
    this._simCrystals(dt);
    this._updateBeacons(dt, elapsed);
    this._updateBridges(dt);
    this._updateExit(dt, elapsed);
    this._animateCrystals(elapsed);
    this._updateDust(dt, elapsed);
  }

  _updateMovers(dt, elapsed) {
    for (const m of this.movers) {
      m.active = m.requires ? this._beaconLit(m.requires) : true;
      if (m.active) m.phase += dt * m.speed;
      // eased 0..1 oscillation that starts (phase 0) at the base height
      const s = 0.5 - 0.5 * Math.cos(m.phase);
      m.group.position.y = m.baseY + m.travel * s;
      m.box.setFromCenterAndSize(
        new THREE.Vector3(m.group.position.x, m.group.position.y, m.group.position.z),
        m.size,
      );
      const pulse = 0.6 + (m.active ? 0.4 + 0.25 * Math.sin(elapsed * 4) : 0);
      m.slab.material.emissiveIntensity = pulse;
      m.light.intensity = 1.2 + (m.active ? 1.4 : 0);
    }
  }

  _simCrystals(dt) {
    const colliders = [];
    for (const s of this.staticBoxes) colliders.push(s.box);
    for (const b of this.bridges) if (b.active) colliders.push(b.box);
    for (const m of this.movers) colliders.push(m.box);

    for (const c of this.crystals) {
      if (c.grabbed) continue;
      c.vel.y -= 22 * dt;
      c.mesh.position.y += c.vel.y * dt;

      // land on the highest surface directly beneath the crystal
      const px = c.mesh.position.x, pz = c.mesh.position.z;
      let groundY = -Infinity;
      for (const box of colliders) {
        if (px >= box.min.x - c.half && px <= box.max.x + c.half &&
            pz >= box.min.z - c.half && pz <= box.max.z + c.half) {
          if (c.mesh.position.y - c.half >= box.max.y - 0.4) {
            groundY = Math.max(groundY, box.max.y);
          }
        }
      }
      if (groundY > -Infinity && c.mesh.position.y - c.half <= groundY) {
        c.mesh.position.y = groundY + c.half;
        c.vel.y = 0;
      }
      // fell into the void — return home
      if (c.mesh.position.y < -12) {
        c.mesh.position.copy(c.home);
        c.vel.set(0, 0, 0);
      }
      c.light.position.copy(c.mesh.position);
    }
  }

  _updateBeacons(dt, elapsed) {
    let lit = 0;
    for (const bc of this.beacons) {
      let placed = false;
      for (const c of this.crystals) {
        if (c.grabbed) continue;
        const dx = c.mesh.position.x - bc.pos.x;
        const dz = c.mesh.position.z - bc.pos.z;
        const near = dx * dx + dz * dz <= bc.radius * bc.radius;
        const resting = Math.abs((c.mesh.position.y - c.half) - bc.surfaceY) < UP_EPS
          && Math.abs(c.vel.y) < 0.5;
        if (near && resting) {
          // snap into the socket for a satisfying seat
          c.mesh.position.x += (bc.pos.x - c.mesh.position.x) * Math.min(1, dt * 8);
          c.mesh.position.z += (bc.pos.z - c.mesh.position.z) * Math.min(1, dt * 8);
          placed = true;
          break;
        }
      }
      if (placed && !bc.lit) {
        this.events.push({ type: 'beacon-lit', id: bc.id });
      }
      bc.lit = placed;
      if (placed) lit++;

      const target = placed ? 1 : 0;
      bc.glow += (target - bc.glow) * Math.min(1, dt * 4);
      bc.light.intensity = bc.glow * 5;
      bc.disc.material.emissiveIntensity = 0.05 + bc.glow * 1.6;
      bc.disc.material.opacity = 0.5 + bc.glow * 0.4;
      bc.ring.material.emissiveIntensity = 0.15 + bc.glow * 1.2;
      bc.beam.material.opacity = bc.glow * 0.18 * (0.85 + 0.15 * Math.sin(elapsed * 3));
      bc.beam.scale.y = 0.6 + bc.glow * 0.4;
    }
    this._litCount = lit;
  }

  _updateBridges(dt) {
    for (const b of this.bridges) {
      const beacon = this.beacons.find((x) => x.id === b.requires);
      b.active = !!(beacon && beacon.lit);
      const target = b.active ? 1 : 0;
      b.t += (target - b.t) * Math.min(1, dt * 5);
      b.mesh.material.opacity = b.t * 0.92;
      b.mesh.material.emissiveIntensity = 0.3 + b.t * 0.8;
      b.mesh.visible = b.t > 0.02;
    }
  }

  _updateExit(dt, elapsed) {
    this.exitOpen = this._litCount === this.beacons.length && this.beacons.length > 0;
    if (this.exitOpen && !this._exitWasOpen) {
      this.events.push({ type: 'exit-open' });
    }
    this._exitWasOpen = this.exitOpen;
    const target = this.exitOpen ? 1 : 0;
    this.exit.glow += (target - this.exit.glow) * Math.min(1, dt * 3);
    const g = this.exit.glow;
    this.exit.portal.material.opacity = g * (0.55 + 0.12 * Math.sin(elapsed * 2));
    this.exit.frame.material.emissiveIntensity = g * 1.4;
    this.exit.light.intensity = g * 6;
    this.exit.frame.rotation.z = elapsed * 0.3 * g;
    this.exit.portal.scale.setScalar(0.9 + 0.1 * Math.sin(elapsed * 1.5) * g);
  }

  _animateCrystals(elapsed) {
    for (let i = 0; i < this.crystals.length; i++) {
      const c = this.crystals[i];
      c.mesh.rotation.y = elapsed * 0.8 + i;
      c.mesh.rotation.x = Math.sin(elapsed * 0.6 + i) * 0.15;
      const pulse = 1.2 + 0.35 * Math.sin(elapsed * 2.5 + i);
      c.mesh.material.emissiveIntensity = pulse;
      c.light.intensity = 5 + 1.5 * Math.sin(elapsed * 2.5 + i);
    }
  }

  _updateDust(dt, elapsed) {
    if (!this.dust) return;
    const pos = this.dust.geometry.attributes.position;
    const b = this._dustBounds;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + dt * 0.25;
      if (y > 9) y = 0;
      pos.setY(i, y);
      const x = pos.getX(i) + Math.sin(elapsed * 0.3 + i) * dt * 0.06;
      pos.setX(i, x);
    }
    pos.needsUpdate = true;
    this.dust.rotation.y = elapsed * 0.01;
  }

  /** True when the player has reached the open exit portal. */
  playerAtExit(playerPos) {
    if (this.exit.glow < 0.85) return false;
    const dx = playerPos.x - this.exit.pos.x;
    const dz = playerPos.z - this.exit.pos.z;
    return dx * dx + dz * dz < 2.2 * 2.2;
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.dispose();
      }
    });
    this.scene.fog = null;
  }
}
