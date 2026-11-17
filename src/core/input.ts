/**
 * Keyboard / mouse input with pointer-lock capture.
 *
 * Two hard requirements from the design:
 *  - `releaseAll()` must drop every held key so entering a puzzle cannot leave
 *    the player drifting while the demon is suspended.
 *  - Focus loss (blur, tab switch, pointer-lock exit) must behave cleanly: it
 *    releases held inputs and reports the capture loss to the game.
 */

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'sprint'
  | 'interact'
  | 'cancel'
  | 'journal'
  | 'flashlight';

const KEY_MAP: Record<string, Action> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  KeyE: 'interact',
  Escape: 'cancel',
  Tab: 'journal',
  KeyF: 'flashlight',
};

export class Input {
  readonly held = new Set<Action>();
  /** Accumulated mouse delta since the last `consumeLook()`. */
  private lookX = 0;
  private lookY = 0;
  private pressQueue: Action[] = [];
  private clickQueue: number[] = [];
  /** When true, movement/look are ignored (puzzle or menu is open). */
  gameplayEnabled = true;

  onCaptureChange: ((captured: boolean) => void) | null = null;
  onBlur: (() => void) | null = null;

  private readonly el: HTMLElement;
  private bound = false;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  attach(): void {
    if (this.bound) return;
    this.bound = true;
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onWindowBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('pointerlockerror', this.onPointerLockError);
    this.el.addEventListener('mousemove', this.onMouseMove);
    this.el.addEventListener('mousedown', this.onMouseDown);
  }

  detach(): void {
    if (!this.bound) return;
    this.bound = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('pointerlockerror', this.onPointerLockError);
    this.el.removeEventListener('mousemove', this.onMouseMove);
    this.el.removeEventListener('mousedown', this.onMouseDown);
  }

  get captured(): boolean {
    return document.pointerLockElement === this.el;
  }

  requestCapture(): void {
    if (this.captured) return;
    const p = this.el.requestPointerLock?.() as unknown as Promise<void> | undefined;
    if (p && typeof p.catch === 'function') p.catch(() => void 0);
  }

  releaseCapture(): void {
    if (this.captured) document.exitPointerLock();
  }

  /** Drop every held key and queued event. Called when a puzzle/menu opens. */
  releaseAll(): void {
    this.held.clear();
    this.pressQueue.length = 0;
    this.clickQueue.length = 0;
    this.lookX = 0;
    this.lookY = 0;
  }

  isHeld(a: Action): boolean {
    return this.gameplayEnabled && this.held.has(a);
  }

  /** One-shot: true at most once per physical press. */
  consumePress(a: Action): boolean {
    const i = this.pressQueue.indexOf(a);
    if (i < 0) return false;
    this.pressQueue.splice(i, 1);
    return true;
  }

  consumeClick(): number | null {
    return this.clickQueue.length ? (this.clickQueue.shift() as number) : null;
  }

  consumeLook(): { x: number; y: number } {
    const r = { x: this.lookX, y: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return r;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const a = KEY_MAP[e.code];
    if (!a) return;
    // Tab and the arrow keys would otherwise scroll / move focus.
    if (e.code === 'Tab' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return;
    this.held.add(a);
    this.pressQueue.push(a);
    if (this.pressQueue.length > 16) this.pressQueue.shift();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const a = KEY_MAP[e.code];
    if (a) this.held.delete(a);
  };

  private onWindowBlur = (): void => {
    this.releaseAll();
    this.onBlur?.();
  };

  private onVisibility = (): void => {
    if (document.hidden) {
      this.releaseAll();
      this.onBlur?.();
    }
  };

  private onPointerLockChange = (): void => {
    const captured = this.captured;
    if (!captured) this.releaseAll();
    this.onCaptureChange?.(captured);
  };

  private onPointerLockError = (): void => {
    this.releaseAll();
    this.onCaptureChange?.(false);
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.captured || !this.gameplayEnabled) return;
    // Guard against the single huge delta some browsers emit on re-capture.
    const dx = Math.abs(e.movementX) > 200 ? 0 : e.movementX;
    const dy = Math.abs(e.movementY) > 200 ? 0 : e.movementY;
    this.lookX += dx;
    this.lookY += dy;
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.captured || !this.gameplayEnabled) return;
    this.clickQueue.push(e.button);
    if (this.clickQueue.length > 4) this.clickQueue.shift();
  };
}
