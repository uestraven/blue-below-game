/**
 * Release gate. Run against the artifact that actually gets deployed.
 *
 * The acceptance suite drives the game through `window.__BB`, which only
 * exists in the `test` build mode. That means the deployed artifact is not the
 * one the suite exercised, so this script checks the difference is exactly the
 * one intended and nothing else: the release build still boots and renders,
 * the debug table is gone, and the deploy-time files are in place.
 *
 *   node test/release-check.mjs          (or: npm run verify:release)
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFile, stat, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIST = path.join(ROOT, 'dist');
const ORIGIN = 'http://127.0.0.1:4178';

let failures = 0;
let checks = 0;

function check(label, ok, detail = '') {
  checks++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
  return ok;
}

async function main() {
  console.log('Release check: verifying the artifact that gets deployed.\n');

  // ---------------------------------------------------- static artifact
  const files = await readdir(DIST, { recursive: true });
  const flat = files.filter((f) => !f.includes(path.sep) || true);
  check('dist/index.html exists', files.includes('index.html'));
  check('dist/_headers was copied from public/', files.includes('_headers'), flat.join(' '));
  // Pages ignores wrangler.toml, so a 404.html is how unknown paths get a real
  // 404 status there rather than the game served with HTTP 200.
  check('dist/404.html exists for Cloudflare Pages', files.includes('404.html'));

  const html = await readFile(path.join(DIST, 'index.html'), 'utf8');
  check('no inline <script> in the shipped HTML (keeps the CSP strict)', !/<script(?![^>]*\ssrc=)/i.test(html));

  const notFound = await readFile(path.join(DIST, '404.html'), 'utf8');
  check('404.html has no inline <script> either', !/<script(?![^>]*\ssrc=)/i.test(notFound));
  check('404.html is self-contained (no hashed stylesheet reference)', !/<link[^>]*stylesheet/i.test(notFound));

  const jsFiles = files.filter((f) => f.endsWith('.js'));
  check('exactly one JS bundle', jsFiles.length === 1, jsFiles.join(' '));
  const bundle = await readFile(path.join(DIST, jsFiles[0]), 'utf8');
  const bundleKb = Math.round((await stat(path.join(DIST, jsFiles[0]))).size / 1024);

  // The debug table is attached inside an `import.meta.env` branch, so the
  // *attachment* must be statically gone. Report whether the method body
  // survived tree-shaking too rather than assuming either way.
  check('no __BB attachment left in the release bundle', !bundle.includes('__BB='), 'searched for the assignment');
  const bodyGone = !bundle.includes('forceDemonTo') && !bundle.includes('assetAudit');
  console.log(
    `  NOTE  debug method bodies ${bodyGone ? 'were also tree-shaken out' : 'are still present but unreachable (no reference to the game instance is exposed)'}`,
  );

  // Parse _headers the way Cloudflare does, so a malformed edit is caught here
  // rather than by silently dropping a rule in production.
  // The AI visualisation is development-only and must not reach the release.
  // Strings that exist only inside src/game/aidebug.ts. Deliberately not the
  // group name 'ai-debug', which the release-side asset audit legitimately
  // references in order to skip the overlay.
  const aiDebugStrings = ['AI DEBUG', 'lost timer', 'patrol dest', 'sees player'];
  const leaked = aiDebugStrings.filter((t) => bundle.includes(t));
  check('the development AI visualisation is absent from the release bundle', leaked.length === 0, leaked.join(', '));
  const chunks = files.filter((f) => f.endsWith('.js'));
  check('no extra chunk shipped for it either', chunks.length === 1, chunks.join(' '));

  const headers = await readFile(path.join(DIST, '_headers'), 'utf8');
  const rules = [];
  let current = null;
  let malformed = [];
  for (const raw of headers.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line) && line.trim().startsWith('/')) {
      current = { path: line.trim(), headers: {} };
      rules.push(current);
    } else if (current) {
      const m = line.trim().match(/^([A-Za-z0-9-]+):\s*(.+)$/);
      if (m) current.headers[m[1].toLowerCase()] = m[2].trim();
      else malformed.push(line.trim());
    } else {
      malformed.push(line.trim());
    }
  }
  check('_headers parses with no malformed lines', malformed.length === 0, malformed.join(' | '));
  check('_headers defines rules', rules.length >= 2, `${rules.length} rules: ${rules.map((r) => r.path).join(' ')}`);
  check('_headers stays under the 100-rule limit', rules.length <= 100, `${rules.length}`);

  const starRule = rules.find((r) => r.path === '/*');
  check('there is a catch-all /* rule', !!starRule);
  for (const h of ['content-security-policy', 'x-content-type-options', 'referrer-policy', 'permissions-policy']) {
    check(`/* sets ${h}`, !!starRule?.headers[h]);
  }
  const assetRule = rules.find((r) => r.path.startsWith('/assets'));
  check('hashed assets are cached immutably', (assetRule?.headers['cache-control'] ?? '').includes('immutable'), assetRule?.headers['cache-control']);
  const rootRule = rules.find((r) => r.path === '/index.html');
  check('the entry point is not cached', (rootRule?.headers['cache-control'] ?? '').includes('max-age=0'), rootRule?.headers['cache-control']);

  const cspText = starRule?.headers['content-security-policy'] ?? '';
  for (const directive of ["default-src 'none'", "script-src 'self'", 'img-src', 'connect-src', "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"]) {
    check(`CSP declares ${directive}`, cspText.includes(directive));
  }

  // -------------------------------------------------------- runtime boot
  const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', '4178', '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {});
  let serverErr = '';
  server.stderr.on('data', (d) => {
    serverErr += d;
  });

  const stop = () => {
    try {
      server.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  };
  process.on('exit', stop);

  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      if ((await fetch(ORIGIN)).ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      console.error(serverErr);
      throw new Error('preview server did not start');
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

  // Apply the production headers locally, so the CSP is actually exercised
  // rather than just declared in a file nobody tested.
  const csp = cspText;
  check('a CSP was parsed out of _headers', !!csp);
  await page.route('**/*', async (route) => {
    const res = await route.fetch();
    const h = { ...res.headers() };
    if (csp) h['content-security-policy'] = csp;
    h['x-content-type-options'] = 'nosniff';
    await route.fulfill({ response: res, headers: h });
  });

  await page.goto(ORIGIN, { waitUntil: 'load' });
  await page.waitForFunction('window.__BB_READY === true', null, { timeout: 60000 });

  const probe = await page.evaluate(() => ({
    debugTable: typeof window.__BB,
    ready: window.__BB_READY === true,
    canvasW: document.getElementById('view')?.width ?? 0,
    canvasH: document.getElementById('view')?.height ?? 0,
    titleShown: (document.getElementById('ui')?.textContent ?? '').includes('BLUE BELOW'),
    takeTheJob: (document.getElementById('ui')?.textContent ?? '').includes('TAKE THE JOB'),
  }));

  check('the game boots under the production CSP', probe.ready);
  check('the debug table is absent at runtime', probe.debugTable === 'undefined', `typeof window.__BB === ${probe.debugTable}`);
  check('the WebGL canvas was sized', probe.canvasW > 0 && probe.canvasH > 0, `${probe.canvasW}x${probe.canvasH}`);
  check('the title screen rendered', probe.titleShown && probe.takeTheJob);

  // Not a blank screen: a uniformly black frame compresses to a few KB, the
  // game's dithered render does not. Crude, but it catches a dead renderer.
  await new Promise((r) => setTimeout(r, 400));
  const shot = await page.screenshot({ timeout: 120000 });
  check('the renderer produced a non-blank frame', shot.length > 15000, `${Math.round(shot.length / 1024)} KB screenshot`);

  check('no console errors under the production CSP', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  await browser.close();
  stop();

  console.log(`\nBundle ${bundleKb} KB. ${checks - failures}/${checks} checks passed.`);
  if (failures) {
    console.log('\nRelease is NOT clean. Do not deploy.');
    process.exit(1);
  }
  console.log('Release is clean and safe to deploy.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
