/**
 * A hand-authored stroke font used for the blood-painted wall letters and the
 * Roman numerals beside them. These are drawn from explicit polylines rather
 * than a system font so the clues are guaranteed chunky and legible at the
 * game's low internal resolution, on any machine, with no font dependency.
 *
 * Coordinates are in a 0..1 box, x right, y down.
 */

export type Polyline = ReadonlyArray<readonly [number, number]>;

/**
 * Curated alphabet for the four-letter lock. Deliberately excludes I, O, Q and
 * Z: at 320x224 with blood-painted strokes they read as 1, 0, 0 and 2.
 */
export const CURATED_ALPHABET = 'ABCDEFGHJKLMNPRSTUVWXY';

export const GLYPHS: Record<string, readonly Polyline[]> = {
  A: [
    [[0, 1], [0.5, 0], [1, 1]],
    [[0.18, 0.62], [0.82, 0.62]],
  ],
  B: [
    [[0, 0], [0, 1]],
    [[0, 0], [0.7, 0], [0.95, 0.2], [0.7, 0.48], [0, 0.48]],
    [[0, 0.48], [0.75, 0.48], [1, 0.74], [0.75, 1], [0, 1]],
  ],
  C: [[[1, 0.18], [0.7, 0], [0.3, 0], [0, 0.3], [0, 0.7], [0.3, 1], [0.7, 1], [1, 0.82]]],
  D: [
    [[0, 0], [0, 1]],
    [[0, 0], [0.6, 0], [1, 0.4], [1, 0.6], [0.6, 1], [0, 1]],
  ],
  E: [
    [[1, 0], [0, 0], [0, 1], [1, 1]],
    [[0, 0.5], [0.8, 0.5]],
  ],
  F: [
    [[1, 0], [0, 0], [0, 1]],
    [[0, 0.5], [0.75, 0.5]],
  ],
  G: [[[1, 0.18], [0.7, 0], [0.3, 0], [0, 0.3], [0, 0.7], [0.3, 1], [0.75, 1], [1, 0.75], [1, 0.55], [0.55, 0.55]]],
  H: [
    [[0, 0], [0, 1]],
    [[1, 0], [1, 1]],
    [[0, 0.5], [1, 0.5]],
  ],
  J: [[[0.8, 0], [0.8, 0.75], [0.5, 1], [0.2, 1], [0, 0.78]]],
  K: [
    [[0, 0], [0, 1]],
    [[1, 0], [0, 0.52]],
    [[0.1, 0.45], [1, 1]],
  ],
  L: [[[0, 0], [0, 1], [1, 1]]],
  M: [[[0, 1], [0, 0], [0.5, 0.55], [1, 0], [1, 1]]],
  N: [[[0, 1], [0, 0], [1, 1], [1, 0]]],
  P: [
    [[0, 1], [0, 0], [0.72, 0], [1, 0.26], [0.72, 0.52], [0, 0.52]],
  ],
  R: [
    [[0, 1], [0, 0], [0.72, 0], [1, 0.26], [0.72, 0.52], [0, 0.52]],
    [[0.45, 0.52], [1, 1]],
  ],
  S: [[[1, 0.16], [0.7, 0], [0.28, 0], [0, 0.26], [0.3, 0.5], [0.7, 0.5], [1, 0.74], [0.72, 1], [0.3, 1], [0, 0.84]]],
  T: [
    [[0, 0], [1, 0]],
    [[0.5, 0], [0.5, 1]],
  ],
  U: [[[0, 0], [0, 0.7], [0.3, 1], [0.7, 1], [1, 0.7], [1, 0]]],
  V: [[[0, 0], [0.5, 1], [1, 0]]],
  W: [[[0, 0], [0.22, 1], [0.5, 0.4], [0.78, 1], [1, 0]]],
  X: [
    [[0, 0], [1, 1]],
    [[1, 0], [0, 1]],
  ],
  Y: [
    [[0, 0], [0.5, 0.52], [1, 0]],
    [[0.5, 0.52], [0.5, 1]],
  ],
};

/** Roman numerals I..IV, each already laid out inside its own 0..1 box. */
export const NUMERALS: Record<string, readonly Polyline[]> = {
  I: bar(0.5),
  II: [...bar(0.32), ...bar(0.68)],
  III: [...bar(0.2), ...bar(0.5), ...bar(0.8)],
  IV: [
    ...bar(0.16),
    [[0.38, 0], [0.63, 1], [0.88, 0]],
  ],
};

/** One serifed vertical numeral bar centred on `x`. */
function bar(x: number): Polyline[] {
  const w = 0.1;
  return [
    [[x, 0], [x, 1]],
    [[x - w, 0], [x + w, 0]],
    [[x - w, 1], [x + w, 1]],
  ];
}

export const NUMERAL_ORDER = ['I', 'II', 'III', 'IV'] as const;
export type NumeralName = (typeof NUMERAL_ORDER)[number];
