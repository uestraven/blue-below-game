/**
 * Turns the layout data into three.js geometry with baked per-vertex lighting.
 *
 * Geometry is merged per (region, surface) pair. That keeps draw calls in the
 * dozens while still giving the frustum culler room to drop whole rooms the
 * player cannot see, which together with the dense fog is the facility's
 * occlusion strategy.
 */

import * as THREE from 'three';
import {
  GW,
  GH,
  TILE,
  REGIONS,
  LIGHTS,
  FALSE_WALL,
  FALSE_WALL_FACES,
  FOG,
  lx,
  lz,
  cx,
  cz,
  gxOf,
  gzOf,
  type RegionDef,
  type SurfaceKey,
  type LightDef,
} from './layout';
import { Grid, CELL_SOLID, CELL_FALSE_WALL } from './grid';
import { SURFACE, lampTexture } from './textures';
import { PAL } from './palette';
import type { PsxRenderer } from '../render/psx';

interface BakedLight extends LightDef {
  x: number;
  z: number;
}

/**
 * Lighting is computed and composited in gamma space (see textures.ts), so
 * these gains are tuned by eye rather than derived: a surface right under a
 * fixture should land near its own texture value, a mid-room surface around a
 * third of it, and a far corner should need the handlamp.
 */
const LIGHT_GAIN = 2.6;
const AMBIENT_GAIN = 2.2;

class Accum {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];

  push(
    p: [number, number, number],
    n: [number, number, number],
    uv: [number, number],
    c: [number, number, number],
  ): void {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.uv.push(uv[0], uv[1]);
    this.col.push(c[0], c[1], c[2]);
  }

  get count(): number {
    return this.pos.length / 3;
  }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export interface RegionVisual {
  def: RegionDef;
  meshes: THREE.Mesh[];
  materials: THREE.ShaderMaterial[];
  /** Lights in this region that flicker, used to modulate the region tint. */
  flicker: BakedLight[];
}

export interface WorldBuild {
  root: THREE.Group;
  regions: Map<string, RegionVisual>;
  /** Visible light fixtures, animated for flicker. */
  fixtures: Array<{ mesh: THREE.Mesh; material: THREE.ShaderMaterial; light: BakedLight }>;
  lights: BakedLight[];
  /** Sum of static light reaching a point; used to shade dynamic objects. */
  sampleLight(x: number, y: number, z: number, out: THREE.Color): THREE.Color;
}

const SURFACE_FN: Record<SurfaceKey, () => THREE.Texture> = {
  floorConcrete: SURFACE.floorConcrete,
  floorTile: SURFACE.floorTile,
  floorGrate: SURFACE.floorGrate,
  floorVault: SURFACE.floorVault,
  floorLobby: SURFACE.floorLobby,
  wallConcrete: SURFACE.wallConcrete,
  wallPainted: SURFACE.wallPainted,
  wallTile: SURFACE.wallTile,
  wallRust: SURFACE.wallRust,
  wallSeam: SURFACE.wallSeam,
  wallVault: SURFACE.wallVault,
  ceilPanel: SURFACE.ceilPanel,
  ceilConcrete: SURFACE.ceilConcrete,
  metalDark: SURFACE.metalDark,
};

export function buildWorld(grid: Grid, psx: PsxRenderer): WorldBuild {
  const baked: BakedLight[] = LIGHTS.map((l) => ({ ...l, x: cx(l.gx), z: cz(l.gz) }));

  /** Baked lighting for one surface vertex. */
  const bake = (
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    region: RegionDef,
  ): [number, number, number] => {
    let r = region.ambient[0] * AMBIENT_GAIN;
    let g = region.ambient[1] * AMBIENT_GAIN;
    let b = region.ambient[2] * AMBIENT_GAIN;
    // Sample a little off the surface so vertices sitting exactly on a wall
    // plane are not classified into the solid cell behind them.
    const sx = x + nx * 0.35;
    const sz = z + nz * 0.35;
    for (const L of baked) {
      const dx = L.x - x;
      const dy = L.y - y;
      const dz = L.z - z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > L.range) continue;
      const ndl = (dx * nx + dy * ny + dz * nz) / (d || 1);
      // Wrapped lighting: a surface turned away from a fixture still catches a
      // fifth of it, which stands in for the bounce a single-pass vertex
      // lighter cannot compute and keeps ceilings from reading as holes.
      const wrap = Math.max(0, ndl) * 0.8 + 0.2;
      if (!grid.sightClear(sx, sz, L.x, L.z)) continue;
      let att = 1 - d / L.range;
      att *= att;
      const k = L.intensity * att * wrap * LIGHT_GAIN;
      r += L.color[0] * k;
      g += L.color[1] * k;
      b += L.color[2] * k;
    }
    return [Math.min(r, 2.2), Math.min(g, 2.2), Math.min(b, 2.2)];
  };

  const groups = new Map<string, Accum>();
  const groupKey = (regionId: string, surf: SurfaceKey): string => `${regionId}|${surf}`;
  const acc = (regionId: string, surf: SurfaceKey): Accum => {
    const k = groupKey(regionId, surf);
    let a = groups.get(k);
    if (!a) {
      a = new Accum();
      groups.set(k, a);
    }
    return a;
  };

  type V3 = [number, number, number];
  type V2 = [number, number];

  /**
   * Emit a bilinear patch, subdivided nu x nv. Corner order is
   * p00 -> p10 -> p11 -> p01 counter-clockwise when viewed from `normal`.
   */
  const patch = (
    a: Accum,
    region: RegionDef,
    p00: V3,
    p10: V3,
    p11: V3,
    p01: V3,
    uv00: V2,
    uv10: V2,
    uv11: V2,
    uv01: V2,
    nu: number,
    nv: number,
  ): void => {
    const lerp3 = (A: V3, B: V3, t: number): V3 => [
      A[0] + (B[0] - A[0]) * t,
      A[1] + (B[1] - A[1]) * t,
      A[2] + (B[2] - A[2]) * t,
    ];
    const lerp2 = (A: V2, B: V2, t: number): V2 => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
    const at = (u: number, v: number): { p: V3; t: V2 } => {
      const top = lerp3(p00, p10, u);
      const bot = lerp3(p01, p11, u);
      const tt = lerp2(uv00, uv10, u);
      const tb = lerp2(uv01, uv11, u);
      return { p: lerp3(top, bot, v), t: lerp2(tt, tb, v) };
    };

    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const u0 = i / nu;
        const u1 = (i + 1) / nu;
        const v0 = j / nv;
        const v1 = (j + 1) / nv;
        const q00 = at(u0, v0);
        const q10 = at(u1, v0);
        const q11 = at(u1, v1);
        const q01 = at(u0, v1);

        // Face normal from the sub-quad, so ramps shade correctly.
        //
        // Corner order p00 -> p10 -> p11 -> p01 is counter-clockwise *as seen
        // from the front of the surface*, so the outward normal is b x a, and
        // the triangles have to be wound q00,q01,q11 / q00,q11,q10 to match.
        // Getting this backwards face-culls every floor, wall and ceiling in
        // the building, which is not a subtle failure but is a silent one.
        const ax = q10.p[0] - q00.p[0];
        const ay = q10.p[1] - q00.p[1];
        const az = q10.p[2] - q00.p[2];
        const bx = q01.p[0] - q00.p[0];
        const by = q01.p[1] - q00.p[1];
        const bz = q01.p[2] - q00.p[2];
        let nxv = by * az - bz * ay;
        let nyv = bz * ax - bx * az;
        let nzv = bx * ay - by * ax;
        const nl = Math.hypot(nxv, nyv, nzv) || 1;
        nxv /= nl;
        nyv /= nl;
        nzv /= nl;
        const nrm: V3 = [nxv, nyv, nzv];

        const c00 = bake(q00.p[0], q00.p[1], q00.p[2], nxv, nyv, nzv, region);
        const c10 = bake(q10.p[0], q10.p[1], q10.p[2], nxv, nyv, nzv, region);
        const c11 = bake(q11.p[0], q11.p[1], q11.p[2], nxv, nyv, nzv, region);
        const c01 = bake(q01.p[0], q01.p[1], q01.p[2], nxv, nyv, nzv, region);

        a.push(q00.p, nrm, q00.t, c00);
        a.push(q01.p, nrm, q01.t, c01);
        a.push(q11.p, nrm, q11.t, c11);

        a.push(q00.p, nrm, q00.t, c00);
        a.push(q11.p, nrm, q11.t, c11);
        a.push(q10.p, nrm, q10.t, c10);
      }
    }
  };

  // ------------------------------------------------------------ floors/ceils
  for (let gz = 0; gz < GH; gz++) {
    for (let gx = 0; gx < GW; gx++) {
      const cell = grid.cellAt(gx, gz);
      if (cell === CELL_SOLID) continue;
      const region = grid.regionAt(cx(gx), cz(gz));
      if (!region) continue;

      const x0 = lx(gx);
      const x1 = lx(gx + 1);
      const z0 = lz(gz);
      const z1 = lz(gz + 1);
      const h00 = grid.cornerHeight(gx, gz);
      const h10 = grid.cornerHeight(gx + 1, gz);
      const h11 = grid.cornerHeight(gx + 1, gz + 1);
      const h01 = grid.cornerHeight(gx, gz + 1);

      // Floor. Wound so the normal points up.
      patch(
        acc(region.id, region.floor),
        region,
        [x0, h00, z0],
        [x1, h10, z0],
        [x1, h11, z1],
        [x0, h01, z1],
        [gx, gz],
        [gx + 1, gz],
        [gx + 1, gz + 1],
        [gx, gz + 1],
        2,
        2,
      );

      // Ceiling. Reverse winding so the normal points down.
      const ch = region.ceiling;
      patch(
        acc(region.id, region.ceil),
        region,
        [x0, ch, z1],
        [x1, ch, z1],
        [x1, ch, z0],
        [x0, ch, z0],
        [gx, gz + 1],
        [gx + 1, gz + 1],
        [gx + 1, gz],
        [gx, gz],
        1,
        1,
      );
    }
  }

  // ------------------------------------------------------------------- walls
  const wallSubdivV = (h: number): number => Math.max(2, Math.ceil(h / 1.6));

  const emitWall = (
    gx: number,
    gz: number,
    dir: '-x' | '+x' | '-z' | '+z',
    region: RegionDef,
    surf: SurfaceKey,
  ): void => {
    const x0 = lx(gx);
    const x1 = lx(gx + 1);
    const z0 = lz(gz);
    const z1 = lz(gz + 1);
    const yb = -0.35; // below the floor so ramps never show a gap
    const yt = region.ceiling;
    const nv = wallSubdivV(yt - yb);
    const a = acc(region.id, surf);
    // A whole number of vertical texture repeats per wall, so painted dados
    // and riveted plates line up with the architecture instead of banding
    // across it at an arbitrary height. Short rooms get one repeat (one clean
    // dado); tall industrial rooms get two, which keeps the rivet detail.
    const uvTop = Math.max(1, Math.floor((yt - yb) / TILE + 0.35));

    // Each quad is wound so its normal faces into the open cell.
    if (dir === '-z') {
      patch(
        a,
        region,
        [x0, yt, z0],
        [x1, yt, z0],
        [x1, yb, z0],
        [x0, yb, z0],
        [gx, 0],
        [gx + 1, 0],
        [gx + 1, uvTop],
        [gx, uvTop],
        2,
        nv,
      );
    } else if (dir === '+z') {
      patch(
        a,
        region,
        [x1, yt, z1],
        [x0, yt, z1],
        [x0, yb, z1],
        [x1, yb, z1],
        [gx + 1, 0],
        [gx, 0],
        [gx, uvTop],
        [gx + 1, uvTop],
        2,
        nv,
      );
    } else if (dir === '-x') {
      patch(
        a,
        region,
        [x0, yt, z1],
        [x0, yt, z0],
        [x0, yb, z0],
        [x0, yb, z1],
        [gz + 1, 0],
        [gz, 0],
        [gz, uvTop],
        [gz + 1, uvTop],
        2,
        nv,
      );
    } else {
      patch(
        a,
        region,
        [x1, yt, z0],
        [x1, yt, z1],
        [x1, yb, z1],
        [x1, yb, z0],
        [gz, 0],
        [gz + 1, 0],
        [gz + 1, uvTop],
        [gz, uvTop],
        2,
        nv,
      );
    }
  };

  const NEIGHBOURS: Array<{ dir: '-x' | '+x' | '-z' | '+z'; dx: number; dz: number }> = [
    { dir: '-x', dx: -1, dz: 0 },
    { dir: '+x', dx: 1, dz: 0 },
    { dir: '-z', dx: 0, dz: -1 },
    { dir: '+z', dx: 0, dz: 1 },
  ];

  for (let gz = 0; gz < GH; gz++) {
    for (let gx = 0; gx < GW; gx++) {
      const cell = grid.cellAt(gx, gz);
      if (cell === CELL_SOLID) continue;
      const region = grid.regionAt(cx(gx), cz(gz));
      if (!region) continue;

      for (const n of NEIGHBOURS) {
        const nc = grid.cellAt(gx + n.dx, gz + n.dz);
        if (nc !== CELL_SOLID) continue;
        emitWall(gx, gz, n.dir, region, region.wall);
      }
    }
  }

  // The false wall: walkable, but a wall quad is drawn across both of its open
  // faces using the seam texture, so it reads as masonry from either side.
  {
    const gx = FALSE_WALL.gx;
    const gz = FALSE_WALL.gz;
    const region = grid.regionAt(cx(gx), cz(gz)) as RegionDef;
    for (const face of FALSE_WALL_FACES) {
      // The corridor side gets the corridor's own wall look plus the seam.
      emitWall(gx, gz, face, region, 'wallSeam');
    }
  }

  // ------------------------------------------------------------ ceiling steps
  for (let gz = 0; gz < GH; gz++) {
    for (let gx = 0; gx < GW; gx++) {
      if (grid.cellAt(gx, gz) === CELL_SOLID) continue;
      const here = grid.regionAt(cx(gx), cz(gz));
      if (!here) continue;
      for (const n of NEIGHBOURS) {
        if (grid.cellAt(gx + n.dx, gz + n.dz) === CELL_SOLID) continue;
        const there = grid.regionAt(cx(gx + n.dx), cz(gz + n.dz));
        if (!there || there.ceiling <= here.ceiling + 0.01) continue;
        // `there` is taller: close the gap with a riser facing into `here`.
        const x0 = lx(gx);
        const x1 = lx(gx + 1);
        const z0 = lz(gz);
        const z1 = lz(gz + 1);
        const yb = here.ceiling;
        const yt = there.ceiling;
        const a = acc(here.id, here.wall);
        const uvT = (yt - yb) / TILE;
        if (n.dir === '-x') {
          patch(a, here, [x0, yt, z0], [x0, yt, z1], [x0, yb, z1], [x0, yb, z0], [gz, 0], [gz + 1, 0], [gz + 1, uvT], [gz, uvT], 1, 1);
        } else if (n.dir === '+x') {
          patch(a, here, [x1, yt, z1], [x1, yt, z0], [x1, yb, z0], [x1, yb, z1], [gz + 1, 0], [gz, 0], [gz, uvT], [gz + 1, uvT], 1, 1);
        } else if (n.dir === '-z') {
          patch(a, here, [x1, yt, z0], [x0, yt, z0], [x0, yb, z0], [x1, yb, z0], [gx + 1, 0], [gx, 0], [gx, uvT], [gx + 1, uvT], 1, 1);
        } else {
          patch(a, here, [x0, yt, z1], [x1, yt, z1], [x1, yb, z1], [x0, yb, z1], [gx, 0], [gx + 1, 0], [gx + 1, uvT], [gx, uvT], 1, 1);
        }
      }
    }
  }

  // -------------------------------------------------------------- assemble
  const root = new THREE.Group();
  root.name = 'facility';
  const regions = new Map<string, RegionVisual>();

  for (const def of REGIONS) {
    regions.set(def.id, {
      def,
      meshes: [],
      materials: [],
      flicker: baked.filter((l) => (l.flicker ?? 0) > 0 && grid.regionIdAt(l.x, l.z) === def.id),
    });
  }

  for (const [key, a] of groups) {
    if (a.count === 0) continue;
    const [regionId, surf] = key.split('|') as [string, SurfaceKey];
    const rv = regions.get(regionId);
    if (!rv) continue;
    const mat = psx.createMaterial({ map: SURFACE_FN[surf](), jitter: 1, affine: 1 });
    const mesh = new THREE.Mesh(a.toGeometry(), mat);
    mesh.name = key;
    mesh.frustumCulled = true;
    root.add(mesh);
    rv.meshes.push(mesh);
    rv.materials.push(mat);
  }

  // ----------------------------------------------------------- light fixtures
  const fixtures: WorldBuild['fixtures'] = [];
  const lampTexCache = new Map<string, THREE.Texture>();
  for (const L of baked) {
    if (!L.fixture || L.fixture === 'none') continue;
    const colorHex = `#${Math.round(L.color[0] * 255)
      .toString(16)
      .padStart(2, '0')}${Math.round(L.color[1] * 255)
      .toString(16)
      .padStart(2, '0')}${Math.round(L.color[2] * 255)
      .toString(16)
      .padStart(2, '0')}`;
    let tex = lampTexCache.get(colorHex);
    if (!tex) {
      tex = lampTexture(colorHex);
      lampTexCache.set(colorHex, tex);
    }
    const w = L.fixture === 'strip' ? 2.4 : 0.6;
    const d = L.fixture === 'strip' ? 0.6 : 0.6;
    const geo = new THREE.PlaneGeometry(w, d);
    geo.rotateX(Math.PI / 2);
    geo.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(new Array(geo.attributes.position.count * 3).fill(1), 3),
    );
    const mat = psx.createMaterial({ map: tex, jitter: 0.35, affine: 0, emissive: 1.25 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(L.x, L.y + 0.02, L.z);
    root.add(mesh);
    fixtures.push({ mesh, material: mat, light: L });
  }

  // --------------------------------------------- dynamic-object light sampling
  const sampleLight = (x: number, y: number, z: number, out: THREE.Color): THREE.Color => {
    const region = grid.regionAt(x, z);
    let r = (region ? region.ambient[0] : 0.03) * AMBIENT_GAIN;
    let g = (region ? region.ambient[1] : 0.03) * AMBIENT_GAIN;
    let b = (region ? region.ambient[2] : 0.035) * AMBIENT_GAIN;
    for (const L of baked) {
      const dx = L.x - x;
      const dy = L.y - y;
      const dz = L.z - z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > L.range) continue;
      if (!grid.sightClear(x, z, L.x, L.z)) continue;
      let att = 1 - d / L.range;
      att *= att;
      const k = L.intensity * att * 0.62 * LIGHT_GAIN;
      r += L.color[0] * k;
      g += L.color[1] * k;
      b += L.color[2] * k;
    }
    return out.setRGB(Math.min(r, 1.8), Math.min(g, 1.8), Math.min(b, 1.8));
  };

  psx.shared.uFogColor.value.setRGB(FOG.color[0], FOG.color[1], FOG.color[2]);
  psx.shared.uFogDensity.value = FOG.density;

  return { root, regions, fixtures, lights: baked, sampleLight };
}

/** Grid-aligned helper used by props.ts to place things against a wall face. */
export function wallAnchor(
  gx: number,
  gz: number,
  face: '-x' | '+x' | '-z' | '+z',
  y: number,
  inset = 0.03,
): { pos: THREE.Vector3; rotY: number; normal: THREE.Vector3 } {
  const x0 = lx(gx);
  const x1 = lx(gx + 1);
  const z0 = lz(gz);
  const z1 = lz(gz + 1);
  switch (face) {
    case '-x':
      return { pos: new THREE.Vector3(x0 + inset, y, (z0 + z1) / 2), rotY: Math.PI / 2, normal: new THREE.Vector3(1, 0, 0) };
    case '+x':
      return { pos: new THREE.Vector3(x1 - inset, y, (z0 + z1) / 2), rotY: -Math.PI / 2, normal: new THREE.Vector3(-1, 0, 0) };
    case '-z':
      return { pos: new THREE.Vector3((x0 + x1) / 2, y, z0 + inset), rotY: 0, normal: new THREE.Vector3(0, 0, 1) };
    default:
      return { pos: new THREE.Vector3((x0 + x1) / 2, y, z1 - inset), rotY: Math.PI, normal: new THREE.Vector3(0, 0, -1) };
  }
}

/** Convenience re-exports used by prop construction. */
export const GridMath = { GW, GH, TILE, lx, lz, cx, cz, gxOf, gzOf, CELL_FALSE_WALL, PAL };
