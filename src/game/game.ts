/**
 * Game orchestration: scene assembly, the phase machine, interaction, the
 * reveal, the gun, the exit threshold and the three endings.
 *
 * `step(dt)` is the single entry point for one simulation tick and is callable
 * from outside, which is what the route tests drive. Nothing in here depends on
 * requestAnimationFrame timing.
 */

import * as THREE from 'three';
import { Input } from '../core/input';
import { AudioEngine, type SfxName } from '../core/audio';
import { loadSettings, saveSettings, type Settings } from '../core/settings';
import { PsxRenderer } from '../render/psx';
import { Grid } from '../world/grid';
import { buildWorld, type WorldBuild } from '../world/build';
import { buildProps, type PropsBuild, type Readable } from '../world/props';
import {
  PLAYER_START,
  REVEAL,
  FRONT_DOOR,
  TILE,
  cx,
  cz,
  gxOf,
  gzOf,
  lz,
} from '../world/layout';
import { SURFACE, flatTexture } from '../world/textures';
import { PAL } from '../world/palette';
import { Player, EYE_HEIGHT, PLAYER_RADIUS } from './player';
import { Demon, DEMON_RADIUS } from './demon';
import { RunState } from './state';
import { Hud } from '../ui/hud';
import { PuzzleHost, type PuzzleKind } from '../ui/puzzles';
import {
  ScreenHost,
  titleScreen,
  briefingScreen,
  controlsScreen,
  settingsScreen,
  readableScreen,
  vaultNoteScreen,
  decisionScreen,
  confirmLeaveScreen,
  pauseScreen,
  journalScreen,
  deathScreen,
  endingScreen,
} from '../ui/screens';
import type { NumeralName } from '../world/strokefont';

export type Phase = 'title' | 'briefing' | 'play' | 'menu' | 'puzzle' | 'reading' | 'death' | 'ending';

/** Seconds of invulnerability after stepping back from a device panel. */
const PUZZLE_GRACE = 2.5;
/** Minimum time carrying the diamond before the reveal is allowed to fire. */
const REVEAL_MIN_DELAY = 16;
/** How close the demon must get to interrupt a readable. */
const READING_INTERRUPT = 13;

interface Interactable {
  id: string;
  pos: THREE.Vector3;
  normal: THREE.Vector3 | null;
  radius: number;
  label: () => string;
  /** False renders the prompt greyed out; activating it still gives feedback. */
  ready: () => boolean;
  visible: () => boolean;
  activate: () => void;
}

export class Game {
  readonly psx: PsxRenderer;
  readonly scene = new THREE.Scene();
  readonly overlayScene = new THREE.Scene();
  readonly overlayCamera: THREE.PerspectiveCamera;
  readonly input: Input;
  readonly audio = new AudioEngine();
  readonly hud: Hud;
  readonly screens: ScreenHost;
  settings: Settings;

  grid!: Grid;
  world!: WorldBuild;
  props!: PropsBuild;
  player!: Player;
  demon!: Demon;
  run: RunState;
  puzzles!: PuzzleHost;

  phase: Phase = 'title';
  private interactables: Interactable[] = [];
  private focused: Interactable | null = null;
  private readables = new Map<string, Readable>();
  private gunGroup = new THREE.Group();
  private gunRecoil = 0;
  private knockTimer = 18;
  private revealClock = 0;
  private endingFade = 0;
  private deathFade = 0;
  private fadeIn = 1;
  private loudThisTick = false;
  private time = 0;
  /** True when the run is live but the browser has not given us the mouse. */
  private pendingResumeCapture = false;
  /** Disabled by the route tests while fast-forwarding scripted movement. */
  renderEnabled = true;

  private readonly tmpColor = new THREE.Color();
  private readonly uiRoot: HTMLElement;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.uiRoot = uiRoot;
    this.settings = loadSettings();
    this.psx = new PsxRenderer(canvas);
    this.input = new Input(canvas);
    this.hud = new Hud(uiRoot);
    this.screens = new ScreenHost(uiRoot, (n) => this.audio.play(n));
    this.run = new RunState();

    this.overlayCamera = new THREE.PerspectiveCamera(55, 1, 0.01, 10);
    this.overlayCamera.position.set(0, 0, 0);

    this.input.onCaptureChange = (captured) => {
      if (!captured && this.phase === 'play') {
        // Losing capture mid-run pauses rather than leaving the player blind.
        this.openPause();
      }
      if (captured) this.pendingResumeCapture = false;
    };
    this.input.onBlur = () => {
      if (this.phase === 'play') this.openPause();
      this.audio.suspend();
    };
    this.input.attach();

    this.buildLevel();
    this.hud.setVisible(false);
    this.showTitle();
  }

  // ===================================================================== init

  private buildLevel(): void {
    this.grid = new Grid();
    this.world = buildWorld(this.grid, this.psx);
    this.scene.add(this.world.root);

    this.props = buildProps(this.psx, this.world, this.run);
    this.scene.add(this.props.root);
    this.grid.blockers = this.props.blockers;
    this.grid.markNavBlockers(DEMON_RADIUS);

    for (const r of this.props.readables) this.readables.set(r.id, r);

    this.player = new Player(1);
    this.demon = new Demon(this.psx, this.world);
    this.scene.add(this.demon.group);
    this.demon.onCatch = () => this.onCaught();
    this.demon.onSpot = () => {
      this.audio.play('roar', this.demon.centre, 0.9);
      this.hud.toast('It has seen you.', 2.0);
    };

    this.puzzles = new PuzzleHost(this.uiRoot, this.run, {
      onClose: () => this.closePuzzle(),
      onSolved: (k) => this.onPuzzleSolved(k),
      sfx: (n) => this.audio.play(n),
    });

    this.buildGunViewmodel();
    this.registerInteractables();
    this.syncPropVisibility();
    this.resetPlayerToStart();
  }

  /** Rebuild everything that depends on the run's generated secrets. */
  private rebuildForNewRun(seed?: number): void {
    this.scene.remove(this.world.root);
    this.scene.remove(this.props.root);
    this.scene.remove(this.demon.group);
    disposeTree(this.world.root);
    disposeTree(this.props.root);
    disposeTree(this.demon.group);
    this.readables.clear();
    this.run = new RunState(seed);
    this.world = buildWorld(this.grid, this.psx);
    this.scene.add(this.world.root);
    this.props = buildProps(this.psx, this.world, this.run);
    this.scene.add(this.props.root);
    this.grid.blockers = this.props.blockers;
    this.grid.markNavBlockers(DEMON_RADIUS);
    for (const r of this.props.readables) this.readables.set(r.id, r);
    this.demon = new Demon(this.psx, this.world);
    this.scene.add(this.demon.group);
    this.demon.onCatch = () => this.onCaught();
    this.demon.onSpot = () => {
      this.audio.play('roar', this.demon.centre, 0.9);
      this.hud.toast('It has seen you.', 2.0);
    };
    this.puzzles = new PuzzleHost(this.uiRoot, this.run, {
      onClose: () => this.closePuzzle(),
      onSolved: (k) => this.onPuzzleSolved(k),
      sfx: (n) => this.audio.play(n),
    });
    this.registerInteractables();
    this.syncPropVisibility();
  }

  private resetPlayerToStart(): void {
    this.player.teleport(cx(Math.floor(PLAYER_START.gx)), cz(Math.floor(PLAYER_START.gz)), PLAYER_START.yaw);
    this.player.controlLocked = false;
  }

  private buildGunViewmodel(): void {
    const mkPart = (
      w: number,
      h: number,
      d: number,
      ox: number,
      oy: number,
      oz: number,
      tex: THREE.Texture,
    ): THREE.Mesh => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(0.82), 3));
      const m = this.psx.createMaterial({ map: tex, jitter: 0.5, affine: 0.2, noFog: true });
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(ox, oy, oz);
      return mesh;
    };
    const metal = SURFACE.gunMetal();
    const grip = SURFACE.gunGrip();
    this.gunGroup.add(mkPart(0.03, 0.035, 0.2, 0, 0.012, -0.12, metal));
    this.gunGroup.add(mkPart(0.048, 0.062, 0.062, 0, 0, 0.02, metal));
    this.gunGroup.add(mkPart(0.03, 0.095, 0.042, 0, -0.058, 0.07, grip));
    this.gunGroup.add(mkPart(0.018, 0.028, 0.022, 0, -0.025, 0.045, metal));
    // Muzzle flash quad, hidden until it fires.
    const flashGeo = new THREE.PlaneGeometry(0.16, 0.16);
    flashGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(flashGeo.attributes.position.count * 3).fill(1), 3));
    const flashMat = this.psx.createMaterial({
      map: flatTexture('flash', PAL.amber),
      jitter: 0,
      affine: 0,
      emissive: 2.2,
      noFog: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.name = 'muzzleflash';
    flash.position.set(0, 0.012, -0.24);
    flash.visible = false;
    this.gunGroup.add(flash);

    this.gunGroup.position.set(0.11, -0.085, -0.26);
    this.gunGroup.rotation.y = -0.12;
    this.gunGroup.visible = false;
    this.overlayScene.add(this.gunGroup);
  }

  // ========================================================== interactables

  private registerInteractables(): void {
    const P = this.props;
    const list: Interactable[] = [];
    const run = (): RunState => this.run;

    // ---- front door control panel -------------------------------------
    list.push({
      id: 'door-panel',
      pos: P.lockAnchor.pos,
      normal: P.lockAnchor.normal,
      radius: 3.2,
      visible: () => true,
      ready: () => run().lockUsable && !run().progress.doorUnlocked,
      label: () => {
        const p = run().progress;
        if (p.doorUnlocked) return 'The door is open';
        if (run().lockUsable) return 'Dial the four letter code';
        return 'Inspect the door control';
      },
      activate: () => {
        const p = run().progress;
        if (p.doorUnlocked) {
          this.hud.toast('It is already open. Go.', 1.8);
          return;
        }
        if (run().lockUsable) {
          this.openPuzzle('lock', P.lockAnchor.pos);
          return;
        }
        p.frontDoorInspected = true;
        this.audio.play('beep');
        this.openReadableCustom('door-panel', 'EXIT DOOR CONTROL', [
          'Two separate things are holding this door, and they are not wired',
          'to each other.',
          '',
          '  POWERED LATCH .......... ' + (p.powerRestored ? 'RELEASED' : 'ENGAGED (no plant power)'),
          '  FOUR LETTER LOCK ....... ' + (p.doorUnlocked ? 'OPEN' : 'LOCKED'),
          '',
          'The latch is a solenoid. With the plant down it stays shot home and',
          'the wheels below it will not even turn - you can feel them seized.',
          '',
          'Four brass wheels under a little window, numbered I to IV. Whoever',
          'set it did not leave the code on the frame.',
          '',
          'So: find the plant, bring the power up, and find four letters.',
        ]);
      },
    });

    // ---- counter safe --------------------------------------------------
    list.push({
      id: 'safe',
      pos: P.safeAnchor.pos,
      normal: P.safeAnchor.normal,
      radius: 3.2,
      // Hidden once it is open: otherwise standing at the open safe focuses
      // the safe ("already open") instead of the key sitting inside it.
      visible: () => !run().progress.safeOpen,
      ready: () => run().extractionLive && !run().progress.safeOpen,
      label: () => {
        if (run().progress.safeOpen) return 'The safe is open';
        if (!run().extractionLive) return 'Counter safe (dead)';
        return 'Work the counter safe';
      },
      activate: () => {
        if (run().progress.safeOpen) {
          this.hud.toast('Already open.', 1.5);
          return;
        }
        if (!run().extractionLive) {
          this.audio.play('denied');
          this.hud.toast('The counter window is dark. No standby power in this building yet.', 3.4);
          return;
        }
        this.openPuzzle('safe', P.safeAnchor.pos);
      },
    });

    // ---- the cabinet key, inside the safe ------------------------------
    list.push({
      id: 'cabinet-key',
      pos: new THREE.Vector3(cx(13), 1.0, lz(30) - 0.85),
      normal: new THREE.Vector3(0, 0, -1),
      radius: 3.2,
      visible: () => run().progress.safeOpen && !run().progress.hasKey,
      ready: () => true,
      label: () => 'Take the breaker cabinet key',
      activate: () => {
        run().progress.hasKey = true;
        this.audio.play('pickup');
        this.hud.toast('Breaker cabinet key. Generator room, east wall.', 3.2);
        this.syncPropVisibility();
      },
    });

    // ---- breaker cabinet -----------------------------------------------
    list.push({
      id: 'breaker',
      pos: P.breakerAnchor.pos,
      normal: P.breakerAnchor.normal,
      radius: 3.2,
      visible: () => true,
      ready: () => run().breakerUsable && run().extractionLive && !run().progress.powerRestored,
      label: () => {
        const p = run().progress;
        if (p.powerRestored) return 'The panel is live';
        if (!p.hasKey) return 'Breaker cabinet (locked)';
        if (!run().extractionLive) return 'Breaker cabinet (dead)';
        return 'Open the breaker cabinet';
      },
      activate: () => {
        const p = run().progress;
        if (p.powerRestored) {
          this.hud.toast('Bus is live. The exit latch is released.', 2.2);
          return;
        }
        if (!run().extractionLive) {
          this.audio.play('denied');
          this.hud.toast('Nothing in the cabinet is energised. Not yet.', 3.0);
          return;
        }
        if (!p.hasKey) {
          this.audio.play('denied');
          this.hud.toast('Keyed access only. The key is in the workshop safe.', 3.2);
          return;
        }
        this.openPuzzle('breaker', P.breakerAnchor.pos);
      },
    });

    // ---- the diamond ----------------------------------------------------
    list.push({
      id: 'diamond',
      pos: P.diamondAnchor.pos,
      normal: null,
      radius: 3.0,
      visible: () => !run().progress.diamondTaken,
      ready: () => true,
      label: () => 'Specimen 04',
      activate: () => this.openVaultDecision(),
    });

    // ---- the handwritten note (also readable on its own) ---------------
    list.push({
      id: 'vault-note',
      pos: new THREE.Vector3(P.diamondAnchor.pos.x - 1.5, 1.6, P.diamondAnchor.pos.z + 0.4),
      normal: null,
      radius: 2.2,
      visible: () => true,
      ready: () => true,
      label: () => 'Read the handwritten note',
      activate: () => {
        run().progress.noteRead = true;
        this.openReadableCustom('vault-note', 'HANDWRITTEN, ON THE LECTERN', [
          'They told me the blue stone was a sample. I signed the inventory',
          'myself. But every time they lifted it, something knocked from inside',
          'the walls. If you take it, it will follow you out. I know what that',
          'sounds like. I signed the inventory anyway.',
        ]);
      },
    });

    // ---- the gun ---------------------------------------------------------
    list.push({
      id: 'gun',
      pos: P.gunAnchor.pos,
      normal: null,
      radius: 2.8,
      visible: () => !run().progress.hasGun,
      ready: () => true,
      label: () => 'Take the gun',
      activate: () => {
        run().progress.hasGun = true;
        this.audio.play('pickup');
        this.hud.toast('One round in the cylinder. One. Left click to fire.', 4.0);
        this.syncPropVisibility();
      },
    });

    // ---- ordinary readables from the props pass -------------------------
    for (const r of this.props.readables) {
      list.push({
        id: `read:${r.id}`,
        pos: r.pos,
        normal: r.normal,
        radius: r.radius,
        visible: () => true,
        ready: () => true,
        label: () => r.prompt,
        activate: () => this.openReadableCustom(r.id, r.title, r.body),
      });
    }

    // ---- the blood letters ----------------------------------------------
    for (const c of this.props.clueDecals) {
      list.push({
        id: `clue:${c.numeral}`,
        pos: c.pos,
        normal: c.normal,
        radius: 2.6,
        visible: () => true,
        ready: () => true,
        label: () => `Study the mark (${c.numeral})`,
        activate: () => this.discoverClue(c.numeral, true),
      });
    }

    this.interactables = list;
  }

  private discoverClue(n: NumeralName, explicit: boolean): void {
    const isNew = this.run.markClueFound(n);
    if (isNew) {
      this.audio.play('accept', undefined, 0.6);
      const letter = this.run.clues[n];
      this.hud.toast(`${n} is ${letter}. Position ${['one', 'two', 'three', 'four'][['I', 'II', 'III', 'IV'].indexOf(n)]} of the door code.`, 3.6);
    } else if (explicit) {
      const letter = this.run.clues[n];
      this.hud.toast(`${n} is ${letter}. Already in your journal.`, 2.4);
    }
  }

  // ================================================================= screens

  private showTitle(): void {
    this.phase = 'title';
    this.hud.setVisible(false);
    this.input.gameplayEnabled = false;
    this.input.releaseCapture();
    this.psx.setFade(0);
    this.screens.show(() =>
      titleScreen({
        onStart: () => this.startNewRun(),
        onControls: () => this.screens.show(() => controlsScreen(() => this.showTitle(), false)),
        onSettings: () =>
          this.screens.show(() =>
            settingsScreen(
              this.settings,
              () => this.applySettings(),
              () => this.showTitle(),
              false,
            ),
          ),
      }),
    );
  }

  startNewRun(seed?: number): void {
    this.audio.start();
    this.rebuildForNewRun(seed);
    this.resetPlayerToStart();
    this.demon.reset();
    this.knockTimer = 16;
    this.revealClock = 0;
    this.endingFade = 0;
    this.deathFade = 0;
    this.fadeIn = 1;
    this.time = 0;
    this.hud.clearToast();
    this.phase = 'briefing';
    this.screens.show(() => briefingScreen(() => this.beginPlay()));
  }

  beginPlay(): void {
    this.screens.close();
    this.phase = 'play';
    this.hud.setVisible(true);
    this.hud.setTag(`SPECIMEN RECOVERY / ${String(this.run.seed % 100000).padStart(5, '0')}`);
    this.input.gameplayEnabled = true;
    this.input.requestCapture();
    this.audio.start();
    this.applySettings();
    this.hud.toast('Have a look at the front door before you go anywhere.', 5.0);
  }

  private openPause(): void {
    if (this.phase !== 'play') return;
    this.phase = 'menu';
    this.input.gameplayEnabled = false;
    this.input.releaseAll();
    this.screens.show(() =>
      pauseScreen({
        run: this.run,
        onResume: () => this.resumeFromMenu(),
        onJournal: () => this.screens.show(() => journalScreen(this.run, () => this.openPauseAgain())),
        onControls: () => this.screens.show(() => controlsScreen(() => this.openPauseAgain(), true)),
        onSettings: () =>
          this.screens.show(() =>
            settingsScreen(
              this.settings,
              () => this.applySettings(),
              () => this.openPauseAgain(),
              true,
            ),
          ),
        onAbandon: () => this.showTitle(),
      }),
    );
  }

  private openPauseAgain(): void {
    this.phase = 'menu';
    this.screens.show(() =>
      pauseScreen({
        run: this.run,
        onResume: () => this.resumeFromMenu(),
        onJournal: () => this.screens.show(() => journalScreen(this.run, () => this.openPauseAgain())),
        onControls: () => this.screens.show(() => controlsScreen(() => this.openPauseAgain(), true)),
        onSettings: () =>
          this.screens.show(() =>
            settingsScreen(
              this.settings,
              () => this.applySettings(),
              () => this.openPauseAgain(),
              true,
            ),
          ),
        onAbandon: () => this.showTitle(),
      }),
    );
  }

  private resumeFromMenu(): void {
    this.screens.close();
    this.phase = 'play';
    this.input.gameplayEnabled = true;
    this.input.releaseAll();
    this.audio.resume();
    if (!this.input.captured) {
      this.input.requestCapture();
      this.pendingResumeCapture = true;
    }
  }

  openJournal(): void {
    if (this.phase !== 'play') return;
    this.phase = 'menu';
    this.input.gameplayEnabled = false;
    this.input.releaseAll();
    this.screens.show(() => journalScreen(this.run, () => this.resumeFromMenu()));
  }

  /** Readables keep normal exploration rules: the world keeps running. */
  private openReadableCustom(id: string, title: string, body: string[]): void {
    if (this.phase !== 'play' && this.phase !== 'reading') return;
    this.run.markRead(id);
    this.phase = 'reading';
    this.input.gameplayEnabled = false;
    this.input.releaseAll();
    this.screens.show(() => readableScreen(title, body, () => this.closeReadable()));
  }

  private closeReadable(): void {
    this.screens.close();
    this.phase = 'play';
    this.input.gameplayEnabled = true;
    this.input.releaseAll();
  }

  private openVaultDecision(): void {
    if (this.run.progress.diamondTaken) return;
    this.phase = 'menu';
    this.input.gameplayEnabled = false;
    this.input.releaseAll();
    this.run.progress.noteRead = true;
    this.audio.play('shimmer', this.props.diamondAnchor.pos, 0.8);
    // The note is always shown first, so it is readable before the decision.
    this.screens.show(() => vaultNoteScreen(() => this.showDecision()));
  }

  private showDecision(): void {
    this.screens.show(() =>
      decisionScreen({
        onTake: () => this.takeDiamond(),
        onLeave: () => this.screens.show(() => confirmLeaveScreen({ onConfirm: () => this.finishEnding('ugly'), onCancel: () => this.showDecision() })),
        onBack: () => this.resumeFromMenu(),
      }),
    );
  }

  private takeDiamond(): void {
    this.screens.close();
    this.run.progress.diamondTaken = true;
    this.phase = 'play';
    this.input.gameplayEnabled = true;
    this.input.releaseAll();
    this.syncPropVisibility();
    this.audio.play('shimmer', this.player.eye, 1);
    this.audio.play('rumble', undefined, 0.8);
    this.revealClock = 0;
    this.knockTimer = 5;
    // Checkpoint: immediately after taking the diamond, before the reveal.
    this.run.saveCheckpoint(this.player.x, this.player.z, this.player.yaw);
    this.hud.toast('It comes out of the cradle easily. Somewhere under the floor, something shifts.', 5.0);
  }

  // ================================================================= puzzles

  private openPuzzle(kind: PuzzleKind, anchor: THREE.Vector3): void {
    this.phase = 'puzzle';
    // Order matters: drop held inputs, lock the body, lock the view, then
    // suspend the demon with its position and chase state untouched.
    this.input.releaseAll();
    this.input.gameplayEnabled = false;
    this.player.controlLocked = true;
    this.player.lockViewTo(anchor);
    this.demon.suspend();
    this.puzzles.openPuzzle(kind);
  }

  private closePuzzle(): void {
    // Restore control first, then let the demon move again with a grace window.
    this.player.releaseView();
    this.player.controlLocked = false;
    this.input.releaseAll();
    this.input.gameplayEnabled = true;
    this.phase = 'play';
    this.demon.resume(PUZZLE_GRACE);
  }

  private onPuzzleSolved(kind: PuzzleKind): void {
    const p = this.run.progress;
    if (kind === 'safe') {
      p.safeOpen = true;
      this.audio.play('clunk', this.props.safeAnchor.pos, 1);
      this.hud.toast('The safe is open. There is a key inside.', 3.6);
    } else if (kind === 'breaker') {
      p.powerRestored = true;
      this.audio.play('relay', this.props.breakerAnchor.pos, 1.2);
      this.audio.play('rumble', undefined, 0.6);
      this.hud.toast('Plant power is up. The exit latch has released.', 4.0);
    } else {
      p.doorUnlocked = true;
      this.audio.play('latch', this.props.lockAnchor.pos, 1.2);
      this.hud.toast('The door is open. Get out.', 3.6);
    }
    this.syncPropVisibility();
    this.puzzles.closePuzzle(false);
    this.closePuzzle();
  }

  // =================================================================== death

  private onCaught(): void {
    if (this.phase === 'death' || this.phase === 'ending') return;
    this.phase = 'death';
    this.run.deaths++;
    this.deathFade = 0;
    this.input.gameplayEnabled = false;
    this.input.releaseAll();
    this.audio.play('scream', this.demon.centre, 1);
    this.audio.play('hit', undefined, 1);
    this.audio.setHeartbeat(0);
    this.hud.setVisible(false);
    this.screens.show(() =>
      deathScreen({
        run: this.run,
        onRetry: () => this.retryFromCheckpoint(),
        onQuit: () => this.showTitle(),
      }),
    );
  }

  retryFromCheckpoint(): void {
    const cp = this.run.restoreCheckpoint();
    this.screens.close();
    this.puzzles.closePuzzle(false);
    this.demon.reset();
    this.endingFade = 0;
    this.deathFade = 0;
    this.fadeIn = 1;
    this.revealClock = 0;
    this.knockTimer = 5;
    if (cp) {
      this.player.teleport(cp.playerX, cp.playerZ, cp.playerYaw);
    } else {
      this.resetPlayerToStart();
    }
    this.player.controlLocked = false;
    this.player.releaseView();
    this.syncPropVisibility();
    this.hud.setVisible(true);
    this.hud.clearToast();
    this.phase = 'play';
    this.input.gameplayEnabled = true;
    this.input.releaseAll();
    if (!this.input.captured) {
      this.input.requestCapture();
      this.pendingResumeCapture = true;
    }
    this.psx.setFade(0);
  }

  // ================================================================ endings

  finishEnding(kind: 'ugly' | 'bad' | 'good'): void {
    if (this.phase === 'ending') return;
    this.phase = 'ending';
    this.run.ending = kind;
    this.endingFade = 0;
    this.input.gameplayEnabled = false;
    this.input.releaseAll();
    this.input.releaseCapture();
    this.hud.setVisible(false);
    this.audio.setHeartbeat(0);
    this.audio.setGrowl(0, { x: 0, y: 0, z: 0 }, 0);
    this.audio.play(kind === 'bad' ? 'roar' : kind === 'good' ? 'latch' : 'clunk', undefined, 1);
    this.screens.show(() => endingScreen(kind, this.run, () => this.showTitle()));
  }

  // ============================================================ prop syncing

  private syncPropVisibility(): void {
    const p = this.run.progress;
    this.props.diamondMesh.visible = !p.diamondTaken;
    this.props.gunMesh.visible = !p.hasGun;
    this.props.keyMesh.visible = p.safeOpen && !p.hasKey;
    this.props.safeDoor.visible = !p.safeOpen;
    this.props.breakerDoor.visible = !p.hasKey;
    this.gunGroup.visible = p.hasGun;
    const flash = this.gunGroup.getObjectByName('muzzleflash');
    if (flash) flash.visible = false;

    // Front door: slide the leaves apart and drop the collision blocker.
    const open = p.doorUnlocked;
    const leaves = this.props.doorLeaves.children;
    for (let i = 0; i < leaves.length; i++) {
      leaves[i].position.x = (i === 0 ? -1 : 1) * (open ? 2.9 : 0) + (leaves[i].userData.baseX ?? leaves[i].position.x);
      if (leaves[i].userData.baseX === undefined) leaves[i].userData.baseX = leaves[i].position.x - (i === 0 ? -1 : 1) * (open ? 2.9 : 0);
    }
    this.props.doorBlocker.top = open ? 0 : 3.0;
    // The doorway cells are nav-blocked while the leaves are shut; re-mark so
    // the open door becomes a route for the player and the demon alike.
    this.grid.markNavBlockers(DEMON_RADIUS);
    // The latch lamp goes from red to green with the powered release.
    this.props.latchLampMat.uniforms.map.value = flatTexture(
      p.powerRestored ? 'latchgreen' : 'latchred',
      p.powerRestored ? PAL.mossLit : PAL.bloodLit,
    );
  }

  // ==================================================================== loop

  resize(w: number, h: number): void {
    this.psx.setSize(w, h);
    this.player.camera.aspect = w / h;
    this.player.camera.updateProjectionMatrix();
    this.overlayCamera.aspect = w / h;
    this.overlayCamera.updateProjectionMatrix();
  }

  applySettings(): void {
    this.audio.setVolumes(this.settings.masterVolume, this.settings.sfxVolume);
    saveSettings(this.settings);
    this.screens.refresh();
  }

  /** One simulation + render tick. */
  step(dt: number): void {
    const d = Math.min(dt, 1 / 20);
    this.time += d;
    this.loudThisTick = false;

    if (this.phase === 'play' || this.phase === 'reading' || this.phase === 'puzzle') {
      this.run.elapsed += d;
    }

    if (this.phase === 'play') {
      this.handlePlayInput(d);
    }

    // The player only moves in `play`; puzzles hold the view, menus freeze.
    if (this.phase === 'play' || this.phase === 'puzzle') {
      this.player.update(d, this.input, this.grid, this.settings, this.audio);
    } else {
      this.player.update(0, this.input, this.grid, this.settings, this.audio);
    }

    // The demon runs in `play` and in `reading` (reading is not a safe haven),
    // is suspended during puzzles, and is frozen entirely in menus/endings.
    if (this.phase === 'play' || this.phase === 'reading' || this.phase === 'puzzle') {
      this.demon.update(d, this.grid, this.player, this.loudThisTick);
    }

    if (this.phase === 'play' || this.phase === 'reading') {
      this.checkReveal(d);
      this.checkThreshold();
      this.checkSecretRoom();
      this.autoDiscoverClues();
      this.ambientKnocks(d);
    }

    if (this.phase === 'reading') this.checkReadingInterrupt();

    this.updateFocus();
    this.updateHud();
    this.updateAudio(d);
    this.animateWorld(d);
    this.render(d);
  }

  private handlePlayInput(dt: number): void {
    if (this.input.consumePress('cancel')) {
      this.openPause();
      return;
    }
    if (this.input.consumePress('journal')) {
      this.openJournal();
      return;
    }
    if (this.input.consumePress('interact') && this.focused) {
      this.focused.activate();
      return;
    }
    const click = this.input.consumeClick();
    if (click === 0) this.fire();
    if (this.gunRecoil > 0) this.gunRecoil = Math.max(0, this.gunRecoil - dt * 4);
  }

  // ------------------------------------------------------------------ firing

  fire(): void {
    const p = this.run.progress;
    if (!p.hasGun) return;
    if (p.roundSpent) {
      this.audio.play('dryfire');
      this.hud.toast('Empty. There was only ever one round.', 2.4);
      return;
    }
    p.roundSpent = true;
    this.gunRecoil = 1;
    this.loudThisTick = true;
    this.audio.play('gunshot', undefined, 1);
    const flash = this.gunGroup.getObjectByName('muzzleflash');
    if (flash) flash.visible = true;

    const hit = this.shotHitsDemon();
    if (hit) {
      this.demon.kill();
      this.audio.play('hit', this.demon.centre, 1);
      this.audio.play('demon_die', this.demon.centre, 1);
      this.audio.setHeartbeat(0);
      this.hud.toast('It folds up and goes down, and the knocking in the walls stops.', 5.0);
    } else {
      this.hud.toast('The round goes somewhere into the dark. That was the only one.', 4.5);
    }
  }

  /** Reliable hit check: ray against the demon's body capsule, plus sight. */
  private shotHitsDemon(): boolean {
    if (!this.demon.alive || this.demon.state === 'dormant') return false;
    const eye = this.player.camera.position;
    const dir = this.player.forward.clone().normalize();
    const cxv = this.demon.x;
    const czv = this.demon.z;
    // Closest approach of the ray to the demon's vertical axis.
    const ox = cxv - eye.x;
    const oz = czv - eye.z;
    const t = ox * dir.x + oz * dir.z;
    if (t < 0.4 || t > 60) return false;
    const px = eye.x + dir.x * t;
    const pz = eye.z + dir.z * t;
    const lateral = Math.hypot(px - cxv, pz - czv);
    if (lateral > 0.78) return false;
    // The ray must also be at body height where it passes the demon.
    const y = eye.y + dir.y * t;
    if (y < 0.15 || y > 2.45) return false;
    return this.grid.sightClear(eye.x, eye.z, cxv, czv);
  }

  // -------------------------------------------------------------- the reveal

  private checkReveal(dt: number): void {
    const p = this.run.progress;
    if (!p.diamondTaken || p.revealPlayed) return;
    this.revealClock += dt;
    if (this.revealClock < REVEAL_MIN_DELAY) return;
    const gx = gxOf(this.player.x);
    const gz = gzOf(this.player.z);
    const inZone = REVEAL.triggerCells.some((c) => c[0] === gx && c[1] === gz);
    if (!inZone) return;
    this.playReveal();
  }

  /** Stage the first sighting: far end of a straight corridor, lit, holding. */
  playReveal(): void {
    const p = this.run.progress;
    if (p.revealPlayed) return;
    p.revealPlayed = true;
    this.demon.spawnReveal(REVEAL.demonCell[0], REVEAL.demonCell[1], REVEAL.holdTime, this.player.x, this.player.z);
    this.audio.play('scream', this.demon.centre, 1);
    this.audio.play('rumble', undefined, 1);
    this.hud.toast(
      'Something is standing at the far end of the tunnel. Somewhere below, a bus closes - the building has power again.',
      6.0,
    );
  }

  // ------------------------------------------------------------- thresholds

  private checkThreshold(): void {
    const p = this.run.progress;
    if (!p.doorUnlocked) return;
    if (this.player.z < FRONT_DOOR.thresholdZ) return;
    if (!p.diamondTaken) return;
    this.finishEnding(this.demon.alive && this.demon.state !== 'dormant' ? 'bad' : 'good');
  }

  private checkSecretRoom(): void {
    if (this.run.progress.secretFound) return;
    if (this.grid.regionIdAt(this.player.x, this.player.z) !== 'secret') return;
    this.run.progress.secretFound = true;
    this.audio.play('clunk', undefined, 0.5);
    this.hud.toast('The wall was never a wall. Someone cut it open and dressed the seam.', 4.5);
  }

  private autoDiscoverClues(): void {
    for (const c of this.props.clueDecals) {
      if (this.run.progress.cluesFound.includes(c.numeral)) continue;
      const dx = c.pos.x - this.player.x;
      const dz = c.pos.z - this.player.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 5.5) continue;
      const f = this.player.forward;
      const dot = (dx * f.x + dz * f.z) / (dist || 1);
      if (dot < 0.72) continue;
      if (!this.grid.sightClear(this.player.x, this.player.z, c.pos.x, c.pos.z)) continue;
      this.discoverClue(c.numeral, false);
    }
  }

  private checkReadingInterrupt(): void {
    if (!this.demon.alive || this.demon.state === 'dormant') return;
    if (this.demon.senses.distance > READING_INTERRUPT) return;
    this.hud.toast('Something is coming. Put it down.', 2.6);
    this.closeReadable();
  }

  private ambientKnocks(dt: number): void {
    if (this.run.progress.revealPlayed) return;
    this.knockTimer -= dt;
    if (this.knockTimer > 0) return;
    const taken = this.run.progress.diamondTaken;
    this.knockTimer = taken ? 6 + Math.random() * 8 : 20 + Math.random() * 22;
    // Put the knock inside a wall near the player, which is where the note
    // says it comes from.
    const a = Math.random() * Math.PI * 2;
    const r = 4 + Math.random() * 7;
    const at = {
      x: this.player.x + Math.cos(a) * r,
      y: 1.3,
      z: this.player.z + Math.sin(a) * r,
    };
    this.audio.play('knock', at, taken ? 1.1 : 0.8);
  }

  // ------------------------------------------------------------------ focus

  private updateFocus(): void {
    if (this.phase !== 'play') {
      this.focused = null;
      return;
    }
    let best: Interactable | null = null;
    let bestScore = -1;
    const f = this.player.forward;
    for (const it of this.interactables) {
      if (!it.visible()) continue;
      const dx = it.pos.x - this.player.x;
      const dz = it.pos.z - this.player.z;
      const dy = it.pos.y - this.player.eyeY;
      const dist = Math.hypot(dx, dz, dy);
      if (dist > it.radius) continue;
      const horiz = Math.hypot(dx, dz) || 1e-4;
      const dot = (dx * f.x + dz * f.z) / horiz;
      if (dot < 0.42) continue;
      if (it.normal) {
        // Must be on the readable side of the plate.
        const facing = -(dx * it.normal.x + dz * it.normal.z) / horiz;
        if (facing < -0.1) continue;
      }
      if (!this.grid.sightClear(this.player.x, this.player.z, it.pos.x, it.pos.z)) continue;
      const score = dot * 2 - dist / it.radius;
      if (score > bestScore) {
        bestScore = score;
        best = it;
      }
    }
    this.focused = best;
  }

  // -------------------------------------------------------------------- hud

  private updateHud(): void {
    if (this.phase !== 'play' && this.phase !== 'reading') {
      this.hud.setPrompt(null);
      return;
    }
    const p = this.run.progress;
    this.hud.setAiming(p.hasGun && !p.roundSpent);
    if (this.pendingResumeCapture && !this.input.captured) {
      // The browser has not handed the mouse back yet; say so plainly rather
      // than leaving the player wondering why looking around does nothing.
      this.hud.setPrompt('Click to take the mouse back', 'LMB');
    } else if (this.focused) {
      this.hud.setPrompt(this.focused.label(), 'E', !this.focused.ready());
    } else {
      this.hud.setPrompt(null);
    }

    const lines = [];
    if (p.diamondTaken) lines.push({ cls: 'diamond', mark: '[*]', text: 'blue diamond' });
    if (p.hasKey) lines.push({ cls: 'key', mark: '[-]', text: 'breaker cabinet key' });
    if (p.hasGun) {
      lines.push(
        p.roundSpent
          ? { cls: 'gun spent', mark: '[ ]', text: 'gun - empty' }
          : { cls: 'gun', mark: '[1]', text: 'gun - one round' },
      );
    }
    if (p.cluesFound.length > 0) {
      lines.push({ cls: 'clues', mark: '[' + p.cluesFound.length + ']', text: 'of 4 wall letters (TAB)' });
    }
    this.hud.setInventory(lines);
    this.hud.setStamina(this.player.stamina, this.player.stamina < 0.999 || this.player.sprinting);

    // Directional threat cue.
    if (!this.demon.alive || this.demon.state === 'dormant') {
      this.hud.setThreat(0, null);
    } else {
      const dx = this.demon.x - this.player.x;
      const dz = this.demon.z - this.player.z;
      const dist = Math.hypot(dx, dz);
      const stateScale =
        this.demon.state === 'chase' || this.demon.state === 'attack'
          ? 1
          : this.demon.state === 'investigate'
            ? 0.72
            : this.demon.state === 'reveal'
              ? 0.9
              : 0.5;
      const level = Math.max(0, 1 - dist / 42) * stateScale * (this.demon.suspended ? 0.35 : 1);
      const fwd = dx * Math.sin(this.player.yaw) + dz * Math.cos(this.player.yaw);
      const rgt = dx * Math.cos(this.player.yaw) - dz * Math.sin(this.player.yaw);
      this.hud.setThreat(level, Math.atan2(rgt, fwd));
    }
  }

  // ------------------------------------------------------------------ audio

  private updateAudio(dt: number): void {
    this.audio.update(dt);
    const cam = this.player.camera;
    const fwd = this.player.forward;
    this.audio.setListener(
      { x: cam.position.x, y: cam.position.y, z: cam.position.z },
      { x: fwd.x, y: fwd.y, z: fwd.z },
      { x: 0, y: 1, z: 0 },
    );

    const playing = this.phase === 'play' || this.phase === 'reading' || this.phase === 'puzzle';
    this.audio.setDrone(playing ? (this.run.progress.diamondTaken ? 0.9 : 0.5) : 0.15);
    this.audio.setHum(
      playing ? (this.run.progress.powerRestored ? 1 : 0.45) : 0,
      { x: cx(39), y: 2.5, z: cz(22) },
    );

    if (!playing || !this.demon.alive || this.demon.state === 'dormant' || this.demon.suspended) {
      this.audio.setGrowl(0, this.demon.centre, 0);
      this.audio.setHeartbeat(0);
      return;
    }
    const dist = this.demon.senses.distance;
    const level = Math.max(0, 1 - dist / 44) * (0.35 + 0.65 * this.demon.senses.agitation);
    this.audio.setGrowl(level, { x: this.demon.x, y: 1.5, z: this.demon.z }, this.demon.senses.agitation);
    const near = Math.max(0, 1 - dist / 24);
    const chasing = this.demon.state === 'chase' || this.demon.state === 'attack' || this.demon.state === 'reveal';
    this.audio.setHeartbeat(chasing || near > 0.4 ? 62 + near * 72 : 0);
  }

  // --------------------------------------------------------------- animation

  private animateWorld(dt: number): void {
    // Light fixtures flicker; the region tint follows so the room pulses too.
    for (const f of this.world.fixtures) {
      const L = f.light;
      if (!L.flicker) continue;
      const n = Math.sin(this.time * L.flicker * 6.2831) * 0.5 + 0.5;
      const spike = Math.sin(this.time * L.flicker * 2.1) > 0.82 ? 0.25 : 1;
      f.material.uniforms.uEmissive.value = 1.25 * (0.35 + 0.65 * n) * spike;
    }
    for (const rv of this.world.regions.values()) {
      if (!rv.flicker.length) continue;
      let k = 1;
      for (const L of rv.flicker) {
        const n = Math.sin(this.time * (L.flicker ?? 1) * 6.2831) * 0.5 + 0.5;
        k *= 0.9 + 0.14 * n;
      }
      for (const m of rv.materials) (m.uniforms.uTint.value as THREE.Color).setScalar(k);
    }

    for (const g of this.props.glows) {
      const n = Math.sin(this.time * g.rate * 6.2831) * 0.5 + 0.5;
      g.mat.uniforms.uEmissive.value = g.base * (0.78 + 0.3 * n);
    }

    // The diamond turns slowly and its halo faces the camera.
    if (this.props.diamondMesh.visible) {
      this.props.diamondMesh.rotation.y += dt * 0.8;
      const halo = (this.props.diamondMesh.userData as { halo?: THREE.Mesh }).halo;
      if (halo) {
        halo.rotation.y = -this.props.diamondMesh.rotation.y;
        halo.lookAt(this.player.camera.position);
        halo.rotation.z = 0;
      }
    }
    if (this.props.gunMesh.visible) {
      this.props.gunMesh.rotation.y += dt * 0.5;
      const glint = (this.props.gunMesh.userData as { glint?: THREE.Mesh }).glint;
      if (glint) {
        glint.lookAt(this.player.camera.position);
        glint.rotation.z = 0;
      }
    }

    // Gun viewmodel sway and recoil.
    if (this.gunGroup.visible) {
      const sway = Math.sin(this.time * 2.2) * 0.004;
      const bob = Math.min(1, this.player.speed / 4.3);
      this.gunGroup.position.set(
        0.11 + sway,
        -0.085 + Math.sin(this.time * 7) * 0.004 * bob + this.gunRecoil * 0.02,
        -0.26 + this.gunRecoil * 0.05,
      );
      this.gunGroup.rotation.x = -this.gunRecoil * 0.4;
      if (this.gunRecoil > 0) this.gunRecoil = Math.max(0, this.gunRecoil - dt * 3.2);
      const flash = this.gunGroup.getObjectByName('muzzleflash');
      if (flash) flash.visible = this.gunRecoil > 0.72;
    }

    // Fades.
    if (this.phase === 'ending') {
      this.endingFade = Math.min(1, this.endingFade + dt * 1.4);
      this.psx.setFade(this.endingFade, 0x000000);
    } else if (this.phase === 'death') {
      this.deathFade = Math.min(1, this.deathFade + dt * 1.6);
      this.psx.setFade(this.deathFade, 0x1a0305);
    } else if (this.fadeIn > 0) {
      this.fadeIn = Math.max(0, this.fadeIn - dt * 0.9);
      this.psx.setFade(this.fadeIn, 0x000000);
    }
  }

  private render(_dt: number): void {
    if (!this.renderEnabled) return;
    const cam = this.player.camera;
    // The handlamp follows the camera.
    this.psx.shared.uFlashPos.value.copy(cam.position);
    this.psx.shared.uFlashDir.value.copy(this.player.forward).normalize();

    // Region fog tint: the vault reads colder than the service tunnels.
    const region = this.grid.regionAt(this.player.x, this.player.z);
    if (region) {
      const target = region.id === 'vault' || region.id === 'vaultCorr' ? [0.03, 0.055, 0.08] : [0.03, 0.034, 0.042];
      const c = this.psx.shared.uFogColor.value;
      c.setRGB(
        c.r + (target[0] - c.r) * 0.04,
        c.g + (target[1] - c.g) * 0.04,
        c.b + (target[2] - c.b) * 0.04,
      );
    }

    this.psx.beginFrame();
    this.psx.renderScene(this.scene, cam);
    if (this.gunGroup.visible) this.psx.renderOverlay(this.overlayScene, this.overlayCamera);
    this.psx.present();
    void this.tmpColor;
  }

  // ============================================================== debug api

  /** Exposed on `window.__BB` for the automated route tests. */
  debugApi(): Record<string, unknown> {
    return {
      game: this,
      phase: () => this.phase,
      snapshot: () => ({
        phase: this.phase,
        seed: this.run.seed,
        code: this.run.code,
        clues: { ...this.run.clues },
        breakerOrder: [...this.run.breakerOrder],
        progress: structuredClone(this.run.progress),
        ending: this.run.ending,
        deaths: this.run.deaths,
        elapsedSeconds: this.run.elapsed,
        player: { x: this.player.x, z: this.player.z, yaw: this.player.yaw, region: this.grid.regionIdAt(this.player.x, this.player.z) },
        demon: {
          state: this.demon.state,
          alive: this.demon.alive,
          suspended: this.demon.suspended,
          x: this.demon.x,
          z: this.demon.z,
          grace: this.demon.grace,
          distance: this.demon.senses.distance,
        },
        safeSwitches: [...this.run.safeSwitches],
        breakerProgress: this.run.breakerProgress,
        lockEntry: [...this.run.lockEntry],
        checkpoint: this.run.checkpoint ? structuredClone(this.run.checkpoint.progress) : null,
      }),
      step: (dt: number, times = 1) => {
        for (let i = 0; i < times; i++) this.step(dt);
      },
      start: (seed?: number) => this.startNewRun(seed),
      begin: () => this.beginPlay(),
      screenChoices: () => (this.screens as unknown as { current: { choices: { label: string }[] } | null }).current?.choices.map((c) => c.label) ?? [],
      screenId: () => this.screens.id,
      pick: (labelOrIndex: string | number) => this.pickScreenChoice(labelOrIndex),
      interactables: () =>
        this.interactables
          .filter((i) => i.visible())
          .map((i) => ({
            id: i.id,
            label: i.label(),
            ready: i.ready(),
            x: i.pos.x,
            y: i.pos.y,
            z: i.pos.z,
            nx: i.normal ? i.normal.x : 0,
            nz: i.normal ? i.normal.z : 0,
          })),
      /** Nearest spot a body can actually stand to reach (x, z). */
      approachPoint: (x: number, z: number) => this.approachPoint(x, z),
      focused: () => this.focused?.id ?? null,
      use: (id: string) => {
        const it = this.interactables.find((i) => i.id === id);
        if (!it) throw new Error(`no interactable ${id}`);
        it.activate();
      },
      /** Walk to a point using real collision; returns whether it arrived. */
      walkTo: (x: number, z: number, maxSteps = 12000, speed = 4.3) =>
        this.debugWalkTo(x, z, maxSteps, speed),
      teleport: (x: number, z: number) => {
        this.player.teleport(x, z, this.player.yaw);
      },
      teleportCell: (gx: number, gz: number) => {
        this.player.teleport(cx(gx), cz(gz), this.player.yaw);
      },
      face: (x: number, z: number) => {
        this.player.yaw = Math.atan2(x - this.player.x, z - this.player.z);
        this.player.pitch = 0;
        this.step(1 / 60);
      },
      puzzleOpen: () => this.puzzles.kind,
      puzzleControls: () =>
        (this.puzzles as unknown as { controls: { id: string; locked?: boolean }[] }).controls.map((c) => ({
          id: c.id,
          locked: !!c.locked,
        })),
      press: (id: string) => this.debugPressPuzzleControl(id),
      puzzleMessage: () =>
        (this.puzzles as unknown as { pendingMessage: { text: string } | null }).pendingMessage?.text ?? '',
      closePuzzle: () => this.puzzles.closePuzzle(),
      fire: () => this.fire(),
      aimAtDemon: () => {
        const dx = this.demon.x - this.player.x;
        const dz = this.demon.z - this.player.z;
        this.player.yaw = Math.atan2(dx, dz);
        const dy = 1.45 - this.player.eyeY;
        this.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        this.step(1 / 60);
      },
      aimAway: () => {
        const dx = this.demon.x - this.player.x;
        const dz = this.demon.z - this.player.z;
        this.player.yaw = Math.atan2(dx, dz) + Math.PI * 0.75;
        this.player.pitch = 0;
        this.step(1 / 60);
      },
      playReveal: () => this.playReveal(),
      clueDecals: () =>
        this.props.clueDecals.map((c) => ({ numeral: c.numeral, letter: c.letter, where: c.where })),
      /** Park the demon on the player and run until it lands a hit. */
      forceCatch: (maxSteps = 600) => {
        this.demon.x = this.player.x + 0.6;
        this.demon.z = this.player.z + 0.6;
        this.demon.grace = 0;
        for (let i = 0; i < maxSteps; i++) {
          this.demon.grace = 0;
          this.step(1 / 60);
          if (this.phase === 'death') return true;
        }
        return false;
      },
      killDemon: () => this.demon.kill(),
      forceDemonTo: (gx: number, gz: number) => {
        this.demon.x = cx(gx);
        this.demon.z = cz(gz);
      },
      gridInfo: () => ({
        walkable: countWalkable(this.grid),
        connected: connectedFromStart(this.grid),
      }),
      pathExists: (ax: number, az: number, bx: number, bz: number) => !!this.grid.findPath(ax, az, bx, bz),
      /** Walking distance along the real path between two points, in units. */
      pathLength: (ax: number, az: number, bx: number, bz: number) => {
        const p = this.grid.findPath(ax, az, bx, bz);
        if (!p || !p.length) return -1;
        let d = Math.hypot(p[0].x - ax, p[0].z - az);
        for (let i = 1; i < p.length; i++) d += Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z);
        return d;
      },
      regionAt: (x: number, z: number) => this.grid.regionIdAt(x, z),
      thresholdZ: () => FRONT_DOOR.thresholdZ,
      playerEyeY: () => this.player.camera.position.y,
      playerSpeed: () => this.player.speed,
      playerStamina: () => this.player.stamina,
      heldActions: () => [...this.input.held],
      floorHeightAt: (x: number, z: number) => this.grid.floorHeight(x, z),
      blurWindow: () => {
        window.dispatchEvent(new Event('blur'));
      },
      /** Used by the measurement route: the doorway is only navigable when open. */
      /**
       * Release audit: walks every live scene graph and reports what is
       * actually bound. Used by the test suite so the placeholder audit in
       * ASSET_MANIFEST.md is reproducible rather than asserted.
       */
      assetAudit: () => {
        const names = new Set<string>();
        let meshes = 0;
        let tris = 0;
        let untextured = 0;
        let foreignMaterials = 0;
        for (const root of [this.scene, this.overlayScene]) {
          root.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            meshes++;
            const pos = m.geometry?.attributes?.position;
            if (pos) tris += pos.count / 3;
            const mat = m.material as THREE.ShaderMaterial | undefined;
            if (!mat || !mat.uniforms) {
              foreignMaterials++;
              return;
            }
            const tex = mat.uniforms.map?.value as THREE.Texture | undefined;
            if (!tex) {
              untextured++;
              return;
            }
            names.add(tex.name || '(unnamed)');
          });
        }
        return {
          textures: [...names].sort(),
          meshes,
          triangles: Math.round(tris),
          untexturedMeshes: untextured,
          foreignMaterials,
          lights: this.world.lights.length,
          fixtures: this.world.fixtures.length,
          blockers: this.grid.blockers.length,
          lowRes: [this.psx.lowResWidth, this.psx.lowResHeight],
        };
      },
      /**
       * Exercises the whole audio graph: starts the context, fires every
       * one-shot both flat and positional, and runs the continuous sources.
       * Reports what failed rather than throwing, so the test can report it.
       */
      audioSelfTest: () => {
        const A = this.audio;
        A.muted = false;
        A.start();
        const names: SfxName[] = [
          'step_concrete', 'step_metal', 'step_tile', 'knock', 'relay', 'clunk', 'latch',
          'denied', 'accept', 'beep', 'switch', 'pickup', 'shimmer', 'gunshot', 'dryfire',
          'roar', 'scream', 'hit', 'demon_die', 'rumble', 'drip', 'rat',
        ];
        const failures: string[] = [];
        for (const n of names) {
          try {
            A.play(n);
            A.play(n, { x: 1, y: 1, z: 1 }, 0.5);
          } catch (e) {
            failures.push(`${n}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        try {
          A.setDrone(0.5);
          A.setHum(0.5, { x: 0, y: 1, z: 0 });
          A.setGrowl(0.6, { x: 2, y: 1, z: 2 }, 0.8);
          A.setHeartbeat(90);
          A.setListener({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 0 });
          for (let i = 0; i < 40; i++) A.update(1 / 60);
        } catch (e) {
          failures.push(`continuous sources: ${e instanceof Error ? e.message : String(e)}`);
        }
        A.setHeartbeat(0);
        return {
          started: A.started,
          contextState: A.contextState,
          oneShotsFired: names.length * 2,
          failures,
        };
      },
      openFrontDoor: () => {
        this.run.progress.doorUnlocked = true;
        this.syncPropVisibility();
      },
      /**
       * Fast-forward mode for the route tests: skips rendering and silences
       * audio, because thousands of simulated seconds compressed into real
       * time would otherwise schedule every footstep on the same instant.
       */
      setRenderEnabled: (on: boolean) => {
        this.renderEnabled = on;
        this.audio.muted = !on;
      },
    };
  }

  /**
   * The nearest point a body of player radius can stand in order to reach a
   * target: used by the route tests so walking to a wall-mounted device means
   * standing in front of it, not inside its housing.
   */
  private approachPoint(x: number, z: number): { x: number; z: number } {
    let best = { x, z };
    let bestD = Infinity;
    const gx0 = gxOf(x);
    const gz0 = gzOf(z);
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const gx = gx0 + dx;
        const gz = gz0 + dz;
        if (this.grid.isBlockedForNav(gx, gz)) continue;
        const px = cx(gx);
        const pz = cz(gz);
        if (this.grid.discBlocked(px, pz, PLAYER_RADIUS)) continue;
        if (!this.grid.sightClear(px, pz, x, z)) continue;
        const d = Math.hypot(px - x, pz - z);
        if (d < bestD) {
          bestD = d;
          best = { x: px, z: pz };
        }
      }
    }
    // Slide in from that cell centre toward the target, so the standing spot
    // is right in front of the thing rather than up to a cell and a half away.
    if (bestD < Infinity && bestD > 0.001) {
      const ux = (best.x - x) / bestD;
      const uz = (best.z - z) / bestD;
      for (let d = 0.8; d < bestD; d += 0.2) {
        const px = x + ux * d;
        const pz = z + uz * d;
        if (!this.grid.discBlocked(px, pz, PLAYER_RADIUS) && !this.grid.isBlockedForNav(gxOf(px), gzOf(pz))) {
          return { x: px, z: pz };
        }
      }
    }
    return best;
  }

  private pickScreenChoice(labelOrIndex: string | number): void {
    const cur = (this.screens as unknown as { current: { choices: { label: string; onPick?: () => void }[] } | null }).current;
    if (!cur) throw new Error('no screen open');
    let choice;
    if (typeof labelOrIndex === 'number') choice = cur.choices[labelOrIndex];
    else choice = cur.choices.find((c) => c.label.toUpperCase().includes(labelOrIndex.toUpperCase()));
    if (!choice) throw new Error(`no choice matching ${labelOrIndex} in [${cur.choices.map((c) => c.label).join(' | ')}]`);
    choice.onPick?.();
  }

  private debugPressPuzzleControl(id: string): void {
    const ph = this.puzzles as unknown as {
      controls: { id: string }[];
      sel: number;
      actuate: () => void;
    };
    const i = ph.controls.findIndex((c) => c.id === id);
    if (i < 0) throw new Error(`no puzzle control ${id} in [${ph.controls.map((c) => c.id).join(',')}]`);
    ph.sel = i;
    ph.actuate();
  }

  /**
   * Drive the player along a path to a point using the real movement and
   * collision code, so route tests exercise what a human would.
   */
  private debugWalkTo(x: number, z: number, maxSteps: number, speed = 4.3): boolean {
    const dt = 1 / 60;
    let path: Array<{ x: number; z: number }> | null = null;
    let pathAge = 0;
    let replans = 0;
    // Wedge detection by displacement over a window: straight-line distance to
    // the goal is not monotonic in a maze, so it cannot be the progress metric.
    let markX = this.player.x;
    let markZ = this.player.z;
    let sinceMark = 0;
    for (let i = 0; i < maxSteps; i++) {
      if (Math.hypot(x - this.player.x, z - this.player.z) < 0.6) return true;

      if (++sinceMark >= 90) {
        const travelled = Math.hypot(this.player.x - markX, this.player.z - markZ);
        sinceMark = 0;
        markX = this.player.x;
        markZ = this.player.z;
        if (travelled < 1.0) {
          path = null;
          if (++replans > 8) return false;
        }
      }

      if (!path || !path.length || pathAge > 45) {
        path = this.grid.findPath(this.player.x, this.player.z, x, z);
        pathAge = 0;
        if (!path || !path.length) return false;
      }
      pathAge++;
      while (path.length > 1 && Math.hypot(path[0].x - this.player.x, path[0].z - this.player.z) < 0.7) {
        path.shift();
      }
      const wp = path[0];
      const wdx = wp.x - this.player.x;
      const wdz = wp.z - this.player.z;
      const len = Math.hypot(wdx, wdz) || 1;
      this.player.yaw = Math.atan2(wdx, wdz);
      const moved = this.grid.moveDisc(
        this.player.x,
        this.player.z,
        (wdx / len) * speed * dt,
        (wdz / len) * speed * dt,
        PLAYER_RADIUS,
      );
      this.player.x = moved.x;
      this.player.z = moved.z;
      this.player.speed = speed;
      this.player.sprinting = speed > 5;
      this.step(dt);
      if (this.phase === 'death' || this.phase === 'ending') return false;
    }
    return Math.hypot(x - this.player.x, z - this.player.z) < 1.2;
  }
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}

function countWalkable(grid: Grid): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] !== 0) n++;
  return n;
}

/** Flood fill from the player's start cell; used by the layout test. */
function connectedFromStart(grid: Grid): number {
  const start = grid.nearestWalkable(gxOf(cx(Math.floor(PLAYER_START.gx))), gzOf(cz(Math.floor(PLAYER_START.gz))));
  if (!start) return 0;
  const seen = new Set<number>();
  const stack = [start[1] * 64 + start[0]];
  while (stack.length) {
    const idx = stack.pop() as number;
    if (seen.has(idx)) continue;
    seen.add(idx);
    const gx = idx % 64;
    const gz = (idx / 64) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = gx + dx;
      const nz = gz + dz;
      if (!grid.inBounds(nx, nz)) continue;
      if (grid.cellAt(nx, nz) === 0) continue;
      const ni = nz * 64 + nx;
      if (!seen.has(ni)) stack.push(ni);
    }
  }
  return seen.size;
}

export { EYE_HEIGHT, TILE };
