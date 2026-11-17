/**
 * The facility layout, as data.
 *
 * The whole building is one level on a 64 x 52 cell grid at 3 units per cell
 * (192 x 156 units). Architecture is carved from rectangles; furniture is
 * handled separately as axis-aligned prop boxes (see props.ts).
 *
 * Route the player learns on the way in and must re-walk on the way out:
 *
 *   VESTIBULE / FRONT DOOR  (south, locked: powered latch + four-letter lock)
 *        |                                   RECORDS (west annex, memo)
 *      LOBBY  ----------------------------------'
 *        |  corridor A            corridor A2 (parallel loop)
 *   GENERATOR ROOM  (breaker cabinet, maint. diagram, clue IV)
 *        |  corridor B
 *      WORKSHOP  (counter safe, clue III)
 *        |  maze connector
 *       MAZE  (dark service tunnels; clue I, clue II, false wall -> SECRET ROOM)
 *        |  vault corridor
 *    VAULT CHAMBER  (blue diamond, handwritten note)
 */

export const GW = 64;
export const GH = 52;
export const TILE = 3;

export const WORLD_W = GW * TILE;
export const WORLD_H = GH * TILE;

/** Centre of cell gx in world x. */
export function cx(gx: number): number {
  return (gx + 0.5 - GW / 2) * TILE;
}
/** Centre of cell gz in world z. */
export function cz(gz: number): number {
  return (gz + 0.5 - GH / 2) * TILE;
}
/** Grid x containing world x. */
export function gxOf(x: number): number {
  return Math.floor(x / TILE) + GW / 2;
}
/** Grid z containing world z. */
export function gzOf(z: number): number {
  return Math.floor(z / TILE) + GH / 2;
}
/** World x of a cell *corner* (grid-line) index. */
export function lx(gx: number): number {
  return (gx - GW / 2) * TILE;
}
/** World z of a cell corner index. */
export function lz(gz: number): number {
  return (gz - GH / 2) * TILE;
}

export type SurfaceKey =
  | 'floorConcrete'
  | 'floorTile'
  | 'floorGrate'
  | 'floorVault'
  | 'floorLobby'
  | 'wallConcrete'
  | 'wallPainted'
  | 'wallTile'
  | 'wallRust'
  | 'wallSeam'
  | 'wallVault'
  | 'ceilPanel'
  | 'ceilConcrete'
  | 'metalDark';

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface RegionDef {
  id: string;
  name: string;
  /** Rectangles carved to floor, inclusive on both ends. */
  carve: Rect[];
  /** Rectangles re-filled as solid after carving (machinery islands, pillars). */
  block?: Rect[];
  ceiling: number;
  floor: SurfaceKey;
  wall: SurfaceKey;
  ceil: SurfaceKey;
  /** Baked ambient term for this region, as an RGB triple in 0..1. */
  ambient: [number, number, number];
  /** Footstep material. */
  step: 'concrete' | 'metal' | 'tile';
}

export const REGIONS: RegionDef[] = [
  {
    id: 'vestibule',
    name: 'Service Vestibule',
    carve: [
      { x0: 37, z0: 47, x1: 40, z1: 50 },
      // The doorway itself. The door leaf blocks it dynamically until unlocked.
      { x0: 38, z0: 46, x1: 39, z1: 46 },
    ],
    ceiling: 3.2,
    floor: 'floorTile',
    wall: 'wallTile',
    ceil: 'ceilPanel',
    ambient: [0.1, 0.09, 0.08],
    step: 'tile',
  },
  {
    id: 'lobby',
    name: 'Reception',
    carve: [{ x0: 30, z0: 37, x1: 47, z1: 45 }],
    ceiling: 4.4,
    floor: 'floorLobby',
    wall: 'wallPainted',
    ceil: 'ceilPanel',
    ambient: [0.1, 0.095, 0.085],
    step: 'tile',
  },
  {
    id: 'records',
    name: 'Records',
    carve: [
      { x0: 18, z0: 39, x1: 28, z1: 45 },
      { x0: 29, z0: 41, x1: 29, z1: 43 },
    ],
    ceiling: 3.4,
    floor: 'floorTile',
    wall: 'wallPainted',
    ceil: 'ceilPanel',
    ambient: [0.07, 0.065, 0.06],
    step: 'tile',
  },
  {
    id: 'corrA',
    name: 'Corridor A',
    carve: [{ x0: 36, z0: 30, x1: 39, z1: 36 }],
    ceiling: 2.9,
    floor: 'floorConcrete',
    wall: 'wallConcrete',
    ceil: 'ceilConcrete',
    ambient: [0.05, 0.06, 0.055],
    step: 'concrete',
  },
  {
    id: 'corrA2',
    name: 'Corridor A2',
    carve: [{ x0: 44, z0: 30, x1: 47, z1: 36 }],
    ceiling: 2.9,
    floor: 'floorConcrete',
    wall: 'wallConcrete',
    ceil: 'ceilConcrete',
    ambient: [0.045, 0.055, 0.05],
    step: 'concrete',
  },
  {
    id: 'generator',
    name: 'Generator Room',
    carve: [{ x0: 28, z0: 16, x1: 50, z1: 29 }],
    block: [
      { x0: 36, z0: 20, x1: 43, z1: 25 },
      { x0: 31, z0: 18, x1: 31, z1: 18 },
      { x0: 47, z0: 18, x1: 47, z1: 18 },
      { x0: 31, z0: 27, x1: 31, z1: 27 },
      { x0: 47, z0: 27, x1: 47, z1: 27 },
    ],
    ceiling: 5.2,
    floor: 'floorGrate',
    wall: 'wallRust',
    ceil: 'ceilConcrete',
    ambient: [0.08, 0.075, 0.06],
    step: 'metal',
  },
  {
    id: 'corrB',
    name: 'Corridor B',
    carve: [{ x0: 20, z0: 21, x1: 28, z1: 24 }],
    ceiling: 2.9,
    floor: 'floorConcrete',
    wall: 'wallConcrete',
    ceil: 'ceilConcrete',
    ambient: [0.05, 0.05, 0.05],
    step: 'concrete',
  },
  {
    id: 'workshop',
    name: 'Workshop',
    carve: [{ x0: 8, z0: 16, x1: 20, z1: 29 }],
    block: [{ x0: 12, z0: 22, x1: 15, z1: 24 }],
    ceiling: 4.0,
    floor: 'floorConcrete',
    wall: 'wallPainted',
    ceil: 'ceilPanel',
    ambient: [0.075, 0.07, 0.06],
    step: 'concrete',
  },
  {
    id: 'mazeConn',
    name: 'Service Stair Head',
    carve: [{ x0: 12, z0: 13, x1: 14, z1: 15 }],
    ceiling: 2.6,
    floor: 'floorGrate',
    wall: 'wallConcrete',
    ceil: 'ceilConcrete',
    ambient: [0.04, 0.042, 0.045],
    step: 'metal',
  },
  {
    id: 'maze',
    name: 'Service Tunnels',
    carve: [
      { x0: 12, z0: 10, x1: 14, z1: 12 }, // A entry hall (locker bank)
      { x0: 3, z0: 10, x1: 14, z1: 11 }, // B west tunnel
      { x0: 3, z0: 6, x1: 6, z1: 11 }, // C pump chamber (clue I)
      { x0: 3, z0: 3, x1: 4, z1: 6 }, // D north-west tunnel
      { x0: 3, z0: 3, x1: 16, z1: 4 }, // E north tunnel (reveal corridor)
      { x0: 9, z0: 4, x1: 10, z1: 10 }, // F mid vertical (loop / escape branch)
      { x0: 16, z0: 3, x1: 17, z1: 9 }, // G east tunnel (false wall at 18,6)
      { x0: 16, z0: 8, x1: 25, z1: 9 }, // H south-east tunnel (clue II opposite)
      { x0: 24, z0: 9, x1: 25, z1: 12 }, // I connector
      { x0: 23, z0: 10, x1: 26, z1: 12 }, // I dead-end sump
      { x0: 24, z0: 4, x1: 25, z1: 9 }, // K north link
      { x0: 24, z0: 3, x1: 29, z1: 4 }, // L north-east tunnel
    ],
    ceiling: 2.6,
    floor: 'floorConcrete',
    wall: 'wallConcrete',
    ceil: 'ceilConcrete',
    ambient: [0.028, 0.03, 0.034],
    step: 'concrete',
  },
  {
    id: 'secret',
    name: 'Sealed Store',
    carve: [{ x0: 19, z0: 5, x1: 22, z1: 7 }],
    ceiling: 2.6,
    floor: 'floorGrate',
    wall: 'wallRust',
    ceil: 'ceilConcrete',
    ambient: [0.045, 0.022, 0.022],
    step: 'metal',
  },
  {
    id: 'vaultCorr',
    name: 'Vault Approach',
    carve: [{ x0: 30, z0: 3, x1: 36, z1: 5 }],
    ceiling: 2.8,
    floor: 'floorTile',
    wall: 'wallVault',
    ceil: 'ceilPanel',
    ambient: [0.035, 0.055, 0.075],
    step: 'tile',
  },
  {
    id: 'vault',
    name: 'Specimen Vault',
    carve: [{ x0: 37, z0: 2, x1: 56, z1: 12 }],
    ceiling: 5.6,
    floor: 'floorVault',
    wall: 'wallVault',
    ceil: 'ceilConcrete',
    ambient: [0.05, 0.08, 0.11],
    step: 'tile',
  },
];

/** The one cell the player can walk through that looks like a wall. */
export const FALSE_WALL = { gx: 18, gz: 6 } as const;
/** Which faces of the false-wall cell get a wall quad drawn across them. */
export const FALSE_WALL_FACES = ['-x', '+x'] as const;

/** Raised dais in the vault; its edges become walkable ramps automatically. */
export const DAIS = { x0: 45, z0: 6, x1: 49, z1: 9, height: 0.6 } as const;

export interface LightDef {
  gx: number;
  gz: number;
  y: number;
  color: [number, number, number];
  range: number;
  intensity: number;
  /** Flicker rate in Hz; 0 for a steady fixture. */
  flicker?: number;
  /** Visible fixture quad drawn at the light position. */
  fixture?: 'strip' | 'bulb' | 'none';
}

export const LIGHTS: LightDef[] = [
  // Vestibule: the only light still on near the front door, plus the exit lamp.
  { gx: 38, gz: 48, y: 3.0, color: [1, 0.92, 0.78], range: 13, intensity: 0.85, fixture: 'strip' },
  { gx: 38, gz: 47, y: 2.5, color: [1, 0.2, 0.2], range: 8, intensity: 0.5, fixture: 'none' },

  // Lobby: four strips, one of them failing.
  { gx: 34, gz: 39, y: 4.2, color: [1, 0.95, 0.84], range: 22, intensity: 0.8, fixture: 'strip' },
  { gx: 43, gz: 39, y: 4.2, color: [1, 0.95, 0.84], range: 22, intensity: 0.8, fixture: 'strip' },
  { gx: 34, gz: 44, y: 4.2, color: [1, 0.93, 0.8], range: 20, intensity: 0.55, flicker: 7.5, fixture: 'strip' },
  { gx: 43, gz: 44, y: 4.2, color: [1, 0.95, 0.84], range: 20, intensity: 0.7, fixture: 'strip' },

  // Records: one dying tube.
  { gx: 22, gz: 41, y: 3.2, color: [0.95, 0.9, 0.78], range: 16, intensity: 0.5, flicker: 3.1, fixture: 'strip' },
  { gx: 26, gz: 44, y: 3.2, color: [0.95, 0.9, 0.78], range: 12, intensity: 0.35, fixture: 'strip' },

  // Corridors in: cold green service lighting.
  { gx: 37, gz: 32, y: 2.7, color: [0.72, 1, 0.8], range: 13, intensity: 0.5, fixture: 'bulb' },
  { gx: 38, gz: 35, y: 2.7, color: [0.72, 1, 0.8], range: 13, intensity: 0.5, fixture: 'bulb' },
  { gx: 45, gz: 33, y: 2.7, color: [0.72, 1, 0.8], range: 13, intensity: 0.42, fixture: 'bulb' },

  // Generator room: tall amber bays. The loudest, brightest room in the game.
  { gx: 31, gz: 17, y: 4.8, color: [1, 0.78, 0.42], range: 26, intensity: 0.85, fixture: 'strip' },
  { gx: 47, gz: 17, y: 4.8, color: [1, 0.78, 0.42], range: 26, intensity: 0.85, fixture: 'strip' },
  { gx: 31, gz: 28, y: 4.8, color: [1, 0.78, 0.42], range: 26, intensity: 0.8, fixture: 'strip' },
  { gx: 47, gz: 28, y: 4.8, color: [1, 0.78, 0.42], range: 26, intensity: 0.8, fixture: 'strip' },
  { gx: 39, gz: 17, y: 4.6, color: [0.8, 1, 0.7], range: 16, intensity: 0.4, flicker: 11, fixture: 'bulb' },
  { gx: 34, gz: 26, y: 2.2, color: [1, 0.45, 0.2], range: 10, intensity: 0.5, fixture: 'none' },

  // Corridor B.
  { gx: 24, gz: 22, y: 2.7, color: [0.8, 0.95, 0.85], range: 14, intensity: 0.45, fixture: 'bulb' },

  // Workshop: work lamps over the benches.
  { gx: 11, gz: 19, y: 3.6, color: [1, 0.96, 0.85], range: 18, intensity: 0.7, fixture: 'strip' },
  { gx: 18, gz: 19, y: 3.6, color: [1, 0.96, 0.85], range: 18, intensity: 0.6, fixture: 'strip' },
  { gx: 14, gz: 27, y: 3.6, color: [1, 0.9, 0.75], range: 16, intensity: 0.5, flicker: 5.3, fixture: 'strip' },

  // Maze connector.
  { gx: 13, gz: 14, y: 2.4, color: [0.9, 0.75, 0.5], range: 11, intensity: 0.45, fixture: 'bulb' },

  // Maze: four weak bulbs, deliberately far apart. Landmarks, not lighting.
  { gx: 13, gz: 11, y: 2.4, color: [1, 0.6, 0.28], range: 13, intensity: 0.55, fixture: 'bulb' },
  { gx: 4, gz: 8, y: 2.4, color: [0.7, 0.85, 0.95], range: 12, intensity: 0.34, flicker: 2.2, fixture: 'bulb' },
  { gx: 16, gz: 8, y: 2.4, color: [0.95, 0.72, 0.4], range: 10, intensity: 0.3, fixture: 'bulb' },
  { gx: 25, gz: 4, y: 2.4, color: [0.8, 0.9, 1], range: 10, intensity: 0.28, flicker: 9, fixture: 'bulb' },
  { gx: 25, gz: 11, y: 2.4, color: [0.9, 0.5, 0.3], range: 9, intensity: 0.22, fixture: 'bulb' },
  // West end of the long north tunnel. This fixture exists so that the first
  // sighting has something to stand in front of: a silhouette at the end of a
  // straight corridor reads, a shape in total darkness does not.
  { gx: 5, gz: 3, y: 2.4, color: [0.74, 0.8, 0.92], range: 16, intensity: 0.5, fixture: 'strip' },

  // Secret store: one dull red emergency lamp.
  { gx: 20, gz: 6, y: 2.3, color: [1, 0.3, 0.26], range: 10, intensity: 0.45, fixture: 'bulb' },

  // Vault approach and chamber: cold blue. Visible from the far end of the maze.
  { gx: 32, gz: 4, y: 2.6, color: [0.5, 0.82, 1], range: 14, intensity: 0.6, fixture: 'strip' },
  { gx: 35, gz: 4, y: 2.6, color: [0.5, 0.82, 1], range: 14, intensity: 0.6, fixture: 'strip' },
  { gx: 40, gz: 4, y: 5.0, color: [0.46, 0.8, 1], range: 26, intensity: 0.7, fixture: 'strip' },
  { gx: 53, gz: 4, y: 5.0, color: [0.46, 0.8, 1], range: 26, intensity: 0.6, fixture: 'strip' },
  { gx: 40, gz: 10, y: 5.0, color: [0.46, 0.8, 1], range: 26, intensity: 0.6, fixture: 'strip' },
  { gx: 53, gz: 10, y: 5.0, color: [0.46, 0.8, 1], range: 26, intensity: 0.6, fixture: 'strip' },
  { gx: 47, gz: 7, y: 2.4, color: [0.35, 0.85, 1], range: 18, intensity: 0.9, fixture: 'none' },
];

/** Where the player starts: the lobby, facing the locked front door. */
export const PLAYER_START = { gx: 38.5, gz: 41.0, yaw: 0 } as const;

/** Diamond pedestal, on the vault dais. */
export const PEDESTAL = { gx: 47.0, gz: 7.5 } as const;

/** Demon patrol ring, in grid coords. Walked in order while unaware. */
export const PATROL: ReadonlyArray<readonly [number, number]> = [
  [13, 11],
  [4, 10],
  [4, 4],
  [13, 4],
  [16, 8],
  [24, 8],
  [25, 4],
  [13, 14],
  [14, 18],
  [10, 27],
  [24, 22],
  [31, 22],
  [33, 28],
  [38, 32],
  [38, 41],
  [45, 42],
  [46, 33],
  [46, 18],
  [33, 18],
];

/**
 * First-reveal staging. When the player, carrying the diamond, reaches the east
 * end of the maze's long north tunnel, the demon appears down the straight
 * corridor roughly 24 units away, standing in front of the one lit fixture at
 * that end so it is unmistakably a figure. It holds still long enough to be
 * read, and the mid-vertical branch at gx 9-10 sits between the two of them,
 * so the player always has a route that is not "straight at it".
 */
export const REVEAL = {
  triggerCells: [
    [14, 3],
    [15, 3],
    [16, 3],
    [14, 4],
    [15, 4],
    [16, 4],
  ] as ReadonlyArray<readonly [number, number]>,
  demonCell: [7, 3] as readonly [number, number],
  /** Seconds the demon holds still and screams before it starts hunting. */
  holdTime: 3.2,
} as const;

/** Front door: the plane the player must cross, and the lock panel position. */
export const FRONT_DOOR = {
  /** Doorway cell inside the wall row between the lobby and the vestibule. */
  cells: [
    [38, 46],
    [39, 46],
  ] as ReadonlyArray<readonly [number, number]>,
  /** World z of the door plane. */
  planeZ: lz(46) + TILE * 0.5,
  /** Crossing this z with the door open finishes the run. */
  thresholdZ: cz(48),
} as const;

/** Where the four blood clues live, as (cell, wall face, numeral). */
export interface ClueAnchor {
  numeral: 'I' | 'II' | 'III' | 'IV';
  gx: number;
  gz: number;
  /** Which wall of that cell the decal is painted on. */
  face: '-x' | '+x' | '-z' | '+z';
  y: number;
  region: string;
  /** Short human description used in the journal and the playtest report. */
  where: string;
}

export const CLUE_ANCHORS: ClueAnchor[] = [
  { numeral: 'I', gx: 3, gz: 7, face: '-x', y: 1.45, region: 'maze', where: 'Pump chamber, west wall' },
  { numeral: 'II', gx: 20, gz: 9, face: '+z', y: 1.45, region: 'maze', where: 'Collapsed shelving, south wall' },
  { numeral: 'III', gx: 8, gz: 20, face: '-x', y: 1.6, region: 'workshop', where: 'Workshop, west wall' },
  { numeral: 'IV', gx: 40, gz: 16, face: '-z', y: 1.8, region: 'generator', where: 'Generator room, north wall' },
];

/** Fog colour and density per region, for the look and for occlusion. */
export const FOG = {
  color: [0.035, 0.04, 0.05] as [number, number, number],
  density: 0.024,
};
