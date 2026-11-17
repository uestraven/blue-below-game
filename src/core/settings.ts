/** Persisted player settings (mouse sensitivity, volumes, invert Y). */

export interface Settings {
  sensitivity: number; // 0.2 .. 3.0, multiplier
  masterVolume: number; // 0 .. 1
  sfxVolume: number; // 0 .. 1
  invertY: boolean;
}

const KEY = 'bluebelow.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  masterVolume: 0.8,
  sfxVolume: 1,
  invertY: false,
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function loadSettings(): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return s;
    const o = JSON.parse(raw) as Partial<Settings>;
    if (typeof o.sensitivity === 'number') s.sensitivity = clamp(o.sensitivity, 0.2, 3);
    if (typeof o.masterVolume === 'number') s.masterVolume = clamp(o.masterVolume, 0, 1);
    if (typeof o.sfxVolume === 'number') s.sfxVolume = clamp(o.sfxVolume, 0, 1);
    if (typeof o.invertY === 'boolean') s.invertY = o.invertY;
  } catch {
    /* storage unavailable; defaults are fine */
  }
  return s;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* non-fatal */
  }
}
