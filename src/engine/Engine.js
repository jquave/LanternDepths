import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';

/**
 * Engine owns the renderer, camera, scene root, post-processing composer,
 * and the main animation loop. Game logic subscribes via onUpdate().
 */
export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();
    this._updaters = new Set();
    this._running = false;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.05,
      500,
    );

    // --- Post-processing: bloom → vignette → output (cinematic cavern look) ---
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.composer.setSize(window.innerWidth, window.innerHeight);

    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.5, // strength (was 0.85 — a bit milky on bright crystals)
      0.55, // radius
      0.92, // threshold — only the brightest emissives bloom
    );
    this.composer.addPass(this.bloomPass);

    this.vignettePass = new ShaderPass(VignetteShader);
    this.vignettePass.uniforms.offset.value = 0.95;
    this.vignettePass.uniforms.darkness.value = 1.15;
    this.composer.addPass(this.vignettePass);

    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', () => this._onResize());
  }

  onUpdate(fn) {
    this._updaters.add(fn);
    return () => this._updaters.delete(fn);
  }

  start() {
    if (this._running) return;
    this._running = true;
    this.clock.start();
    this.renderer.setAnimationLoop(() => this._tick());
  }

  _tick() {
    // Clamp dt so a tab-switch stall can't fling the physics.
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime;
    for (const fn of this._updaters) fn(dt, elapsed);
    this.composer.render();
  }

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
  }
}
