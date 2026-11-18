/**
 * Full-screen interface states: title, briefing, readables, the diamond
 * decision, pause, controls, settings, the clue journal, the death screen and
 * the three endings.
 *
 * Navigation deliberately matches the puzzle panels - mouse movement or W/S
 * moves the selection, click or Enter confirms - so pointer capture is never
 * dropped and re-acquired mid-run.
 */

import type { Settings } from '../core/settings';
import type { RunState } from '../game/state';
import { NUMERAL_ORDER } from '../world/strokefont';
import { CLUE_ANCHORS } from '../world/layout';
import { drawEndingArt, type EndingArt } from './endingart';
import type { SfxName } from '../core/audio';

export interface Choice {
  label: string;
  note?: string;
  danger?: boolean;
  onPick?: () => void;
  /** Present on slider rows; left/right adjusts. */
  adjust?: (dir: number) => void;
}

export interface ScreenSpec {
  id: string;
  html: string;
  choices: Choice[];
  transparent?: boolean;
  wide?: boolean;
  onEscape?: () => void;
}

export class ScreenHost {
  private readonly parent: HTMLElement;
  private readonly sfx: (n: SfxName) => void;
  private el: HTMLDivElement | null = null;
  private spec: (() => ScreenSpec) | null = null;
  private current: ScreenSpec | null = null;
  private choiceEls: HTMLButtonElement[] = [];
  private sel = 0;
  private mouseAccum = 0;

  constructor(parent: HTMLElement, sfx: (n: SfxName) => void) {
    this.parent = parent;
    this.sfx = sfx;
  }

  get open(): boolean {
    return this.el !== null;
  }

  get id(): string | null {
    return this.current?.id ?? null;
  }

  show(spec: () => ScreenSpec, keepSelection = false): void {
    const prevSel = keepSelection ? this.sel : 0;
    this.closeInternal();
    this.spec = spec;
    this.sel = prevSel;
    this.el = document.createElement('div');
    this.parent.appendChild(this.el);
    this.render();
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('mousemove', this.onMouseMove, true);
    window.addEventListener('mousedown', this.onMouseDown, true);
  }

  /** Re-render the current screen (after a settings change). */
  refresh(): void {
    if (this.spec) this.render();
  }

  close(): void {
    this.closeInternal();
  }

  private closeInternal(): void {
    if (!this.el) return;
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('mousemove', this.onMouseMove, true);
    window.removeEventListener('mousedown', this.onMouseDown, true);
    this.el.remove();
    this.el = null;
    this.spec = null;
    this.current = null;
    this.choiceEls = [];
  }

  private render(): void {
    if (!this.el || !this.spec) return;
    const s = this.spec();
    this.current = s;
    this.el.className = `screen${s.transparent ? ' transparent' : ''}`;
    this.el.innerHTML = '';

    const panel = document.createElement('div');
    panel.className = `panel${s.wide ? ' wide' : ''}`;
    panel.innerHTML = s.html;
    this.el.appendChild(panel);

    const box = document.createElement('div');
    box.className = 'choices stack';
    this.choiceEls = [];
    if (this.sel >= s.choices.length) this.sel = Math.max(0, s.choices.length - 1);
    for (let i = 0; i < s.choices.length; i++) {
      const c = s.choices[i];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn${c.danger ? ' danger' : ''}`;
      b.innerHTML = `${escapeHtml(c.label)}${c.note ? `<span class="note">${escapeHtml(c.note)}</span>` : ''}`;
      box.appendChild(b);
      this.choiceEls.push(b);
    }
    panel.appendChild(box);
    this.highlight();
  }

  private highlight(): void {
    for (let i = 0; i < this.choiceEls.length; i++) {
      this.choiceEls[i].classList.toggle('sel', i === this.sel);
    }
  }

  private move(dir: number): void {
    const n = this.choiceEls.length;
    if (n < 2) return;
    this.sel = (this.sel + dir + n) % n;
    this.sfx('beep');
    this.highlight();
  }

  private confirm(): void {
    const c = this.current?.choices[this.sel];
    if (!c) return;
    this.sfx('accept');
    c.onPick?.();
  }

  private adjust(dir: number): void {
    const c = this.current?.choices[this.sel];
    if (!c?.adjust) {
      this.move(dir);
      return;
    }
    c.adjust(dir);
    this.sfx('beep');
    this.render();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.el) return;
    let handled = true;
    switch (e.code) {
      case 'ArrowUp':
      case 'KeyW':
        this.move(-1);
        break;
      case 'ArrowDown':
      case 'KeyS':
        this.move(1);
        break;
      case 'ArrowLeft':
      case 'KeyA':
        this.adjust(-1);
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.adjust(1);
        break;
      case 'Enter':
      case 'Space':
      case 'KeyE':
        this.confirm();
        break;
      case 'Escape':
        if (this.current?.onEscape) this.current.onEscape();
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
    if (!this.el) return;
    const dy = Math.abs(e.movementY) > 200 ? 0 : e.movementY;
    this.mouseAccum += dy;
    const step = 90;
    while (this.mouseAccum > step) {
      this.mouseAccum -= step;
      this.move(1);
    }
    while (this.mouseAccum < -step) {
      this.mouseAccum += step;
      this.move(-1);
    }
    e.stopPropagation();
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.el) return;
    const t = (e.target as HTMLElement | null)?.closest('.btn') as HTMLElement | null;
    if (t) {
      const i = this.choiceEls.indexOf(t as HTMLButtonElement);
      if (i >= 0) {
        this.sel = i;
        this.highlight();
      }
    }
    if (e.button === 0) this.confirm();
    e.preventDefault();
    e.stopPropagation();
  };
}

// ======================================================================
// Screen definitions
// ======================================================================

export const BRIEFING_TEXT =
  'Your client paid for a blue diamond. They gave you a service entrance, a ' +
  'floor plan that ends halfway through the building, and one instruction: ' +
  'bring it back intact. The facility went dark three nights ago. Your contact ' +
  "hasn't answered since.";

export const VAULT_NOTE_TEXT = [
  'They told me the blue stone was a sample. I signed the inventory myself.',
  'But every time they lifted it, something knocked from inside the walls.',
  'If you take it, it will follow you out. I know what that sounds like.',
  'I signed the inventory anyway.',
];

export function titleScreen(opts: {
  onStart: () => void;
  onControls: () => void;
  onSettings: () => void;
}): ScreenSpec {
  return {
    id: 'title',
    html: `
      <h1>BLUE BELOW</h1>
      <p class="sub">A JOB. A STONE. THE THING THAT OWNS IT.</p>
      <p>Somewhere under this building there is a blue diamond on a pedestal,
      and a note from the last person who signed for it.</p>
      <p class="hint">MOUSE OR W / S TO SELECT &nbsp;&middot;&nbsp; CLICK OR ENTER TO CONFIRM</p>
    `,
    choices: [
      { label: 'TAKE THE JOB', note: 'Start a new run. A new door code is generated.', onPick: opts.onStart },
      { label: 'CONTROLS', onPick: opts.onControls },
      { label: 'SETTINGS', onPick: opts.onSettings },
    ],
  };
}

export function briefingScreen(onBegin: () => void): ScreenSpec {
  return {
    id: 'briefing',
    html: `
      <h2>The Job</h2>
      <p class="quote">${escapeHtml(BRIEFING_TEXT)}</p>
      <p>You are already inside. The service entrance locked behind you.</p>
      <p class="hint">The front door has a powered release and a four letter lock.
      Have a look at it before you go anywhere.</p>
      <p class="hint"><strong>W A S D</strong> to move, <strong>MOUSE</strong> to look,
      <strong>SHIFT</strong> to run, <strong>E</strong> to use anything.
      Full controls are on the pause screen.</p>
    `,
    choices: [{ label: 'GO IN', onPick: onBegin }],
  };
}

export function controlsScreen(onBack: () => void, inRun: boolean): ScreenSpec {
  return {
    id: 'controls',
    wide: true,
    transparent: inRun,
    html: `
      <h2>Controls</h2>
      <div class="kv">
        <div class="k">W A S D</div><div class="v">Move</div>
        <div class="k">MOUSE</div><div class="v">Look, and aim the gun once you have it</div>
        <div class="k">SHIFT</div><div class="v">Sprint. Finite, and the loudest thing you can do</div>
        <div class="k">E</div><div class="v">Interact: read, use a device, pick something up</div>
        <div class="k">LEFT CLICK</div><div class="v">Fire a flare, once you have the signal pistol</div>
        <div class="k">ESC</div><div class="v">Close an interaction, or pause while exploring</div>
        <div class="k">TAB</div><div class="v">Clue journal (also on the pause screen)</div>
      </div>
      <h2 style="margin-top:26px">Inside a device panel</h2>
      <div class="kv">
        <div class="k">MOUSE / A D</div><div class="v">Move the selection</div>
        <div class="k">CLICK / E / ENTER</div><div class="v">Actuate the selected control</div>
        <div class="k">W S</div><div class="v">Turn a letter wheel on the door lock</div>
        <div class="k">R</div><div class="v">Reset the counter or clear the wheels</div>
        <div class="k">ESC</div><div class="v">Step back from the device</div>
      </div>
      <p class="hint">Opening a device panel holds the building still. Nothing can
      reach you while a panel is open, and you cannot move until you step back.</p>
    `,
    choices: [{ label: 'BACK', onPick: onBack }],
    onEscape: onBack,
  };
}

export function settingsScreen(
  settings: Settings,
  onChange: () => void,
  onBack: () => void,
  inRun: boolean,
): ScreenSpec {
  const bar = (v: number): string => {
    const pct = Math.round(v * 100);
    return `<span class="slider"><span class="bar"><i style="width:${pct}%"></i></span><span>${pct}%</span></span>`;
  };
  return {
    id: 'settings',
    transparent: inRun,
    html: `
      <h2>Settings</h2>
      <p class="hint">Select a row, then use A / D or the left and right arrows.</p>
      <div class="rows">
        <div class="label">MOUSE SENSITIVITY</div>
        <div class="value">${bar((settings.sensitivity - 0.2) / 2.8)} &nbsp;x${settings.sensitivity.toFixed(2)}</div>
        <div class="label">MASTER VOLUME</div>
        <div class="value">${bar(settings.masterVolume)}</div>
        <div class="label">EFFECTS VOLUME</div>
        <div class="value">${bar(settings.sfxVolume)}</div>
        <div class="label">INVERT LOOK</div>
        <div class="value">${settings.invertY ? 'ON' : 'OFF'}</div>
      </div>
    `,
    choices: [
      {
        label: `MOUSE SENSITIVITY  x${settings.sensitivity.toFixed(2)}`,
        adjust: (d) => {
          settings.sensitivity = clamp(+(settings.sensitivity + d * 0.1).toFixed(2), 0.2, 3);
          onChange();
        },
      },
      {
        label: `MASTER VOLUME  ${Math.round(settings.masterVolume * 100)}%`,
        adjust: (d) => {
          settings.masterVolume = clamp(+(settings.masterVolume + d * 0.05).toFixed(2), 0, 1);
          onChange();
        },
      },
      {
        label: `EFFECTS VOLUME  ${Math.round(settings.sfxVolume * 100)}%`,
        adjust: (d) => {
          settings.sfxVolume = clamp(+(settings.sfxVolume + d * 0.05).toFixed(2), 0, 1);
          onChange();
        },
      },
      {
        label: `INVERT LOOK  ${settings.invertY ? 'ON' : 'OFF'}`,
        adjust: () => {
          settings.invertY = !settings.invertY;
          onChange();
        },
        onPick: () => {
          settings.invertY = !settings.invertY;
          onChange();
        },
      },
      { label: 'BACK', onPick: onBack },
    ],
    onEscape: onBack,
  };
}

export function readableScreen(title: string, body: string[], onClose: () => void): ScreenSpec {
  return {
    id: `read:${title}`,
    transparent: true,
    wide: true,
    html: `
      <h2>${escapeHtml(title)}</h2>
      <pre>${escapeHtml(body.join('\n'))}</pre>
    `,
    choices: [{ label: 'PUT IT DOWN', onPick: onClose }],
    onEscape: onClose,
  };
}

/** The handwritten note beside the diamond. Read before any decision. */
export function vaultNoteScreen(onContinue: () => void): ScreenSpec {
  return {
    id: 'vault-note',
    wide: true,
    html: `
      <h2>Handwritten, on the lectern</h2>
      <p class="quote">${VAULT_NOTE_TEXT.map(escapeHtml).join('<br>')}</p>
      <p class="hint">The handwriting gets worse toward the end. The last line is
      pressed so hard it has gone through the paper.</p>
    `,
    choices: [{ label: 'LOOK AT THE STONE', onPick: onContinue }],
  };
}

export function decisionScreen(opts: { onTake: () => void; onLeave: () => void; onBack: () => void }): ScreenSpec {
  return {
    id: 'decision',
    wide: true,
    html: `
      <h2>Specimen 04</h2>
      <p>It sits in its cradle at chest height, about the size of a plum, and it
      is putting out more light than the room is.</p>
      <p class="quote">&ldquo;If you take it, it will follow you out.&rdquo;</p>
      <p class="hint">Your client paid for this. Nobody paid you to be careful.</p>
    `,
    choices: [
      { label: 'TAKE THE DIAMOND', note: 'Finish the job. Whatever that costs.', onPick: opts.onTake },
      { label: 'LEAVE THE DIAMOND', note: 'Walk out with nothing. The seal holds.', danger: true, onPick: opts.onLeave },
      { label: 'STEP BACK AND THINK', note: 'Decide later. Nothing is chasing you yet.', onPick: opts.onBack },
    ],
    onEscape: opts.onBack,
  };
}

/** Placing the cross in the seal. Permanent, so it is a confirmed choice. */
export function ritualDecisionScreen(opts: { onPlace: () => void; onBack: () => void }): ScreenSpec {
  return {
    id: 'ritual-decision',
    wide: true,
    html: `
      <h2>The Seal</h2>
      <p>The cuts in the floor are packed with something that has never dried.
      In the middle of the star there is a worn patch about the size of two
      hands, smoother than the concrete around it.</p>
      <p>The crucifix in your pocket is the right size for it.</p>
      <p class="quote">&ldquo;Put something holy in the seal and whatever the
      blue stone let out goes into the floor with it, and stays there.&rdquo;</p>
      <p class="hint">You only have the one. Setting it down is not something
      you can take back.</p>
    `,
    choices: [
      { label: 'PLACE THE CROSS', note: 'Give it up. For good.', onPick: opts.onPlace },
      { label: 'NOT YET', note: 'Keep it and step back from the seal.', onPick: opts.onBack },
    ],
    onEscape: opts.onBack,
  };
}

export function confirmLeaveScreen(opts: { onConfirm: () => void; onCancel: () => void }): ScreenSpec {
  return {
    id: 'confirm-leave',
    html: `
      <h2>Leave it?</h2>
      <p>You take your hand off the stone. The light in the cradle does not
      change. Nothing in the walls moves.</p>
      <p>You will walk out of here with nothing, and your client will find
      someone less careful.</p>
    `,
    choices: [
      { label: 'YES. LEAVE IT.', note: 'Ends the job here.', danger: true, onPick: opts.onConfirm },
      { label: 'NO. PICK IT UP.', onPick: opts.onCancel },
    ],
    onEscape: opts.onCancel,
  };
}

export function pauseScreen(opts: {
  onResume: () => void;
  onJournal: () => void;
  onControls: () => void;
  onSettings: () => void;
  onAbandon: () => void;
  run: RunState;
}): ScreenSpec {
  const p = opts.run.progress;
  const objective = !p.diamondTaken
    ? 'Find the blue diamond.'
    : !p.safeOpen
      ? 'Get out. Open the counter safe in the workshop.'
      : !p.powerRestored
        ? 'Get out. Energise the main breaker panel.'
        : !p.doorUnlocked
          ? 'Get out. Dial the four letter code at the front door.'
          : 'Get out. The door is open.';
  return {
    id: 'pause',
    transparent: true,
    html: `
      <h2>Paused</h2>
      <div class="kv">
        <div class="k">OBJECTIVE</div><div class="v">${escapeHtml(objective)}</div>
        <div class="k">CARRYING</div><div class="v">${escapeHtml(
          [
            p.diamondTaken ? 'the diamond' : null,
            p.hasCabinetKey ? 'steel key' : null,
            p.hasBoxKey ? 'brass key' : null,
            p.hasCross ? 'brass crucifix' : null,
            p.hasFlareGun ? (p.flares > 0 ? `signal pistol (${p.flares})` : 'signal pistol (empty)') : null,
            !p.hasFlareGun && p.flares > 0 ? `${p.flares} flares` : null,
          ]
            .filter(Boolean)
            .join(', ') || 'nothing',
        )}</div>
        <div class="k">THE SEAL</div><div class="v">${
          p.ritualDone
            ? 'the ritual is done - it is gone for good'
            : p.crossPlaced
              ? 'cross placed, waiting'
              : p.hasCross
                ? 'you are carrying something it wants'
                : 'nothing placed'
        }</div>
        <div class="k">CLUES FOUND</div><div class="v">${p.cluesFound.length} of 4</div>
      </div>
    `,
    choices: [
      { label: 'RESUME', onPick: opts.onResume },
      { label: 'CLUE JOURNAL', onPick: opts.onJournal },
      { label: 'CONTROLS', onPick: opts.onControls },
      { label: 'SETTINGS', onPick: opts.onSettings },
      { label: 'ABANDON THE JOB', note: 'Back to the title screen. This run ends.', danger: true, onPick: opts.onAbandon },
    ],
    onEscape: opts.onResume,
  };
}

export function journalScreen(run: RunState, onBack: () => void): ScreenSpec {
  const rows = NUMERAL_ORDER.map((n) => {
    const found = run.progress.cluesFound.includes(n);
    const letter = found ? run.clues[n] : '?';
    const where = CLUE_ANCHORS.find((c) => c.numeral === n)?.where ?? '';
    return `
      <div class="num">${n}</div>
      <div class="let${found ? '' : ' unknown'}">${letter}</div>
      <div class="where">${found ? escapeHtml(where) : 'not found yet'}</div>
    `;
  }).join('');
  const entry = run.progress.cluesFound.length === 4 ? run.code : NUMERAL_ORDER.map((n) => (run.progress.cluesFound.includes(n) ? run.clues[n] : '_')).join('');
  return {
    id: 'journal',
    transparent: true,
    wide: true,
    html: `
      <h2>Clue Journal</h2>
      <p>Four letters, painted on the walls in blood. The numeral beside each
      letter is its position in the door code.</p>
      <div class="journal-list">${rows}</div>
      <p style="margin-top:20px">Code so far: <span class="cold" style="font-size:26px;letter-spacing:0.3em">${escapeHtml(entry)}</span></p>
      <p class="hint">What you have written down here is kept across deaths and
      retries for this run. A new job generates a new code.</p>
    `,
    choices: [{ label: 'BACK', onPick: onBack }],
    onEscape: onBack,
  };
}

export function deathScreen(opts: { run: RunState; onRetry: () => void; onQuit: () => void }): ScreenSpec {
  return {
    id: 'death',
    html: `
      <h2 class="danger">It had you</h2>
      <p>It does not drag you anywhere. It simply stops, and then you do.</p>
      <p class="hint">Retry puts you back in the vault, the moment after you
      lifted the stone. You keep the code you worked out, everything you were
      carrying then, and the puzzle progress you had then.</p>
      <div class="kv" style="margin-top:18px">
        <div class="k">DEATHS THIS RUN</div><div class="v">${opts.run.deaths}</div>
        <div class="k">DOOR CODE</div><div class="v">${opts.run.progress.cluesFound.length} of 4 letters known</div>
      </div>
    `,
    choices: [
      { label: 'RETRY FROM THE VAULT', onPick: opts.onRetry },
      { label: 'ABANDON THE JOB', danger: true, onPick: opts.onQuit },
    ],
  };
}

export function endingScreen(kind: EndingArt, run: RunState, onRestart: () => void): ScreenSpec {
  const art = drawEndingArt(kind);
  const artHtml = `<img class="ending-art" alt="" src="${art.toDataURL('image/png')}">`;
  const minutes = Math.floor(run.elapsed / 60);
  const seconds = Math.floor(run.elapsed % 60);
  const stats = `
    <div class="kv" style="margin-top:22px">
      <div class="k">TIME</div><div class="v">${minutes}m ${String(seconds).padStart(2, '0')}s</div>
      <div class="k">DEATHS</div><div class="v">${run.deaths}</div>
      <div class="k">DOOR CODE</div><div class="v">${escapeHtml(run.code)}</div>
    </div>`;

  if (kind === 'ugly') {
    return {
      id: 'ending-ugly',
      wide: true,
      html: `
        ${artHtml}
        <h2>The Ugly Ending</h2>
        <p>You put your hand back in your pocket and you walk out the way you
        came in, past the safe you never opened and the panel you never threw.</p>
        <p>Behind you the cradle holds. Nothing knocks. Whatever the last
        inventory clerk heard in the walls stays in the walls, because the thing
        that answers to the stone has no reason to follow a man carrying
        nothing.</p>
        <p>Your client does not pay. Somebody else will take the job, and they
        will not read the note.</p>
        <p class="hint">The world is intact. The diamond is still down there.
        You have nothing.</p>
        ${stats}
      `,
      choices: [{ label: 'TAKE THE JOB AGAIN', onPick: onRestart }],
    };
  }
  if (kind === 'bad') {
    return {
      id: 'ending-bad',
      wide: true,
      html: `
        ${artHtml}
        <h2 class="danger">The Bad Ending</h2>
        <p>The door gives and the night air hits you and for about four seconds
        it is the best job you have ever done.</p>
        <p>Then the doorway behind you goes dark in the middle, the way a
        doorway does when something tall is standing in it, and it steps out
        after you onto open ground, and it does not hurry, because it does not
        have to any more.</p>
        <p>If you put a flare in it on the way out, that bought you a minute,
        and the minute is over. A flare was never going to be enough. There
        was a seal in the floor of a room somebody had bricked up, and a box in
        records with a key you could have found.</p>
        <p>You got paid. There is a city twenty minutes down that road with its
        lights on, and it is walking that way.</p>
        <p class="danger">You brought it out. It is loose, and that is on you.</p>
        ${stats}
      `,
      choices: [{ label: 'TAKE THE JOB AGAIN', onPick: onRestart }],
    };
  }
  return {
    id: 'ending-good',
    wide: true,
    html: `
      ${artHtml}
      <h2 class="good">The Good Ending</h2>
      <p>You set a dead man&rsquo;s crucifix down in the middle of a star cut
      into a concrete floor, in a room somebody had bricked up and somebody
      else had cut open again, and the light in the cuts came up.</p>
      <p>Whatever the blue stone let out went into the floor after it. Not
      driven off, not burned back for a minute and a half &mdash; taken, and
      kept. The knocking in the walls stopped with it.</p>
      <p>Then you still had a safe to open, a panel to throw and a door to
      dial, because none of that cared what you had just done.</p>
      <p>You cross the threshold at first light with the stone in your pocket
      and nothing behind you but a building with its power on and nobody in
      it.</p>
      <p class="good">You keep the diamond. What the diamond released is in
      the floor of the sealed store, and it is staying there.</p>
      ${stats}
    `,
    choices: [{ label: 'TAKE THE JOB AGAIN', onPick: onRestart }],
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
