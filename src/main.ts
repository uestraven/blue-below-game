/**
 * Entry point. Boots the renderer, builds the facility, and runs the frame
 * loop. The whole game runs through this one path - there is no separate
 * debug or test entry point, only a debug handle attached to `window`.
 */

import { Game } from './game/game';

const canvas = document.getElementById('view') as HTMLCanvasElement | null;
const uiRoot = document.getElementById('ui') as HTMLElement | null;

if (!canvas || !uiRoot) {
  throw new Error('BLUE BELOW: missing #view or #ui');
}

function fail(message: string): void {
  uiRoot!.innerHTML = `
    <div class="screen"><div class="panel">
      <h2 class="danger">Cannot start</h2>
      <p>${message}</p>
      <p class="hint">BLUE BELOW needs a desktop browser with WebGL 2.</p>
    </div></div>`;
}

let game: Game | null = null;
try {
  game = new Game(canvas, uiRoot);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

if (game) {
  const g = game;

  const resize = (): void => {
    g.resize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', resize);
  resize();

  // Clicking the canvas (re)takes the mouse. Also the gesture that unlocks
  // audio on first interaction.
  canvas.addEventListener('mousedown', () => {
    g.audio.start();
    g.audio.resume();
    if (g.phase === 'play' && !g.input.captured) g.input.requestCapture();
  });
  window.addEventListener('keydown', () => {
    g.audio.start();
  }, { once: true });

  let last = performance.now();
  const frame = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    g.step(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Debug handle: used by the automated route tests in test/. It calls the
  // same functions the interface calls, so the logic under test is the real
  // logic and only the physical input layer is bypassed.
  //
  // Build-gated, because it can read the run's door code straight out of
  // memory and this build gets deployed to the public internet. Present in
  // `dev` and in `build --mode test`; statically absent from the release
  // build, where the condition folds to `false` and the block is dropped.
  if (import.meta.env.VITE_DEBUG_API === '1') {
    (window as unknown as { __BB: Record<string, unknown> }).__BB = g.debugApi();
  }
  (window as unknown as { __BB_READY: boolean }).__BB_READY = true;
}
