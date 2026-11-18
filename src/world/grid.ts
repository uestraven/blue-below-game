/**
 * The navigable grid: collision, line of sight, floor height and pathfinding.
 *
 * The player and the demon share this one structure, so the demon is literally
 * navigating the same facility the player walks through - no separate nav mesh
 * that can drift out of agreement with the geometry.
 */

import {
  GW,
  GH,
  TILE,
  REGIONS,
  FALSE_WALL,
  DAIS,
  gxOf,
  gzOf,
  lx,
  lz,
  type RegionDef,
} from './layout';

export const CELL_SOLID = 0;
export const CELL_FLOOR = 1;
/** Walkable, but drawn as a wall and opaque to line of sight. */
export const CELL_FALSE_WALL = 2;

export interface Aabb {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  /** Top of the box; the player steps over anything at or below `stepOver`. */
  top: number;
  id?: string;
}

export class Grid {
  readonly cells = new Uint8Array(GW * GH);
  readonly region = new Int16Array(GW * GH).fill(-1);
  /** Corner heights, (GW+1) x (GH+1). Bilinear between them gives ramps. */
  readonly corner = new Float32Array((GW + 1) * (GH + 1));

  /** Dynamic blockers (furniture, the closed front door leaf). */
  blockers: Aabb[] = [];

  /**
   * Cells a walking body cannot stand in because furniture fills them. A*
   * respects this, so the demon never plots a route through a workbench and
   * then grinds against it.
   */
  readonly nav = new Uint8Array(GW * GH);

  /** Blockers bucketed by cell, so collision never scans the whole list. */
  private blockerIndex: Array<Aabb[] | undefined> = new Array(GW * GH);

  constructor() {
    for (let ri = 0; ri < REGIONS.length; ri++) {
      const r = REGIONS[ri];
      for (const rect of r.carve) {
        for (let gz = rect.z0; gz <= rect.z1; gz++) {
          for (let gx = rect.x0; gx <= rect.x1; gx++) {
            if (!this.inBounds(gx, gz)) continue;
            this.cells[gz * GW + gx] = CELL_FLOOR;
            this.region[gz * GW + gx] = ri;
          }
        }
      }
    }
    // Re-solidify machinery islands and pillars after carving.
    for (const r of REGIONS) {
      for (const rect of r.block ?? []) {
        for (let gz = rect.z0; gz <= rect.z1; gz++) {
          for (let gx = rect.x0; gx <= rect.x1; gx++) {
            if (!this.inBounds(gx, gz)) continue;
            this.cells[gz * GW + gx] = CELL_SOLID;
          }
        }
      }
    }
    // The false wall: walkable and opaque, but owned by the *tunnel* so its
    // floor, ceiling and side faces match the corridor it is hiding in. The
    // only tell is the seam texture on the two faces that read as masonry.
    const fwi = REGIONS.findIndex((r) => r.id === 'maze');
    this.cells[FALSE_WALL.gz * GW + FALSE_WALL.gx] = CELL_FALSE_WALL;
    this.region[FALSE_WALL.gz * GW + FALSE_WALL.gx] = fwi;

    // Raised dais corners; neighbouring cells become ramps by interpolation.
    for (let gz = DAIS.z0; gz <= DAIS.z1; gz++) {
      for (let gx = DAIS.x0; gx <= DAIS.x1; gx++) {
        this.corner[gz * (GW + 1) + gx] = DAIS.height;
      }
    }
  }

  inBounds(gx: number, gz: number): boolean {
    return gx >= 0 && gz >= 0 && gx < GW && gz < GH;
  }

  cellAt(gx: number, gz: number): number {
    if (!this.inBounds(gx, gz)) return CELL_SOLID;
    return this.cells[gz * GW + gx];
  }

  /** Blocks movement. */
  isSolid(gx: number, gz: number): boolean {
    return this.cellAt(gx, gz) === CELL_SOLID;
  }

  /** Blocks sight (walls and the false wall). */
  isOpaque(gx: number, gz: number): boolean {
    const c = this.cellAt(gx, gz);
    return c === CELL_SOLID || c === CELL_FALSE_WALL;
  }

  regionAt(x: number, z: number): RegionDef | null {
    const gx = gxOf(x);
    const gz = gzOf(z);
    if (!this.inBounds(gx, gz)) return null;
    const ri = this.region[gz * GW + gx];
    return ri < 0 ? null : REGIONS[ri];
  }

  regionIdAt(x: number, z: number): string {
    return this.regionAt(x, z)?.id ?? '';
  }

  /** Ceiling height of the region containing a point (falls back to 3). */
  ceilingAt(x: number, z: number): number {
    return this.regionAt(x, z)?.ceiling ?? 3;
  }

  cornerHeight(gx: number, gz: number): number {
    if (gx < 0 || gz < 0 || gx > GW || gz > GH) return 0;
    return this.corner[gz * (GW + 1) + gx];
  }

  /** Bilinear floor height; gives smooth ramps around the vault dais. */
  floorHeight(x: number, z: number): number {
    const fx = x / TILE + GW / 2;
    const fz = z / TILE + GH / 2;
    const gx = Math.floor(fx);
    const gz = Math.floor(fz);
    const tx = fx - gx;
    const tz = fz - gz;
    const h00 = this.cornerHeight(gx, gz);
    const h10 = this.cornerHeight(gx + 1, gz);
    const h01 = this.cornerHeight(gx, gz + 1);
    const h11 = this.cornerHeight(gx + 1, gz + 1);
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  // ------------------------------------------------------------- collision

  /** True when a disc of radius r at (x, z) overlaps a solid cell or blocker. */
  discBlocked(x: number, z: number, r: number, eyeY = 1.0): boolean {
    const x0 = gxOf(x - r);
    const x1 = gxOf(x + r);
    const z0 = gzOf(z - r);
    const z1 = gzOf(z + r);
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        if (!this.isSolid(gx, gz)) continue;
        // Nearest point on the cell box to the disc centre.
        const cx0 = lx(gx);
        const cz0 = lz(gz);
        const nx = Math.max(cx0, Math.min(x, cx0 + TILE));
        const nz = Math.max(cz0, Math.min(z, cz0 + TILE));
        const dx = x - nx;
        const dz = z - nz;
        if (dx * dx + dz * dz < r * r) return true;
      }
    }
    const bucket = this.blockerIndex[gzOf(z) * GW + gxOf(x)];
    if (bucket) {
      for (const b of bucket) {
        if (b.top <= 0.001) continue;
        // Anything whose top is below knee height is stepped over, not blocked.
        if (b.top < 0.35 && eyeY > 0) continue;
        const nx = Math.max(b.minX, Math.min(x, b.maxX));
        const nz = Math.max(b.minZ, Math.min(z, b.maxZ));
        const dx = x - nx;
        const dz = z - nz;
        if (dx * dx + dz * dz < r * r) return true;
      }
    }
    return false;
  }

  /**
   * Can a disc of radius `r` actually travel the straight line A -> B without
   * fouling architecture or furniture? Cell tests alone are not enough: a
   * pedestal straddling a cell boundary blocks no cell centre but will still
   * stop a body walking over it.
   */
  bodyPathClear(x0: number, z0: number, x1: number, z1: number, r: number): boolean {
    if (!this.navClear(x0, z0, x1, z1)) return false;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(1, Math.ceil(len / (r * 1.4)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (this.discBlocked(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, r)) return false;
    }
    return true;
  }

  /**
   * Slide a disc from (x, z) by (dx, dz), resolving each axis separately so
   * the player grazes along walls and tight corners instead of catching.
   */
  moveDisc(x: number, z: number, dx: number, dz: number, r: number): { x: number; z: number; hit: boolean } {
    let nx = x;
    let nz = z;
    let hit = false;

    // If the body has somehow ended up overlapping geometry - squeezed into a
    // corner, or caught by a blocker that changed under it - push it out
    // before trying to move, or it can never move again.
    if (this.discBlocked(nx, nz, r)) {
      const unstuck = this.pushOut(nx, nz, r);
      nx = unstuck.x;
      nz = unstuck.z;
    }
    const steps = Math.max(1, Math.ceil((Math.abs(dx) + Math.abs(dz)) / (r * 0.5)));
    const sx = dx / steps;
    const sz = dz / steps;
    for (let i = 0; i < steps; i++) {
      if (!this.discBlocked(nx + sx, nz, r)) nx += sx;
      else hit = true;
      if (!this.discBlocked(nx, nz + sz, r)) nz += sz;
      else hit = true;
    }
    return { x: nx, z: nz, hit };
  }

  /** Nearest unblocked spot to (x, z), searched outward in a ring. */
  pushOut(x: number, z: number, r: number): { x: number; z: number } {
    for (let step = 1; step <= 8; step++) {
      const d = step * r * 0.5;
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        const px = x + Math.cos(ang) * d;
        const pz = z + Math.sin(ang) * d;
        if (!this.discBlocked(px, pz, r)) return { x: px, z: pz };
      }
    }
    return { x, z };
  }

  // ----------------------------------------------------------- line of sight

  /**
   * Amanatides-Woo grid traversal. `opaque` decides what stops the ray;
   * pass `isSolid` for pathing checks and `isOpaque` for sight and shots.
   */
  private march(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    blocks: (gx: number, gz: number) => boolean,
  ): { clear: boolean; t: number } {
    let gx = gxOf(x0);
    let gz = gzOf(z0);
    const egx = gxOf(x1);
    const egz = gzOf(z1);
    if (blocks(gx, gz)) return { clear: false, t: 0 };

    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return { clear: true, t: 0 };
    const ndx = dx / len;
    const ndz = dz / len;

    const stepX = ndx > 0 ? 1 : -1;
    const stepZ = ndz > 0 ? 1 : -1;
    const invX = ndx !== 0 ? Math.abs(TILE / ndx) : Infinity;
    const invZ = ndz !== 0 ? Math.abs(TILE / ndz) : Infinity;

    const bx = lx(gx);
    const bz = lz(gz);
    let tMaxX = ndx !== 0 ? (ndx > 0 ? bx + TILE - x0 : x0 - bx) / Math.abs(ndx) : Infinity;
    let tMaxZ = ndz !== 0 ? (ndz > 0 ? bz + TILE - z0 : z0 - bz) / Math.abs(ndz) : Infinity;

    let guard = 0;
    while (guard++ < 4096) {
      if (gx === egx && gz === egz) return { clear: true, t: len };
      if (tMaxX < tMaxZ) {
        if (tMaxX > len) return { clear: true, t: len };
        gx += stepX;
        if (blocks(gx, gz)) return { clear: false, t: tMaxX };
        tMaxX += invX;
      } else {
        if (tMaxZ > len) return { clear: true, t: len };
        gz += stepZ;
        if (blocks(gx, gz)) return { clear: false, t: tMaxZ };
        tMaxZ += invZ;
      }
    }
    return { clear: false, t: len };
  }

  /** Can something at A see something at B? The false wall blocks sight. */
  sightClear(x0: number, z0: number, x1: number, z1: number): boolean {
    return this.march(x0, z0, x1, z1, (gx, gz) => this.isOpaque(gx, gz)).clear;
  }

  /** Can something walk straight from A to B? The false wall does not block. */
  walkClear(x0: number, z0: number, x1: number, z1: number): boolean {
    return this.march(x0, z0, x1, z1, (gx, gz) => this.isSolid(gx, gz)).clear;
  }

  /**
   * As `walkClear`, but furniture counts, and the false wall counts too. Used
   * when smoothing a path.
   *
   * The false wall is deliberately walkable, which means a naive smoother will
   * happily straighten a corridor route into a diagonal that clips through it
   * and dumps the body in a dead-end room it never meant to enter. Smoothing
   * therefore treats it as solid: A* can still step onto it on purpose, but no
   * straight-line shortcut is ever drawn through it.
   */
  navClear(x0: number, z0: number, x1: number, z1: number): boolean {
    return this.march(
      x0,
      z0,
      x1,
      z1,
      (gx, gz) => this.isBlockedForNav(gx, gz) || this.cellAt(gx, gz) === CELL_FALSE_WALL,
    ).clear;
  }

  /** Distance along the ray until the first opaque cell, or `max`. */
  rayHitDistance(x0: number, z0: number, dirX: number, dirZ: number, max: number): number {
    const r = this.march(x0, z0, x0 + dirX * max, z0 + dirZ * max, (gx, gz) => this.isOpaque(gx, gz));
    return r.clear ? max : r.t;
  }

  // ------------------------------------------------------------ pathfinding

  private openHeap: number[] = [];
  private gScore = new Float32Array(GW * GH);
  private fScore = new Float32Array(GW * GH);
  private cameFrom = new Int32Array(GW * GH);
  private visitStamp = new Int32Array(GW * GH);
  private stamp = 0;

  /**
   * Mark every cell a body of radius `r` cannot stand in because this box
   * fills it. Called once per piece of furniture at load time.
   */
  markNavBlockers(bodyRadius: number): void {
    this.nav.fill(0);
    this.blockerIndex = new Array(GW * GH);
    for (const b of this.blockers) {
      // Index every cell the box touches, padded by a body radius so a disc
      // near a cell edge still finds the box in the neighbouring cell.
      const ix0 = gxOf(b.minX - bodyRadius - 0.1);
      const ix1 = gxOf(b.maxX + bodyRadius + 0.1);
      const iz0 = gzOf(b.minZ - bodyRadius - 0.1);
      const iz1 = gzOf(b.maxZ + bodyRadius + 0.1);
      for (let gz = iz0; gz <= iz1; gz++) {
        for (let gx = ix0; gx <= ix1; gx++) {
          if (!this.inBounds(gx, gz)) continue;
          const k = gz * GW + gx;
          (this.blockerIndex[k] ??= []).push(b);
        }
      }
    }
    for (const b of this.blockers) {
      if (b.top < 0.35) continue; // steppable
      const x0 = gxOf(b.minX - bodyRadius * 0.4);
      const x1 = gxOf(b.maxX + bodyRadius * 0.4);
      const z0 = gzOf(b.minZ - bodyRadius * 0.4);
      const z1 = gzOf(b.maxZ + bodyRadius * 0.4);
      for (let gz = z0; gz <= z1; gz++) {
        for (let gx = x0; gx <= x1; gx++) {
          if (!this.inBounds(gx, gz)) continue;
          // Block a cell only when a body of this radius cannot stand at its
          // centre, so a bench that clips a cell corner does not wall off a
          // corridor, but a box covering the middle of one does.
          const px = lx(gx) + TILE / 2;
          const pz = lz(gz) + TILE / 2;
          const nx = Math.max(b.minX, Math.min(px, b.maxX));
          const nz = Math.max(b.minZ, Math.min(pz, b.maxZ));
          if (Math.hypot(px - nx, pz - nz) < bodyRadius * 0.9) {
            this.nav[gz * GW + gx] = 1;
          }
        }
      }
    }
  }

  /** Solid for pathfinding purposes: architecture or furniture. */
  isBlockedForNav(gx: number, gz: number): boolean {
    if (!this.inBounds(gx, gz)) return true;
    return this.cells[gz * GW + gx] === CELL_SOLID || this.nav[gz * GW + gx] === 1;
  }

  /** Nearest cell a walker can stand in, searched outward. */
  nearestWalkable(gx: number, gz: number, maxR = 8): [number, number] | null {
    if (this.inBounds(gx, gz) && !this.isBlockedForNav(gx, gz)) return [gx, gz];
    for (let r = 1; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = gx + dx;
          const nz = gz + dz;
          if (this.inBounds(nx, nz) && !this.isBlockedForNav(nx, nz)) return [nx, nz];
        }
      }
    }
    return null;
  }

  /**
   * A* over the cell grid, 8-connected with corner-cutting disallowed, then
   * string-pulled so the demon walks diagonals through rooms instead of
   * stair-stepping along cell centres.
   */
  findPath(sx: number, sz: number, tx: number, tz: number): Array<{ x: number; z: number }> | null {
    const s = this.nearestWalkable(gxOf(sx), gzOf(sz));
    const t = this.nearestWalkable(gxOf(tx), gzOf(tz));
    if (!s || !t) return null;
    const startIdx = s[1] * GW + s[0];
    const goalIdx = t[1] * GW + t[0];
    if (startIdx === goalIdx) return [{ x: tx, z: tz }];

    this.stamp++;
    const stamp = this.stamp;
    const heap = this.openHeap;
    heap.length = 0;

    const h = (idx: number): number => {
      const ax = idx % GW;
      const az = (idx / GW) | 0;
      return Math.hypot(ax - t[0], az - t[1]);
    };

    this.gScore[startIdx] = 0;
    this.fScore[startIdx] = h(startIdx);
    this.cameFrom[startIdx] = -1;
    this.visitStamp[startIdx] = stamp;
    this.heapPush(heap, startIdx);

    const closed = new Set<number>();
    let found = false;
    let guard = 0;
    while (heap.length && guard++ < 20000) {
      const cur = this.heapPop(heap);
      if (cur === goalIdx) {
        found = true;
        break;
      }
      if (closed.has(cur)) continue;
      closed.add(cur);
      const cxi = cur % GW;
      const czi = (cur / GW) | 0;
      for (let d = 0; d < 8; d++) {
        const dx = DIRS[d][0];
        const dz = DIRS[d][1];
        const nx = cxi + dx;
        const nz = czi + dz;
        if (this.isBlockedForNav(nx, nz)) continue;
        if (dx !== 0 && dz !== 0) {
          // No squeezing through a diagonal gap between two walls.
          if (this.isBlockedForNav(cxi + dx, czi) || this.isBlockedForNav(cxi, czi + dz)) continue;
        }
        const nIdx = nz * GW + nx;
        if (closed.has(nIdx)) continue;
        const step = dx !== 0 && dz !== 0 ? 1.41421356 : 1;
        const tentative = this.gScore[cur] + step;
        if (this.visitStamp[nIdx] !== stamp || tentative < this.gScore[nIdx]) {
          this.visitStamp[nIdx] = stamp;
          this.gScore[nIdx] = tentative;
          this.fScore[nIdx] = tentative + h(nIdx);
          this.cameFrom[nIdx] = cur;
          this.heapPush(heap, nIdx);
        }
      }
    }
    if (!found) return null;

    // Reconstruct, then string-pull.
    const raw: Array<{ x: number; z: number }> = [];
    let cur = goalIdx;
    while (cur !== -1) {
      const gxi = cur % GW;
      const gzi = (cur / GW) | 0;
      raw.push({ x: lx(gxi) + TILE / 2, z: lz(gzi) + TILE / 2 });
      cur = this.cameFrom[cur];
    }
    raw.reverse();
    raw[raw.length - 1] = { x: tx, z: tz };

    const out: Array<{ x: number; z: number }> = [];
    let i = 0;
    while (i < raw.length) {
      // Bounded look-ahead keeps smoothing cheap on long paths.
      let j = Math.min(raw.length - 1, i + 14);
      for (; j > i + 1; j--) {
        if (this.corridorClear(raw[i].x, raw[i].z, raw[j].x, raw[j].z, 0.75)) break;
      }
      out.push(raw[j]);
      i = j;
      if (j === raw.length - 1) break;
    }
    return out;
  }

  /** Walk-clear with a width, so string-pulled lines do not clip a corner. */
  private corridorClear(x0: number, z0: number, x1: number, z1: number, r: number): boolean {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz) || 1;
    const px = (-dz / len) * r;
    const pz = (dx / len) * r;
    return (
      this.bodyPathClear(x0, z0, x1, z1, r) &&
      this.navClear(x0 + px, z0 + pz, x1 + px, z1 + pz) &&
      this.navClear(x0 - px, z0 - pz, x1 - px, z1 - pz)
    );
  }

  private heapPush(heap: number[], idx: number): void {
    heap.push(idx);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.fScore[heap[p]] <= this.fScore[heap[i]]) break;
      const t = heap[p];
      heap[p] = heap[i];
      heap[i] = t;
      i = p;
    }
  }

  private heapPop(heap: number[]): number {
    const top = heap[0];
    const last = heap.pop() as number;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && this.fScore[heap[l]] < this.fScore[heap[m]]) m = l;
        if (r < heap.length && this.fScore[heap[r]] < this.fScore[heap[m]]) m = r;
        if (m === i) break;
        const t = heap[m];
        heap[m] = heap[i];
        heap[i] = t;
        i = m;
      }
    }
    return top;
  }
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
