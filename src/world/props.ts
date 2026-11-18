/**
 * Everything in the facility that is not floor, wall or ceiling: furniture,
 * wayfinding signs, the three puzzle devices, the landmarks the player
 * navigates by, the blood-letter clues, the diamond and the gun.
 *
 * This module owns placement and collision volumes only. Gameplay wiring
 * (what pressing E on the safe does) lives in game/game.ts.
 */

import * as THREE from 'three';
import {
  TILE,
  cx,
  cz,
  lx,
  lz,
  PEDESTAL,
  CLUE_ANCHORS,
  FALSE_WALL,
  FRONT_DOOR,
  DAIS,
  type ClueAnchor,
} from './layout';
import type { Aabb } from './grid';
import {
  SURFACE,
  signTexture,
  bloodLetterDecal,
  scratchMarkTexture,
  safeFaceTexture,
  breakerFaceTexture,
  lockFaceTexture,
  diagramTexture,
  flatTexture,
  glowTexture,
  pentagramTexture,
} from './textures';
import { PAL } from './palette';
import type { PsxRenderer } from '../render/psx';
import type { WorldBuild } from './build';
import { wallAnchor } from './build';
import type { RunState } from '../game/state';
import type { NumeralName } from './strokefont';

export interface Readable {
  id: string;
  title: string;
  body: string[];
  pos: THREE.Vector3;
  normal: THREE.Vector3;
  radius: number;
  prompt: string;
}

export interface ClueDecal {
  numeral: NumeralName;
  letter: string;
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  normal: THREE.Vector3;
  where: string;
}

/**
 * Somewhere the player can get inside and be invisible to the demon. Hiding
 * does not suspend it - it keeps hunting, loses track of you, searches and
 * eventually wanders off, which is the whole point of the mechanic.
 */
export interface HideSpot {
  id: string;
  kind: 'locker' | 'under' | 'crate';
  /** Where the eye sits while hidden. */
  cam: THREE.Vector3;
  /** Yaw held while hidden, and how far the player may look either side. */
  yaw: number;
  yawRange: number;
  /** Where the player is put back on the floor when they climb out. */
  exit: THREE.Vector3;
  /** Interaction anchor. */
  pos: THREE.Vector3;
  label: string;
  /** Short line shown the first time this kind of spot is used. */
  flavour: string;
}

export interface PropsBuild {
  root: THREE.Group;
  blockers: Aabb[];
  readables: Readable[];
  clueDecals: ClueDecal[];
  hideSpots: HideSpot[];
  /** Device interaction anchors. */
  safeAnchor: { pos: THREE.Vector3; normal: THREE.Vector3 };
  breakerAnchor: { pos: THREE.Vector3; normal: THREE.Vector3 };
  lockAnchor: { pos: THREE.Vector3; normal: THREE.Vector3 };
  diamondAnchor: { pos: THREE.Vector3; normal: THREE.Vector3 };
  /** Mutable visuals the game toggles. */
  diamondMesh: THREE.Group;
  /** The flare gun pickup, in the records annex emergency station. */
  flareGunMesh: THREE.Group;
  flareGunAnchor: { pos: THREE.Vector3 };
  /** The three loose flare cartridges. */
  flarePickups: Array<{ id: string; mesh: THREE.Group; pos: THREE.Vector3; where: string }>;
  /** Harding's personal box, its lid, and the cross inside it. */
  personalBoxLid: THREE.Mesh;
  personalBoxAnchor: { pos: THREE.Vector3 };
  crossMesh: THREE.Group;
  crossAnchor: { pos: THREE.Vector3 };
  /** The brass key that opens the personal box. */
  boxKeyMesh: THREE.Group;
  boxKeyAnchor: { pos: THREE.Vector3 };
  /** The seal in the sealed store, and the cross once placed in it. */
  pentagram: THREE.Group;
  pentagramAnchor: { pos: THREE.Vector3 };
  placedCross: THREE.Group;
  safeDoor: THREE.Mesh;
  breakerDoor: THREE.Mesh;
  doorLeaves: THREE.Group;
  doorBlocker: Aabb;
  latchLamp: THREE.Mesh;
  latchLampMat: THREE.ShaderMaterial;
  keyMesh: THREE.Group;
  /** Animated flames/glow bits the game ticks. */
  glows: Array<{ mat: THREE.ShaderMaterial; base: number; rate: number }>;
}

export function buildProps(psx: PsxRenderer, wb: WorldBuild, run: RunState): PropsBuild {
  const root = new THREE.Group();
  root.name = 'props';
  const blockers: Aabb[] = [];
  const readables: Readable[] = [];
  const clueDecals: ClueDecal[] = [];
  const hideSpots: HideSpot[] = [];
  const glows: PropsBuild['glows'] = [];

  const tmp = new THREE.Color();

  /** Bakes the static light term into a geometry's vertex colours. */
  const bakeGeometry = (geo: THREE.BufferGeometry, offset: THREE.Vector3): void => {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      wb.sampleLight(pos.getX(i) + offset.x, pos.getY(i) + offset.y, pos.getZ(i) + offset.z, tmp);
      col[i * 3] = tmp.r;
      col[i * 3 + 1] = tmp.g;
      col[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  };

  interface BoxOpts {
    tex: THREE.Texture;
    uvScale?: number;
    rotY?: number;
    collide?: boolean;
    emissive?: number;
    jitter?: number;
    affine?: number;
    name?: string;
    id?: string;
  }

  const addBox = (
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    opts: BoxOpts,
  ): THREE.Mesh => {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const uvs = geo.attributes.uv as THREE.BufferAttribute;
    const s = opts.uvScale ?? Math.max(sx, sy, sz) / TILE;
    for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * s, uvs.getY(i) * s);
    uvs.needsUpdate = true;
    if (opts.rotY) geo.rotateY(opts.rotY);
    bakeGeometry(geo, new THREE.Vector3(x, y, z));
    const mat = psx.createMaterial({
      map: opts.tex,
      jitter: opts.jitter ?? 1,
      affine: opts.affine ?? 1,
      emissive: opts.emissive ?? 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    if (opts.name) mesh.name = opts.name;
    root.add(mesh);
    if (opts.collide) {
      const hx = Math.abs(Math.cos(opts.rotY ?? 0)) * sx * 0.5 + Math.abs(Math.sin(opts.rotY ?? 0)) * sz * 0.5;
      const hz = Math.abs(Math.sin(opts.rotY ?? 0)) * sx * 0.5 + Math.abs(Math.cos(opts.rotY ?? 0)) * sz * 0.5;
      blockers.push({
        minX: x - hx,
        maxX: x + hx,
        minZ: z - hz,
        maxZ: z + hz,
        top: y + sy * 0.5,
        id: opts.id,
      });
    }
    return mesh;
  };

  const addCylinder = (
    x: number,
    y: number,
    z: number,
    r: number,
    h: number,
    seg: number,
    tex: THREE.Texture,
    collide = false,
  ): THREE.Mesh => {
    const geo = new THREE.CylinderGeometry(r, r, h, seg, 1);
    bakeGeometry(geo, new THREE.Vector3(x, y, z));
    const mat = psx.createMaterial({ map: tex, jitter: 1, affine: 1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    root.add(mesh);
    if (collide) {
      blockers.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, top: y + h / 2 });
    }
    return mesh;
  };

  /** A flat quad hung on a wall face. */
  const addPlate = (
    gx: number,
    gz: number,
    face: '-x' | '+x' | '-z' | '+z',
    y: number,
    w: number,
    h: number,
    tex: THREE.Texture,
    opts: { alphaTest?: number; jitter?: number; affine?: number; emissive?: number; inset?: number } = {},
  ): { mesh: THREE.Mesh; pos: THREE.Vector3; normal: THREE.Vector3; mat: THREE.ShaderMaterial } => {
    const a = wallAnchor(gx, gz, face, y, opts.inset ?? 0.06);
    const geo = new THREE.PlaneGeometry(w, h);
    geo.rotateY(a.rotY);
    bakeGeometry(geo, a.pos);
    const mat = psx.createMaterial({
      map: tex,
      jitter: opts.jitter ?? 0,
      affine: opts.affine ?? 0,
      alphaTest: opts.alphaTest ?? 0,
      emissive: opts.emissive ?? 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(a.pos);
    root.add(mesh);
    return { mesh, pos: a.pos.clone(), normal: a.normal.clone(), mat };
  };

  /**
   * Register a hide spot and mark its interior dark, so from outside it reads
   * as something with a space inside rather than a solid block.
   */
  const addHideSpot = (
    id: string,
    kind: HideSpot['kind'],
    cam: [number, number, number],
    yaw: number,
    exit: [number, number],
    label: string,
    flavour: string,
    yawRange = 1.15,
  ): void => {
    hideSpots.push({
      id,
      kind,
      cam: new THREE.Vector3(cam[0], cam[1], cam[2]),
      yaw,
      yawRange,
      exit: new THREE.Vector3(exit[0], 0, exit[1]),
      pos: new THREE.Vector3(cam[0], Math.max(cam[1], 1.0), cam[2]),
      label,
      flavour,
    });
  };

  /** A small floating glint so a hand-sized pickup is findable in the dark. */
  const pickupGlint = (parent: THREE.Group, color: string, size: number, base: number): void => {
    const g = new THREE.PlaneGeometry(size, size);
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(1), 3));
    const m = psx.createMaterial({
      map: glowTexture(color),
      jitter: 0,
      affine: 0,
      emissive: base,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    m.uniforms.uOpacity.value = 0.45;
    const mesh = new THREE.Mesh(g, m);
    parent.add(mesh);
    (parent as THREE.Group & { userData: { glint?: THREE.Mesh } }).userData.glint = mesh;
    glows.push({ mat: m, base, rate: 0.55 });
  };

  const T = {
    metal: SURFACE.metalDark(),
    machine: SURFACE.machine(),
    crate: SURFACE.crate(),
    locker: SURFACE.locker(),
    desk: SURFACE.desk(),
    pipe: SURFACE.pipe(),
    concrete: SURFACE.wallConcrete(),
    painted: SURFACE.wallPainted(),
    rust: SURFACE.wallRust(),
    vault: SURFACE.wallVault(),
    gunGrip: SURFACE.gunGrip(),
    flareBody: SURFACE.flareBody(),
    flareShell: SURFACE.flareShell(),
    flareTip: flatTexture('flaretip', PAL.bloodLit),
    bone: flatTexture('bone', PAL.bone),
    blue: flatTexture('blue', PAL.blue),
    amber: flatTexture('amber', PAL.amber),
    red: flatTexture('red', PAL.bloodLit),
    green: flatTexture('green', PAL.mossLit),
    dark: flatTexture('dark', PAL.ink),
  };

  /** Break-barrelled signal pistol: fat muzzle, short body, angled grip. */
  const buildFlareGunPickup = (at: THREE.Vector3): THREE.Group => {
    const grp = new THREE.Group();
    const part = (w: number, h: number, d: number, ox: number, oy: number, oz: number, tex: THREE.Texture): void => {
      const g = new THREE.BoxGeometry(w, h, d);
      bakeGeometry(g, at);
      const m = new THREE.Mesh(g, psx.createMaterial({ map: tex, jitter: 0.6, affine: 0.3 }));
      m.position.set(ox, oy, oz);
      grp.add(m);
    };
    part(0.14, 0.15, 0.3, 0, 0.05, 0.08, T.flareBody); // fat barrel
    part(0.1, 0.12, 0.16, 0, 0.02, -0.11, T.flareBody); // breech
    part(0.07, 0.24, 0.1, 0, -0.12, -0.17, T.gunGrip); // grip
    part(0.05, 0.07, 0.05, 0, -0.04, -0.07, T.flareBody); // trigger guard
    pickupGlint(grp, PAL.amber, 0.7, 0.75);
    grp.position.copy(at);
    grp.rotation.y = 0.4;
    root.add(grp);
    return grp;
  };

  /** A single loose flare cartridge standing on end. */
  const buildFlarePickup = (at: THREE.Vector3): THREE.Group => {
    const grp = new THREE.Group();
    const g = new THREE.CylinderGeometry(0.045, 0.045, 0.2, 6);
    bakeGeometry(g, at);
    const body = new THREE.Mesh(g, psx.createMaterial({ map: T.flareShell, jitter: 0.5, affine: 0.2, emissive: 0.25 }));
    grp.add(body);
    const capGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.04, 6);
    bakeGeometry(capGeo, at);
    const cap = new THREE.Mesh(capGeo, psx.createMaterial({ map: T.flareTip, jitter: 0.5, affine: 0, emissive: 0.9 }));
    cap.position.y = 0.12;
    grp.add(cap);
    pickupGlint(grp, PAL.bloodLit, 0.5, 0.7);
    grp.position.copy(at);
    root.add(grp);
    return grp;
  };

  /** A small key, colour-coded so the two keys are never confused. */
  const buildKeyPickup = (at: THREE.Vector3, color: string): THREE.Group => {
    const grp = new THREE.Group();
    const tex = flatTexture(`key-${color}`, color);
    const part = (w: number, h: number, d: number, ox: number, oy: number, oz: number): void => {
      const g = new THREE.BoxGeometry(w, h, d);
      bakeGeometry(g, at);
      const m = new THREE.Mesh(g, psx.createMaterial({ map: tex, jitter: 0.5, affine: 0.2, emissive: 0.4 }));
      m.position.set(ox, oy, oz);
      grp.add(m);
    };
    part(0.05, 0.05, 0.3, 0, 0, 0);
    part(0.14, 0.14, 0.04, 0, 0, -0.16);
    part(0.1, 0.04, 0.04, 0.04, 0, 0.12);
    pickupGlint(grp, color, 0.45, 0.7);
    grp.position.copy(at);
    grp.rotation.y = 0.6;
    root.add(grp);
    return grp;
  };

  /** The cross, as a pickup inside the personal box. */
  const buildCrossPickup = (at: THREE.Vector3): THREE.Group => {
    const grp = new THREE.Group();
    const tex = T.bone;
    const part = (w: number, h: number, d: number, oy: number): void => {
      const g = new THREE.BoxGeometry(w, h, d);
      bakeGeometry(g, at);
      const m = new THREE.Mesh(g, psx.createMaterial({ map: tex, jitter: 0.4, affine: 0.2, emissive: 0.5 }));
      m.position.set(0, oy, 0);
      grp.add(m);
    };
    part(0.06, 0.34, 0.06, 0.17);
    part(0.22, 0.06, 0.06, 0.25);
    pickupGlint(grp, PAL.white, 0.5, 0.6);
    grp.position.copy(at);
    root.add(grp);
    return grp;
  };

  // =====================================================================
  // LOBBY - the player starts here, facing the door they must come back to.
  // =====================================================================
  // Reception counter, placed so it does not obstruct the route.
  addBox(cx(32), 0.55, cz(39), 7, 1.1, 1.2, { tex: T.desk, collide: true, uvScale: 2 });
  addHideSpot(
    'hide-reception',
    'under',
    [cx(32), 0.62, cz(39)],
    Math.PI, // looking back out into the lobby, toward the front door
    [cx(32), cz(40)],
    'Get under the counter',
    'You fold up under the counter where the receptionist used to put her feet.',
  );
  addBox(cx(32), 1.15, cz(39), 7, 0.1, 1.4, { tex: T.metal, uvScale: 2 });
  // Two waiting benches.
  addBox(cx(45), 0.45, cz(40), 1.0, 0.9, 4.0, { tex: T.desk, collide: true, uvScale: 1.5 });
  addBox(cx(45), 0.45, cz(44), 1.0, 0.9, 4.0, { tex: T.desk, collide: true, uvScale: 1.5 });
  // A dead potted plant and a tipped chair, for silhouette variety.
  addCylinder(cx(31), 0.4, cz(44), 0.45, 0.8, 6, T.rust, true);
  addBox(cx(41), 0.25, cz(38), 0.8, 0.5, 0.8, { tex: T.desk, rotY: 0.6, collide: true, uvScale: 1 });

  // Wayfinding: the route is legible from the lobby.
  addPlate(
    47,
    38,
    '+x',
    2.6,
    4.6,
    2.3,
    signTexture('lobby-dir', ['GENERATOR  ->', 'WORKSHOP   ->', 'TUNNELS    ->', '', 'RECORDS  <-'], {
      bg: PAL.steel,
      fg: PAL.bone,
      accent: PAL.amberDim,
      width: 256,
      height: 128,
      align: 'left',
      size: 20,
    }),
  );
  addPlate(
    30,
    42,
    '-x',
    2.4,
    2.6,
    1.3,
    signTexture('to-records', ['<- RECORDS'], { bg: PAL.steel, fg: PAL.bone, width: 256, height: 128, size: 34 }),
  );
  addPlate(
    38,
    37,
    '-z',
    2.4,
    3.2,
    1.6,
    signTexture('to-generator', ['SUBLEVEL ACCESS', 'GENERATOR / WORKSHOP'], {
      bg: PAL.steel,
      fg: PAL.bone,
      accent: PAL.moss,
      width: 256,
      height: 128,
      size: 22,
    }),
  );
  addPlate(
    45,
    37,
    '-z',
    2.4,
    2.6,
    1.3,
    signTexture('corr-a2', ['CORRIDOR A2', 'PLANT ACCESS'], { bg: PAL.steel, fg: PAL.pale, width: 256, height: 128, size: 26 }),
  );

  // The client's floor plan, pinned by the door. It stops halfway.
  const planBoard = addPlate(
    37,
    45,
    '+z',
    2.1,
    2.4,
    1.8,
    signTexture(
      'floorplan',
      ['FLOOR PLAN  (CLIENT COPY)', '', 'LOBBY -> CORRIDOR A', 'GENERATOR ROOM', 'WORKSHOP', '', 'PLAN ENDS HERE'],
      { bg: PAL.bone, fg: PAL.ink, plate: 'paper', width: 256, height: 256, size: 19 },
    ),
  );
  readables.push({
    id: 'floorplan',
    title: 'FLOOR PLAN (CLIENT COPY)',
    body: [
      'Hand-traced, photocopied twice. Lines stop at the workshop.',
      '',
      '  LOBBY ---- CORRIDOR A ---- GENERATOR ROOM',
      '                                   |',
      '                              CORRIDOR B',
      '                                   |',
      '                              WORKSHOP',
      '',
      'Below the workshop someone has written, in pen:',
      '"service tunnels - NOT SURVEYED"',
      '',
      'Nothing past that. Whatever is down there, you find it yourself.',
    ],
    pos: planBoard.pos,
    normal: planBoard.normal,
    radius: 2.4,
    prompt: 'Read floor plan',
  });

  // =====================================================================
  // FRONT DOOR - inspectable from the first minute.
  // =====================================================================
  const doorLeaves = new THREE.Group();
  {
    const doorZ = FRONT_DOOR.planeZ;
    const westX = lx(38);
    const eastX = lx(40);
    const leafW = (eastX - westX) / 2;
    for (let i = 0; i < 2; i++) {
      const geo = new THREE.BoxGeometry(leafW - 0.05, 3.0, 0.18);
      const uvs = geo.attributes.uv as THREE.BufferAttribute;
      for (let v = 0; v < uvs.count; v++) uvs.setXY(v, uvs.getX(v) * 1.2, uvs.getY(v) * 1.2);
      const px = westX + leafW * (i + 0.5);
      bakeGeometry(geo, new THREE.Vector3(px, 1.5, doorZ));
      const mat = psx.createMaterial({ map: T.metal, jitter: 0.6, affine: 0.5 });
      const leaf = new THREE.Mesh(geo, mat);
      leaf.position.set(px, 1.5, doorZ);
      doorLeaves.add(leaf);
    }
    // Door frame and the EXIT sign above it.
    addBox(lx(38) - 0.15, 1.6, doorZ, 0.3, 3.2, 0.5, { tex: T.metal, uvScale: 1 });
    addBox(lx(40) + 0.15, 1.6, doorZ, 0.3, 3.2, 0.5, { tex: T.metal, uvScale: 1 });
    addBox((westX + eastX) / 2, 3.25, doorZ, eastX - westX + 0.6, 0.35, 0.5, { tex: T.metal, uvScale: 1 });
    const exitSign = addPlate(
      38,
      45,
      '+z',
      3.5,
      1.8,
      0.7,
      signTexture('exit', ['EXIT'], { bg: PAL.blood, fg: PAL.white, width: 256, height: 128, size: 60 }),
      { emissive: 0.9 },
    );
    glows.push({ mat: exitSign.mat, base: 0.9, rate: 0.6 });
  }
  root.add(doorLeaves);
  const doorBlocker: Aabb = {
    minX: lx(38),
    maxX: lx(40),
    minZ: FRONT_DOOR.planeZ - 0.4,
    maxZ: FRONT_DOOR.planeZ + 0.4,
    top: 3.0,
    id: 'front-door',
  };
  blockers.push(doorBlocker);

  // The lock panel sits on the lobby side of the door, at eye height.
  addBox(cx(40), 1.45, lz(46) - 0.18, 1.45, 1.45, 0.34, { tex: T.metal, uvScale: 1 });
  const lockPlate = addPlate(40, 45, '+z', 1.45, 1.2, 1.2, lockFaceTexture(), { inset: 0.38 });
  const latch = addPlate(40, 45, '+z', 2.3, 0.34, 0.34, flatTexture('latchred', PAL.bloodLit), {
    emissive: 1.2,
    inset: 0.42,
  });
  glows.push({ mat: latch.mat, base: 1.2, rate: 1.4 });

  // =====================================================================
  // RECORDS - optional detour, explains how the extraction gear interlocks.
  // =====================================================================
  for (let i = 0; i < 4; i++) {
    addBox(cx(19), 0.85, cz(40 + i), 1.1, 1.7, 0.9, { tex: T.locker, collide: true, uvScale: 1 });
  }
  addBox(cx(25), 0.55, cz(43), 3.0, 1.1, 1.6, { tex: T.desk, collide: true, uvScale: 1.6 });
  addHideSpot(
    'hide-records',
    'under',
    [cx(25), 0.62, cz(43)],
    0,
    [cx(25), cz(42)],
    'Get under the desk',
    'There is just room under the desk if you keep your knees up.',
  );
  addBox(cx(27), 0.9, cz(40), 1.2, 1.8, 1.0, { tex: T.locker, collide: true, uvScale: 1 });
  const memo = addPlate(
    23,
    39,
    '-z',
    1.7,
    1.9,
    1.9,
    signTexture(
      'memo',
      ['SITE MEMO 11-C', '', 'EXIT RELEASE requires', 'BOTH:', '1. plant power at the', '   main breaker panel', '2. the four letter code', '', 'Breaker cabinet key is', 'in the workshop safe.'],
      { bg: PAL.bone, fg: PAL.ink, plate: 'paper', width: 256, height: 256, size: 17 },
    ),
  );
  readables.push({
    id: 'memo',
    title: 'SITE MEMO 11-C',
    body: [
      'To all shift staff.',
      '',
      'The front exit will not release on the code alone. The latch is',
      'powered. With the plant down, the latch stays engaged no matter',
      'what you dial.',
      '',
      'Sequence for an out-of-hours exit:',
      '',
      '  1.  Open the counter safe in the workshop. The breaker',
      '      cabinet key is kept inside it.',
      '  2.  Energise the main breaker panel in the generator room,',
      '      in the order given on maintenance diagram 4C.',
      '  3.  Dial the four letter release code at the door.',
      '',
      'The code is rotated weekly and is NOT written down.',
      '',
      'Underneath, in a different hand, scratched hard into the paper:',
      '',
      '  "it is written down. she wrote it on the walls."',
      '',
      'And lower still, almost off the page:',
      '',
      '  "there is a sealed store off the tunnels. you will not find the',
      '   door, you have to feel the air move. what is cut into the floor',
      '   in there will take it, but only if you give the floor something",',
      '',
      '  "something consecrated. harding kept his in that box and he never',
      '   let the key out of his sight. look where he used to wash his',
      '   hands."',
      '',
      'The last line is circled twice:',
      '',
      '  "a flare will only ever buy you a minute."',
    ],
    pos: memo.pos,
    normal: memo.normal,
    radius: 2.2,
    prompt: 'Read site memo',
  });
  addPlate(
    22,
    39,
    '-z',
    2.6,
    1.6,
    0.8,
    signTexture('records-sign', ['RECORDS'], { bg: PAL.steel, fg: PAL.bone, width: 256, height: 128, size: 44 }),
  );

  // Site emergency station in the records annex: where the flare gun lives.
  addBox(cx(27), 1.15, lz(39) + 0.3, 1.1, 1.4, 0.5, { tex: T.metal, uvScale: 1, collide: true });
  addPlate(
    27,
    39,
    '-z',
    1.15,
    0.95,
    0.95,
    signTexture('emergency-station', ['EMERGENCY', 'SIGNAL KIT', '1 PISTOL', '1 CARTRIDGE'], {
      bg: PAL.blood,
      fg: PAL.white,
      width: 256,
      height: 256,
      size: 22,
    }),
    { inset: 0.28 },
  );
  const flareGunMesh = buildFlareGunPickup(new THREE.Vector3(cx(27), 1.18, lz(39) + 0.02));

  // Harding's personal box, locked, in the same annex. Discoverable long
  // before the brass key that opens it.
  addBox(cx(19), 1.85, cz(44), 1.1, 0.5, 0.95, { tex: T.metal, uvScale: 1, collide: true });
  const boxLidGeo = new THREE.BoxGeometry(1.15, 0.1, 1.0);
  boxLidGeo.translate(0, 0, -0.5);
  bakeGeometry(boxLidGeo, new THREE.Vector3(cx(19), 2.12, cz(44)));
  const personalBoxLid = new THREE.Mesh(boxLidGeo, psx.createMaterial({ map: T.metal, jitter: 0.8, affine: 0.4 }));
  personalBoxLid.position.set(cx(19), 2.12, cz(44) + 0.5);
  root.add(personalBoxLid);
  addPlate(
    19,
    44,
    '+z',
    2.3,
    0.9,
    0.45,
    signTexture('box-tag', ['R. HARDING'], { bg: PAL.rust, fg: PAL.bone, width: 256, height: 128, size: 30 }),
    { inset: 0.52 },
  );
  const crossMesh = buildCrossPickup(new THREE.Vector3(cx(19), 1.95, cz(44)));

  // =====================================================================
  // CORRIDOR A / A2 - the stretch the player will run back down.
  // =====================================================================
  for (const gz of [31, 34]) {
    addCylinder(lx(36) + 0.4, 1.4, cz(gz), 0.14, 2.8, 6, T.pipe);
    addCylinder(lx(40) - 0.4, 1.4, cz(gz), 0.14, 2.8, 6, T.pipe);
  }
  addBox(cx(38), 2.55, cz(33), 3.4, 0.22, 0.22, { tex: T.pipe, uvScale: 1 });
  addPlate(
    38,
    30,
    '-z',
    2.2,
    2.4,
    1.2,
    signTexture('corrA-sign', ['GENERATOR ROOM', 'AHEAD'], { bg: PAL.steel, fg: PAL.bone, width: 256, height: 128, size: 26 }),
  );
  addBox(cx(46), 0.6, cz(31), 1.0, 1.2, 1.0, { tex: T.crate, collide: true, uvScale: 1 });
  // Flare 1 of 3, on the crate in the optional parallel corridor.
  const flarePickups: Array<{ id: string; mesh: THREE.Group; pos: THREE.Vector3; where: string }> = [];
  flarePickups.push({
    id: 'flare-corrA2',
    mesh: buildFlarePickup(new THREE.Vector3(cx(46), 1.32, cz(31))),
    pos: new THREE.Vector3(cx(46), 1.32, cz(31)),
    where: 'Corridor A2, on a crate',
  });

  // =====================================================================
  // GENERATOR ROOM - breaker cabinet, maintenance diagram, clue IV.
  // =====================================================================
  // The machinery island is solid in the grid, so its faces are already walls.
  // Dress it with equipment that protrudes into the room - anything placed
  // inside the island would simply be buried.
  for (const gz of [21, 24]) {
    addBox(lx(36) - 0.5, 1.6, cz(gz), 1.0, 3.2, 2.2, { tex: T.machine, uvScale: 1.5, collide: true });
    addBox(lx(44) + 0.5, 1.6, cz(gz), 1.0, 3.2, 2.2, { tex: T.machine, uvScale: 1.5, collide: true });
  }
  for (const gx of [37, 42]) {
    addBox(cx(gx), 1.4, lz(20) - 0.5, 2.2, 2.8, 1.0, { tex: T.machine, uvScale: 1.5, collide: true });
    addBox(cx(gx), 1.4, lz(26) + 0.5, 2.2, 2.8, 1.0, { tex: T.machine, uvScale: 1.5, collide: true });
  }
  // Exhaust stacks off the top of the island, up into the roof space.
  for (const gx of [37, 40, 43]) {
    addCylinder(cx(gx), 4.6, cz(22), 0.3, 1.2, 6, T.pipe);
  }
  // Control desk against the island's south face, facing the room.
  addBox(cx(39) + 1.5, 0.55, lz(26) + 1.4, 5.0, 1.1, 1.2, { tex: T.desk, collide: true, uvScale: 2 });
  addHideSpot(
    'hide-control-desk',
    'under',
    [cx(39) + 1.5, 0.62, lz(26) + 1.4],
    0,
    [cx(39) + 1.5, lz(26) + 3.5],
    'Get under the control desk',
    'Under the desk, with the plant humming through the floor against your back.',
  );
  addPlate(
    39,
    26,
    '+z',
    2.3,
    3.0,
    1.5,
    signTexture('plant-sign', ['PLANT NO. 1', 'KEEP CLEAR'], {
      bg: PAL.amberDim,
      fg: PAL.ink,
      accent: PAL.ink,
      width: 256,
      height: 128,
      size: 26,
    }),
    { inset: 1.6 },
  );
  // Turbine housings along the north wall.
  for (const gx of [33, 45]) {
    addCylinder(cx(gx), 1.3, cz(17), 1.3, 2.6, 8, T.machine, true);
    addCylinder(cx(gx), 2.8, cz(17), 0.3, 2.4, 6, T.pipe);
  }
  // Pillars (solid in grid) get a visual column.
  for (const [gx, gz] of [[31, 18], [47, 18], [31, 27], [47, 27]] as const) {
    addBox(cx(gx), 2.6, cz(gz), 3.0, 5.2, 3.0, { tex: T.rust, uvScale: 1 });
  }
  // Barrels for cover silhouettes.
  for (const [gx, gz] of [[29, 24], [49, 20], [34, 28], [44, 28]] as const) {
    addCylinder(cx(gx), 0.6, cz(gz), 0.55, 1.2, 8, T.rust, true);
  }
  // Overhead conduit, which reads as "this room feeds the building".
  for (const gz of [17, 28]) {
    addBox(cx(39), 4.9, cz(gz), 22, 0.3, 0.3, { tex: T.pipe, uvScale: 6 });
  }

  const breakerBody = addBox(lx(51) - 0.35, 1.6, cz(21), 0.7, 2.4, 3.0, { tex: T.metal, uvScale: 1, collide: true });
  breakerBody.name = 'breaker-body';
  addBox(lx(51) - 0.45, 1.6, cz(21), 0.5, 2.0, 2.4, { tex: T.dark, uvScale: 1 });
  const breakerFace = addPlate(50, 21, '+x', 1.6, 2.5, 2.5, breakerFaceTexture(), { inset: 0.78 });
  const breakerDoor = breakerFace.mesh;
  addPlate(
    50,
    23,
    '+x',
    2.4,
    1.9,
    0.95,
    signTexture('breaker-sign', ['MAIN BREAKER', 'PANEL'], { bg: PAL.moss, fg: PAL.white, width: 256, height: 128, size: 26 }),
  );

  // Flare 2 of 3, on the shelf beside the breaker cabinet.
  addBox(lx(51) - 0.3, 1.0, cz(24), 0.6, 0.08, 1.2, { tex: T.metal, uvScale: 1 });
  flarePickups.push({
    id: 'flare-generator',
    mesh: buildFlarePickup(new THREE.Vector3(lx(51) - 0.4, 1.14, cz(24))),
    pos: new THREE.Vector3(lx(51) - 0.4, 1.14, cz(24)),
    where: 'Generator hall, shelf by the breaker cabinet',
  });

  const diagram = addPlate(50, 19, '+x', 1.7, 1.9, 1.9, diagramTexture([...run.breakerOrder]), { inset: 0.08 });
  readables.push({
    id: 'diagram',
    title: 'MAINTENANCE DIAGRAM 4C',
    body: [
      'A laminated card, bolted to the wall beside the breaker cabinet.',
      '',
      '   MAIN BREAKER PANEL - ENERGISE IN THIS ORDER',
      '',
      ...run.breakerOrder.map((b, i) => `        ${i + 1}.  ->  [ ${b} ]`),
      '',
      'Printed along the bottom: WRONG ORDER TRIPS THE PANEL.',
      'Someone has added, in marker: "it just resets. try again."',
    ],
    pos: diagram.pos,
    normal: diagram.normal,
    radius: 2.4,
    prompt: 'Read maintenance diagram',
  });

  // =====================================================================
  // CORRIDOR B
  // =====================================================================
  addBox(cx(22), 0.7, lz(21) + 0.5, 1.2, 1.4, 0.8, { tex: T.crate, collide: true, uvScale: 1 });
  addPlate(
    24,
    21,
    '-z',
    2.2,
    2.6,
    1.3,
    signTexture('corrB-sign', ['<- WORKSHOP', 'GENERATOR ->'], { bg: PAL.steel, fg: PAL.bone, width: 256, height: 128, size: 24 }),
  );

  // =====================================================================
  // WORKSHOP - counter safe, clue III, and the way down to the tunnels.
  // =====================================================================
  // Central bench island (solid in grid) plus loose benches.
  addBox(cx(13) + 1.5, 0.55, cz(23), 11.5, 1.1, 8.5, { tex: T.desk, uvScale: 3 });
  addBox(cx(13) + 1.5, 1.15, cz(23), 11.9, 0.12, 8.9, { tex: T.metal, uvScale: 3 });
  for (const [gx, gz] of [[9, 18], [18, 26]] as const) {
    addBox(cx(gx), 0.5, cz(gz), 2.4, 1.0, 1.4, { tex: T.desk, collide: true, uvScale: 1.5 });
  }
  for (const [gx, gz] of [[10, 28], [19, 17]] as const) {
    addBox(cx(gx), 1.0, cz(gz), 1.0, 2.0, 1.2, { tex: T.locker, collide: true, uvScale: 1 });
  }
  addHideSpot(
    'hide-workshop-locker',
    'locker',
    [cx(10), 1.3, cz(28)],
    Math.PI, // the door faces back into the workshop
    [cx(10), cz(27)],
    'Get into the locker',
    'You pull the locker door to. It does not quite shut.',
    0.75,
  );
  addBox(cx(16), 0.5, cz(28), 1.2, 1.0, 1.2, { tex: T.crate, collide: true, uvScale: 1 });

  // Housing recessed into the wall; the labelled panel is the door itself, so
  // the player reads TARGET 8 and the switch modifiers off the closed safe.
  const safeBody = addBox(cx(13), 1.0, lz(30) - 0.5, 2.6, 2.0, 1.0, { tex: T.metal, uvScale: 1, collide: true });
  safeBody.name = 'safe-body';
  // Dark interior, revealed when the door is hidden.
  addBox(cx(13), 1.05, lz(30) - 0.6, 2.0, 1.6, 0.7, { tex: T.dark, uvScale: 1 });
  const safeFace = addPlate(13, 29, '+z', 1.05, 2.0, 2.0, safeFaceTexture(), { inset: 1.06 });
  const safeDoor = safeFace.mesh;
  addPlate(
    13,
    29,
    '+z',
    2.4,
    2.4,
    1.2,
    signTexture('safe-sign', ['COUNTER SAFE', 'TARGET  8'], { bg: PAL.steel, fg: PAL.amber, width: 256, height: 128, size: 26 }),
  );

  // The cabinet key, revealed inside the safe once it opens.
  const keyMesh = new THREE.Group();
  {
    const shaft = new THREE.BoxGeometry(0.06, 0.06, 0.34);
    const head = new THREE.BoxGeometry(0.16, 0.16, 0.05);
    const tooth = new THREE.BoxGeometry(0.12, 0.05, 0.05);
    for (const g of [shaft, head, tooth]) bakeGeometry(g, new THREE.Vector3(cx(13), 1.0, lz(30) - 0.9));
    const mat = psx.createMaterial({ map: T.amber, jitter: 0.5, affine: 0.2, emissive: 0.35 });
    const a = new THREE.Mesh(shaft, mat);
    const b = new THREE.Mesh(head, mat);
    b.position.z = -0.18;
    const c = new THREE.Mesh(tooth, mat);
    c.position.set(0.04, 0, 0.14);
    keyMesh.add(a, b, c);
    keyMesh.position.set(cx(13), 1.0, lz(30) - 0.88);
    keyMesh.visible = false;
    root.add(keyMesh);
  }

  addPlate(
    13,
    16,
    '-z',
    2.2,
    2.8,
    1.4,
    signTexture('to-tunnels', ['SERVICE TUNNELS', 'AUTHORISED ONLY'], {
      bg: PAL.steel,
      fg: PAL.amber,
      accent: PAL.blood,
      width: 256,
      height: 128,
      size: 22,
    }),
  );
  addPlate(
    8,
    26,
    '-x',
    2.4,
    2.2,
    1.1,
    signTexture('workshop-sign', ['WORKSHOP'], { bg: PAL.steel, fg: PAL.bone, width: 256, height: 128, size: 40 }),
  );

  // =====================================================================
  // MAZE CONNECTOR AND TUNNELS - landmarks the player navigates by.
  // =====================================================================
  // Connector: a grated shaft head with a pipe cluster.
  for (const dx of [-0.9, 0.9]) {
    addCylinder(cx(13) + dx, 1.3, cz(14), 0.12, 2.4, 6, T.pipe);
  }

  // Landmark 1: the locker bank at the tunnel mouth.
  for (let i = 0; i < 3; i++) {
    addBox(lx(12) + 0.5, 1.0, cz(10) + i * 1.0 - 1.0, 0.9, 2.0, 0.95, { tex: T.locker, collide: true, uvScale: 1 });
  }
  addHideSpot(
    'hide-tunnel-locker',
    'locker',
    [lx(12) + 0.85, 1.3, cz(10)],
    Math.PI / 2, // the door faces east, out across the entry hall
    [cx(13), cz(10)],
    'Get into the locker',
    'Standing in a dead man\u2019s locker, breathing through your mouth.',
    0.75,
  );
  addPlate(
    13,
    12,
    '+z',
    1.9,
    2.2,
    1.1,
    signTexture('tunnel-mouth', ['TUNNEL 1 - WEST', 'TUNNEL 2 - NORTH'], { bg: PAL.steel, fg: PAL.pale, width: 256, height: 128, size: 20 }),
  );

  // Landmark 2: the pump chamber, dripping, with clue I on the west wall.
  addCylinder(cx(5), 0.8, cz(8), 0.9, 1.6, 8, T.machine, true);
  addCylinder(cx(5), 2.0, cz(8), 0.22, 1.2, 6, T.pipe);
  addBox(cx(4), 2.3, cz(9), 0.25, 0.25, 6.0, { tex: T.pipe, uvScale: 2 });
  addBox(cx(4), 0.06, cz(10), 2.4, 0.12, 2.4, { tex: T.metal, uvScale: 1 });
  // The brass key, on the pump housing where Harding left it.
  const boxKeyMesh = buildKeyPickup(new THREE.Vector3(cx(5), 1.68, cz(8)), PAL.amber);

  // Landmark 3: collapsed shelving in the south-east tunnel (clue II opposite).
  addBox(cx(21), 0.9, lz(8) + 0.45, 3.4, 1.8, 0.7, { tex: T.locker, rotY: 0.08, collide: true, uvScale: 1 });
  // Low debris: stepped over rather than walked around, so the two-cell
  // corridor stays passable for both the player and the demon.
  addBox(cx(23), 0.13, cz(8), 1.6, 0.26, 1.0, { tex: T.crate, rotY: 0.5, collide: true, uvScale: 1 });

  // Landmark 4: the sump - a dead end with a floor drain, to punish a wrong turn.
  addCylinder(cx(25), 0.04, cz(11), 0.8, 0.08, 10, T.metal);
  addBox(cx(24), 0.55, cz(12), 1.2, 1.1, 1.0, { tex: T.crate, collide: true, uvScale: 1 });
  addHideSpot(
    'hide-sump-crate',
    'crate',
    [cx(24), 0.6, cz(12)],
    -Math.PI / 2,
    [cx(24), cz(11)],
    'Get into the crate',
    'You climb into the crate and pull the lid most of the way over.',
    0.6,
  );
  addPlate(
    25,
    12,
    '+z',
    1.7,
    2.0,
    1.0,
    signTexture('sump', ['SUMP - NO EXIT'], { bg: PAL.rust, fg: PAL.bone, width: 256, height: 128, size: 26 }),
  );
  // Flare 3 of 3, dropped in the sump dead end.
  flarePickups.push({
    id: 'flare-sump',
    mesh: buildFlarePickup(new THREE.Vector3(cx(26), 0.12, cz(11))),
    pos: new THREE.Vector3(cx(26), 0.12, cz(11)),
    where: 'Maze sump, on the floor',
  });

  // Tunnel route markers, so the maze is learnable rather than arbitrary.
  addPlate(
    16,
    3,
    '-z',
    1.9,
    2.0,
    1.0,
    signTexture('t-vault', ['VAULT ->'], { bg: PAL.blueDeep, fg: PAL.white, width: 256, height: 128, size: 34 }),
  );
  addPlate(
    4,
    3,
    '-z',
    1.9,
    2.0,
    1.0,
    signTexture('t-pump', ['PUMP ROOM'], { bg: PAL.steel, fg: PAL.pale, width: 256, height: 128, size: 28 }),
  );
  addPlate(
    25,
    3,
    '-z',
    1.9,
    2.0,
    1.0,
    signTexture('t-vault2', ['VAULT APPROACH ->'], { bg: PAL.blueDeep, fg: PAL.white, width: 256, height: 128, size: 20 }),
  );

  // The false wall hint: a scratch mark beside the seam, on the corridor side.
  addPlate(FALSE_WALL.gx - 1, FALSE_WALL.gz, '+x', 1.1, 0.9, 0.9, scratchMarkTexture(), {
    alphaTest: 0.5,
    inset: 0.05,
  });
  // Deliberately no sign here. The tells are the seam in the wall texture, the
  // scratch marks beside it, and the draught you can hear - which is what "a
  // subtle environmental clue" means. A placard reading DRAUGHT hands over the
  // secret room, and with it the good ending, to anyone who walks past.

  // =====================================================================
  // SECRET STORE - behind the false wall. The seal, and what it is for.
  // =====================================================================
  // Kept clear of the walls and of the false-wall entrance at (19, 6): the
  // room is only four cells by three and a body wedged in here has nowhere to
  // go.
  addBox(cx(21), 0.5, cz(5), 1.0, 1.0, 1.0, { tex: T.crate, collide: true, uvScale: 1 });
  addBox(cx(22), 0.9, cz(5), 0.9, 1.8, 0.9, { tex: T.locker, collide: true, uvScale: 1 });
  // A sheet over something that is the right size for a person. Kept on the
  // north row, clear of the entrance at (19, 6) and of the seal at (20, 6).
  addBox(cx(22), 0.22, cz(4), 1.4, 0.44, 0.8, { tex: T.bone, rotY: 0.12, collide: true, uvScale: 1 });

  // The pentagram: a glowing seal cut into the floor of the sealed store. Not
  // a pickup - a place where something has to be put.
  const pentagram = new THREE.Group();
  {
    const ppos = new THREE.Vector3(cx(20), 0.02, cz(6));
    const geo = new THREE.PlaneGeometry(2.5, 2.5);
    geo.rotateX(-Math.PI / 2);
    geo.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(new Array(geo.attributes.position.count * 3).fill(1), 3),
    );
    const mat = psx.createMaterial({
      map: pentagramTexture(),
      jitter: 0,
      affine: 0,
      emissive: 1.15,
      alphaTest: 0.25,
    });
    const mesh = new THREE.Mesh(geo, mat);
    pentagram.add(mesh);
    glows.push({ mat, base: 1.15, rate: 0.35 });
    // A low haze above the seal so it reads as light coming out of the floor.
    const hazeGeo = new THREE.PlaneGeometry(2.2, 2.2);
    hazeGeo.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(new Array(hazeGeo.attributes.position.count * 3).fill(1), 3),
    );
    const hazeMat = psx.createMaterial({
      map: glowTexture(PAL.bloodLit),
      jitter: 0,
      affine: 0,
      emissive: 0.55,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    hazeMat.uniforms.uOpacity.value = 0.3;
    const haze = new THREE.Mesh(hazeGeo, hazeMat);
    haze.position.set(0, 0.5, 0);
    pentagram.add(haze);
    (pentagram as THREE.Group & { userData: { haze: THREE.Mesh } }).userData.haze = haze;
    glows.push({ mat: hazeMat, base: 0.55, rate: 0.5 });
    pentagram.position.copy(ppos);
    root.add(pentagram);
  }

  // The cross, once placed. Hidden until the ritual starts.
  const placedCross = new THREE.Group();
  {
    const cpos = new THREE.Vector3(cx(20), 0.1, cz(6));
    const upright = new THREE.BoxGeometry(0.09, 0.62, 0.09);
    const arm = new THREE.BoxGeometry(0.4, 0.09, 0.09);
    for (const g of [upright, arm]) bakeGeometry(g, cpos);
    const mat = psx.createMaterial({ map: T.bone, jitter: 0.4, affine: 0.2, emissive: 0.7 });
    const a = new THREE.Mesh(upright, mat);
    a.position.y = 0.31;
    const b = new THREE.Mesh(arm, mat);
    b.position.y = 0.46;
    placedCross.add(a, b);
    placedCross.position.copy(cpos);
    placedCross.visible = false;
    root.add(placedCross);
    glows.push({ mat, base: 0.7, rate: 0.8 });
  }

  const secretNote = addPlate(
    19,
    4,
    '-z',
    1.6,
    1.7,
    1.7,
    signTexture(
      'secret-note',
      ['I CUT THE WALL', 'MYSELF', '', 'THE SEAL IS NOT', 'A TRAP', '', 'IT IS A GRAVE', 'WAITING FOR A', 'HEADSTONE'],
      { bg: PAL.bone, fg: PAL.blood, plate: 'paper', width: 256, height: 256, size: 17 },
    ),
  );
  readables.push({
    id: 'secret-note',
    title: 'PINNED TO THE WALL, IN PENCIL',
    body: [
      'I cut this wall open myself and I will cut it open again if they',
      'seal it. What is on the floor in here is not a trap and it is not',
      'a summoning. I checked it against three books. It is a grave.',
      '',
      'A grave does nothing on its own. It wants a headstone - something',
      'consecrated, set down inside the lines, given freely.',
      '',
      'Put something holy in the seal and whatever the blue stone let out',
      'goes into the floor with it, and stays there.',
      '',
      'I do not own anything holy. Harding in records did. He kept it in',
      'that box of his and he never let anyone near the key.',
    ],
    pos: secretNote.pos,
    normal: secretNote.normal,
    radius: 2.2,
    prompt: 'Read pinned note',
  });

  // =====================================================================
  // VAULT APPROACH AND CHAMBER
  // =====================================================================
  addPlate(
    36,
    4,
    '+x',
    2.1,
    2.4,
    1.2,
    signTexture('vault-sign', ['SPECIMEN VAULT', 'LEVEL 2 CLEARANCE'], {
      bg: PAL.blueDeep,
      fg: PAL.white,
      accent: PAL.blueInk,
      width: 256,
      height: 128,
      size: 22,
    }),
  );
  for (const gz of [3, 5]) {
    addCylinder(lx(33), 1.4, cz(gz), 0.14, 2.6, 6, T.pipe);
  }

  // Specimen cases around the chamber, all empty but one.
  for (const [gx, gz] of [[39, 3], [39, 11], [54, 3], [54, 11]] as const) {
    addBox(cx(gx), 0.6, cz(gz), 1.6, 1.2, 1.6, { tex: T.metal, collide: true, uvScale: 1 });
    addBox(cx(gx), 1.45, cz(gz), 1.3, 0.7, 1.3, { tex: T.vault, collide: true, uvScale: 1 });
  }

  // Dais edge trim (the dais itself is a ramped height field in the grid).
  addBox(
    (lx(DAIS.x0) + lx(DAIS.x1)) / 2,
    DAIS.height + 0.02,
    (lz(DAIS.z0) + lz(DAIS.z1)) / 2,
    (DAIS.x1 - DAIS.x0) * TILE - 0.2,
    0.04,
    (DAIS.z1 - DAIS.z0) * TILE - 0.2,
    { tex: T.vault, uvScale: 3 },
  );

  // Pedestal and the diamond.
  const pedX = (PEDESTAL.gx - 32) * TILE;
  const pedZ = (PEDESTAL.gz - 26) * TILE;
  addCylinder(pedX, DAIS.height + 0.5, pedZ, 0.55, 1.0, 8, T.vault, true);
  addCylinder(pedX, DAIS.height + 1.02, pedZ, 0.7, 0.08, 8, T.metal);

  const diamondMesh = new THREE.Group();
  {
    const dy = DAIS.height + 1.28;
    const geo = new THREE.OctahedronGeometry(0.26, 0);
    geo.scale(1, 1.35, 1);
    bakeGeometry(geo, new THREE.Vector3(pedX, dy, pedZ));
    const mat = psx.createMaterial({ map: T.blue, jitter: 0.3, affine: 0, emissive: 1.5 });
    const core = new THREE.Mesh(geo, mat);
    diamondMesh.add(core);
    glows.push({ mat, base: 1.5, rate: 0.9 });

    // A soft halo quad so it is visible from the far end of the chamber.
    const halo = new THREE.PlaneGeometry(1.5, 1.5);
    halo.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(new Array(halo.attributes.position.count * 3).fill(1), 3),
    );
    const haloMat = psx.createMaterial({
      map: glowTexture(PAL.blue),
      jitter: 0,
      affine: 0,
      emissive: 0.5,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    haloMat.uniforms.uOpacity.value = 0.35;
    const haloMesh = new THREE.Mesh(halo, haloMat);
    diamondMesh.add(haloMesh);
    (diamondMesh as THREE.Group & { userData: { halo: THREE.Mesh } }).userData.halo = haloMesh;
    diamondMesh.position.set(pedX, dy, pedZ);
    root.add(diamondMesh);
  }

  // The handwritten note, on a lectern beside the pedestal.
  addBox(pedX - 1.5, DAIS.height + 0.5, pedZ + 0.4, 0.7, 1.0, 0.5, { tex: T.desk, collide: true, uvScale: 1 });
  const noteGeo = new THREE.PlaneGeometry(0.62, 0.46);
  noteGeo.rotateX(-Math.PI / 2.6);
  const notePos = new THREE.Vector3(pedX - 1.5, DAIS.height + 1.04, pedZ + 0.4);
  bakeGeometry(noteGeo, notePos);
  const noteTex = signTexture(
    'vault-note-prop',
    ['THEY TOLD ME THE', 'BLUE STONE WAS', 'A SAMPLE.', '', 'I SIGNED THE', 'INVENTORY ANYWAY.'],
    { bg: PAL.bone, fg: PAL.ink, plate: 'paper', width: 256, height: 256, size: 20 },
  );
  const noteMesh = new THREE.Mesh(noteGeo, psx.createMaterial({ map: noteTex, jitter: 0, affine: 0 }));
  noteMesh.position.copy(notePos);
  root.add(noteMesh);

  addPlate(
    47,
    2,
    '-z',
    3.2,
    6.0,
    3.0,
    signTexture(
      'vault-plate',
      ['SPECIMEN 04', 'BLUE CORUNDUM - SAMPLE', 'DO NOT LIFT WITHOUT', 'TWO PERSON SIGN-OFF'],
      { bg: PAL.blueDeep, fg: PAL.white, width: 256, height: 128, size: 18 },
    ),
  );

  // Clue IV lives in the generator room; all four decals are built here from
  // the run's `clues` map, so the walls and the lock can never disagree.
  for (const anchor of CLUE_ANCHORS as ClueAnchor[]) {
    const letter = run.clues[anchor.numeral];
    const plate = addPlate(
      anchor.gx,
      anchor.gz,
      anchor.face,
      anchor.y,
      1.15,
      2.3,
      bloodLetterDecal(letter, anchor.numeral),
      { alphaTest: 0.45, inset: 0.05 },
    );
    clueDecals.push({
      numeral: anchor.numeral,
      letter,
      mesh: plate.mesh,
      pos: plate.pos,
      normal: plate.normal,
      where: anchor.where,
    });
  }

  return {
    root,
    blockers,
    readables,
    clueDecals,
    hideSpots,
    safeAnchor: { pos: safeFace.pos, normal: safeFace.normal },
    breakerAnchor: { pos: breakerFace.pos, normal: breakerFace.normal },
    lockAnchor: { pos: lockPlate.pos, normal: lockPlate.normal },
    diamondAnchor: { pos: new THREE.Vector3(pedX, DAIS.height + 1.2, pedZ), normal: new THREE.Vector3(0, 0, 1) },
    diamondMesh,
    flareGunMesh,
    flareGunAnchor: { pos: new THREE.Vector3(cx(27), 1.18, lz(39) + 0.02) },
    flarePickups,
    personalBoxLid,
    personalBoxAnchor: { pos: new THREE.Vector3(cx(19), 2.1, cz(44) + 0.2) },
    crossMesh,
    crossAnchor: { pos: new THREE.Vector3(cx(19), 1.95, cz(44)) },
    boxKeyMesh,
    boxKeyAnchor: { pos: new THREE.Vector3(cx(5), 1.68, cz(8)) },
    pentagram,
    pentagramAnchor: { pos: new THREE.Vector3(cx(20), 0.6, cz(6)) },
    placedCross,
    safeDoor,
    breakerDoor,
    doorLeaves,
    doorBlocker,
    latchLamp: latch.mesh,
    latchLampMat: latch.mat,
    keyMesh,
    glows,
  };
}
