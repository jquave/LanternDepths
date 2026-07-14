/**
 * Procedural Web Audio for THE LANTERN DEPTHS.
 * No external samples — all tones synthesized so the game stays zero-dep.
 * Unlock must follow a user gesture (ENTER click / canvas click).
 */

const MUTE_KEY = 'lantern-depths-muted';

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfx = null;
    this.amb = null;
    this.muted = this._loadMuted();
    this._unlocked = false;
    this._ambient = null;
    this._ambGain = null;
  }

  get unlocked() { return this._unlocked; }

  /** Call from a user gesture (button click). Safe to call repeatedly. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);

      this.sfx = this.ctx.createGain();
      this.sfx.gain.value = 0.85;
      this.sfx.connect(this.master);

      this.amb = this.ctx.createGain();
      this.amb.gain.value = 0.55;
      this.amb.connect(this.master);

      this._applyMute();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => { /* autoplay policy */ });
    }
    this._unlocked = true;
  }

  setMuted(m) {
    this.muted = !!m;
    this._applyMute();
    try { localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0'); } catch { /* ignore */ }
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  // --------------------------------------------------------------- ambient
  startAmbient() {
    if (!this.ctx || this._ambient) return;
    const t = this.ctx.currentTime;
    const ambGain = this.ctx.createGain();
    ambGain.gain.setValueAtTime(0, t);
    ambGain.gain.linearRampToValueAtTime(1, t + 2.5);
    ambGain.connect(this.amb);
    this._ambGain = ambGain;

    // Deep sub drone + slightly detuned fifth for cavernous bed
    const nodes = [];
    const makeOsc = (freq, type, gain, detune = 0) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      g.gain.value = gain;
      o.connect(g);
      g.connect(ambGain);
      o.start();
      nodes.push({ o, g });
      return { o, g };
    };

    makeOsc(55, 'sine', 0.22);           // A1
    makeOsc(82.5, 'sine', 0.12, 4);      // E2-ish, detuned
    makeOsc(110, 'triangle', 0.04, -6);  // soft A2

    // Slow LFO tremolo on a high shimmer pad
    const shimmer = makeOsc(220, 'sine', 0);
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 0.035;
    lfo.connect(lfoGain);
    lfoGain.connect(shimmer.g.gain);
    shimmer.g.gain.value = 0.02;
    lfo.start();
    nodes.push({ o: lfo, g: lfoGain });

    // Soft filtered noise for air / dust
    const noiseBuf = this._noiseBuffer(2);
    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuf;
    noise.loop = true;
    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.value = 420;
    noiseFilter.Q.value = 0.5;
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.value = 0.028;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ambGain);
    noise.start();
    nodes.push({ o: noise, g: noiseGain });

    this._ambient = nodes;
  }

  stopAmbient(fade = 0.8) {
    if (!this.ctx || !this._ambient || !this._ambGain) return;
    const t = this.ctx.currentTime;
    const g = this._ambGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + fade);
    const nodes = this._ambient;
    const ambGain = this._ambGain;
    this._ambient = null;
    this._ambGain = null;
    setTimeout(() => {
      for (const n of nodes) {
        try { n.o.stop(); } catch { /* already stopped */ }
        try { n.o.disconnect(); } catch { /* */ }
        try { n.g.disconnect(); } catch { /* */ }
      }
      try { ambGain.disconnect(); } catch { /* */ }
    }, (fade + 0.15) * 1000);
  }

  // ------------------------------------------------------------------- SFX
  playGrab() {
    // Soft crystalline pluck rising
    this._tone({ freq: 520, endFreq: 780, type: 'sine', dur: 0.18, peak: 0.18, attack: 0.005 });
    this._tone({ freq: 780, endFreq: 1040, type: 'triangle', dur: 0.22, peak: 0.08, attack: 0.01, delay: 0.02 });
  }

  playRelease() {
    // Gentle drop / place
    this._tone({ freq: 280, endFreq: 160, type: 'sine', dur: 0.16, peak: 0.12, attack: 0.008 });
    this._noiseBurst({ dur: 0.1, peak: 0.05, freq: 800 });
  }

  playBeacon() {
    // Warm major triad swell — the "light wakes" moment
    const base = 196; // G3
    for (const [mult, peak, delay] of [
      [1, 0.14, 0],
      [5 / 4, 0.1, 0.04],
      [3 / 2, 0.12, 0.08],
      [2, 0.06, 0.12],
    ]) {
      this._tone({
        freq: base * mult,
        type: 'sine',
        dur: 1.1,
        peak,
        attack: 0.08,
        delay,
      });
    }
    this._noiseBurst({ dur: 0.35, peak: 0.04, freq: 1200, delay: 0.02 });
  }

  playExitOpen() {
    // Ethereal ascending cluster
    for (let i = 0; i < 5; i++) {
      this._tone({
        freq: 330 * Math.pow(1.25, i),
        type: i % 2 ? 'triangle' : 'sine',
        dur: 1.4,
        peak: 0.09 - i * 0.01,
        attack: 0.12,
        delay: i * 0.09,
      });
    }
  }

  playDescend() {
    // Deep whoosh into the dark
    this._tone({ freq: 180, endFreq: 55, type: 'sine', dur: 0.9, peak: 0.16, attack: 0.05 });
    this._noiseBurst({ dur: 0.7, peak: 0.07, freq: 600, delay: 0.05 });
  }

  playVictory() {
    const notes = [261.63, 329.63, 392, 523.25];
    notes.forEach((freq, i) => {
      this._tone({ freq, type: 'sine', dur: 1.6, peak: 0.11, attack: 0.1, delay: i * 0.14 });
    });
  }

  playUI() {
    this._tone({ freq: 640, type: 'sine', dur: 0.06, peak: 0.06, attack: 0.004 });
  }

  // -------------------------------------------------------------- internals
  _applyMute() {
    if (!this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.muted ? 0 : 1, t);
  }

  _loadMuted() {
    try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
  }

  _tone({ freq, endFreq, type = 'sine', dur = 0.2, peak = 0.15, attack = 0.01, delay = 0 }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (endFreq != null) o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g);
    g.connect(this.sfx);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  _noiseBurst({ dur = 0.15, peak = 0.05, freq = 1000, delay = 0 }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(Math.max(0.05, dur + 0.05));
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 0.7;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfx);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  _noiseBuffer(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }
}
