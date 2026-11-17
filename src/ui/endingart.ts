/**
 * Ending illustrations, drawn procedurally at 320x200 from the same constrained
 * palette as the facility textures and presented with nearest-neighbour
 * scaling, so the ending stills read as part of the same product as the game.
 */

import { PAL } from '../world/palette';
import { Rng } from '../core/rng';

export type EndingArt = 'ugly' | 'bad' | 'good';

const W = 320;
const H = 200;

export function drawEndingArt(kind: EndingArt): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  c.className = 'ending-art';
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.imageSmoothingEnabled = false;
  const rng = new Rng(kind === 'ugly' ? 11 : kind === 'bad' ? 22 : 33);
  if (kind === 'ugly') drawUgly(g, rng);
  else if (kind === 'bad') drawBad(g, rng);
  else drawGood(g, rng);
  dither(g, rng);
  return c;
}

function rect(g: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number): void {
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** A standing human silhouette, built from blocks. */
function figure(
  g: CanvasRenderingContext2D,
  color: string,
  x: number,
  footY: number,
  scale: number,
  carry: string | null,
): void {
  const s = scale;
  rect(g, color, x - 4 * s, footY - 26 * s, 8 * s, 14 * s); // torso
  rect(g, color, x - 3 * s, footY - 31 * s, 6 * s, 6 * s); // head
  rect(g, color, x - 3 * s, footY - 12 * s, 2.6 * s, 12 * s); // left leg
  rect(g, color, x + 0.6 * s, footY - 12 * s, 2.6 * s, 12 * s); // right leg
  rect(g, color, x - 6 * s, footY - 25 * s, 2 * s, 12 * s); // left arm
  rect(g, color, x + 4 * s, footY - 25 * s, 2 * s, 12 * s); // right arm
  if (carry) {
    rect(g, carry, x + 4.2 * s, footY - 14 * s, 2 * s, 2 * s);
    rect(g, PAL.white, x + 4.6 * s, footY - 13.6 * s, 1 * s, 1 * s);
  }
}

/** Tall, thin, long-armed. Reads as the demon at any size. */
function demonFigure(g: CanvasRenderingContext2D, x: number, footY: number, scale: number): void {
  const s = scale;
  rect(g, PAL.ink, x - 5 * s, footY - 40 * s, 10 * s, 22 * s);
  rect(g, PAL.ink, x - 4 * s, footY - 47 * s, 8 * s, 8 * s);
  rect(g, PAL.ink, x - 3.6 * s, footY - 18 * s, 3 * s, 18 * s);
  rect(g, PAL.ink, x + 0.6 * s, footY - 18 * s, 3 * s, 18 * s);
  rect(g, PAL.ink, x - 8 * s, footY - 39 * s, 2.6 * s, 24 * s);
  rect(g, PAL.ink, x + 5.4 * s, footY - 39 * s, 2.6 * s, 24 * s);
  rect(g, PAL.white, x - 3 * s, footY - 44 * s, 2 * s, 1.6 * s);
  rect(g, PAL.white, x + 1 * s, footY - 44 * s, 2 * s, 1.6 * s);
}

// ------------------------------------------------------------------- UGLY

function drawUgly(g: CanvasRenderingContext2D, rng: Rng): void {
  // The vault chamber, seen from the approach corridor. The stone stays.
  rect(g, PAL.blueInk, 0, 0, W, H);
  rect(g, PAL.slate, 0, 150, W, 50); // floor
  for (let i = 0; i < 6; i++) rect(g, PAL.blueDeep, 0, 150 + i * 9, W, 1);

  // Chamber walls receding.
  rect(g, PAL.slate, 60, 40, 200, 112);
  rect(g, PAL.blueInk, 74, 52, 172, 100);
  for (let i = 0; i < 5; i++) rect(g, PAL.blueDeep, 74, 52 + i * 20, 172, 2);

  // Pedestal and the diamond, still lit.
  rect(g, PAL.steel, 150, 108, 20, 44);
  rect(g, PAL.grey, 146, 104, 28, 5);
  for (let r = 16; r > 0; r -= 4) {
    g.globalAlpha = 0.1;
    rect(g, PAL.blue, 160 - r, 96 - r, r * 2, r * 2);
  }
  g.globalAlpha = 1;
  rect(g, PAL.blue, 156, 92, 8, 11);
  rect(g, PAL.white, 158, 95, 3, 4);

  // The vault door closing across the frame: two shutters from the sides.
  rect(g, PAL.steel, 0, 20, 62, 160);
  rect(g, PAL.steel, 258, 20, 62, 160);
  rect(g, PAL.ink, 56, 20, 6, 160);
  rect(g, PAL.ink, 258, 20, 6, 160);
  for (let i = 0; i < 8; i++) {
    rect(g, PAL.slate, 6, 28 + i * 20, 46, 12);
    rect(g, PAL.slate, 268, 28 + i * 20, 46, 12);
  }

  // The player, walking out of frame, empty-handed.
  figure(g, PAL.ink, 36, 186, 1.5, null);
  rect(g, PAL.ink, 0, 182, W, 18);

  // Ceiling shadow.
  rect(g, PAL.ink, 0, 0, W, 22);
  for (let i = 0; i < 40; i++) rect(g, PAL.blueDeep, rng.int(W), 150 + rng.int(46), 1, 1);
}

// -------------------------------------------------------------------- BAD

function drawBad(g: CanvasRenderingContext2D, rng: Rng): void {
  // Outside, night. The city is awake and has no idea.
  rect(g, PAL.ink, 0, 0, W, H);
  for (let y = 0; y < 90; y++) {
    const t = y / 90;
    rect(g, t > 0.72 ? PAL.slate : t > 0.4 ? PAL.blueInk : PAL.ink, 0, y, W, 1);
  }
  for (let i = 0; i < 70; i++) rect(g, PAL.pale, rng.int(W), rng.int(58), 1, 1);

  // Distant city: blocks with lit windows.
  for (let i = 0; i < 16; i++) {
    const bw = 10 + rng.int(18);
    const bh = 14 + rng.int(34);
    const bx = i * 20 + rng.int(6);
    rect(g, PAL.slate, bx, 90 - bh, bw, bh);
    for (let wy = 0; wy < bh - 4; wy += 5) {
      for (let wx = 0; wx < bw - 3; wx += 5) {
        if (rng.next() > 0.55) rect(g, PAL.amber, bx + wx + 1, 90 - bh + wy + 2, 2, 2);
      }
    }
  }

  // Ground and the road out.
  rect(g, PAL.steel, 0, 90, W, 110);
  for (let i = 0; i < 7; i++) rect(g, PAL.slate, 0, 96 + i * 15, W, 3);
  rect(g, PAL.grey, 120, 90, 80, 110);
  for (let i = 0; i < 5; i++) rect(g, PAL.bone, 158, 104 + i * 22, 4, 10);

  // The facility behind, one door open and lit.
  rect(g, PAL.ink, 190, 30, 130, 70);
  rect(g, PAL.slate, 196, 36, 118, 60);
  rect(g, PAL.amber, 236, 62, 14, 34);
  rect(g, PAL.white, 240, 68, 6, 22);
  rect(g, PAL.blood, 300, 40, 12, 6);

  // The player walking away toward us.
  figure(g, PAL.ink, 96, 188, 2.2, PAL.blue);

  // And it followed. Larger than it should be, right behind the doorway light.
  demonFigure(g, 214, 176, 1.9);

  rect(g, PAL.ink, 0, 192, W, 8);
}

// ------------------------------------------------------------------- GOOD

function drawGood(g: CanvasRenderingContext2D, rng: Rng): void {
  // Outside, first light. Nothing behind you but a dark building.
  for (let y = 0; y < 104; y++) {
    const t = y / 104;
    const c = t < 0.22 ? PAL.blueDeep : t < 0.45 ? PAL.slate : t < 0.68 ? PAL.rust : t < 0.86 ? PAL.rustLit : PAL.amber;
    rect(g, c, 0, y, W, 1);
  }
  for (let i = 0; i < 26; i++) rect(g, PAL.bone, rng.int(W), rng.int(34), 1, 1);

  // Low hills.
  for (let i = 0; i < W; i++) {
    const hy = 100 - Math.round(Math.sin(i * 0.035) * 5 + Math.sin(i * 0.011) * 7);
    rect(g, PAL.moss, i, hy, 1, 104 - hy + 2);
  }

  // Ground.
  rect(g, PAL.steel, 0, 104, W, 96);
  for (let i = 0; i < 8; i++) rect(g, PAL.slate, 0, 110 + i * 12, W, 2);
  for (let i = 0; i < 120; i++) rect(g, PAL.moss, rng.int(W), 106 + rng.int(92), 1, 1);

  // The facility: dark, shut, finished.
  rect(g, PAL.ink, 196, 42, 124, 64);
  rect(g, PAL.slate, 202, 48, 112, 54);
  rect(g, PAL.ink, 244, 72, 14, 30);
  rect(g, PAL.steel, 244, 72, 14, 3);
  // No light in any window.
  for (let wy = 0; wy < 3; wy++) {
    for (let wx = 0; wx < 6; wx++) rect(g, PAL.blueInk, 208 + wx * 17, 54 + wy * 14, 8, 7);
  }

  // The player, with the stone, and a long shadow pointing back at the door.
  rect(g, PAL.slate, 90, 186, 120, 5);
  figure(g, PAL.ink, 86, 186, 2.4, PAL.blue);
  for (let r = 10; r > 0; r -= 3) {
    g.globalAlpha = 0.12;
    rect(g, PAL.blue, 97 - r, 152 - r, r * 2, r * 2);
  }
  g.globalAlpha = 1;

  rect(g, PAL.ink, 0, 192, W, 8);
}

/** A light ordered-dither pass so the stills share the game's banding. */
function dither(g: CanvasRenderingContext2D, rng: Rng): void {
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  const m = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const t = (m[(y % 4) * 4 + (x % 4)] / 16 - 0.5) * 16;
      for (let k = 0; k < 3; k++) {
        const v = d[i + k] + t;
        d[i + k] = Math.max(0, Math.min(255, Math.round(v / 8) * 8));
      }
    }
  }
  // A few dropouts, like a well-used disc.
  for (let i = 0; i < 40; i++) {
    const x = rng.int(W);
    const y = rng.int(H);
    const i4 = (y * W + x) * 4;
    d[i4] = d[i4 + 1] = d[i4 + 2] = 255;
  }
  g.putImageData(img, 0, 0);
}
