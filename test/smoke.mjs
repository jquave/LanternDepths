// Headless smoke test: boots the game, starts a level, drives the player,
// and fails on any console error / page error. Run: node test/smoke.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire('/tmp/pptr/');
const puppeteer = require('puppeteer').default;

const PORT = 8123;
const URL = `http://localhost:${PORT}/`;

function startServer() {
  const p = spawn('node', ['server.js', String(PORT)], { stdio: 'ignore' });
  return p;
}

async function main() {
  const server = startServer();
  await new Promise((r) => setTimeout(r, 800));

  const browser = await puppeteer.launch({
    args: [
      '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--enable-webgl',
      // Keep requestAnimationFrame running at full rate in a headless page,
      // otherwise the render/sim loop is throttled and tests flake.
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.bringToFront();

  const errors = [];
  // Ignore artifacts that only occur in headless automation, not real play:
  // pointer-lock needs a user gesture; favicon may 404 on some setups.
  const benign = (t) => /pointer lock|favicon\.ico|Failed to load resource/i.test(t);
  page.on('console', (m) => { if (m.type() === 'error' && !benign(m.text())) errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => { if (!benign(e.message)) errors.push('pageerror: ' + e.message); });

  // Headless has no user gesture, so pointer-lock requests reject async and can
  // auto-pause the game mid-test. Neutralize them before any script runs.
  await page.evaluateOnNewDocument(() => {
    Element.prototype.requestPointerLock = function () {};
    document.exitPointerLock = function () {};
  });

  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1200));

  // engine should be exposed and running
  const booted = await page.evaluate(() => !!(window.__LANTERN && window.__LANTERN.game));
  if (!booted) throw new Error('game did not boot (window.__LANTERN missing)');

  // Start level 0 directly (bypass pointer-lock click gate for the test)
  await page.evaluate(() => window.__LANTERN.game.startLevel(0));
  await new Promise((r) => setTimeout(r, 500));

  const state = await page.evaluate(() => ({
    state: window.__LANTERN.game.state,
    litTotal: window.__LANTERN.game.world.litTotal,
    crystals: window.__LANTERN.game.world.crystals.length,
    beacons: window.__LANTERN.game.world.beacons.length,
  }));

  // Drive the player forward deterministically to exercise physics + collision,
  // then confirm a frame renders without throwing.
  const after = await page.evaluate(() => {
    const g = window.__LANTERN.game;
    const input = window.__LANTERN.input;
    input.held.add('KeyW');
    for (let i = 0; i < 60; i++) g.player.update(1 / 60);
    input.held.delete('KeyW');
    // force one render to prove the pipeline is intact
    let rendered = true;
    try { g.engine.composer.render(); } catch (e) { rendered = false; }
    // Audio system present; unlock is gesture-gated but API must exist.
    const hasAudio = !!(g.audio && typeof g.audio.playGrab === 'function'
      && typeof g.audio.startAmbient === 'function'
      && typeof g.audio.toggleMute === 'function');
    const hasJuice = !!(g.juice && typeof g.juice.burst === 'function'
      && typeof g.juice.punch === 'function'
      && typeof g.juice.applyCameraShake === 'function'
      && g.engine.vignettePass);
    // Exercise grab event: put hold point on the crystal so range check passes.
    const c0 = g.world.crystals[0];
    const grabResult = g.world.tryGrab(c0.mesh.position.clone());
    const grabEvent = grabResult === 'grab' && g.world.events.some((e) => e.type === 'grab');
    // Drain once so juice reacts the same way as the live loop.
    if (grabEvent) {
      g.juice.burst(c0.mesh.position, c0.color, 10, 2);
      g.juice.punch(0.1);
      g.juice.update(1 / 60);
      g.juice.applyCameraShake(g.engine.camera, 1 / 60);
    }
    g.world.update(1 / 60, 1);
    return {
      playerX: g.player.position.x,
      playerY: g.player.position.y,
      playerZ: g.player.position.z,
      moved: Math.abs(g.player.position.z - g.player.spawn.z) > 0.5,
      rendered,
      hasAudio,
      hasJuice,
      grabEvent,
      juiceParticles: g.juice._count,
      juiceShake: g.juice.shake,
    };
  });

  // Input breadth: gamepad + touch fold into the same held/pressed/mouse-delta
  // primitives, so a fake pad and a fake touch-stick must drive move + look +
  // jump + grab without any device present in headless.
  const inputCheck = await page.evaluate(() => {
    const input = window.__LANTERN.input;
    const hasApi = typeof input.update === 'function'
      && typeof input.moveVector === 'function';

    // Fake gamepad: left stick full up (forward), right stick full right
    // (look right), A held (jump), X held (grab).
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
    buttons[0].pressed = true; // A / jump
    buttons[2].pressed = true; // X / grab
    const fake = { connected: true, axes: [0, -1, 1, 0], buttons };
    navigator.getGamepads = () => [fake];

    input.mouseDX = 0; input.mouseDY = 0;
    input._pressedEdge.clear();
    input.update(1 / 60);
    const mv = input.moveVector();
    const pad = {
      forward: mv.z > 0.5,          // left stick up = forward
      lookRight: input.mouseDX > 0, // right stick right = +mouseDX
      jumpHeld: input.isDown('Space'),
      grabEdge: input.pressed('KeyE'),
    };
    input.endFrame();
    navigator.getGamepads = () => [];
    // Releasing the pad must clear its virtual buttons next poll.
    input.update(1 / 60);
    const jumpReleased = !input.isDown('Space');

    // Fake touch joystick pushed right → strafe right in moveVector.
    input._touchMove.x = 1; input._touchMove.z = 0;
    const touchStrafe = input.moveVector().x > 0.5;
    input._touchMove.x = 0;
    input.endFrame();

    return { hasApi, ...pad, jumpReleased, touchStrafe };
  });

  // End-to-end win logic: force-solve every level by seating a crystal in each
  // beacon, then confirm all beacons light and the exit opens.
  const totalLevels = await page.evaluate(() => window.__LANTERN.LEVELS.length);
  const solveResults = [];
  for (let li = 0; li < totalLevels; li++) {
    await page.evaluate((idx) => window.__LANTERN.game.startLevel(idx), li);
    await new Promise((r) => setTimeout(r, 300));
    const res = await page.evaluate(() => {
      const w = window.__LANTERN.game.world;
      // record lift heights before solving so we can prove armed lifts travel
      const moverY0 = w.movers.map((m) => m.group.position.y);
      // seat one crystal per beacon (levels are designed 1:1)
      w.beacons.forEach((bc, i) => {
        const c = w.crystals[i];
        if (!c) return;
        c.grabbed = false;
        c.vel.set(0, 0, 0);
        c.mesh.position.set(bc.pos.x, bc.surfaceY + c.half, bc.pos.z);
      });
      // Deterministically step the simulation (headless rAF is throttled), so
      // lighting + exit state settle regardless of the browser's frame pacing.
      for (let i = 0; i < 40; i++) w.update(1 / 60, i / 60);
      const eventTypes = w.events.map((e) => e.type);
      // once every beacon is lit, all armed lifts should have moved off base
      const moverMoved = w.movers.every((m, i) => Math.abs(m.group.position.y - moverY0[i]) > 0.05);
      return {
        level: window.__LANTERN.game.levelIndex,
        lit: w.litCount,
        total: w.litTotal,
        exitOpen: w.exitOpen,
        beaconEvents: eventTypes.filter((t) => t === 'beacon-lit').length,
        exitEvent: eventTypes.includes('exit-open'),
        movers: w.movers.length,
        moverMoved,
      };
    });
    solveResults.push(res);
  }

  await browser.close();
  server.kill();

  console.log('boot state:', JSON.stringify(state));
  console.log('after driving:', JSON.stringify(after));
  console.log('input breadth:', JSON.stringify(inputCheck));
  console.log('solve results:', JSON.stringify(solveResults));

  const problems = [];
  if (state.state !== 'playing') problems.push('state not playing: ' + state.state);
  if (state.litTotal < 1) problems.push('no beacons in level');
  if (!after.rendered) problems.push('composer.render() threw');
  if (!after.moved) problems.push('player did not move when driven forward');
  if (!after.hasAudio) problems.push('audio system missing on game.audio');
  if (!after.hasJuice) problems.push('juice system missing (burst/punch/vignette)');
  if (!after.grabEvent) problems.push('tryGrab did not emit grab event');
  if (!(after.juiceParticles > 0)) problems.push('juice burst did not spawn particles');
  if (!(after.juiceShake > 0)) problems.push('juice punch did not set camera shake');
  if (!inputCheck.hasApi) problems.push('input missing update()/moveVector() API');
  if (!inputCheck.forward) problems.push('gamepad left stick did not drive forward movement');
  if (!inputCheck.lookRight) problems.push('gamepad right stick did not drive look');
  if (!inputCheck.jumpHeld) problems.push('gamepad A did not register as jump (Space)');
  if (!inputCheck.grabEdge) problems.push('gamepad X did not register a grab (KeyE) edge');
  if (!inputCheck.jumpReleased) problems.push('gamepad disconnect left a virtual button stuck down');
  if (!inputCheck.touchStrafe) problems.push('touch joystick did not drive strafe movement');
  if (!Number.isFinite(after.playerY) || !Number.isFinite(after.playerX)) {
    problems.push('player position is NaN');
  }
  for (const r of solveResults) {
    if (r.lit !== r.total) problems.push(`level ${r.level}: only ${r.lit}/${r.total} beacons lit when solved`);
    if (!r.exitOpen) problems.push(`level ${r.level}: exit did not open when all beacons lit`);
    if (r.beaconEvents < r.total) {
      problems.push(`level ${r.level}: expected ${r.total} beacon-lit events, got ${r.beaconEvents}`);
    }
    if (!r.exitEvent) problems.push(`level ${r.level}: missing exit-open event`);
    if (r.movers > 0 && !r.moverMoved) {
      problems.push(`level ${r.level}: armed light-lift(s) did not travel after beacons lit`);
    }
  }
  if (!solveResults.some((r) => r.movers > 0)) {
    problems.push('no level exercises the moving light-lift mechanic');
  }
  if (errors.length) problems.push(...errors);

  if (problems.length) {
    console.error('\n❌ SMOKE TEST FAILED:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log('\n✅ SMOKE TEST PASSED — game boots, renders, and simulates cleanly.');
  process.exit(0);
}

main().catch((e) => {
  console.error('❌ smoke test crashed:', e.message);
  process.exit(1);
});
