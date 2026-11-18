/**
 * Procedural texture production. Every surface, prop, sign, puzzle face and
 * blood-letter decal in the release build is synthesised here from the
 * constrained palette at low resolution (64-256 px) with nearest-neighbour
 * magnification, which is where most of the period look comes from.
 *
 * Textures are cached by key; a given key always produces identical pixels
 * (fixed seeds), so screenshots are reproducible.
 */

import * as THREE from 'three';
import { PAL } from './palette';
import { Rng } from '../core/rng';
import { GLYPHS, NUMERALS, type Polyline } from './strokefont';

type Ctx = CanvasRenderingContext2D;

const cache = new Map<string, THREE.Texture>();

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: Ctx } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d') as Ctx;
  g.imageSmoothingEnabled = false;
  return { c, g };
}

function finish(c: HTMLCanvasElement, repeat: boolean, mips: boolean): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = mips ? THREE.NearestMipmapNearestFilter : THREE.NearestFilter;
  t.generateMipmaps = mips;
  t.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = 1;
  // Deliberately NOT tagged sRGB. The whole renderer works in gamma space,
  // the way the hardware this is imitating did: the byte values in these
  // canvases are the values the shader multiplies light into, with no
  // linearisation either side. That is what keeps the palette banded and the
  // shading flat instead of photographic.
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

interface TexOpts {
  repeat?: boolean;
  mips?: boolean;
}

function make(key: string, w: number, h: number, draw: (g: Ctx, rng: Rng) => void, opts: TexOpts = {}): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const { c, g } = canvas(w, h);
  // Seed from the key so the same name always yields the same pixels.
  let seed = 2166136261;
  for (let i = 0; i < key.length; i++) seed = (Math.imul(seed ^ key.charCodeAt(i), 16777619) >>> 0);
  draw(g, new Rng(seed));
  const t = finish(c, opts.repeat ?? true, opts.mips ?? true);
  t.name = key;
  cache.set(key, t);
  return t;
}

export function disposeTextures(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}

// --------------------------------------------------------------- primitives

function fill(g: Ctx, color: string, w: number, h: number): void {
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
}

/** Per-pixel speckle, the backbone of every low-res surface here. */
function speckle(g: Ctx, rng: Rng, w: number, h: number, colors: string[], density: number, size = 1): void {
  const n = Math.floor(w * h * density);
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[rng.int(colors.length)];
    g.fillRect(rng.int(w), rng.int(h), size, size);
  }
}

/** Soft-ish grime blotches built from axis-aligned rects (no smooth gradients). */
function grime(g: Ctx, rng: Rng, w: number, h: number, color: string, count: number, maxR: number): void {
  g.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const cx = rng.int(w);
    const cy = rng.int(h);
    const r = 1 + rng.int(maxR);
    for (let y = -r; y <= r; y++) {
      const span = Math.round(Math.sqrt(Math.max(0, r * r - y * y)));
      if (span <= 0) continue;
      g.fillRect(cx - span, cy + y, span * 2, 1);
    }
  }
}

function hline(g: Ctx, y: number, w: number, color: string, t = 1): void {
  g.fillStyle = color;
  g.fillRect(0, y, w, t);
}

function vline(g: Ctx, x: number, h: number, color: string, t = 1): void {
  g.fillStyle = color;
  g.fillRect(x, 0, t, h);
}

/** Draws a stroke-font polyline set into a rect, with optional paint ragging. */
function strokePolys(
  g: Ctx,
  polys: readonly Polyline[],
  x: number,
  y: number,
  w: number,
  h: number,
  width: number,
  color: string,
  rng?: Rng,
): void {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const p of polys) {
    g.beginPath();
    for (let i = 0; i < p.length; i++) {
      const jx = rng ? rng.range(-w * 0.012, w * 0.012) : 0;
      const jy = rng ? rng.range(-h * 0.012, h * 0.012) : 0;
      const px = x + p[i][0] * w + jx;
      const py = y + p[i][1] * h + jy;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();
  }
}

// ------------------------------------------------------------------ surfaces

export const SURFACE = {
  floorConcrete: (): THREE.Texture =>
    make('surf.floor.concrete', 64, 64, (g, rng) => {
      fill(g, PAL.steel, 64, 64);
      speckle(g, rng, 64, 64, [PAL.slate, PAL.grey, PAL.steel, PAL.ink], 0.5);
      grime(g, rng, 64, 64, PAL.slate, 7, 9);
      // expansion joints
      hline(g, 0, 64, PAL.ink);
      vline(g, 0, 64, PAL.ink);
      hline(g, 31, 64, PAL.slate);
      vline(g, 31, 64, PAL.slate);
    }),

  floorTile: (): THREE.Texture =>
    make('surf.floor.tile', 64, 64, (g, rng) => {
      fill(g, PAL.grey, 64, 64);
      for (let ty = 0; ty < 4; ty++) {
        for (let tx = 0; tx < 4; tx++) {
          const shade = rng.next();
          g.fillStyle = shade > 0.82 ? PAL.pale : shade > 0.3 ? PAL.grey : PAL.steel;
          g.fillRect(tx * 16 + 1, ty * 16 + 1, 14, 14);
        }
      }
      speckle(g, rng, 64, 64, [PAL.slate, PAL.pale], 0.16);
      grime(g, rng, 64, 64, PAL.moss, 3, 6);
    }),

  floorGrate: (): THREE.Texture =>
    make('surf.floor.grate', 64, 64, (g, rng) => {
      fill(g, PAL.ink, 64, 64);
      g.fillStyle = PAL.rust;
      for (let i = 0; i < 64; i += 8) g.fillRect(i, 0, 5, 64);
      g.fillStyle = PAL.rustLit;
      for (let i = 0; i < 64; i += 16) g.fillRect(0, i, 64, 3);
      speckle(g, rng, 64, 64, [PAL.rust, PAL.ink, PAL.steel], 0.3);
    }),

  floorVault: (): THREE.Texture =>
    make('surf.floor.vault', 64, 64, (g, rng) => {
      fill(g, PAL.blueInk, 64, 64);
      for (let ty = 0; ty < 2; ty++) {
        for (let tx = 0; tx < 2; tx++) {
          g.fillStyle = (tx + ty) % 2 === 0 ? PAL.slate : PAL.blueInk;
          g.fillRect(tx * 32 + 1, ty * 32 + 1, 30, 30);
        }
      }
      speckle(g, rng, 64, 64, [PAL.blueDeep, PAL.slate], 0.1);
      hline(g, 0, 64, PAL.blueDeep);
      vline(g, 0, 64, PAL.blueDeep);
    }),

  floorLobby: (): THREE.Texture =>
    make('surf.floor.lobby', 64, 64, (g, rng) => {
      fill(g, PAL.steel, 64, 64);
      for (let ty = 0; ty < 2; ty++) {
        for (let tx = 0; tx < 2; tx++) {
          g.fillStyle = (tx + ty) % 2 === 0 ? PAL.grey : PAL.steel;
          g.fillRect(tx * 32, ty * 32, 32, 32);
        }
      }
      speckle(g, rng, 64, 64, [PAL.pale, PAL.slate], 0.14);
      grime(g, rng, 64, 64, PAL.slate, 4, 7);
    }),

  wallConcrete: (): THREE.Texture =>
    make('surf.wall.concrete', 64, 64, (g, rng) => {
      fill(g, PAL.grey, 64, 64);
      speckle(g, rng, 64, 64, [PAL.steel, PAL.pale, PAL.grey], 0.45);
      grime(g, rng, 64, 64, PAL.steel, 6, 10);
      // form-board seams
      hline(g, 2, 64, PAL.steel);
      hline(g, 33, 64, PAL.steel);
      // damp streaks from the top
      for (let i = 0; i < 6; i++) {
        const x = rng.int(64);
        g.fillStyle = PAL.slate;
        g.fillRect(x, 0, 1 + rng.int(2), 8 + rng.int(28));
      }
    }),

  wallPainted: (): THREE.Texture =>
    make('surf.wall.painted', 64, 64, (g, rng) => {
      fill(g, PAL.pale, 64, 64);
      speckle(g, rng, 64, 64, [PAL.grey, PAL.bone, PAL.pale], 0.3);
      // safety stripe along the bottom third
      g.fillStyle = PAL.moss;
      g.fillRect(0, 42, 64, 22);
      hline(g, 40, 64, PAL.steel, 2);
      speckle(g, rng, 64, 64, [PAL.mossLit], 0.06);
      grime(g, rng, 64, 64, PAL.grey, 4, 7);
    }),

  wallTile: (): THREE.Texture =>
    make('surf.wall.tile', 64, 64, (g, rng) => {
      fill(g, PAL.slate, 64, 64);
      for (let ty = 0; ty < 8; ty++) {
        for (let tx = 0; tx < 4; tx++) {
          const off = ty % 2 ? 8 : 0;
          const v = rng.next();
          g.fillStyle = v > 0.9 ? PAL.steel : v > 0.25 ? PAL.bone : PAL.pale;
          g.fillRect(((tx * 16 + off) % 64) + 1, ty * 8 + 1, 14, 6);
        }
      }
      grime(g, rng, 64, 64, PAL.moss, 4, 6);
      speckle(g, rng, 64, 64, [PAL.grey], 0.1);
    }),

  wallRust: (): THREE.Texture =>
    make('surf.wall.rust', 64, 64, (g, rng) => {
      fill(g, PAL.steel, 64, 64);
      // riveted plates
      for (let ty = 0; ty < 2; ty++) {
        for (let tx = 0; tx < 2; tx++) {
          g.fillStyle = (tx + ty) % 2 ? PAL.steel : PAL.slate;
          g.fillRect(tx * 32 + 1, ty * 32 + 1, 30, 30);
          g.fillStyle = PAL.grey;
          for (const [rx, ry] of [[4, 4], [27, 4], [4, 27], [27, 27]]) {
            g.fillRect(tx * 32 + rx, ty * 32 + ry, 2, 2);
          }
        }
      }
      grime(g, rng, 64, 64, PAL.rust, 9, 8);
      grime(g, rng, 64, 64, PAL.rustLit, 5, 4);
      speckle(g, rng, 64, 64, [PAL.rust, PAL.ink], 0.22);
    }),

  /** Visually a wall; its only tell is the vertical seam and shifted grime. */
  wallSeam: (): THREE.Texture =>
    make('surf.wall.seam', 64, 64, (g, rng) => {
      fill(g, PAL.grey, 64, 64);
      speckle(g, rng, 64, 64, [PAL.steel, PAL.pale, PAL.grey], 0.45);
      grime(g, rng, 64, 64, PAL.steel, 5, 9);
      hline(g, 2, 64, PAL.steel);
      hline(g, 33, 64, PAL.steel);
      // the tell: a full-height seam, slightly open, with dust pulled through it
      vline(g, 30, 64, PAL.ink, 2);
      vline(g, 29, 64, PAL.slate);
      vline(g, 32, 64, PAL.pale);
      for (let i = 0; i < 14; i++) {
        g.fillStyle = PAL.bone;
        g.fillRect(33 + rng.int(5), rng.int(64), 1, 1);
      }
    }),

  wallVault: (): THREE.Texture =>
    make('surf.wall.vault', 64, 64, (g, rng) => {
      fill(g, PAL.slate, 64, 64);
      for (let ty = 0; ty < 4; ty++) {
        g.fillStyle = ty % 2 ? PAL.slate : PAL.blueInk;
        g.fillRect(0, ty * 16, 64, 16);
      }
      vline(g, 0, 64, PAL.blueDeep, 2);
      vline(g, 32, 64, PAL.blueDeep, 2);
      speckle(g, rng, 64, 64, [PAL.blueDeep, PAL.steel], 0.2);
    }),

  ceilPanel: (): THREE.Texture =>
    make('surf.ceil.panel', 64, 64, (g, rng) => {
      fill(g, PAL.slate, 64, 64);
      for (let ty = 0; ty < 2; ty++) {
        for (let tx = 0; tx < 2; tx++) {
          g.fillStyle = PAL.steel;
          g.fillRect(tx * 32 + 2, ty * 32 + 2, 28, 28);
        }
      }
      speckle(g, rng, 64, 64, [PAL.slate, PAL.grey], 0.2);
      grime(g, rng, 64, 64, PAL.rust, 2, 5);
    }),

  ceilConcrete: (): THREE.Texture =>
    make('surf.ceil.concrete', 64, 64, (g, rng) => {
      fill(g, PAL.slate, 64, 64);
      speckle(g, rng, 64, 64, [PAL.ink, PAL.steel], 0.4);
      grime(g, rng, 64, 64, PAL.ink, 6, 10);
      // conduit run
      g.fillStyle = PAL.steel;
      g.fillRect(0, 26, 64, 4);
      g.fillStyle = PAL.grey;
      g.fillRect(0, 26, 64, 1);
    }),

  metalDark: (): THREE.Texture =>
    make('surf.metal.dark', 64, 64, (g, rng) => {
      fill(g, PAL.slate, 64, 64);
      speckle(g, rng, 64, 64, [PAL.ink, PAL.steel], 0.35);
      for (let i = 0; i < 64; i += 16) hline(g, i, 64, PAL.ink);
      grime(g, rng, 64, 64, PAL.rust, 3, 5);
    }),

  machine: (): THREE.Texture =>
    make('surf.metal.machine', 64, 64, (g, rng) => {
      fill(g, PAL.steel, 64, 64);
      g.fillStyle = PAL.slate;
      g.fillRect(0, 0, 64, 10);
      g.fillRect(0, 54, 64, 10);
      // louvres
      g.fillStyle = PAL.ink;
      for (let y = 14; y < 50; y += 5) g.fillRect(6, y, 52, 2);
      g.fillStyle = PAL.amberDim;
      g.fillRect(50, 2, 4, 4);
      g.fillStyle = PAL.moss;
      g.fillRect(44, 2, 4, 4);
      speckle(g, rng, 64, 64, [PAL.grey, PAL.slate], 0.14);
      grime(g, rng, 64, 64, PAL.rust, 3, 4);
    }),

  crate: (): THREE.Texture =>
    make('surf.prop.crate', 64, 64, (g, rng) => {
      fill(g, PAL.rust, 64, 64);
      speckle(g, rng, 64, 64, [PAL.rustLit, PAL.rust, PAL.slate], 0.4);
      g.strokeStyle = PAL.ink;
      g.lineWidth = 2;
      g.strokeRect(2, 2, 60, 60);
      g.fillStyle = PAL.ink;
      g.fillRect(2, 30, 60, 3);
      g.fillStyle = PAL.bone;
      g.fillRect(14, 10, 36, 12);
      g.fillStyle = PAL.ink;
      g.fillRect(17, 14, 30, 2);
      g.fillRect(17, 18, 20, 2);
    }),

  locker: (): THREE.Texture =>
    make('surf.prop.locker', 64, 64, (g, rng) => {
      fill(g, PAL.moss, 64, 64);
      speckle(g, rng, 64, 64, [PAL.mossLit, PAL.moss, PAL.slate], 0.3);
      g.fillStyle = PAL.ink;
      g.fillRect(31, 0, 2, 64);
      for (const x of [8, 40]) {
        g.fillStyle = PAL.slate;
        g.fillRect(x, 6, 16, 6);
        g.fillStyle = PAL.ink;
        for (let i = 0; i < 3; i++) g.fillRect(x + 1, 7 + i * 2, 14, 1);
        g.fillStyle = PAL.pale;
        g.fillRect(x + 13, 30, 3, 6);
      }
      grime(g, rng, 64, 64, PAL.rust, 4, 5);
    }),

  desk: (): THREE.Texture =>
    make('surf.prop.desk', 64, 64, (g, rng) => {
      fill(g, PAL.rust, 64, 64);
      for (let i = 0; i < 64; i += 3) {
        g.fillStyle = i % 6 ? PAL.rust : PAL.rustLit;
        g.fillRect(0, i, 64, 2);
      }
      speckle(g, rng, 64, 64, [PAL.ink, PAL.rustLit], 0.16);
    }),

  pipe: (): THREE.Texture =>
    make('surf.prop.pipe', 32, 32, (g, rng) => {
      for (let x = 0; x < 32; x++) {
        const t = Math.abs(x / 31 - 0.5) * 2;
        g.fillStyle = t > 0.75 ? PAL.ink : t > 0.4 ? PAL.steel : PAL.grey;
        g.fillRect(x, 0, 1, 32);
      }
      grime(g, rng, 32, 32, PAL.rust, 4, 4);
    }),

  demonSkin: (): THREE.Texture =>
    make('surf.demon.skin', 64, 64, (g, rng) => {
      // Dark body, a few bright accents. A uniformly pale skin reads as a
      // statue and a uniformly black one reads as a hole in the screen; what
      // works is a dark mass with drum-tight bone showing through in patches,
      // so the silhouette has edges without becoming a figurine.
      fill(g, PAL.slate, 64, 64);
      speckle(g, rng, 64, 64, [PAL.ink, PAL.slate, PAL.steel], 0.55);
      grime(g, rng, 64, 64, PAL.ink, 9, 9);
      grime(g, rng, 64, 64, PAL.bone, 2, 3);
      grime(g, rng, 64, 64, PAL.blood, 4, 5);
      // Sinew, stretched lengthwise.
      g.lineWidth = 1;
      for (let i = 0; i < 14; i++) {
        g.strokeStyle = i % 4 === 0 ? PAL.bone : PAL.grey;
        g.beginPath();
        const x = rng.int(64);
        g.moveTo(x, 0);
        g.lineTo(x + rng.range(-6, 6), 63);
        g.stroke();
      }
      g.strokeStyle = PAL.ink;
      for (let i = 0; i < 10; i++) {
        g.beginPath();
        g.moveTo(0, rng.int(64));
        g.lineTo(63, rng.int(64));
        g.stroke();
      }
    }),

  demonFace: (): THREE.Texture =>
    make('surf.demon.face', 64, 64, (g, rng) => {
      // A face built from absence: two sunken sockets and a vertical split,
      // not a cartoon face. Readable as wrong at eight pixels tall.
      fill(g, PAL.steel, 64, 64);
      speckle(g, rng, 64, 64, [PAL.grey, PAL.slate], 0.4);
      grime(g, rng, 64, 64, PAL.ink, 6, 7);

      // Sockets: deep black, larger than eyes should be.
      g.fillStyle = PAL.ink;
      for (const sx of [10, 36]) {
        for (let y = 0; y < 16; y++) {
          const w = 18 - Math.abs(y - 8);
          g.fillRect(sx + (18 - w) / 2, 14 + y, w, 1);
        }
      }
      // A pale brow ridge above them, so the sockets read as recessed.
      g.fillStyle = PAL.bone;
      g.fillRect(6, 10, 52, 3);
      g.fillStyle = PAL.pale;
      g.fillRect(6, 13, 52, 1);

      // Vertical split mouth, teeth as irregular slivers.
      g.fillStyle = PAL.ink;
      g.fillRect(26, 36, 12, 26);
      g.fillStyle = PAL.bone;
      for (let i = 0; i < 7; i++) {
        const h = 3 + rng.int(4);
        g.fillRect(26, 38 + i * 3, 3 + rng.int(2), h - 1);
        g.fillRect(38 - 3 - rng.int(2), 38 + i * 3, 3 + rng.int(2), h - 1);
      }
      g.fillStyle = PAL.blood;
      g.fillRect(29, 44, 6, 16);
      // Cheek hollows.
      grime(g, rng, 64, 64, PAL.ink, 3, 5);
    }),

  /** Signal-pistol body: blunt, scuffed, safety-orange rather than gunmetal. */
  flareBody: (): THREE.Texture =>
    make('surf.prop.flarebody', 32, 32, (g, rng) => {
      // Blued steel with a safety-orange band, not a block of rust: at
      // first-person scale a heavily speckled orange reads as a crate.
      fill(g, PAL.steel, 32, 32);
      speckle(g, rng, 32, 32, [PAL.slate, PAL.steel, PAL.grey], 0.3);
      g.fillStyle = PAL.rustLit;
      g.fillRect(0, 12, 32, 8);
      g.fillStyle = PAL.amber;
      g.fillRect(0, 13, 32, 2);
      hline(g, 11, 32, PAL.ink);
      hline(g, 20, 32, PAL.ink);
      grime(g, rng, 32, 32, PAL.ink, 2, 3);
    }),

  /** A flare cartridge: paper shell with a stencilled band. */
  flareShell: (): THREE.Texture =>
    make('surf.prop.flareshell', 32, 32, (g, rng) => {
      fill(g, PAL.blood, 32, 32);
      speckle(g, rng, 32, 32, [PAL.bloodLit, PAL.blood], 0.3);
      g.fillStyle = PAL.bone;
      g.fillRect(0, 12, 32, 7);
      g.fillStyle = PAL.ink;
      g.fillRect(0, 12, 32, 1);
      g.fillRect(0, 18, 32, 1);
      for (let i = 0; i < 5; i++) g.fillRect(3 + i * 6, 14, 2, 3);
    }),

  gunGrip: (): THREE.Texture =>
    make('surf.prop.gungrip', 32, 32, (g, rng) => {
      fill(g, PAL.rust, 32, 32);
      for (let y = 0; y < 32; y += 4) {
        g.fillStyle = PAL.ink;
        g.fillRect(0, y, 32, 1);
      }
      speckle(g, rng, 32, 32, [PAL.rustLit], 0.2);
    }),
} as const;

// ----------------------------------------------------------- blood decals

/**
 * One blood-painted letter with its Roman numeral beneath. Produced per letter
 * so the engine can compose the run's four clues dynamically from individual
 * approved decals (see ASSET_MANIFEST.md, DECAL section).
 */
export function bloodLetterDecal(letter: string, numeral: string): THREE.Texture {
  const key = `decal.blood.${numeral}.${letter}`;
  return make(
    key,
    128,
    256,
    (g, rng) => {
      g.clearRect(0, 0, 128, 256);
      const polys = GLYPHS[letter];
      const nums = NUMERALS[numeral];
      if (!polys || !nums) return;

      // Smeared halo first so the letter sits in paint rather than on it.
      g.globalAlpha = 0.5;
      strokePolys(g, polys, 20, 24, 88, 108, 22, PAL.blood, rng);
      g.globalAlpha = 1;

      // Drips: from the lowest point of each polyline.
      g.fillStyle = PAL.blood;
      for (const p of polys) {
        let lowest = p[0];
        for (const q of p) if (q[1] > lowest[1]) lowest = q;
        const dx = Math.round(20 + lowest[0] * 88);
        const dy = Math.round(24 + lowest[1] * 108);
        const len = 10 + rng.int(44);
        const w = 2 + rng.int(3);
        g.fillRect(dx - (w >> 1), dy, w, len);
        g.fillRect(dx - 1, dy + len, 3, 3);
      }

      strokePolys(g, polys, 20, 24, 88, 108, 13, PAL.bloodLit, rng);
      strokePolys(g, polys, 20, 24, 88, 108, 6, PAL.blood, rng);

      // Separator and numeral.
      g.fillStyle = PAL.blood;
      g.fillRect(34, 176, 60, 3);
      strokePolys(g, nums, 30, 194, 68, 44, 7, PAL.bloodLit, rng);
      strokePolys(g, nums, 30, 194, 68, 44, 3, PAL.blood, rng);

      // Flecks.
      for (let i = 0; i < 70; i++) {
        g.fillStyle = rng.next() > 0.5 ? PAL.blood : PAL.bloodLit;
        g.fillRect(8 + rng.int(112), 10 + rng.int(236), 1, 1 + rng.int(2));
      }
    },
    { repeat: false, mips: true },
  );
}

/** A scratched tally mark used as the false-wall hint beside the seam. */
export function scratchMarkTexture(): THREE.Texture {
  return make(
    'decal.scratch',
    64,
    64,
    (g, rng) => {
      g.clearRect(0, 0, 64, 64);
      g.strokeStyle = PAL.bone;
      g.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        g.beginPath();
        g.moveTo(14 + i * 10 + rng.range(-2, 2), 12);
        g.lineTo(12 + i * 10 + rng.range(-2, 2), 52);
        g.stroke();
      }
      g.strokeStyle = PAL.blood;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(8, 46);
      g.lineTo(56, 20);
      g.stroke();
    },
    { repeat: false, mips: true },
  );
}

// -------------------------------------------------------------------- signs

export interface SignStyle {
  bg: string;
  fg: string;
  accent?: string;
  width?: number;
  height?: number;
  align?: 'left' | 'center';
  size?: number;
  plate?: 'metal' | 'paper' | 'painted';
}

/**
 * A readable wall sign. Signs, puzzle faces and blood letters are rendered with
 * vertex jitter and affine UV warp disabled (see psx.ts), so this text stays
 * legible while the rest of the facility wobbles.
 */
export function signTexture(key: string, lines: string[], style: SignStyle): THREE.Texture {
  const w = style.width ?? 256;
  const h = style.height ?? 128;
  return make(
    `sign.${key}`,
    w,
    h,
    (g, rng) => {
      const plate = style.plate ?? 'metal';
      fill(g, style.bg, w, h);
      if (plate === 'metal') {
        speckle(g, rng, w, h, [style.bg, PAL.grey, PAL.slate], 0.1);
        g.strokeStyle = PAL.ink;
        g.lineWidth = 2;
        g.strokeRect(1, 1, w - 2, h - 2);
        g.fillStyle = PAL.grey;
        for (const [x, y] of [[6, 6], [w - 8, 6], [6, h - 8], [w - 8, h - 8]]) g.fillRect(x, y, 3, 3);
      } else if (plate === 'paper') {
        speckle(g, rng, w, h, [PAL.bone, style.bg], 0.12);
        grime(g, rng, w, h, PAL.rust, 3, 8);
        g.strokeStyle = PAL.rust;
        g.lineWidth = 1;
        g.strokeRect(2, 2, w - 4, h - 4);
      } else {
        speckle(g, rng, w, h, [style.bg, PAL.pale], 0.08);
      }
      if (style.accent) {
        g.fillStyle = style.accent;
        g.fillRect(0, 0, w, 8);
        g.fillRect(0, h - 8, w, 8);
      }

      const size = style.size ?? Math.max(10, Math.floor(h / (lines.length + 1.2)));
      g.font = `bold ${size}px "DejaVu Sans Mono", monospace`;
      g.textBaseline = 'middle';
      g.fillStyle = style.fg;
      const align = style.align ?? 'center';
      g.textAlign = align === 'center' ? 'center' : 'left';
      const top = (h - lines.length * (size + 4)) / 2 + size / 2 + 2;
      for (let i = 0; i < lines.length; i++) {
        const y = Math.round(top + i * (size + 4));
        const x = align === 'center' ? Math.round(w / 2) : 12;
        g.fillText(lines[i], x, y);
      }
    },
    { repeat: false, mips: true },
  );
}

// -------------------------------------------------------------- puzzle faces

/** Counter-safe front: three labelled toggles, a total window and a target plate. */
export function safeFaceTexture(): THREE.Texture {
  return make(
    'face.safe',
    256,
    256,
    (g, rng) => {
      fill(g, PAL.steel, 256, 256);
      speckle(g, rng, 256, 256, [PAL.slate, PAL.grey], 0.12);
      g.strokeStyle = PAL.ink;
      g.lineWidth = 4;
      g.strokeRect(2, 2, 252, 252);
      g.fillStyle = PAL.slate;
      g.fillRect(14, 14, 228, 228);

      g.fillStyle = PAL.bone;
      g.font = 'bold 20px "DejaVu Sans Mono", monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('COUNTER SAFE', 128, 36);

      // total window
      g.fillStyle = PAL.ink;
      g.fillRect(74, 56, 108, 50);
      g.strokeStyle = PAL.grey;
      g.lineWidth = 2;
      g.strokeRect(74, 56, 108, 50);
      g.fillStyle = PAL.amber;
      g.font = 'bold 34px "DejaVu Sans Mono", monospace';
      g.fillText('TOTAL', 128, 81);

      // target plate
      g.fillStyle = PAL.bone;
      g.fillRect(84, 116, 88, 30);
      g.fillStyle = PAL.ink;
      g.font = 'bold 20px "DejaVu Sans Mono", monospace';
      g.fillText('TARGET 8', 128, 131);

      // three toggles
      const labels = ['+4', '-3', '+7'];
      for (let i = 0; i < 3; i++) {
        const x = 32 + i * 68;
        g.fillStyle = PAL.ink;
        g.fillRect(x, 164, 54, 64);
        g.fillStyle = PAL.grey;
        g.fillRect(x + 6, 172, 42, 30);
        g.fillStyle = PAL.amber;
        g.font = 'bold 22px "DejaVu Sans Mono", monospace';
        g.fillText(labels[i], x + 27, 216);
      }
      g.fillStyle = PAL.pale;
      g.font = 'bold 12px "DejaVu Sans Mono", monospace';
      g.fillText('SWITCH ON ADDS - SWITCH OFF REMOVES', 128, 152);
    },
    { repeat: false, mips: true },
  );
}

/** Breaker cabinet front: four labelled breakers and a sequence progress row. */
export function breakerFaceTexture(): THREE.Texture {
  return make(
    'face.breaker',
    256,
    256,
    (g, rng) => {
      fill(g, PAL.moss, 256, 256);
      speckle(g, rng, 256, 256, [PAL.mossLit, PAL.moss, PAL.slate], 0.16);
      g.strokeStyle = PAL.ink;
      g.lineWidth = 4;
      g.strokeRect(2, 2, 252, 252);
      g.fillStyle = PAL.slate;
      g.fillRect(16, 46, 224, 150);

      g.fillStyle = PAL.bone;
      g.font = 'bold 18px "DejaVu Sans Mono", monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('MAIN BREAKER PANEL', 128, 26);

      const labels = ['A1', 'B2', 'C3', 'D4'];
      for (let i = 0; i < 4; i++) {
        const x = 26 + i * 54;
        g.fillStyle = PAL.ink;
        g.fillRect(x, 60, 42, 100);
        g.fillStyle = PAL.grey;
        g.fillRect(x + 8, 70, 26, 44);
        g.fillStyle = PAL.amber;
        g.font = 'bold 20px "DejaVu Sans Mono", monospace';
        g.fillText(labels[i], x + 21, 138);
      }
      g.fillStyle = PAL.ink;
      g.fillRect(26, 168, 204, 22);
      g.fillStyle = PAL.pale;
      g.font = 'bold 13px "DejaVu Sans Mono", monospace';
      g.fillText('SEQUENCE  _ _ _ _', 128, 179);
      g.fillStyle = PAL.bloodLit;
      g.font = 'bold 13px "DejaVu Sans Mono", monospace';
      g.fillText('KEYED ACCESS ONLY', 128, 212);
      g.fillStyle = PAL.pale;
      g.font = 'bold 11px "DejaVu Sans Mono", monospace';
      g.fillText('ORDER PER MAINT. DIAGRAM', 128, 232);
    },
    { repeat: false, mips: true },
  );
}

/** Front-door lock face: four letter wheels plus the powered-latch lamp. */
export function lockFaceTexture(): THREE.Texture {
  return make(
    'face.lock',
    256,
    256,
    (g, rng) => {
      fill(g, PAL.slate, 256, 256);
      speckle(g, rng, 256, 256, [PAL.steel, PAL.ink], 0.14);
      g.strokeStyle = PAL.ink;
      g.lineWidth = 4;
      g.strokeRect(2, 2, 252, 252);

      g.fillStyle = PAL.bone;
      g.font = 'bold 17px "DejaVu Sans Mono", monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('EXIT DOOR CONTROL', 128, 24);

      // powered latch lamp row
      g.fillStyle = PAL.ink;
      g.fillRect(20, 42, 216, 40);
      g.fillStyle = PAL.bloodLit;
      g.beginPath();
      g.arc(44, 62, 11, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = PAL.pale;
      g.font = 'bold 14px "DejaVu Sans Mono", monospace';
      g.textAlign = 'left';
      g.fillText('POWERED LATCH', 64, 62);

      // four wheels
      g.textAlign = 'center';
      for (let i = 0; i < 4; i++) {
        const x = 24 + i * 54;
        g.fillStyle = PAL.ink;
        g.fillRect(x, 100, 44, 74);
        g.fillStyle = PAL.steel;
        g.fillRect(x + 4, 112, 36, 50);
        g.fillStyle = PAL.amber;
        g.font = 'bold 30px "DejaVu Sans Mono", monospace';
        g.fillText('-', x + 22, 138);
        g.fillStyle = PAL.pale;
        g.font = 'bold 12px "DejaVu Sans Mono", monospace';
        g.fillText(['I', 'II', 'III', 'IV'][i], x + 22, 186);
      }
      g.fillStyle = PAL.pale;
      g.font = 'bold 12px "DejaVu Sans Mono", monospace';
      g.fillText('FOUR LETTER RELEASE CODE', 128, 212);
      g.fillStyle = PAL.bloodLit;
      g.fillText('LOCKED', 128, 234);
    },
    { repeat: false, mips: true },
  );
}

/** The maintenance diagram that gives the breaker order. */
export function diagramTexture(order: string[]): THREE.Texture {
  return make(
    `sign.diagram.${order.join('')}`,
    256,
    256,
    (g, rng) => {
      fill(g, PAL.bone, 256, 256);
      speckle(g, rng, 256, 256, [PAL.white, PAL.bone], 0.1);
      grime(g, rng, 256, 256, PAL.rust, 4, 10);
      g.strokeStyle = PAL.ink;
      g.lineWidth = 3;
      g.strokeRect(6, 6, 244, 244);

      g.fillStyle = PAL.ink;
      g.font = 'bold 17px "DejaVu Sans Mono", monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('MAINT. DIAGRAM 4C', 128, 26);
      g.font = 'bold 13px "DejaVu Sans Mono", monospace';
      g.fillText('MAIN BREAKER PANEL', 128, 48);
      g.fillText('ENERGISE IN THIS ORDER', 128, 68);

      for (let i = 0; i < order.length; i++) {
        const y = 96 + i * 36;
        g.fillStyle = PAL.ink;
        g.fillRect(40, y - 14, 30, 28);
        g.fillStyle = PAL.bone;
        g.font = 'bold 18px "DejaVu Sans Mono", monospace';
        g.fillText(String(i + 1), 55, y);

        g.fillStyle = PAL.ink;
        g.font = 'bold 15px "DejaVu Sans Mono", monospace';
        g.fillText('-->', 90, y);

        g.strokeStyle = PAL.ink;
        g.lineWidth = 2;
        g.strokeRect(120, y - 16, 56, 32);
        g.font = 'bold 20px "DejaVu Sans Mono", monospace';
        g.fillText(order[i], 148, y);
      }
      g.font = 'bold 11px "DejaVu Sans Mono", monospace';
      g.fillStyle = PAL.rust;
      g.fillText('WRONG ORDER TRIPS THE PANEL', 128, 236);
    },
    { repeat: false, mips: true },
  );
}

/** A flat lamp / emissive panel face. */
export function lampTexture(color: string): THREE.Texture {
  return make(
    `surf.lamp.${color}`,
    32,
    32,
    (g) => {
      fill(g, color, 32, 32);
      g.fillStyle = PAL.white;
      g.fillRect(4, 4, 24, 24);
      g.fillStyle = color;
      g.fillRect(0, 0, 32, 2);
      g.fillRect(0, 30, 32, 2);
    },
    { repeat: false, mips: true },
  );
}

/**
 * A soft radial glow, quantised into chunky rings so it stays in period. Used
 * for the diamond's halo, which has to be visible from the far end of the
 * vault without becoming a flat square.
 */
export function glowTexture(color: string): THREE.Texture {
  return make(
    `glow.${color}`,
    64,
    64,
    (g) => {
      g.clearRect(0, 0, 64, 64);
      const rings = 10;
      for (let i = rings; i >= 1; i--) {
        const r = (i / rings) * 31;
        const a = Math.pow(1 - i / rings, 1.7);
        g.globalAlpha = a;
        g.fillStyle = color;
        // Chunky stepped disc: filled scanline rows, no smooth gradient.
        for (let y = -r; y <= r; y++) {
          const span = Math.round(Math.sqrt(Math.max(0, r * r - y * y)));
          if (span <= 0) continue;
          g.fillRect(32 - span, Math.round(32 + y), span * 2, 1);
        }
      }
      g.globalAlpha = 1;
    },
    { repeat: false, mips: true },
  );
}

/**
 * The seal cut into the floor of the sealed store: a pentagram in a double
 * ring, drawn with the stroke renderer so it stays crisp with jitter and warp
 * switched off, on transparent so the floor shows through.
 */
export function pentagramTexture(): THREE.Texture {
  return make(
    'decal.pentagram',
    128,
    128,
    (g, rng) => {
      g.clearRect(0, 0, 128, 128);
      const cx0 = 64;
      const cy0 = 64;
      const R = 54;

      const ring = (r: number, w: number, color: string): void => {
        g.strokeStyle = color;
        g.lineWidth = w;
        g.beginPath();
        // Stepped circle: 24 segments, so it reads as scribed rather than CAD.
        for (let i = 0; i <= 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          const px = cx0 + Math.cos(a) * r;
          const py = cy0 + Math.sin(a) * r;
          if (i === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.stroke();
      };

      // Halo first, so the lines sit in light.
      g.globalAlpha = 0.45;
      ring(R, 11, PAL.blood);
      g.globalAlpha = 1;

      ring(R, 4, PAL.bloodLit);
      ring(R - 7, 2, PAL.blood);

      // The star: five points, every second vertex.
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
        pts.push([cx0 + Math.cos(a) * (R - 10), cy0 + Math.sin(a) * (R - 10)]);
      }
      g.lineCap = 'round';
      g.strokeStyle = PAL.blood;
      g.lineWidth = 9;
      g.globalAlpha = 0.5;
      for (let i = 0; i < 5; i++) {
        const a = pts[i];
        const b = pts[(i + 2) % 5];
        g.beginPath();
        g.moveTo(a[0], a[1]);
        g.lineTo(b[0], b[1]);
        g.stroke();
      }
      g.globalAlpha = 1;
      g.strokeStyle = PAL.bloodLit;
      g.lineWidth = 3.5;
      for (let i = 0; i < 5; i++) {
        const a = pts[i];
        const b = pts[(i + 2) % 5];
        g.beginPath();
        g.moveTo(a[0], a[1]);
        g.lineTo(b[0], b[1]);
        g.stroke();
      }

      // Scratched marks between the points.
      g.strokeStyle = PAL.blood;
      g.lineWidth = 1.5;
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + ((i + 0.5) / 5) * Math.PI * 2;
        const r0 = R - 4;
        g.beginPath();
        g.moveTo(cx0 + Math.cos(a) * r0, cy0 + Math.sin(a) * r0);
        g.lineTo(cx0 + Math.cos(a) * (r0 - 7), cy0 + Math.sin(a) * (r0 - 7));
        g.stroke();
      }
      for (let i = 0; i < 40; i++) {
        g.fillStyle = rng.next() > 0.5 ? PAL.blood : PAL.bloodLit;
        g.fillRect(cx0 - R + rng.int(R * 2), cy0 - R + rng.int(R * 2), 1, 1);
      }
    },
    { repeat: false, mips: true },
  );
}

/** Solid colour helper for untextured low-poly parts. */
export function flatTexture(key: string, color: string): THREE.Texture {
  return make(`flat.${key}`, 8, 8, (g) => fill(g, color, 8, 8), { repeat: true, mips: false });
}
