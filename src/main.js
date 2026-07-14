import { Engine } from './engine/Engine.js';
import { Input } from './engine/Input.js';
import { Game } from './game/Game.js';
import { LEVELS } from './levels/levels.js';

/** Bootstraps the engine + game once the DOM (and WebGL context) are ready. */
function main() {
  const canvas = document.getElementById('scene');
  const engine = new Engine(canvas);
  const input = new Input(canvas);
  const game = new Game(engine, input);

  engine.start();
  // Give the first frame a moment so the loading veil reads intentionally.
  setTimeout(() => game.boot(), 350);

  // Expose for debugging / future agents.
  window.__LANTERN = { engine, input, game, LEVELS };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
