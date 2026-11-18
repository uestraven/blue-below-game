/** Captures the development-only AI visualisation, for verification. */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const O = 'http://127.0.0.1:4182';
await mkdir(path.join(HERE, 'screenshots'), { recursive: true });
const sv = spawn('npx', ['vite','preview','--host','127.0.0.1','--port','4182','--strictPort'], { cwd: path.resolve(HERE,'..'), stdio:['ignore','pipe','pipe'] });
sv.stdout.on('data',()=>{});
await new Promise(async r=>{for(;;){try{if((await fetch(O)).ok)return r();}catch{} await new Promise(q=>setTimeout(q,250));}});
const b = await chromium.launch({ headless:true, args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport:{width:960,height:600} });
p.on('pageerror', e=>console.log('PAGEERROR', e.message));
await p.goto(O); await p.waitForFunction('window.__BB_READY === true', null, { timeout:60000 });
await p.evaluate(() => {
  const BB = window.__BB;
  BB.start(4242); BB.begin(); BB.step(1/60, 2);
  BB.game.run.progress.diamondTaken = true;
  BB.playReveal(); BB.step(1/60, 260);
  BB.teleportCell(13, 4); BB.forceDemonTo(7, 4); BB.faceDemonAt(-55.5, -64.5);
  BB.game.hud.clearToast();
  BB.setAiDebug(true);
  BB.step(1/60, 20);
});
await new Promise(r=>setTimeout(r,400));
await p.screenshot({ path: path.join(HERE,'screenshots','aidebug-chase.png'), timeout:120000 });
console.log('aidebug-chase');
// lost sight
await p.evaluate(() => { const BB=window.__BB; BB.teleportCell(17,8); BB.step(1/60,90); });
await new Promise(r=>setTimeout(r,300));
await p.screenshot({ path: path.join(HERE,'screenshots','aidebug-lostsight.png'), timeout:120000 });
console.log('aidebug-lostsight');
const on = await p.evaluate(() => window.__BB.game.aiDebug?.enabled === true);
console.log('overlay enabled:', on);
await b.close(); sv.kill('SIGTERM');
