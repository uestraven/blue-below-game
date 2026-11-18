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
  PATROL,
  REVEAL,
  FALSE_WALL,
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
import {
  Player,
  EYE_HEIGHT,
  PLAYER_RADIUS,
  WALK_SPEED,
  SPRINT_SPEED,
  STAMINA_DRAIN,
  STAMINA_REGEN,
} from './player';
import { Demon, DEMON_RADIUS, SPEED_CHASE } from './demon';
import { Flares } from './flares';
import { DEMON_SIGHT } from '../world/layout';
import { RunState, FLARE_GUN_LOADED, FLARE_SUPPRESSION_SECONDS } from './state';
import { Hud } from '../ui/hud';
import { PuzzleHost, type PuzzleKind } from '../ui/puzzles';
import {
  ScreenHost,
  ritualDecisionScreen,
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
/** Length of the protected ritual sequence, in seconds. */
const RITUAL_SECONDS = 3.2;

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
  flares!: Flares;
  /**
   * Development-only AI visualisation. Constructed only when the debug build
   * flag is set, so the release bundle neither contains it nor can show it.
   */
  aiDebug: import('./aidebug').AiDebug | null = null;

  phase: Phase = 'title';
  private interactables: Interactable[] = [];
  private focused: Interactable | null = null;
  private readables = new Map<string, Readable>();
  private gunGroup = new THREE.Group();
  private gunRecoil = 0;
  private knockTimer = 18;
  private draughtTimer = 1;
  private ritualTimer = 0;
  /**
   * Counts down while the player has never sprinted. Sprinting is the single
   * most important verb in a chase and the first playtester did not know it
   * existed, so it gets taught in the safe part of the game and again at the
   * exact moment it matters.
   */
  private sprintHintTimer = 24;
  private sprintTaught = false;
  private revealClock = 0;
  private endingFade = 0;
  private deathFade = 0;
  private fadeIn = 1;
  private time = 0;
  /** True when the run is live but the browser has not given us the mouse. */
  private pendingResumeCapture = false;
  /** Disabled by the route tests while fast-forwarding scripted movement. */
  renderEnabled = true;
  /** The hide spot the player is currently inside, if any. */
  private currentHideSpot: import('../world/props').HideSpot | null = null;
  /** Kinds of hiding place already used, so the flavour line shows once each. */
  private readonly hideKindsSeen = new Set<string>();

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
    this.flares = new Flares(this.psx, this.grid);
    this.scene.add(this.flares.root);
    this.demon = new Demon(this.psx, this.world);
    this.scene.add(this.demon.group);
    this.demon.onCatch = () => this.onCaught();
    this.demon.extraLight = (x, y, z, out) => this.flares.sample(x, y, z, out);
    this.demon.seed(this.run.seed);
    this.demon.onSpot = () => {
      this.audio.play('roar', this.demon.centre, 0.9);
      this.hud.toast(this.sprintTaught ? 'It has seen you.' : 'It has seen you. HOLD SHIFT TO RUN.', 2.6);
    };

    this.puzzles = new PuzzleHost(this.uiRoot, this.run, {
      onClose: () => this.closePuzzle(),
      onSolved: (k) => this.onPuzzleSolved(k),
      sfx: (n) => this.audio.play(n),
    });

    this.buildGunViewmodel();
    this.setupAiDebug();
    this.registerInteractables();
    this.syncPropVisibility();
    this.resetPlayerToStart();
  }

  /**
   * Wire up the AI debug overlay, if this is a development build. The dynamic
   * import keeps the module out of the release bundle entirely.
   */
  private setupAiDebug(): void {
    if (import.meta.env.VITE_DEBUG_API !== '1') return;
    void import('./aidebug').then(({ AiDebug }) => {
      const dbg = new AiDebug(this.uiRoot);
      this.aiDebug = dbg;
      this.scene.add(dbg.root);
      window.addEventListener('keydown', (e) => {
        if (e.code === 'F3') {
          e.preventDefault();
          dbg.toggle();
        }
      });
    });
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
    this.demon.extraLight = (x, y, z, out) => this.flares.sample(x, y, z, out);
    this.demon.seed(this.run.seed);
    this.demon.onSpot = () => {
      this.audio.play('roar', this.demon.centre, 0.9);
      this.hud.toast(this.sprintTaught ? 'It has seen you.' : 'It has seen you. HOLD SHIFT TO RUN.', 2.6);
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
    this.player.hidden = false;
    this.currentHideSpot = null;
    this.hud.setHidden(null);
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
    // Signal pistol, not a revolver: a fat stubby muzzle and a blunt breech.
    const body = SURFACE.flareBody();
    const grip = SURFACE.gunGrip();
    this.gunGroup.add(mkPart(0.052, 0.055, 0.17, 0, 0.014, -0.1, body)); // barrel
    this.gunGroup.add(mkPart(0.062, 0.07, 0.07, 0, 0.004, 0.015, body)); // breech
    this.gunGroup.add(mkPart(0.034, 0.1, 0.045, 0, -0.058, 0.07, grip)); // grip
    this.gunGroup.add(mkPart(0.02, 0.03, 0.024, 0, -0.024, 0.042, body)); // guard
    // Muzzle flash quad, hidden until it fires.
    const flashGeo = new THREE.PlaneGeometry(0.16, 0.16);
    flashGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(flashGeo.attributes.position.count * 3).fill(1), 3));
    const flashMat = this.psx.createMaterial({
      map: flatTexture('flash', PAL.bloodLit),
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

    // Held low and to the right, and small: a signal pistol is a stubby thing
    // and at this overlay FOV the parts subtend far more than their size
    // suggests.
    this.gunGroup.scale.setScalar(0.46);
    this.gunGroup.position.set(0.125, -0.085, -0.34);
    this.gunGroup.rotation.y = -0.14;
    this.gunGroup.rotation.z = 0.06;
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
      visible: () => run().progress.safeOpen && !run().progress.hasCabinetKey,
      ready: () => true,
      label: () => 'Take the steel cabinet key',
      activate: () => {
        run().progress.hasCabinetKey = true;
        this.audio.play('pickup');
        this.hud.toast('Steel cabinet key. It opens the breaker cabinet in the generator hall.', 3.6);
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
        if (!p.hasCabinetKey) return 'Breaker cabinet (needs the steel key)';
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
        if (!p.hasCabinetKey) {
          this.audio.play('denied');
          this.hud.toast(
            p.hasBoxKey
              ? 'The brass key does not fit this. It needs the steel key from the workshop safe.'
              : 'Keyed access only. The steel key is in the workshop safe.',
            3.6,
          );
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

    // ---- the flare gun ---------------------------------------------------
    list.push({
      id: 'flare-gun',
      pos: P.flareGunAnchor.pos,
      normal: null,
      radius: 2.8,
      visible: () => !run().progress.hasFlareGun,
      ready: () => true,
      label: () => 'Take the signal pistol',
      activate: () => {
        const p = run().progress;
        p.hasFlareGun = true;
        p.flares += FLARE_GUN_LOADED;
        this.audio.play('pickup');
        this.hud.toast(
          'Signal pistol, loaded with one flare. Left click to fire. A flare lights a room, ' +
            'and a flare in the thing itself will buy you a minute.',
          6.5,
        );
        this.syncPropVisibility();
      },
    });

    // ---- the three loose flares ------------------------------------------
    for (const pickup of P.flarePickups) {
      list.push({
        id: pickup.id,
        pos: pickup.pos,
        normal: null,
        radius: 2.6,
        visible: () => !run().progress.flaresTaken.includes(pickup.id),
        ready: () => true,
        label: () => 'Take the flare',
        activate: () => {
          const p = run().progress;
          if (p.flaresTaken.includes(pickup.id)) return;
          p.flaresTaken.push(pickup.id);
          p.flares += 1;
          this.audio.play('pickup');
          this.hud.toast(
            p.hasFlareGun
              ? `Flare. ${p.flares} in hand.`
              : 'A flare cartridge. No use without the pistol it goes in.',
            3.0,
          );
          this.syncPropVisibility();
        },
      });
    }

    // ---- the brass key, for the personal box -----------------------------
    list.push({
      id: 'box-key',
      pos: P.boxKeyAnchor.pos,
      normal: null,
      radius: 2.6,
      visible: () => !run().progress.hasBoxKey,
      ready: () => true,
      label: () => 'Take the brass key',
      activate: () => {
        run().progress.hasBoxKey = true;
        this.audio.play('pickup');
        this.hud.toast("Small brass key. Too small for anything on a door. Someone's own lock.", 4.2);
        this.syncPropVisibility();
      },
    });

    // ---- Harding's personal box -------------------------------------------
    list.push({
      id: 'personal-box',
      pos: P.personalBoxAnchor.pos,
      normal: null,
      radius: 2.8,
      visible: () => !run().progress.personalBoxOpen,
      ready: () => run().progress.hasBoxKey,
      label: () =>
        run().progress.hasBoxKey ? 'Unlock the personal box' : 'Personal box (locked)',
      activate: () => {
        const p = run().progress;
        if (!p.hasBoxKey) {
          this.audio.play('denied');
          this.openReadableCustom('personal-box', "PERSONAL BOX - R. HARDING", [
            'A steel deed box, bolted to the shelf, with a small brass lock on',
            'the front. The kind of lock that is there to stop colleagues, not',
            'thieves - and you do not have anything small enough to turn it.',
            '',
            'Something shifts inside when you tilt it. Not papers. Something',
            'with weight and edges.',
            '',
            'The tag on the lid reads R. HARDING.',
          ]);
          return;
        }
        p.personalBoxOpen = true;
        this.audio.play('latch', P.personalBoxAnchor.pos, 0.9);
        this.hud.toast('The brass key turns. There is a crucifix inside, wrapped in a shirt.', 4.5);
        this.syncPropVisibility();
      },
    });

    // ---- the cross -------------------------------------------------------
    list.push({
      id: 'cross',
      pos: P.crossAnchor.pos,
      normal: null,
      radius: 2.6,
      // Collectable exactly once: gone from the box, and gone for good once
      // it has been placed in the seal.
      visible: () =>
        run().progress.personalBoxOpen && !run().progress.hasCross && !run().progress.crossPlaced,
      ready: () => true,
      label: () => 'Take the crucifix',
      activate: () => {
        const p = run().progress;
        if (p.hasCross || p.crossPlaced) return;
        p.hasCross = true;
        this.audio.play('pickup');
        this.hud.toast('A heavy brass crucifix. Consecrated, by the look of the wear on it.', 4.2);
        this.syncPropVisibility();
      },
    });

    // ---- the seal in the sealed store ------------------------------------
    list.push({
      id: 'pentagram',
      pos: P.pentagramAnchor.pos,
      normal: null,
      radius: 3.2,
      visible: () => !run().progress.crossPlaced,
      ready: () => run().progress.hasCross,
      label: () => (run().progress.hasCross ? 'Place the cross in the seal' : 'Examine the seal'),
      activate: () => {
        if (run().progress.crossPlaced) return;
        if (!run().progress.hasCross) {
          run().progress.pentagramInspected = true;
          this.audio.play('beep');
          this.openReadableCustom('pentagram', 'THE SEAL', [
            'A pentagram, cut into the concrete floor rather than painted on',
            'it, inside a double ring. The cuts are packed with something dark',
            'that has not dried in however many years it has been down here,',
            'and it is putting out a faint red light of its own.',
            '',
            'Nothing is written in it. Nothing is burning in it. It is not',
            'doing anything at all.',
            '',
            'There is a clean space in the middle of the star, about the size',
            'of two hands, worn smoother than the rest of the floor - as if',
            'something was meant to be set down there and never was.',
          ]);
          return;
        }
        this.openRitualDecision();
      },
    });

    // ---- hiding places --------------------------------------------------
    for (const spot of this.props.hideSpots) {
      list.push({
        id: spot.id,
        pos: spot.pos,
        normal: null,
        radius: 2.6,
        visible: () => !this.player.hidden,
        ready: () => true,
        label: () => spot.label,
        activate: () => this.enterHide(spot.id),
      });
    }

    // ---- ordinary readables from the props pass -------------------------
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
    this.hud.toast('Have a look at the front door before you go anywhere. Hold SHIFT to run.', 6.0);
    this.sprintHintTimer = 24;
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

  // ================================================================== ritual

  /** Offer to place the cross. A decision, like the diamond, not a reflex. */
  private openRitualDecision(): void {
    if (this.run.progress.crossPlaced) return;
    this.phase = 'menu';
    this.input.gameplayEnabled = false;
    this.input.releaseAll();
    this.screens.show(() =>
      ritualDecisionScreen({
        onPlace: () => this.performRitual(),
        onBack: () => this.resumeFromMenu(),
      }),
    );
  }

  /**
   * Place the cross and resolve the ritual. Permanent, and exactly once.
   *
   * Has to work from every state the demon can be in when the player gets
   * here: hunting, suspended behind a device panel, burning, already absent on
   * a flare budget, or not yet released at all because the diamond is still on
   * its pedestal. The last case is deferred to the reveal - see
   * `playReveal` - so the stone still has to be lifted for the ritual to
   * mean anything.
   */
  private performRitual(): void {
    const p = this.run.progress;
    if (p.crossPlaced) return;
    p.crossPlaced = true;
    p.hasCross = false;
    this.screens.close();
    this.syncPropVisibility();

    this.phase = 'play';
    this.input.gameplayEnabled = true;
    this.input.releaseAll();

    // Nothing can touch the player while this plays out.
    this.ritualTimer = RITUAL_SECONDS;
    this.player.controlLocked = true;
    this.player.lockViewTo(this.props.pentagramAnchor.pos);
    this.demon.suspend();
    this.audio.play('ritual', this.props.pentagramAnchor.pos, 1);

    if (!p.diamondTaken) {
      // The thing is not out yet. The seal is armed and will take it the
      // moment lifting the stone lets it loose.
      this.hud.toast(
        'The crucifix settles into the worn patch and the cuts in the floor go bright. ' +
          'Whatever this is waiting for, it has not arrived yet.',
        6.5,
      );
      return;
    }
    this.hud.toast('The crucifix settles into the worn patch. The floor takes a breath in.', 5.0);
  }

  /** The moment the ritual actually ends the demon. Idempotent. */
  private resolveRitualKill(): void {
    const p = this.run.progress;
    if (p.ritualDone) return;
    p.ritualDone = true;
    // Any pending flare-suppression return is cancelled: it is not coming back.
    p.demonAbsence = 0;
    p.demonDead = true;
    this.demon.resume(0);
    this.demon.kill();
    this.audio.play('demon_die', this.demon.centre, 1);
    this.audio.play('ritual', this.props.pentagramAnchor.pos, 0.8);
    this.audio.setHeartbeat(0);
    this.hud.toast(
      'It is dragged down into the lines in the floor, and the light in the cuts goes out behind it.',
      6.5,
    );
  }

  /** Runs the protected ritual window, then resolves the kill. */
  private tickRitual(dt: number): void {
    if (this.ritualTimer <= 0) return;
    this.ritualTimer -= dt;
    this.psx.setFade(Math.min(0.75, (RITUAL_SECONDS - this.ritualTimer) * 0.5), 0xa8181c);
    if (this.ritualTimer > 0) return;
    this.psx.setFade(0);
    this.player.controlLocked = false;
    this.player.releaseView();
    // If the demon is out, this is where it dies. If it is not out yet, the
    // seal stays armed and the reveal resolves it.
    if (this.run.progress.diamondTaken && this.demon.state !== 'dormant') {
      this.resolveRitualKill();
    } else {
      this.demon.resume(PUZZLE_GRACE);
    }
  }

  // ================================================================== hiding

  /**
   * Climb into a hide spot. Unlike a device panel this does NOT suspend the
   * demon: the world keeps running and it keeps hunting. The player simply
   * stops being perceivable, so it loses the trail, searches, and moves on.
   */
  enterHide(id: string): void {
    if (this.phase !== 'play' || this.player.hidden) return;
    const spot = this.props.hideSpots.find((h) => h.id === id);
    if (!spot) return;
    this.input.releaseAll();
    // If it watched you climb in, it knows where you were - not that you are
    // in there. It comes and looks at the spot.
    const witnessed = this.demon.senses.sees;
    this.currentHideSpot = spot;
    this.player.enterHide(spot.cam, spot.yaw, spot.yawRange);
    if (witnessed) this.demon.noteHidingObserved(this.player.x, this.player.z);
    this.hud.setHidden(spot.kind);
    this.audio.play('clunk', undefined, 0.35);
    if (!this.hideKindsSeen.has(spot.kind)) {
      this.hideKindsSeen.add(spot.kind);
      this.hud.toast(spot.flavour, 4.0);
    } else {
      this.hud.toast('Hidden. It cannot see or hear you in here.', 2.4);
    }
  }

  exitHide(): void {
    if (!this.player.hidden) return;
    const at = this.currentHideSpot?.exit;
    this.player.exitHide(at ?? new THREE.Vector3(this.player.x, 0, this.player.z));
    this.currentHideSpot = null;
    this.hud.setHidden(null);
    this.input.releaseAll();
    this.audio.play('clunk', undefined, 0.3);
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
    this.player.hidden = false;
    this.currentHideSpot = null;
    this.hud.setHidden(null);
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
    this.props.flareGunMesh.visible = !p.hasFlareGun;
    for (const pickup of this.props.flarePickups) {
      pickup.mesh.visible = !p.flaresTaken.includes(pickup.id);
    }
    this.props.boxKeyMesh.visible = !p.hasBoxKey;
    // Lid swings up and back when the box is unlocked.
    this.props.personalBoxLid.rotation.x = p.personalBoxOpen ? -1.9 : 0;
    this.props.crossMesh.visible = p.personalBoxOpen && !p.hasCross && !p.crossPlaced;
    this.props.pentagram.visible = true;
    this.props.placedCross.visible = p.crossPlaced;
    this.props.keyMesh.visible = p.safeOpen && !p.hasCabinetKey;
    this.props.safeDoor.visible = !p.safeOpen;
    this.props.breakerDoor.visible = !p.hasCabinetKey;
    this.gunGroup.visible = p.hasFlareGun;
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
      this.demon.update(
        d,
        this.grid,
        {
          x: this.player.x,
          z: this.player.z,
          speed: this.player.speed,
          sprinting: this.player.sprinting,
          floorY: this.grid.floorHeight(this.player.x, this.player.z),
        },
        this.player.hidden,
      );
    }

    // Active-gameplay clocks. Deliberately not ticked in menus, endings or
    // the death screen, and the suppression clock additionally stops while a
    // device panel has the demon suspended.
    if (this.phase === 'play' || this.phase === 'reading') {
      this.flares.update(d, this.player.camera.position, this.demon.group.visible ? this.demon.centre : null);
      this.tickDemonAbsence(d);
      this.tickRitual(d);
    } else if (this.phase === 'puzzle') {
      // Flares keep burning while a panel is open, but the demon's return
      // clock does not: the brief requires a puzzle interaction to pause it.
      this.flares.update(d, this.player.camera.position, null);
      this.tickRitual(d);
    }

    if (this.phase === 'play' || this.phase === 'reading') {
      this.checkReveal(d);
      this.checkThreshold();
      this.checkSecretRoom();
      this.autoDiscoverClues();
      this.ambientKnocks(d);
      this.draughtCue(d);
      this.teachSprint(d);
    }

    if (this.phase === 'reading') this.checkReadingInterrupt();

    this.updateFocus();
    this.updateHud();
    this.updateAudio(d);
    this.animateWorld(d);
    this.aiDebug?.update(this.demon, DEMON_SIGHT.fovDegrees, DEMON_SIGHT.range);
    this.render(d);
  }

  private handlePlayInput(dt: number): void {
    // While hidden, E and Esc both mean "get out" rather than interact/pause.
    if (this.player.hidden) {
      if (this.input.consumePress('interact') || this.input.consumePress('cancel')) {
        this.exitHide();
      }
      this.input.consumeClick();
      return;
    }
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
    if (!p.hasFlareGun) return;
    if (p.flares <= 0) {
      this.audio.play('dryfire');
      this.hud.toast('Empty. Nothing left to load.', 2.4);
      return;
    }
    p.flares -= 1;
    p.flaresFired += 1;
    this.gunRecoil = 1;
    this.audio.play('flare_fire', undefined, 1);
    const flash = this.gunGroup.getObjectByName('muzzleflash');
    if (flash) flash.visible = true;

    // Judge the shot once, here, against what the player had down the sights.
    const hit = this.shotHitsDemon();
    const dir = this.player.forward.clone().normalize();
    this.flares.onIgniteDemon = hit ? () => this.igniteDemon() : null;
    this.flares.fire(this.player.camera.position, dir, hit, hit ? this.demon.centre : null);

    if (hit) {
      this.hud.toast('A hit. It goes up like a dry hedge.', 4.0);
    } else {
      this.hud.toast(
        p.flares > 0
          ? `The flare skids off down the corridor, burning. ${p.flares} left.`
          : 'The flare skids off down the corridor, burning. That was the last one.',
        4.0,
      );
    }
  }

  /**
   * A flare has landed in the demon. It burns, screams, and goes off the board
   * for a fixed budget of *active* gameplay seconds - not wall-clock, and not
   * counted while a panel has it suspended or the game is paused.
   *
   * This is relief, not a kill. Only the ritual is permanent.
   */
  private igniteDemon(): void {
    if (!this.demon.alive || this.demon.state === 'dormant') return;
    if (this.run.progress.ritualDone) return;
    const at = this.demon.centre;
    this.run.progress.demonAbsence = FLARE_SUPPRESSION_SECONDS;
    this.demon.ignite();
    this.audio.play('demon_ignite', at, 1);
    this.audio.play('scream', at, 1);
    this.audio.setHeartbeat(0);
    this.hud.toast(
      'It burns. It goes through the wall still burning, and the sound of it moves away under the floor.',
      6.0,
    );
  }

  /**
   * Burn down the suppression budget and bring the demon back. Called only
   * with active-gameplay dt, so pausing or opening a panel stops the clock.
   */
  private tickDemonAbsence(dt: number): void {
    const p = this.run.progress;
    if (p.ritualDone || p.demonAbsence <= 0) return;
    const before = p.demonAbsence;
    p.demonAbsence = Math.max(0, p.demonAbsence - dt);

    // One audible warning before it is back on the board.
    if (before > 6 && p.demonAbsence <= 6) {
      this.audio.play('rumble', undefined, 0.8);
      this.hud.toast('Somewhere a long way off, something starts moving again.', 4.0);
    }
    if (p.demonAbsence > 0) return;

    const spot = this.pickReturnPoint();
    this.demon.returnFromBurn(spot.gx, spot.gz, this.player.x, this.player.z);
    this.audio.play('roar', this.demon.centre, 0.95);
    this.hud.toast('It is back, and it is not burning any more.', 4.0);
  }

  /**
   * Somewhere out of the player's lap and out of their sight: a patrol node
   * that is far enough away and has no line of sight to the player.
   */
  private pickReturnPoint(): { gx: number; gz: number } {
    let best: { gx: number; gz: number } | null = null;
    let bestScore = -Infinity;
    for (const [gx, gz] of PATROL) {
      const wx = cx(gx);
      const wz = cz(gz);
      const d = Math.hypot(wx - this.player.x, wz - this.player.z);
      if (d < 18) continue; // not in the player's immediate vicinity
      const seen = this.grid.sightClear(this.player.x, this.player.z, wx, wz);
      // Prefer out of sight, then moderate distance over the far side of the map.
      const score = (seen ? -1000 : 0) - Math.abs(d - 30);
      if (score > bestScore) {
        bestScore = score;
        best = { gx, gz };
      }
    }
    return best ?? { gx: PATROL[0][0], gz: PATROL[0][1] };
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
    if (p.crossPlaced && !p.ritualDone) {
      // The seal was armed before the stone was lifted. It appears, and the
      // floor takes it immediately - same permanent outcome, staged here.
      this.audio.play('scream', this.demon.centre, 1);
      this.resolveRitualKill();
      this.hud.toast(
        'It comes up out of the dark at the end of the tunnel, and the seal you armed takes it ' +
          'before it reaches you.',
        7.0,
      );
      return;
    }
    this.audio.play('scream', this.demon.centre, 1);
    this.audio.play('rumble', undefined, 1);
    this.hud.toast(
      this.sprintTaught
        ? 'Something is standing at the far end of the tunnel. Somewhere below, a bus closes - the building has power again.'
        : 'Something is standing at the far end of the tunnel. HOLD SHIFT TO RUN.',
      6.0,
    );
  }

  // ------------------------------------------------------------- thresholds

  private checkThreshold(): void {
    const p = this.run.progress;
    if (!p.doorUnlocked) return;
    if (this.player.z < FRONT_DOOR.thresholdZ) return;
    if (!p.diamondTaken) return;
    // Permanent death is the ritual and only the ritual. A demon that is
    // merely absent on a flare budget is still alive, so this is a Bad Ending.
    this.finishEnding(this.run.demonPermanentlyDead ? 'good' : 'bad');
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

  /**
   * The false wall's only cue, other than the seam and the scratches: you can
   * hear air moving through it. Replaces the sign that used to stand here and
   * gave the secret away to anyone walking past.
   */
  private draughtCue(dt: number): void {
    this.draughtTimer -= dt;
    if (this.draughtTimer > 0) return;
    const fx = cx(FALSE_WALL.gx);
    const fz = cz(FALSE_WALL.gz);
    const d = Math.hypot(this.player.x - fx, this.player.z - fz);
    if (d > 10) {
      this.draughtTimer = 0.5;
      return;
    }
    this.draughtTimer = 3.4 + Math.random() * 2.6;
    this.audio.play('draught', { x: fx, y: 1.4, z: fz }, 1 - d / 14);
  }

  /** Teach sprinting before it is needed, and stop as soon as it is used. */
  private teachSprint(dt: number): void {
    if (this.sprintTaught) return;
    if (this.player.sprinting) {
      this.sprintTaught = true;
      this.sprintHintTimer = Infinity;
      return;
    }
    this.sprintHintTimer -= dt;
    if (this.sprintHintTimer > 0) return;
    this.sprintHintTimer = 50;
    this.hud.toast('Hold SHIFT to run. The bar at the bottom right is how much running you have left.', 5.5);
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
    this.hud.setAiming(p.hasFlareGun && p.flares > 0);
    if (this.player.hidden) {
      this.hud.setPrompt('Come out', 'E');
      this.hud.setInventory(this.inventoryLines());
      this.hud.setStamina(this.player.stamina, true);
      this.updateThreatCue();
      return;
    }
    if (this.pendingResumeCapture && !this.input.captured) {
      // The browser has not handed the mouse back yet; say so plainly rather
      // than leaving the player wondering why looking around does nothing.
      this.hud.setPrompt('Click to take the mouse back', 'LMB');
    } else if (this.focused) {
      this.hud.setPrompt(this.focused.label(), 'E', !this.focused.ready());
    } else {
      this.hud.setPrompt(null);
    }

    this.hud.setInventory(this.inventoryLines());
    this.hud.setStamina(this.player.stamina, true);

    this.updateThreatCue();
  }

  private inventoryLines(): Array<{ cls: string; mark: string; text: string }> {
    const p = this.run.progress;
    const lines: Array<{ cls: string; mark: string; text: string }> = [];
    if (p.diamondTaken) lines.push({ cls: 'diamond', mark: '[*]', text: 'blue diamond' });
    if (p.hasCabinetKey) lines.push({ cls: 'key', mark: '[=]', text: 'steel key - breaker cabinet' });
    if (p.hasBoxKey) lines.push({ cls: 'key', mark: '[-]', text: 'brass key - personal box' });
    if (p.hasCross) lines.push({ cls: 'cross', mark: '[+]', text: 'brass crucifix' });
    if (p.hasFlareGun) {
      lines.push(
        p.flares > 0
          ? { cls: 'gun', mark: `[${p.flares}]`, text: p.flares === 1 ? 'signal pistol - 1 flare' : `signal pistol - ${p.flares} flares` }
          : { cls: 'gun spent', mark: '[ ]', text: 'signal pistol - empty' },
      );
    } else if (p.flares > 0) {
      lines.push({ cls: 'gun spent', mark: `[${p.flares}]`, text: 'flares - no pistol' });
    }
    if (p.cluesFound.length > 0) {
      lines.push({ cls: 'clues', mark: `[${p.cluesFound.length}]`, text: 'of 4 wall letters (TAB)' });
    }
    return lines;
  }

  /** Directional demon cue: a marker at the screen edge plus the threat text. */
  private updateThreatCue(): void {
    // Burned off and counting down: say so, and say roughly how long is left,
    // because spending a flare is a tactical decision and the player has to be
    // able to plan around what they bought.
    if (this.run.demonSuppressed) {
      this.hud.setThreat(0, null);
      this.hud.setThreatText(`BURNING SOMEWHERE - ${Math.ceil(this.run.progress.demonAbsence)}`);
      return;
    }
    this.hud.setThreatText(null);
    if (!this.demon.alive || this.demon.state === 'dormant') {
      this.hud.setThreat(0, null);
      return;
    }
    const dx = this.demon.x - this.player.x;
    const dz = this.demon.z - this.player.z;
    const dist = Math.hypot(dx, dz);
    const stateScale =
      this.demon.state === 'chase' || this.demon.state === 'attack'
        ? 1
        : this.demon.state === 'lostSight'
          ? 0.72
          : this.demon.state === 'reveal'
            ? 0.9
            : 0.5;
    const level = Math.max(0, 1 - dist / 42) * stateScale * (this.demon.suspended ? 0.35 : 1);
    const fwd = dx * Math.sin(this.player.yaw) + dz * Math.cos(this.player.yaw);
    const rgt = dx * Math.cos(this.player.yaw) - dz * Math.sin(this.player.yaw);
    this.hud.setThreat(level, Math.atan2(rgt, fwd));
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
    // Pickups turn slowly and their glints face the camera.
    for (const grp of [
      this.props.flareGunMesh,
      this.props.boxKeyMesh,
      this.props.crossMesh,
      ...this.props.flarePickups.map((f) => f.mesh),
    ]) {
      if (!grp.visible) continue;
      grp.rotation.y += dt * 0.5;
      const glint = (grp.userData as { glint?: THREE.Mesh }).glint;
      if (glint) {
        glint.lookAt(this.player.camera.position);
        glint.rotation.z = 0;
      }
    }
    // The seal's haze faces the camera too.
    const haze = (this.props.pentagram.userData as { haze?: THREE.Mesh }).haze;
    if (haze) {
      haze.lookAt(this.player.camera.position);
      haze.rotation.z = 0;
    }

    // Gun viewmodel sway and recoil.
    if (this.gunGroup.visible) {
      const sway = Math.sin(this.time * 2.2) * 0.004;
      const bob = Math.min(1, this.player.speed / 4.3);
      this.gunGroup.position.set(
        0.125 + sway,
        -0.085 + Math.sin(this.time * 7) * 0.004 * bob + this.gunRecoil * 0.02,
        -0.34 + this.gunRecoil * 0.05,
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
        player: {
          x: this.player.x,
          z: this.player.z,
          yaw: this.player.yaw,
          region: this.grid.regionIdAt(this.player.x, this.player.z),
          hidden: this.player.hidden,
        },
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
      flareState: () => ({
        hasGun: this.run.progress.hasFlareGun,
        flares: this.run.progress.flares,
        fired: this.run.progress.flaresFired,
        taken: [...this.run.progress.flaresTaken],
        burning: this.flares.burningCount,
        active: this.flares.activeCount,
      }),
      ritualState: () => ({
        hasBoxKey: this.run.progress.hasBoxKey,
        boxOpen: this.run.progress.personalBoxOpen,
        hasCross: this.run.progress.hasCross,
        crossPlaced: this.run.progress.crossPlaced,
        ritualDone: this.run.progress.ritualDone,
        pentagramInspected: this.run.progress.pentagramInspected,
        permanentlyDead: this.run.demonPermanentlyDead,
        suppressed: this.run.demonSuppressed,
        absence: this.run.progress.demonAbsence,
      }),
      /** Aim at the demon and fire for real, through the normal fire path. */
      fireAtDemon: () => {
        const dx = this.demon.x - this.player.x;
        const dz = this.demon.z - this.player.z;
        this.player.yaw = Math.atan2(dx, dz);
        const dy = 1.45 - this.player.eyeY;
        this.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        this.step(1 / 60);
        this.fire();
        // Let the projectile reach it.
        for (let i = 0; i < 90; i++) this.step(1 / 60);
      },
      /**
       * Light sampled at a point. `withFlares` includes burning flares, so a
       * test can compare the same point lit and unlit and prove a flare is
       * doing something.
       */
      lightAt: (x: number, y: number, z: number, withFlares = true) => {
        const c = new THREE.Color();
        this.world.sampleLight(x, y, z, c);
        if (withFlares) this.flares.sample(x, y, z, c);
        return { r: c.r, g: c.g, b: c.b, sum: c.r + c.g + c.b };
      },
      /** Where the burning flares actually are. */
      flarePositions: () => {
        const p = this.flares.brightest();
        return p ? [{ x: p.x, y: p.y, z: p.z }] : [];
      },
      hideSpots: () =>
        this.props.hideSpots.map((h) => ({ id: h.id, kind: h.kind, x: h.pos.x, z: h.pos.z, label: h.label })),
      enterHide: (id: string) => this.enterHide(id),
      exitHide: () => this.exitHide(),
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
      sightClear: (ax: number, az: number, bx: number, bz: number) => this.grid.sightClear(ax, az, bx, bz),
      setAiDebug: (on: boolean) => this.aiDebug?.setEnabled(on),
      /** Drop the demon into a clean patrol with no knowledge of the player. */
      beginPatrol: () => this.demon.beginPatrolNear(this.grid, this.demon.x, this.demon.z, true),
      aiState: () => ({
        state: this.demon.state,
        sees: this.demon.senses.sees,
        lostTimer: this.demon.lostTimer,
        hasLastSeen: this.demon.hasLastSeen,
        lastSeen: { x: this.demon.lastSeenX, z: this.demon.lastSeenZ },
        patrolTarget: this.demon.patrolTarget,
        suspended: this.demon.suspended,
        alive: this.demon.alive,
        distance: this.demon.senses.distance,
        rays: this.demon.senses.rays.map((r) => ({ clear: r.clear, inCone: r.inCone })),
        x: this.demon.x,
        z: this.demon.z,
        yaw: this.demon.yaw,
      }),
      /** Point the demon at a world position, for detection tests. */
      faceDemonAt: (x: number, z: number) => {
        this.demon.yaw = Math.atan2(x - this.demon.x, z - this.demon.z);
      },
      demonSight: () => ({ ...DEMON_SIGHT }),
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
      /** The chase-balance numbers, so a test can assert the relationship. */
      tuning: () => ({
        walk: WALK_SPEED,
        sprint: SPRINT_SPEED,
        chase: SPEED_CHASE,
        staminaDrain: STAMINA_DRAIN,
        staminaRegen: STAMINA_REGEN,
      }),
      /** Put the demon in a chase on the player, for balance tests. */
      forceChase: () => {
        this.run.progress.diamondTaken = true;
        this.playReveal();
        this.demon.forceChase(this.player.x, this.player.z);
      },
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
            // The development AI visualisation is not release content - the
            // release build does not contain the module at all, which the
            // release gate asserts separately - so it is not audited here.
            let p: THREE.Object3D | null = o;
            while (p) {
              if (p.name === 'ai-debug') return;
              p = p.parent;
            }
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
