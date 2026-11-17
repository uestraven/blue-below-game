/**
 * Preflight for `wrangler dev`.
 *
 * `wrangler dev` runs the real Workers runtime locally via `workerd`, which is
 * a prebuilt binary with its own glibc floor. When that floor is not met it
 * fails with an EPIPE and the useful part of the message scrolls past, so
 * check it up front and say something actionable instead.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function workerdPath() {
  for (const pkg of ['@cloudflare/workerd-linux-64', '@cloudflare/workerd-darwin-64', '@cloudflare/workerd-darwin-arm64', '@cloudflare/workerd-windows-64']) {
    try {
      const dir = require.resolve(`${pkg}/package.json`).replace(/package\.json$/, '');
      for (const bin of ['bin/workerd', 'bin/workerd.exe']) {
        if (existsSync(dir + bin)) return dir + bin;
      }
    } catch {
      /* not installed for this platform */
    }
  }
  return null;
}

const bin = workerdPath();
if (!bin) {
  console.error('cf-preflight: could not find the workerd binary. Run `npm install`.');
  process.exit(1);
}

const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
if (r.status === 0) {
  console.log(`workerd ok: ${(r.stdout || '').trim()}`);
  process.exit(0);
}

const why = `${r.stderr || ''}${r.error?.message || ''}`.trim();
const glibc = why.match(/GLIBC_([0-9.]+)' not found/);

console.error('\n  wrangler dev cannot run on this machine.\n');
if (glibc) {
  const have = spawnSync('bash', ['-lc', 'ldd --version 2>&1 | head -1'], { encoding: 'utf8' }).stdout?.trim();
  console.error(`  workerd needs glibc ${glibc[1]} or newer. This host: ${have || 'unknown'}`);
} else {
  console.error(`  ${why.split('\n')[0] || 'workerd failed to start.'}`);
}
console.error(`
  This affects local Workers emulation only. It does not affect deploying:
  'wrangler deploy' is an HTTPS upload and does not use workerd.

    npm run play         play the game locally (this works here)
    npm run cf:check     validate the Cloudflare config and upload plan
    npm run cf:deploy    deploy to Cloudflare
`);
process.exit(1);
