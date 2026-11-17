/**
 * Run state: the per-run generated secrets, the player's progress flags, and
 * the single checkpoint.
 *
 * The four-letter code and the breaker order are derived from one seed, so a
 * retry that restores the checkpoint cannot possibly disagree with the blood
 * letters already painted on the walls - the walls and the lock read the same
 * `clues` object.
 */

import { Rng, freshSeed } from '../core/rng';
import { CURATED_ALPHABET, NUMERAL_ORDER, type NumeralName } from '../world/strokefont';

export const BREAKER_LABELS = ['A1', 'B2', 'C3', 'D4'] as const;
export type BreakerLabel = (typeof BREAKER_LABELS)[number];

/** Counter safe: three fixed modifiers, and the target that needs all three. */
export const SAFE_MODIFIERS = [4, -3, 7] as const;
export const SAFE_TARGET = 8;

export interface Progress {
  diamondTaken: boolean;
  revealPlayed: boolean;
  safeOpen: boolean;
  hasKey: boolean;
  powerRestored: boolean;
  doorUnlocked: boolean;
  footlockerOpen: boolean;
  hasGun: boolean;
  roundSpent: boolean;
  demonDead: boolean;
  noteRead: boolean;
  frontDoorInspected: boolean;
  secretFound: boolean;
  /** Numerals whose blood letter the player has actually looked at. */
  cluesFound: NumeralName[];
  /** Readables the player has opened, for the journal. */
  readSeen: string[];
}

export interface Checkpoint {
  progress: Progress;
  playerX: number;
  playerZ: number;
  playerYaw: number;
  /** Puzzle sub-state captured with the checkpoint. */
  safeSwitches: [boolean, boolean, boolean];
  breakerProgress: number;
  lockEntry: [string, string, string, string];
  elapsed: number;
}

export type Ending = 'ugly' | 'bad' | 'good';

export class RunState {
  readonly seed: number;
  /** The four-letter lock code for this run. */
  readonly code: string;
  /** numeral -> letter. The blood decals are built from exactly this map. */
  readonly clues: Record<NumeralName, string>;
  /** The order the four breakers must be thrown in. */
  readonly breakerOrder: BreakerLabel[];

  progress: Progress = RunState.freshProgress();

  /** Live puzzle state, so reopening a puzzle resumes where it was left. */
  safeSwitches: [boolean, boolean, boolean] = [false, false, false];
  breakerProgress = 0;
  lockEntry: [string, string, string, string] = ['-', '-', '-', '-'];

  checkpoint: Checkpoint | null = null;
  ending: Ending | null = null;
  deaths = 0;
  elapsed = 0;

  constructor(seed = freshSeed()) {
    this.seed = seed >>> 0;
    const rng = new Rng(this.seed);

    const letters = rng.shuffle(CURATED_ALPHABET.split('')).slice(0, 4);
    this.code = letters.join('');
    this.clues = {
      I: letters[0],
      II: letters[1],
      III: letters[2],
      IV: letters[3],
    };
    this.breakerOrder = rng.shuffle([...BREAKER_LABELS]) as BreakerLabel[];
  }

  static freshProgress(): Progress {
    return {
      diamondTaken: false,
      revealPlayed: false,
      safeOpen: false,
      hasKey: false,
      powerRestored: false,
      doorUnlocked: false,
      footlockerOpen: false,
      hasGun: false,
      roundSpent: false,
      demonDead: false,
      noteRead: false,
      frontDoorInspected: false,
      secretFound: false,
      cluesFound: [],
      readSeen: [],
    };
  }

  /** The letter the lock expects at a 1-based position. */
  letterAt(position: number): string {
    return this.clues[NUMERAL_ORDER[position - 1]];
  }

  markClueFound(n: NumeralName): boolean {
    if (this.progress.cluesFound.includes(n)) return false;
    this.progress.cluesFound.push(n);
    this.progress.cluesFound.sort((a, b) => NUMERAL_ORDER.indexOf(a) - NUMERAL_ORDER.indexOf(b));
    return true;
  }

  markRead(id: string): boolean {
    if (this.progress.readSeen.includes(id)) return false;
    this.progress.readSeen.push(id);
    return true;
  }

  /** Saved immediately after the diamond is lifted, before the demon reveal. */
  saveCheckpoint(playerX: number, playerZ: number, playerYaw: number): void {
    this.checkpoint = {
      progress: structuredClone(this.progress),
      playerX,
      playerZ,
      playerYaw,
      safeSwitches: [...this.safeSwitches] as [boolean, boolean, boolean],
      breakerProgress: this.breakerProgress,
      lockEntry: [...this.lockEntry] as [string, string, string, string],
      elapsed: this.elapsed,
    };
  }

  /** Restores everything the checkpoint captured. The run's code never changes. */
  restoreCheckpoint(): Checkpoint | null {
    const cp = this.checkpoint;
    if (!cp) return null;
    this.progress = structuredClone(cp.progress);
    this.safeSwitches = [...cp.safeSwitches] as [boolean, boolean, boolean];
    this.breakerProgress = cp.breakerProgress;
    this.lockEntry = [...cp.lockEntry] as [string, string, string, string];
    this.elapsed = cp.elapsed;
    this.ending = null;
    return cp;
  }

  /** Whether the lock panel will accept input at all. */
  get lockUsable(): boolean {
    return this.progress.powerRestored;
  }

  /** Whether the breaker cabinet can be opened. */
  get breakerUsable(): boolean {
    return this.progress.hasKey;
  }

  /**
   * Extraction gear only comes alive once the player has seen what they are
   * running from. Before that the devices are dead metal with a clear reason.
   */
  get extractionLive(): boolean {
    return this.progress.revealPlayed;
  }
}
