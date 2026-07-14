import * as THREE from 'three';
import { World } from './World.js';
import { Player } from './Player.js';
import { UI } from './UI.js';
import { Audio } from '../engine/Audio.js';
import { Juice } from '../engine/Juice.js';
import { LEVELS } from '../levels/levels.js';

const STATE = { MENU: 'menu', PLAYING: 'playing', PAUSED: 'paused', WON: 'won' };
const UNLOCK_KEY = 'lantern-depths-unlocked';

/**
 * Top-level game: owns the state machine, level lifecycle, and the per-frame
 * step. Wires DOM buttons and player input to world actions.
 */
export class Game {
  constructor(engine, input) {
    this.engine = engine;
    this.input = input;
    this.ui = new UI();
    this.audio = new Audio();
    this.juice = new Juice(engine.scene);
    this.state = STATE.MENU;
    this.levelIndex = 0;
    this.world = null;
    this.player = null;
    this._levelTime = 0;
    this._totalTime = 0;
    this._transitioning = false;
    this.unlocked = this._loadUnlocked();

    this._wireUI();
    this._wirePointerLock();
    engine.onUpdate((dt, elapsed) => this._update(dt, elapsed));
  }

  boot() {
    this.ui.hideLoading();
    this.ui.buildLevelSelect(LEVELS, this.unlocked, (i) => {
      this._ensureAudio();
      this.audio.playUI();
      this.startLevel(i);
    });
    this.ui.setMuted(this.audio.muted);
    this.ui.showMenu();
  }

  // ------------------------------------------------------------- lifecycle
  startLevel(index) {
    this.levelIndex = index;
    if (this.world) this.world.dispose();
    this.juice.clear();

    const level = LEVELS[index];
    this.world = new World(this.engine.scene, level);
    this.player = new Player(this.engine.camera, this.input, this.world, level.spawn);
    this._levelTime = 0;
    this._transitioning = false;

    this.ui.hideMenu();
    this.ui.hideVictory();
    this.ui.showHUD();
    this.ui.setLevelName(level.name);
    this.ui.setProgress(0, this.world.litTotal);
    this.ui.banner(level.name.split('·')[0].trim(), level.name.split('·')[1]?.trim() || level.name, level.quote);

    this.state = STATE.PLAYING;
    this.audio.startAmbient();
    this.input.requestLock();
  }

  nextLevel() {
    const next = this.levelIndex + 1;
    if (next >= LEVELS.length) {
      this._win();
      return;
    }
    this._unlock(next);
    this.startLevel(next);
  }

  restartLevel() {
    this.startLevel(this.levelIndex);
  }

  _win() {
    this.state = STATE.WON;
    this.input.exitLock();
    this.audio.stopAmbient(1.2);
    this.audio.playVictory();
    this.juice.punch(0.18);
    if (this.world) { this.world.dispose(); this.world = null; }
    this.juice.clear();
    const mins = Math.floor(this._totalTime / 60);
    const secs = Math.floor(this._totalTime % 60);
    this.ui.showVictory(
      `You lit every depth in ${mins}m ${secs.toString().padStart(2, '0')}s. The dark remembers your light.`,
    );
  }

  pause(on) {
    if (this.state === STATE.MENU || this.state === STATE.WON) return;
    this.state = on ? STATE.PAUSED : STATE.PLAYING;
    this.ui.showPause(on);
    if (on) this.input.exitLock();
    else this.input.requestLock();
  }

  quitToMenu() {
    if (this.world) { this.world.dispose(); this.world = null; }
    this.juice.clear();
    this.state = STATE.MENU;
    this.input.exitLock();
    this.audio.stopAmbient(0.6);
    this.ui.showPause(false);
    this.ui.buildLevelSelect(LEVELS, this.unlocked, (i) => {
      this._ensureAudio();
      this.audio.playUI();
      this.startLevel(i);
    });
    this.ui.showMenu();
  }

  // ---------------------------------------------------------------- update
  _update(dt, elapsed) {
    // Poll continuous devices (gamepad) first so their edges/deltas are live
    // for this frame's action + movement handling.
    this.input.update(dt);
    // Gamepad Start toggles pause in either direction (no pointer-lock on pad).
    if (this.input.pressed('Pad:Pause')) {
      if (this.state === STATE.PLAYING && !this._transitioning) this.pause(true);
      else if (this.state === STATE.PAUSED) this.pause(false);
    }

    if (this.state === STATE.PLAYING) {
      this._handleActions();
      this.player.update(dt);
      this.world.update(dt, elapsed);
      this._drainWorldEvents();
      this.juice.update(dt);
      this.juice.applyCameraShake(this.engine.camera, dt);
      this._levelTime += dt;
      this._totalTime += dt;

      this.ui.setProgress(this.world.litCount, this.world.litTotal);
      this.ui.setGrabbing(!!this.world.grabbed);

      if (!this._transitioning && this.world.playerAtExit(this.player.position)) {
        this._transitioning = true;
        const idx = this.levelIndex;
        this.audio.playDescend();
        this.ui.banner('DESCENDING', 'The way opens', 'Deeper into the dark…', 1800);
        this.input.exitLock();
        setTimeout(() => { if (this.levelIndex === idx) this.nextLevel(); }, 1500);
      }
    } else if (this.state === STATE.WON) {
      // idle victory ambience handled by CSS + one-shot victory chord
    }
    this.input.endFrame();
  }

  _drainWorldEvents() {
    if (!this.world) return;
    const ev = this.world.events;
    while (ev.length) {
      const e = ev.shift();
      if (e.type === 'grab') {
        this.audio.playGrab();
        const c = this.world.grabbed;
        if (c) {
          this.juice.burst(c.mesh.position, c.mesh.material.color, 14, 2.2);
        }
      } else if (e.type === 'release') {
        this.audio.playRelease();
      } else if (e.type === 'beacon-lit') {
        this.audio.playBeacon();
        this.juice.punch(0.14);
        const bc = this.world.beacons.find((b) => b.id === e.id);
        if (bc) {
          this.juice.burst(bc.group.position.clone().add(new THREE.Vector3(0, 1.1, 0)), bc.color, 28, 3.4);
        }
      } else if (e.type === 'exit-open') {
        this.audio.playExitOpen();
        this.juice.punch(0.22);
        if (this.world.exit) {
          const p = this.world.exit.group
            ? this.world.exit.group.position.clone()
            : this.world.exit.portal.position.clone();
          p.y += 1.2;
          this.juice.burst(p, this.world.level.palette?.accent ?? 0xaaccff, 36, 3.8);
        }
      }
    }
  }

  _handleActions() {
    if (this.input.pressed('KeyE')) {
      this.world.tryGrab(this.player.holdPoint);
    }
    if (this.input.pressed('KeyR')) {
      this.restartLevel();
    }
    // Escape / losing pointer-lock triggers pause via input.onUnlock().
  }

  _ensureAudio() {
    this.audio.unlock();
  }

  _toggleMute() {
    this._ensureAudio();
    const muted = this.audio.toggleMute();
    this.ui.setMuted(muted);
    if (!muted) this.audio.playUI();
  }

  // ------------------------------------------------------------------ wire
  _wireUI() {
    document.getElementById('btn-start').addEventListener('click', () => {
      this._ensureAudio();
      this.audio.playUI();
      this._totalTime = 0;
      this.startLevel(0);
    });
    document.getElementById('btn-resume').addEventListener('click', () => {
      this._ensureAudio();
      this.pause(false);
    });
    document.getElementById('btn-restart').addEventListener('click', () => {
      this.ui.showPause(false);
      this.restartLevel();
    });
    document.getElementById('btn-quit').addEventListener('click', () => this.quitToMenu());
    document.getElementById('btn-again').addEventListener('click', () => {
      this._ensureAudio();
      this.audio.playUI();
      this._totalTime = 0;
      this.startLevel(0);
    });
    for (const id of ['btn-mute', 'btn-mute-pause']) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggleMute();
      });
    }
  }

  _wirePointerLock() {
    // Clicking the canvas while playing re-grabs the mouse (also unlocks audio).
    this.engine.canvas.addEventListener('click', () => {
      this._ensureAudio();
      if (this.state === STATE.PLAYING && !this.input.locked) this.input.requestLock();
    });
    // If the player presses Esc, the browser drops the lock; reflect that as pause.
    this.input.onUnlock(() => {
      if (this.state === STATE.PLAYING && !this._transitioning) this.pause(true);
    });
  }

  // ---------------------------------------------------------------- persist
  _loadUnlocked() {
    try {
      const v = parseInt(localStorage.getItem(UNLOCK_KEY) || '0', 10);
      return Number.isFinite(v) ? Math.max(0, v) : 0;
    } catch { return 0; }
  }

  _unlock(index) {
    if (index > this.unlocked) {
      this.unlocked = index;
      try { localStorage.setItem(UNLOCK_KEY, String(index)); } catch { /* ignore */ }
    }
  }
}
