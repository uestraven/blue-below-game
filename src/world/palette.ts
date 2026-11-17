/**
 * The constrained palette. Every procedural texture, decal, prop and ending
 * illustration draws from this list only, which is what keeps the facility
 * reading as one late-90s console product instead of a pile of assets.
 */
export const PAL = {
  black: '#000000',
  ink: '#070a10',
  slate: '#1b2230',
  steel: '#2e3744',
  grey: '#4a545f',
  pale: '#7b8794',
  bone: '#c2bba8',
  white: '#e8e2cf',
  rust: '#6b3a24',
  rustLit: '#9c5a33',
  amber: '#d79a3c',
  amberDim: '#8a5f24',
  moss: '#44583a',
  mossLit: '#5f7a4e',
  blood: '#6d0f12',
  bloodLit: '#a8181c',
  blue: '#39b6e8',
  blueDeep: '#1d4f73',
  blueInk: '#0d2335',
} as const;

export type PaletteKey = keyof typeof PAL;

/** Hex string -> packed 0xRRGGBB, for three.js Color inputs. */
export function hex(k: PaletteKey): number {
  return parseInt(PAL[k].slice(1), 16);
}
