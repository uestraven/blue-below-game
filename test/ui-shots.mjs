/**
 * Captures every interface state: title, briefing, controls, settings, the
 * three device panels, the note and decision, the journal, the death screen
 * and all three endings with their art.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, 'ui');
const ORIGIN = 'http://127.0.0.1:4173';

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], {
    cwd: path.resolve(HERE, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {});
  for (;;) {
    try {
      if ((await fetch(ORIGIN)).ok) break;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  const browser = await chromium.launch({
    headless: !process.argv.includes('--headed'),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(ORIGIN, { waitUntil: 'load' });
  await page.waitForFunction('window.__BB_READY === true', null, { timeout: 60000 });

  const ev = (fn, arg) => page.evaluate(fn, arg);
  const shot = async (name) => {
    await new Promise((r) => setTimeout(r, 180));
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), timeout: 120000 });
    console.log(`  ${name}`);
  };

  await shot('01-title');
  await ev(() => window.__BB.pick('CONTROLS'));
  await shot('02-controls');
  await ev(() => window.__BB.pick('BACK'));
  await ev(() => window.__BB.pick('SETTINGS'));
  await shot('03-settings');
  await ev(() => window.__BB.pick('BACK'));

  await ev(() => {
    window.__BB.start(9001);
  });
  await shot('04-briefing');
  await ev(() => {
    const BB = window.__BB;
    BB.begin();
    BB.setRenderEnabled(false);
    BB.step(1 / 60, 2);
  });

  // The front door inspection, from where the player starts.
  await ev(() => {
    const BB = window.__BB;
    BB.use('door-panel');
  });
  await shot('05-door-inspection');
  await ev(() => window.__BB.pick('PUT IT DOWN'));

  // Journal with nothing in it, then with the full code.
  await ev(() => window.__BB.game.openJournal());
  await shot('06-journal-empty');
  await ev(() => window.__BB.pick('BACK'));
  await ev(() => {
    const BB = window.__BB;
    for (const n of ['I', 'II', 'III', 'IV']) BB.use(`clue:${n}`);
    BB.game.openJournal();
  });
  await shot('07-journal-full');
  await ev(() => window.__BB.pick('BACK'));

  // The note and the decision at the pedestal.
  await ev(() => window.__BB.use('diamond'));
  await shot('08-vault-note');
  await ev(() => window.__BB.pick('LOOK AT THE STONE'));
  await shot('09-decision');
  await ev(() => window.__BB.pick('LEAVE THE DIAMOND'));
  await shot('10-confirm-leave');
  await ev(() => window.__BB.pick('NO. PICK IT UP.'));
  await ev(() => window.__BB.pick('TAKE THE DIAMOND'));

  // Device panels. Reveal first so the gear is live.
  await ev(() => {
    const BB = window.__BB;
    BB.playReveal();
    BB.forceDemonTo(53, 10);
    BB.step(1 / 60, 240);
    BB.use('safe');
  });
  await shot('11-safe-panel');
  await ev(() => {
    const BB = window.__BB;
    BB.press('sw0');
    BB.press('sw2');
    BB.press('submit');
  });
  await shot('12-safe-rejected');
  await ev(() => {
    const BB = window.__BB;
    BB.press('reset');
    BB.press('sw0');
    BB.press('sw1');
    BB.press('sw2');
  });
  await shot('13-safe-solved-state');
  await ev(() => window.__BB.press('submit'));
  await new Promise((r) => setTimeout(r, 900));

  await ev(() => {
    const BB = window.__BB;
    BB.use('cabinet-key');
    BB.use('read:diagram');
  });
  await shot('14-diagram');
  await ev(() => window.__BB.pick('PUT IT DOWN'));

  await ev(() => window.__BB.use('breaker'));
  await shot('15-breaker-panel');
  await ev(() => {
    const BB = window.__BB;
    const order = BB.snapshot().breakerOrder;
    const labels = ['A1', 'B2', 'C3', 'D4'];
    BB.press(`br${labels.indexOf(order[0])}`);
    BB.press(`br${labels.indexOf(order[3])}`); // wrong: trips the panel
  });
  await shot('16-breaker-fault');
  await ev(() => {
    const BB = window.__BB;
    const order = BB.snapshot().breakerOrder;
    const labels = ['A1', 'B2', 'C3', 'D4'];
    for (const l of order) BB.press(`br${labels.indexOf(l)}`);
  });
  await new Promise((r) => setTimeout(r, 1100));

  await ev(() => window.__BB.use('door-panel'));
  await shot('17-lock-panel');
  await ev(() => {
    const BB = window.__BB;
    for (let i = 0; i < 4; i++) BB.press(`wh${i}`);
    BB.press('submit');
  });
  await shot('18-lock-rejected');
  await ev(() => {
    const BB = window.__BB;
    const code = BB.snapshot().code;
    const A = 'ABCDEFGHJKLMNPRSTUVWXY';
    BB.press('reset');
    for (let i = 0; i < 4; i++) for (let k = 0; k <= A.indexOf(code[i]); k++) BB.press(`wh${i}`);
  });
  await shot('19-lock-code-dialled');

  // Pause screen mid-run, opened through the real Escape key path.
  await ev(() => window.__BB.closePuzzle());
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 300));
  await shot('20-pause');

  // Death screen.
  await ev(() => {
    const BB = window.__BB;
    BB.pick('RESUME');
    BB.forceCatch();
  });
  await shot('21-death');

  // All three endings. finishEnding is one-shot per run by design, so the
  // phase is reset between captures.
  for (const [n, kind] of [['22-ending-ugly', 'ugly'], ['23-ending-bad', 'bad'], ['24-ending-good', 'good']]) {
    await page.evaluate((k) => {
      const g = window.__BB.game;
      g.phase = 'play';
      g.run.ending = null;
      g.finishEnding(k);
    }, kind);
    await shot(n);
  }

  await browser.close();
  server.kill('SIGTERM');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
