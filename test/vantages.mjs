/**
 * Visual verification: drops the camera at a fixed list of vantage points in
 * the facility and screenshots each one. Used to check lighting, readability
 * of signs and puzzle faces, and the period look.
 *
 *   node test/vantages.mjs            all vantages
 *   node test/vantages.mjs lobby safe just those
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, 'vantages');
const ORIGIN = 'http://127.0.0.1:4173';

// Each vantage: where to stand (grid cell), what to look at (world x/z), and
// any progress flags needed for the thing to be there at all.
const VANTAGES = [
  { name: 'lobby-front-door', cell: [38, 42], look: [19.5, 61.5], note: 'the locked exit, from inside' },
  { name: 'lobby-wide', cell: [34, 44], look: [40, 40], note: 'reception, wayfinding signs' },
  { name: 'door-lock-panel', cell: [40, 44], look: [25.5, 59.6], note: 'four-letter lock face' },
  { name: 'records', cell: [24, 43], look: [-28.5, 39.0], note: 'records room and the site memo' },
  { name: 'corridor-a', cell: [38, 34], look: [19.5, 90.0], note: 'corridor back toward reception' },
  { name: 'generator-wide', cell: [33, 25], look: [57, -14], note: 'generator hall' },
  { name: 'breaker-cabinet', cell: [49, 21], look: [56.3, -13.5], note: 'breaker face and diagram' },
  { name: 'clue-IV', cell: [40, 18], look: [25.5, -30.0], note: 'blood letter IV' },
  { name: 'workshop-wide', cell: [11, 26], look: [-57, -27], note: 'workshop, benches' },
  { name: 'counter-safe', cell: [13, 28], look: [-55.5, 11.0], note: 'counter safe face' },
  { name: 'clue-III', cell: [9, 20], look: [-72.0, -18.0], note: 'blood letter III' },
  { name: 'tunnel-mouth', cell: [13, 12], look: [-55.5, -72.0], note: 'locker bank, tunnel entrance' },
  { name: 'maze-dark', cell: [8, 11], look: [-90.0, -46.5], note: 'the dark west tunnel' },
  { name: 'pump-chamber', cell: [4, 8], look: [-96.0, -52.5], note: 'pump room, blood letter I' },
  { name: 'false-wall-seam', cell: [17, 6], look: [-42.0, -58.5], note: 'the seam and the draught sign' },
  { name: 'secret-room', cell: [22, 4], look: [-34.5, -58.5], progress: { secretFound: true }, note: 'the glowing seal in the floor' },
  { name: 'pentagram-close', cell: [21, 4], look: [-34.5, -58.5], progress: { secretFound: true }, note: 'the pentagram up close' },
  { name: 'records-flaregun', cell: [27, 41], look: [-16.5, -61.5], note: 'emergency signal kit and the personal box' },
  { name: 'personal-box', cell: [20, 44], look: [-37.5, -55.5], note: "Harding's locked personal box" },
  { name: 'reveal-corridor', cell: [15, 4], look: [-82.5, -67.5], note: 'the straight tunnel the demon appears down' },
  { name: 'vault-approach', cell: [33, 4], look: [45, -64.5], note: 'blue light from the vault' },
  { name: 'vault-diamond', cell: [43, 7], look: [45, -55.5], note: 'the diamond on its pedestal' },
  { name: 'vestibule-out', cell: [38, 48], look: [19.5, 90.0], note: 'outside the threshold' },
];

/** Vantages that need the demon staged. */
const DEMON_VANTAGES = [
  { name: 'demon-reveal-far', stand: [15, 4], demon: [4, 3], note: 'the first sighting, 33 units away' },
  { name: 'demon-mid', stand: [11, 4], demon: [7, 4], note: 'closing down the tunnel' },
  { name: 'demon-close', stand: [13, 12], demon: [13, 10], note: 'in the open, close' },
  { name: 'demon-lit', stand: [33, 26], demon: [34, 21], note: 'under the generator lights' },
];

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));

  const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], {
    cwd: path.resolve(HERE, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {});
  for (;;) {
    try {
      const r = await fetch(ORIGIN);
      if (r.ok) break;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  const browser = await chromium.launch({
    headless: !process.argv.includes('--headed'),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(ORIGIN, { waitUntil: 'load' });
  await page.waitForFunction('window.__BB_READY === true', null, { timeout: 60000 });
  // These scripts drive the game through window.__BB, which only exists in the
  // `test` build mode. Say so plainly rather than failing on `undefined`.
  if (!(await page.evaluate(() => typeof window.__BB === 'object'))) {
    throw new Error(
      'dist/ has no debug table: it is a release build. Run `npm run build:test` first.',
    );
  }

  await page.evaluate(() => {
    window.__BB.start(4242);
    window.__BB.begin();
    window.__BB.step(1 / 60, 2);
  });

  for (const v of VANTAGES) {
    if (wanted.length && !wanted.some((w) => v.name.includes(w))) continue;
    await page.evaluate(
      ([cell, look, progress]) => {
        const BB = window.__BB;
        if (progress) Object.assign(BB.game.run.progress, progress);
        BB.teleportCell(cell[0], cell[1]);
        BB.face(look[0], look[1]);
        // Clear the intro toast and settle the fade so the frame is clean.
        BB.game.hud.clearToast();
        BB.step(1 / 60, 120);
      },
      [v.cell, v.look, v.progress ?? null],
    );
    await new Promise((r) => setTimeout(r, 200));
    await page.screenshot({ path: path.join(SHOTS, `${v.name}.png`), timeout: 120000 });
    console.log(`  ${v.name.padEnd(22)} ${v.note}`);
  }

  // Demon vantages: stage the reveal for real, then park it where we want it.
  for (const v of DEMON_VANTAGES) {
    if (wanted.length && !wanted.some((w) => v.name.includes(w))) continue;
    await page.evaluate(
      ([stand, demonCell]) => {
        const BB = window.__BB;
        BB.game.run.progress.diamondTaken = true;
        BB.teleportCell(stand[0], stand[1]);
        BB.playReveal();
        BB.forceDemonTo(demonCell[0], demonCell[1]);
        BB.game.hud.clearToast();
        BB.step(1 / 60, 20);
        BB.forceDemonTo(demonCell[0], demonCell[1]);
        BB.face(BB.game.demon.x, BB.game.demon.z);
        BB.step(1 / 60, 2);
      },
      [v.stand, v.demon],
    );
    await new Promise((r) => setTimeout(r, 200));
    await page.screenshot({ path: path.join(SHOTS, `${v.name}.png`), timeout: 120000 });
    console.log(`  ${v.name.padEnd(22)} ${v.note}`);
  }

  // Interface stills.
  await page.evaluate(() => window.__BB.game.showTitleForShot?.());
  await browser.close();
  server.kill('SIGTERM');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
