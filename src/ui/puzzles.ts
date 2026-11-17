/**
 * The three extraction puzzles.
 *
 * Each one runs in a dedicated interaction mode. While it is open the demon is
 * suspended, the player cannot move, and the view is locked to the device, so
 * nothing can creep up during a puzzle and nothing about the puzzle depends on
 * reflexes. Every panel can be backed out of with Esc, and every wrong input
 * is recoverable in place.
 *
 * Input is keyboard-and-click without releasing the mouse capture: moving the
 * mouse or pressing A/D moves the selection, left click or E/Enter actuates.
 * Keeping pointer lock through a puzzle is what makes "controls resume
 * correctly" reliable rather than dependent on browser pointer-lock cooldowns.
 */

import type { RunState } from '../game/state';
import { SAFE_MODIFIERS, SAFE_TARGET, BREAKER_LABELS } from '../game/state';
import { CURATED_ALPHABET } from '../world/strokefont';
import type { SfxName } from '../core/audio';

export type PuzzleKind = 'safe' | 'breaker' | 'lock';

export interface PuzzleHostCallbacks {
  /** Player backed out (Esc or BACK). */
  onClose(): void;
  /** Puzzle completed successfully. */
  onSolved(kind: PuzzleKind): void;
  sfx(name: SfxName): void;
}

interface Control {
  id: string;
  el: HTMLDivElement;
  type: 'toggle' | 'wheel' | 'action';
  index: number;
  action?: 'submit' | 'reset' | 'back';
  locked?: boolean;
}

export class PuzzleHost {
  private readonly parent: HTMLElement;
  private readonly run: RunState;
  private readonly cb: PuzzleHostCallbacks;

  private wrap: HTMLDivElement | null = null;
  private device: HTMLDivElement | null = null;
  private msgEl: HTMLDivElement | null = null;
  private controls: Control[] = [];
  private sel = 0;
  private mouseAccum = 0;
  private faultFlash = 0;
  /** Pending success callback, cancelled if the panel closes first. */
  private solveTimer: number | null = null;

  kind: PuzzleKind | null = null;

  constructor(parent: HTMLElement, run: RunState, cb: PuzzleHostCallbacks) {
    this.parent = parent;
    this.run = run;
    this.cb = cb;
  }

  get open(): boolean {
    return this.kind !== null;
  }

  openPuzzle(kind: PuzzleKind): void {
    if (this.kind) this.closePuzzle(false);
    this.kind = kind;
    this.sel = 0;
    this.mouseAccum = 0;
    this.faultFlash = 0;

    this.wrap = document.createElement('div');
    this.wrap.className = 'puzzle';
    this.device = document.createElement('div');
    this.device.className = 'device';
    this.wrap.appendChild(this.device);
    this.parent.appendChild(this.wrap);

    this.render();

    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('mousemove', this.onMouseMove, true);
    window.addEventListener('mousedown', this.onMouseDown, true);
  }

  closePuzzle(notify = true): void {
    if (!this.kind) return;
    if (this.solveTimer !== null) {
      window.clearTimeout(this.solveTimer);
      this.solveTimer = null;
    }
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('mousemove', this.onMouseMove, true);
    window.removeEventListener('mousedown', this.onMouseDown, true);
    this.wrap?.remove();
    this.wrap = null;
    this.device = null;
    this.msgEl = null;
    this.controls = [];
    this.kind = null;
    if (notify) this.cb.onClose();
  }

  // ------------------------------------------------------------------ input

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.kind) return;
    let handled = true;
    switch (e.code) {
      case 'Escape':
        this.cb.sfx('beep');
        this.closePuzzle();
        break;
      case 'ArrowLeft':
      case 'KeyA':
        this.moveSel(-1);
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.moveSel(1);
        break;
      case 'ArrowUp':
      case 'KeyW':
        this.nudge(1);
        break;
      case 'ArrowDown':
      case 'KeyS':
        this.nudge(-1);
        break;
      case 'Enter':
      case 'Space':
      case 'KeyE':
        this.actuate();
        break;
      case 'KeyR':
        this.resetInputs();
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.kind) return;
    const dx = Math.abs(e.movementX) > 200 ? 0 : e.movementX;
    this.mouseAccum += dx;
    const stepPx = 110;
    while (this.mouseAccum > stepPx) {
      this.mouseAccum -= stepPx;
      this.moveSel(1);
    }
    while (this.mouseAccum < -stepPx) {
      this.mouseAccum += stepPx;
      this.moveSel(-1);
    }
    e.stopPropagation();
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.kind) return;
    // A click on a control selects and actuates it; a click anywhere else
    // actuates the current selection.
    const target = (e.target as HTMLElement | null)?.closest('.ctl') as HTMLElement | null;
    if (target) {
      const i = this.controls.findIndex((c) => c.el === target);
      if (i >= 0) this.sel = i;
    }
    if (e.button === 0) this.actuate();
    e.preventDefault();
    e.stopPropagation();
  };

  private moveSel(dir: number): void {
    if (!this.controls.length) return;
    const n = this.controls.length;
    let i = this.sel;
    for (let guard = 0; guard < n; guard++) {
      i = (i + dir + n) % n;
      if (!this.controls[i].locked) break;
    }
    if (i !== this.sel) {
      this.sel = i;
      this.cb.sfx('beep');
    }
    this.refreshSelection();
  }

  private nudge(dir: number): void {
    const c = this.controls[this.sel];
    if (!c || c.locked) return;
    if (this.kind === 'lock' && c.type === 'wheel') {
      this.cycleWheel(c.index, dir);
    } else {
      this.actuate();
    }
  }

  private resetInputs(): void {
    if (this.kind === 'safe') {
      this.run.safeSwitches = [false, false, false];
      this.cb.sfx('switch');
      this.setMessage('COUNTER CLEARED. TOTAL 0.', '');
      this.render();
    } else if (this.kind === 'lock') {
      this.run.lockEntry = ['-', '-', '-', '-'];
      this.cb.sfx('switch');
      this.setMessage('WHEELS CLEARED.', '');
      this.render();
    } else if (this.kind === 'breaker') {
      this.run.breakerProgress = 0;
      this.cb.sfx('switch');
      this.setMessage('SEQUENCE CLEARED.', '');
      this.render();
    }
  }

  private actuate(): void {
    const c = this.controls[this.sel];
    if (!c) return;
    if (c.locked) {
      this.cb.sfx('denied');
      this.setMessage('THAT CONTROL IS DEAD.', 'bad');
      return;
    }
    if (c.action === 'back') {
      this.cb.sfx('beep');
      this.closePuzzle();
      return;
    }
    if (c.action === 'reset') {
      this.resetInputs();
      return;
    }
    switch (this.kind) {
      case 'safe':
        if (c.type === 'toggle') this.toggleSafe(c.index);
        else if (c.action === 'submit') this.submitSafe();
        break;
      case 'breaker':
        if (c.type === 'toggle') this.pressBreaker(c.index);
        break;
      case 'lock':
        if (c.type === 'wheel') this.cycleWheel(c.index, 1);
        else if (c.action === 'submit') this.submitLock();
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------- safe (puzzle 1)

  private get safeTotal(): number {
    let t = 0;
    for (let i = 0; i < 3; i++) if (this.run.safeSwitches[i]) t += SAFE_MODIFIERS[i];
    return t;
  }

  private toggleSafe(i: number): void {
    this.faultFlash = 0;
    this.run.safeSwitches[i] = !this.run.safeSwitches[i];
    this.cb.sfx('switch');
    const mod = SAFE_MODIFIERS[i];
    const verb = this.run.safeSwitches[i] ? 'ADDED' : 'REMOVED';
    this.setMessage(`${verb} ${mod > 0 ? '+' : ''}${mod}. TOTAL ${this.safeTotal}.`, '');
    this.render();
  }

  private submitSafe(): void {
    const total = this.safeTotal;
    if (total === SAFE_TARGET) {
      this.cb.sfx('latch');
      this.setMessage(`TOTAL ${total} MATCHES TARGET ${SAFE_TARGET}. BOLTS CLEAR.`, 'ok');
      this.render();
      this.solveTimer = window.setTimeout(() => {
        this.solveTimer = null;
        if (this.kind === 'safe') this.cb.onSolved('safe');
      }, 650);
    } else {
      this.cb.sfx('denied');
      this.faultFlash = 1;
      this.setMessage(`TOTAL ${total} DOES NOT MATCH TARGET ${SAFE_TARGET}. REJECTED.`, 'bad');
      this.render();
    }
  }

  // ------------------------------------------------------- breaker (puzzle 2)

  private pressBreaker(i: number): void {
    const label = BREAKER_LABELS[i];
    const expected = this.run.breakerOrder[this.run.breakerProgress];
    if (label === expected) {
      this.faultFlash = 0;
      this.run.breakerProgress++;
      this.cb.sfx('relay');
      if (this.run.breakerProgress >= 4) {
        this.setMessage('PANEL ENERGISED. EXIT LATCH RELEASED.', 'ok');
        this.render();
        this.solveTimer = window.setTimeout(() => {
          this.solveTimer = null;
          if (this.kind === 'breaker') this.cb.onSolved('breaker');
        }, 800);
        return;
      }
      this.setMessage(`${label} CLOSED. ${this.run.breakerProgress} OF 4.`, 'ok');
    } else {
      this.run.breakerProgress = 0;
      this.faultFlash = 1;
      this.cb.sfx('denied');
      this.setMessage(`${label} OUT OF ORDER. PANEL TRIPPED - SEQUENCE RESET TO 1 OF 4.`, 'bad');
    }
    this.render();
  }

  // ---------------------------------------------------------- lock (puzzle 3)

  private cycleWheel(i: number, dir: number): void {
    this.faultFlash = 0;
    const cur = this.run.lockEntry[i];
    const alpha = CURATED_ALPHABET;
    let next: string;
    if (cur === '-') {
      next = dir > 0 ? alpha[0] : alpha[alpha.length - 1];
    } else {
      const at = alpha.indexOf(cur);
      const ni = at + dir;
      next = ni < 0 ? '-' : ni >= alpha.length ? '-' : alpha[ni];
    }
    this.run.lockEntry[i] = next;
    this.cb.sfx('switch');
    this.setMessage(`WHEEL ${['I', 'II', 'III', 'IV'][i]} -> ${next}`, '');
    this.render();
  }

  private submitLock(): void {
    const entry = this.run.lockEntry.join('');
    if (entry.includes('-')) {
      this.cb.sfx('denied');
      this.setMessage('ALL FOUR WHEELS MUST BE SET.', 'bad');
      return;
    }
    if (entry === this.run.code) {
      this.cb.sfx('latch');
      this.setMessage(`${entry} ACCEPTED. DOOR RELEASED.`, 'ok');
      this.render();
      this.solveTimer = window.setTimeout(() => {
        this.solveTimer = null;
        if (this.kind === 'lock') this.cb.onSolved('lock');
      }, 700);
    } else {
      this.cb.sfx('denied');
      this.faultFlash = 1;
      this.setMessage(`${entry} REJECTED. WHEELS HELD - ADJUST AND TRY AGAIN.`, 'bad');
      this.render();
    }
  }

  // ----------------------------------------------------------------- render

  private setMessage(text: string, cls: string): void {
    if (this.msgEl) {
      this.msgEl.textContent = text;
      this.msgEl.className = `msg ${cls}`.trim();
    }
    this.pendingMessage = { text, cls };
  }

  private pendingMessage: { text: string; cls: string } | null = null;

  private refreshSelection(): void {
    for (let i = 0; i < this.controls.length; i++) {
      const c = this.controls[i];
      c.el.classList.toggle('sel', i === this.sel);
    }
  }

  private render(): void {
    const d = this.device;
    if (!d || !this.kind) return;
    d.innerHTML = '';
    this.controls = [];

    const header = document.createElement('header');
    const h2 = document.createElement('h2');
    const tag = document.createElement('span');
    tag.className = 'tag';
    header.appendChild(h2);
    header.appendChild(tag);
    d.appendChild(header);

    if (this.kind === 'safe') {
      h2.textContent = 'COUNTER SAFE';
      tag.textContent = 'WORKSHOP / UNIT 2';
      this.renderSafe(d);
    } else if (this.kind === 'breaker') {
      h2.textContent = 'MAIN BREAKER PANEL';
      tag.textContent = 'GENERATOR ROOM';
      this.renderBreaker(d);
    } else {
      h2.textContent = 'EXIT DOOR CONTROL';
      tag.textContent = 'SERVICE ENTRANCE';
      this.renderLock(d);
    }

    this.msgEl = document.createElement('div');
    this.msgEl.className = 'msg';
    if (this.pendingMessage) {
      this.msgEl.textContent = this.pendingMessage.text;
      this.msgEl.className = `msg ${this.pendingMessage.cls}`.trim();
    }
    d.appendChild(this.msgEl);

    const frozen = document.createElement('div');
    frozen.className = 'frozen';
    frozen.textContent = 'WHILE YOU WORK, THE BUILDING IS STILL.';
    d.appendChild(frozen);

    const footer = document.createElement('footer');
    const keys = ['MOUSE or A/D : SELECT', 'CLICK or E : ACTUATE'];
    if (this.kind === 'lock') keys.push('W/S : TURN WHEEL');
    if (this.kind !== 'breaker') keys.push('R : RESET');
    keys.push('ESC : STEP BACK');
    footer.textContent = keys.join('   \u00b7   ');
    d.appendChild(footer);

    this.refreshSelection();
  }

  private addControl(
    row: HTMLDivElement,
    opts: {
      id: string;
      type: Control['type'];
      index: number;
      name: string;
      state?: string;
      on?: boolean;
      action?: Control['action'];
      locked?: boolean;
      wheel?: boolean;
    },
  ): void {
    const el = document.createElement('div');
    el.className = 'ctl';
    if (opts.type === 'action') el.classList.add('action');
    if (opts.wheel) el.classList.add('wheel');
    if (opts.on) el.classList.add('on');
    if (opts.locked) el.classList.add('locked');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = opts.name;
    el.appendChild(name);
    if (opts.state !== undefined) {
      const st = document.createElement('div');
      st.className = 'state';
      st.textContent = opts.state;
      el.appendChild(st);
    }
    row.appendChild(el);
    this.controls.push({
      id: opts.id,
      el,
      type: opts.type,
      index: opts.index,
      action: opts.action,
      locked: opts.locked,
    });
  }

  private renderSafe(d: HTMLDivElement): void {
    const total = this.safeTotal;
    const readout = document.createElement('div');
    readout.className = 'readout';
    readout.appendChild(
      cell('CURRENT TOTAL', String(total), total === SAFE_TARGET ? 'ok' : this.faultFlash ? 'bad' : ''),
    );
    readout.appendChild(cell('TARGET', String(SAFE_TARGET), 'target'));
    d.appendChild(readout);

    const row = document.createElement('div');
    row.className = 'controls-row';
    for (let i = 0; i < 3; i++) {
      const mod = SAFE_MODIFIERS[i];
      this.addControl(row, {
        id: `sw${i}`,
        type: 'toggle',
        index: i,
        name: `${mod > 0 ? '+' : ''}${mod}`,
        state: this.run.safeSwitches[i] ? 'ON' : 'OFF',
        on: this.run.safeSwitches[i],
      });
    }
    d.appendChild(row);

    const row2 = document.createElement('div');
    row2.className = 'controls-row';
    this.addControl(row2, { id: 'reset', type: 'action', index: 0, name: 'RESET', state: 'ALL OFF', action: 'reset' });
    this.addControl(row2, { id: 'submit', type: 'action', index: 0, name: 'SUBMIT', state: 'TRY TOTAL', action: 'submit' });
    this.addControl(row2, { id: 'back', type: 'action', index: 0, name: 'BACK', state: 'STEP AWAY', action: 'back' });
    d.appendChild(row2);
  }

  private renderBreaker(d: HTMLDivElement): void {
    const bar = document.createElement('div');
    bar.className = this.faultFlash ? 'seqbar fault' : 'seqbar';
    for (let i = 0; i < 4; i++) {
      const slot = document.createElement('div');
      slot.className = i < this.run.breakerProgress ? 'slot done' : 'slot';
      slot.textContent = i < this.run.breakerProgress ? this.run.breakerOrder[i] : `${i + 1}`;
      bar.appendChild(slot);
    }
    d.appendChild(bar);

    const readout = document.createElement('div');
    readout.className = 'readout';
    readout.appendChild(cell('SEQUENCE', `${this.run.breakerProgress} / 4`, this.run.breakerProgress > 0 ? 'ok' : ''));
    readout.appendChild(cell('BUS', this.run.breakerProgress >= 4 ? 'LIVE' : 'OPEN', this.run.breakerProgress >= 4 ? 'ok' : 'bad'));
    d.appendChild(readout);

    const row = document.createElement('div');
    row.className = 'controls-row';
    for (let i = 0; i < 4; i++) {
      const label = BREAKER_LABELS[i];
      const thrown = this.run.breakerOrder.indexOf(label) < this.run.breakerProgress;
      this.addControl(row, {
        id: `br${i}`,
        type: 'toggle',
        index: i,
        name: label,
        state: thrown ? 'CLOSED' : 'OPEN',
        on: thrown,
      });
    }
    d.appendChild(row);

    const row2 = document.createElement('div');
    row2.className = 'controls-row';
    this.addControl(row2, { id: 'back', type: 'action', index: 0, name: 'BACK', state: 'STEP AWAY', action: 'back' });
    d.appendChild(row2);
  }

  private renderLock(d: HTMLDivElement): void {
    const readout = document.createElement('div');
    readout.className = 'readout';
    readout.appendChild(cell('POWERED LATCH', this.run.progress.powerRestored ? 'RELEASED' : 'ENGAGED', this.run.progress.powerRestored ? 'ok' : 'bad'));
    readout.appendChild(cell('ENTRY', this.run.lockEntry.join(' '), ''));
    d.appendChild(readout);

    const row = document.createElement('div');
    row.className = 'controls-row';
    for (let i = 0; i < 4; i++) {
      this.addControl(row, {
        id: `wh${i}`,
        type: 'wheel',
        index: i,
        name: this.run.lockEntry[i],
        state: ['I', 'II', 'III', 'IV'][i],
        wheel: true,
      });
    }
    d.appendChild(row);

    const row2 = document.createElement('div');
    row2.className = 'controls-row';
    this.addControl(row2, { id: 'reset', type: 'action', index: 0, name: 'CLEAR', state: 'ALL WHEELS', action: 'reset' });
    this.addControl(row2, { id: 'submit', type: 'action', index: 0, name: 'SUBMIT', state: 'TRY CODE', action: 'submit' });
    this.addControl(row2, { id: 'back', type: 'action', index: 0, name: 'BACK', state: 'STEP AWAY', action: 'back' });
    d.appendChild(row2);
  }
}

function cell(cap: string, big: string, cls: string): HTMLDivElement {
  const c = document.createElement('div');
  c.className = `cell ${cls}`.trim();
  const a = document.createElement('div');
  a.className = 'cap';
  a.textContent = cap;
  const b = document.createElement('div');
  b.className = 'big';
  b.textContent = big;
  c.appendChild(a);
  c.appendChild(b);
  return c;
}
