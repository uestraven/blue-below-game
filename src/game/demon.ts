/**
 * The demon.
 *
 * One persistent stalker, navigating the same grid the player walks. It has
 * four honest behaviours - patrol, investigate, chase, search - and both of its
 * senses are things the player can reason about: a forward sight cone that
 * walls block, and a hearing radius that the player controls by choosing to
 * walk, stand still, or sprint.
 *
 * Suspension (entering a puzzle) freezes movement, detection and attacks while
 * preserving position and chase state. It is never despawned or moved.
 */

import * as THREE from 'three';
import type { Grid } from '../world/grid';
import { PATROL_NODES, DEMON_SIGHT, LOST_SIGHT_SECONDS, cx, cz } from '../world/layout';
import { Rng } from '../core/rng';
import { SURFACE, flatTexture } from '../world/textures';
import { PAL } from '../world/palette';
import type { PsxRenderer } from '../render/psx';
import type { WorldBuild } from '../world/build';

export type DemonState =
  | 'dormant'
  | 'reveal'
  | 'patrol'
  /** Saw the player and is on them. */
  | 'chase'
  /** Lost sight; heading for the last place it actually saw them. */
  | 'lostSight'
  | 'attack'
  /** On fire and leaving. Plays out, then goes to `absent`. */
  | 'burning'
  /** Off the board on a flare-suppression budget. Not dead. */
  | 'absent'
  | 'dead';

export const DEMON_RADIUS = 0.5;
const SPEED_PATROL = 2.35;
/**
 * Chase speed, and the most important number in the game.
 *
 * It sits deliberately *above* the player's walk (4.3) and below their sprint
 * (6.6). Walking away loses about 0.7 u/s, so noticing it is not enough on its
 * own: the escape is to sprint, round a corner, and let it lose you, which is
 * what the 5 s memory and 13 s search exist for. Stamina is therefore a real
 * resource and running out of it is genuinely dangerous.
 *
 * This was briefly dropped to 4.1 - below the walk - after a playtester could
 * not escape. The actual fault was that they never knew sprinting existed: the
 * stamina bar only appeared once you were already sprinting, so the one piece
 * of UI advertising the mechanic was hidden behind using the mechanic. Fixing
 * the discoverability was the right fix; slowing the demon just made sprint
 * and stamina pointless.
 *
 * Keep this between `WALK_SPEED` and `SPRINT_SPEED` in player.ts. Route 14
 * asserts that ordering so it cannot drift.
 */
export const SPEED_CHASE = 5.0;
const CATCH_DISTANCE = 1.55;
const ATTACK_WINDUP = 0.42;
const REPATH_INTERVAL = 0.33;
/** How long it dwells at a patrol node before choosing the next one. */
const PAUSE_HALL = 0.35;
const PAUSE_INTERSECTION = 1.6;
const PAUSE_ROOM = 1.0;

export interface DemonSenses {
  /** True if the demon can currently see the player. */
  sees: boolean;
  /** Straight-line distance to the player. Informational only. */
  distance: number;
  /** 0..1 how worked up it is; drives audio and the HUD cue. */
  agitation: number;
  /** Per-body-point results from the last detection check, for the debug view. */
  rays: Array<{ x: number; y: number; z: number; clear: boolean; inCone: boolean }>;
}

export class Demon {
  readonly group = new THREE.Group();
  state: DemonState = 'dormant';
  x = 0;
  z = 0;
  yaw = 0;
  /** Suspended by a puzzle. Position and `state` are left untouched. */
  suspended = false;
  /** Seconds remaining before it is allowed to hurt the player again. */
  grace = 0;
  alive = true;

  private prevStateBeforeSuspend: DemonState = 'dormant';
  private path: Array<{ x: number; z: number }> = [];
  private pathIndex = 0;
  private repathTimer = 0;
  private revealTimer = 0;
  private attackTimer = 0;
  private walkPhase = 0;
  private deathTimer = 0;
  private burnTimer = 0;
  private stuckTimer = 0;
  private lastX = 0;
  private lastZ = 0;

  readonly senses: DemonSenses = { sees: false, distance: 999, agitation: 0, rays: [] };

  // --- what it knows ----------------------------------------------------
  /**
   * The last position it *saw* the player at. This is the only channel through
   * which the player's position reaches the demon: there is deliberately no
   * hearing model and nothing hands it a live position.
   */
  lastSeenX = 0;
  lastSeenZ = 0;
  hasLastSeen = false;
  /** Seconds of unbroken no-sight. Frozen while suspended. */
  lostTimer = 0;

  // --- patrol -----------------------------------------------------------
  /** Node id it is walking to, or -1. */
  patrolTarget = -1;
  /** Per-node time-since-visited, used to weight the next choice. */
  private visitAge: number[] = [];
  private dwell = 0;
  private scanYaw = 0;

  /** Fired once when the demon transitions into a chase; used for stingers. */
  onSpot: (() => void) | null = null;
  /** Fired when the demon reaches the player. */
  onCatch: (() => void) | null = null;

  private torso!: THREE.Mesh;
  private head!: THREE.Group;
  private jaw!: THREE.Mesh;
  /** Hip joints; the shin hangs off each as a child so the knee bends. */
  private legs: THREE.Mesh[] = [];
  private shins: THREE.Mesh[] = [];
  /** Shoulder joints, with the forearm as a child. */
  private arms: THREE.Mesh[] = [];
  private forearms: THREE.Mesh[] = [];
  private twitchTimer = 0;
  private twitch = 0;
  private materials: THREE.ShaderMaterial[] = [];
  private eyeMat!: THREE.ShaderMaterial;
  private readonly tintColor = new THREE.Color();

  /**
   * Patrol choices are random, but seeded from the run - so a given run always
   * hunts the same way and a failing route can be replayed.
   */
  private rng = new Rng(1);

  /** Re-seed the patrol randomness. Called when a run starts. */
  seed(seed: number): void {
    this.rng = new Rng(seed ^ 0x5bd1e995);
  }

  constructor(psx: PsxRenderer, private readonly wb: WorldBuild) {
    const skin = SURFACE.demonSkin();
    const face = SURFACE.demonFace();

    const block = (w: number, h: number, d: number, tex: THREE.Texture): THREE.Mesh => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.setAttribute(
        'color',
        new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(1), 3),
      );
      const m = psx.createMaterial({ map: tex, jitter: 1, affine: 1, emissive: 0.1 });
      this.materials.push(m);
      return new THREE.Mesh(g, m);
    };

    // 2.55 units of wrong proportions: a long forward-pitched spine, a skull
    // that tapers to a snout, a jaw that hangs, ribs you can count, and arms
    // long enough that the hands swing below the knees. Boxes alone read as a
    // mannequin, so the skull and limbs taper and the knees bend backwards.

    /** Angular tapered solid - a 5-sided cylinder, which is era-appropriate. */
    const taper = (rTop: number, rBot: number, h: number, tex: THREE.Texture, pivotTop = false): THREE.Mesh => {
      const g = new THREE.CylinderGeometry(rTop, rBot, h, 5, 1);
      if (pivotTop) g.translate(0, -h / 2, 0);
      g.setAttribute(
        'color',
        new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(1), 3),
      );
      const m = psx.createMaterial({ map: tex, jitter: 1, affine: 1, emissive: 0.1 });
      this.materials.push(m);
      return new THREE.Mesh(g, m);
    };

    // Torso: narrow at the waist, flaring at the shoulders, pitched forward.
    this.torso = taper(0.34, 0.2, 1.05, skin);
    this.torso.scale.set(0.86, 1, 0.55);
    this.torso.position.set(0, 1.5, 0);
    this.group.add(this.torso);

    // Ribs, as slats across the chest.
    for (let i = 0; i < 4; i++) {
      const rib = block(0.46 - i * 0.05, 0.045, 0.3, skin);
      rib.position.set(0, 1.78 - i * 0.16, 0.08);
      this.torso.add(rib);
      rib.position.set(0, (1.78 - i * 0.16 - 1.5) / 1, 0.13);
    }

    const pelvis = taper(0.2, 0.26, 0.3, skin);
    pelvis.scale.set(1, 1, 0.7);
    pelvis.position.set(0, 0.97, 0);
    this.group.add(pelvis);

    // Head: tapered skull, thrust forward on a long neck, with a hanging jaw.
    this.head = new THREE.Group();
    const neck = taper(0.08, 0.1, 0.26, skin);
    neck.position.set(0, -0.16, -0.02);
    this.head.add(neck);
    const skull = taper(0.13, 0.3, 0.52, skin);
    skull.rotation.x = Math.PI; // narrow end forward-down, like a snout
    skull.scale.set(1, 1, 1.5);
    skull.position.set(0, 0.04, 0.12);
    this.head.add(skull);
    this.jaw = block(0.21, 0.14, 0.32, skin);
    this.jaw.geometry.translate(0, -0.07, 0.13);
    this.jaw.position.set(0, -0.11, 0.1);
    this.head.add(this.jaw);

    const faceGeo = new THREE.PlaneGeometry(0.38, 0.38);
    faceGeo.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(new Array(faceGeo.attributes.position.count * 3).fill(1), 3),
    );
    const faceMat = psx.createMaterial({ map: face, jitter: 1, affine: 0.5, emissive: 0.12 });
    this.materials.push(faceMat);
    const faceMesh = new THREE.Mesh(faceGeo, faceMat);
    faceMesh.position.set(0, 0.04, 0.305);
    this.head.add(faceMesh);

    // Two points of cold light, deep set, so it is identifiable in the dark.
    const eyeGeo = new THREE.PlaneGeometry(0.1, 0.07);
    eyeGeo.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(new Array(eyeGeo.attributes.position.count * 3).fill(1), 3),
    );
    this.eyeMat = psx.createMaterial({
      map: flatTexture('demoneye', PAL.white),
      jitter: 0.4,
      affine: 0,
      emissive: 2.6,
    });
    for (const dx of [-0.095, 0.095]) {
      const eye = new THREE.Mesh(eyeGeo, this.eyeMat);
      eye.position.set(dx, 0.1, 0.315);
      this.head.add(eye);
    }
    // Low and forward: the head leads, ahead of the shoulders, not on top.
    this.head.position.set(0, 2.06, 0.22);
    this.group.add(this.head);

    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;

      // Leg: thigh from the hip, shin hinged at the knee and angled back.
      const thigh = taper(0.11, 0.085, 0.58, skin, true);
      thigh.position.set(side * 0.15, 0.97, 0);
      const shin = taper(0.075, 0.055, 0.56, skin, true);
      shin.position.set(0, -0.58, 0);
      thigh.add(shin);
      const foot = block(0.12, 0.07, 0.3, skin);
      foot.position.set(0, -0.56, 0.07);
      shin.add(foot);
      this.legs.push(thigh);
      this.shins.push(shin);
      this.group.add(thigh);

      // Arm: upper arm from the shoulder, forearm hinged at the elbow, and a
      // long splayed hand. Total reach puts the fingers below the knee.
      const upper = taper(0.085, 0.065, 0.62, skin, true);
      upper.position.set(side * 0.27, 1.96, 0);
      const fore = taper(0.06, 0.045, 0.6, skin, true);
      fore.position.set(0, -0.62, 0);
      upper.add(fore);
      const hand = block(0.07, 0.26, 0.05, skin);
      hand.geometry.translate(0, -0.13, 0);
      hand.position.set(0, -0.6, 0);
      fore.add(hand);
      this.arms.push(upper);
      this.forearms.push(fore);
      this.group.add(upper);
    }

    this.group.visible = false;
  }

  /** Centre of mass, used as the shot target and the audio source. */
  get centre(): THREE.Vector3 {
    return new THREE.Vector3(this.x, 1.45, this.z);
  }

  reset(): void {
    this.state = 'dormant';
    this.alive = true;
    this.suspended = false;
    this.grace = 0;
    this.path = [];
    this.pathIndex = 0;
    this.revealTimer = 0;
    this.attackTimer = 0;
    this.deathTimer = 0;
    this.burnTimer = 0;
    this.stuckTimer = 0;
    this.lostTimer = 0;
    this.hasLastSeen = false;
    this.patrolTarget = -1;
    this.visitAge = [];
    this.dwell = 0;
    this.patrolFailures = 0;
    this.senses.rays.length = 0;
    this.senses.sees = false;
    this.senses.distance = 999;
    this.senses.agitation = 0;
    this.group.visible = false;
    this.group.scale.set(1, 1, 1);
    this.group.rotation.set(0, 0, 0);
    for (const m of this.materials) m.uniforms.uOpacity.value = 1;
  }

  /** Stage the first reveal: stand it at `cell`, facing the player. */
  spawnReveal(gx: number, gz: number, holdTime: number, faceX: number, faceZ: number): void {
    this.x = cx(gx);
    this.z = cz(gz);
    this.yaw = Math.atan2(faceX - this.x, faceZ - this.z);
    this.state = 'reveal';
    this.revealTimer = holdTime;
    this.alive = true;
    this.group.visible = true;
    this.lastX = this.x;
    this.lastZ = this.z;
  }

  suspend(): void {
    if (this.suspended) return;
    this.prevStateBeforeSuspend = this.state;
    this.suspended = true;
  }

  /** Restore movement. `grace` seconds of invulnerability for the player. */
  resume(grace: number): void {
    if (!this.suspended) return;
    this.suspended = false;
    this.state = this.prevStateBeforeSuspend;
    this.grace = Math.max(this.grace, grace);
    // Force a fresh path next tick; the player may have moved nowhere, but the
    // stale path index could be pointing at a waypoint already passed.
    this.repathTimer = 0;
  }

  /**
   * Hit by a flare. It burns, flees, and leaves the board - temporarily. This
   * is not `kill()`: `alive` stays true, because the Bad Ending must still be
   * reachable while it is merely absent.
   */
  ignite(): void {
    if (!this.alive || this.state === 'dormant' || this.state === 'dead') return;
    this.state = 'burning';
    this.burnTimer = 1.6;
    this.suspended = false;
    this.senses.sees = false;
    this.senses.agitation = 1;
    this.path = [];
    this.pathIndex = 0;
  }

  /** Back on the board at `gx,gz`, facing the player, hunting from scratch. */
  returnFromBurn(gx: number, gz: number, px: number, pz: number): void {
    this.x = cx(gx);
    this.z = cz(gz);
    this.lastX = this.x;
    this.lastZ = this.z;
    this.yaw = Math.atan2(px - this.x, pz - this.z);
    this.alive = true;
    this.suspended = false;
    this.group.visible = true;
    this.group.scale.set(1, 1, 1);
    this.burnTimer = 0;
    for (const m of this.materials) {
      m.uniforms.uOpacity.value = 1;
      m.transparent = false;
      (m.uniforms.uTint.value as THREE.Color).setRGB(1, 1, 1);
    }
    // Comes back on patrol, with no idea where the player is. It has to see
    // them again before it chases anything.
    this.state = 'patrol';
    this.hasLastSeen = false;
    this.lostTimer = 0;
    this.patrolTarget = -1;
    this.path = [];
    this.repathTimer = 0;
    this.grace = 1.5;
  }

  /** True while it is off the board after a flare hit. */
  get absent(): boolean {
    return this.state === 'absent';
  }

  kill(): void {
    if (!this.alive) return;
    this.alive = false;
    this.state = 'dead';
    this.deathTimer = 0;
    this.senses.sees = false;
    this.senses.agitation = 0;
  }

  /** True once the death animation has fully played out. */
  get deathComplete(): boolean {
    return !this.alive && this.deathTimer > 2.4;
  }

  update(
    dt: number,
    grid: Grid,
    player: { x: number; z: number; speed: number; sprinting: boolean; floorY: number },
    /**
     * The player is inside a hide spot. It keeps hunting, but it cannot see,
     * hear or reach them - so it runs down its memory, searches, and gives up.
     * This is deliberately not suspension: the world keeps moving.
     */
    playerHidden = false,
  ): void {
    if (this.state === 'dormant') return;

    if (!this.alive) {
      this.deathTimer += dt;
      this.animateDeath();
      this.applyLighting();
      return;
    }

    if (this.grace > 0) this.grace = Math.max(0, this.grace - dt);

    if (this.state === 'absent') {
      // Off the board. Nothing to see, nothing to hear, nothing to hit.
      this.senses.sees = false;
      this.senses.distance = 999;
      this.senses.agitation = 0;
      this.group.visible = false;
      return;
    }

    if (this.state === 'burning') {
      // Runs for it, on fire, then leaves. Deliberately unkillable mid-burn.
      this.burnTimer -= dt;
      this.senses.sees = false;
      this.senses.agitation = 1;
      const t = 1 - Math.max(0, this.burnTimer) / 1.6;
      for (const m of this.materials) m.uniforms.uEmissive.value = 1.6 + Math.sin(t * 40) * 0.5;
      this.walkPhase += dt * 16;
      this.animatePose(SPEED_CHASE, dt);
      // Flails away from the player while it goes.
      const away = Math.atan2(this.x - player.x, this.z - player.z);
      this.yaw = approachAngle(this.yaw, away, dt * 5);
      const moved = grid.moveDisc(this.x, this.z, Math.sin(this.yaw) * 7 * dt, Math.cos(this.yaw) * 7 * dt, DEMON_RADIUS);
      this.x = moved.x;
      this.z = moved.z;
      this.group.scale.setScalar(Math.max(0.05, 1 - t * 0.9));
      for (const m of this.materials) {
        m.uniforms.uOpacity.value = Math.max(0, 1 - t);
        m.transparent = true;
      }
      this.applyTransform();
      if (this.burnTimer <= 0) {
        this.state = 'absent';
        this.group.visible = false;
      }
      return;
    }

    if (this.suspended) {
      // Frozen: no movement, no detection, no attack. The pose is held.
      this.senses.sees = false;
      this.applyTransform();
      this.applyLighting();
      return;
    }

    const dx = player.x - this.x;
    const dz = player.z - this.z;
    const dist = Math.hypot(dx, dz);
    this.senses.distance = dist;

    // --- sight ----------------------------------------------------------
    // The only sense it has. No hearing: nothing but a successful visual
    // detection ever tells it where the player is.
    const sees = playerHidden ? false : this.look(grid, player.x, player.z, player.floorY);
    this.senses.sees = sees;
    if (sees) {
      this.lastSeenX = player.x;
      this.lastSeenZ = player.z;
      this.hasLastSeen = true;
      this.lostTimer = 0;
    }

    if (this.state === 'reveal') {
      this.revealTimer -= dt;
      this.yaw = approachAngle(this.yaw, Math.atan2(dx, dz), dt * 3);
      this.walkPhase += dt * 1.2;
      this.senses.agitation = 1;
      if (this.revealTimer <= 0) {
        // The reveal is a scripted sighting: it has been looking at the player
        // the whole time, so it goes straight into a chase.
        this.lastSeenX = player.x;
        this.lastSeenZ = player.z;
        this.hasLastSeen = true;
        this.enterChase();
      }
      this.animatePose(0, dt);
      this.applyTransform();
      this.applyLighting();
      return;
    }

    // Seeing the player always starts or continues a chase.
    if (sees && this.state !== 'chase' && this.state !== 'attack') {
      this.enterChase();
      this.onSpot?.();
    }

    // --- state machine --------------------------------------------------
    let speed = SPEED_PATROL;
    let goal: { x: number; z: number } | null = null;

    switch (this.state) {
      case 'chase': {
        speed = SPEED_CHASE;
        this.senses.agitation = 1;
        if (sees) {
          goal = { x: this.lastSeenX, z: this.lastSeenZ };
          if (dist < CATCH_DISTANCE && this.grace <= 0 && !playerHidden && this.canReach(grid, player.x, player.z, player.floorY)) {
            this.state = 'attack';
            this.attackTimer = ATTACK_WINDUP;
          }
        } else {
          // Sight just broke. Head for where they actually were and start the
          // clock; it keeps looking on the way via the normal sight check.
          this.state = 'lostSight';
          this.lostTimer = 0;
          this.path = [];
          this.repathTimer = 0;
        }
        break;
      }

      case 'lostSight': {
        speed = SPEED_CHASE * 0.86;
        this.senses.agitation = 0.7;
        this.lostTimer += dt;
        goal = this.hasLastSeen ? { x: this.lastSeenX, z: this.lastSeenZ } : null;

        // Sweep its head as it goes, so corners come into the cone.
        this.scanYaw += dt * 2.1;

        if (this.lostTimer >= LOST_SIGHT_SECONDS) {
          // Give up, wherever it got to - reaching the last seen position is
          // explicitly not required.
          this.beginPatrolNear(grid, this.hasLastSeen ? this.lastSeenX : this.x, this.hasLastSeen ? this.lastSeenZ : this.z);
        }
        break;
      }

      case 'attack': {
        speed = 0;
        this.attackTimer -= dt;
        this.yaw = approachAngle(this.yaw, Math.atan2(dx, dz), dt * 12);
        this.senses.agitation = 1;
        if (this.attackTimer <= 0) {
          if (
            dist < CATCH_DISTANCE + 0.7 &&
            this.grace <= 0 &&
            !playerHidden &&
            this.canReach(grid, player.x, player.z, player.floorY)
          ) {
            this.onCatch?.();
          }
          this.state = sees ? 'chase' : 'lostSight';
          if (!sees) this.lostTimer = 0;
        }
        break;
      }

      case 'patrol':
      default: {
        speed = SPEED_PATROL;
        this.senses.agitation = 0.12;
        goal = this.patrolStep(dt, grid);
        if (!goal) speed = 0;
        break;
      }
    }

    if (goal && speed > 0) this.steer(dt, grid, goal, speed);

    this.animatePose(speed, dt);
    this.applyTransform();
    this.applyLighting();
  }

  /** Drop straight into a chase on a known point. Used by balance tests. */
  forceChase(px: number, pz: number): void {
    this.alive = true;
    this.group.visible = true;
    this.revealTimer = 0;
    this.grace = 0;
    this.enterChase(px, pz);
  }

  private dwellTurn = 0;
  private patrolFailures = 0;

  /**
   * Visual detection. Checks several points up the player's body against the
   * sight cone, the range, and a true 3D ray that walls, furniture and closed
   * doors all stop.
   *
   * Several points rather than one because a single centre-of-mass ray makes
   * detection around corners a coin toss: the demon either sees a whole person
   * through a two-inch gap or misses one standing in the open.
   */
  private look(grid: Grid, px: number, pz: number, playerFloorY: number): boolean {
    const eyeY = this.groundY + 2.06;
    const dx = px - this.x;
    const dz = pz - this.z;
    const dist = Math.hypot(dx, dz);
    this.senses.rays.length = 0;
    if (dist > DEMON_SIGHT.range) return false;

    const fwdX = Math.sin(this.yaw + this.scanOffset);
    const fwdZ = Math.cos(this.yaw + this.scanOffset);
    const cosHalf = Math.cos(THREE.MathUtils.degToRad(DEMON_SIGHT.fovDegrees / 2));
    const dot = dist > 1e-4 ? (dx * fwdX + dz * fwdZ) / dist : 1;
    const inCone = dot >= cosHalf || dist <= DEMON_SIGHT.peripheralRadius;

    let any = false;
    for (const h of DEMON_SIGHT.bodyPoints) {
      const ty = playerFloorY + h;
      const clear = grid.raySightClear(this.x, eyeY, this.z, px, ty, pz);
      this.senses.rays.push({ x: px, y: ty, z: pz, clear, inCone });
      if (clear && inCone) any = true;
    }
    return any;
  }

  /**
   * A catch has to be physically plausible: close, and with something clear
   * between the two of them at chest height. Without this it can claw through
   * a workbench it is standing behind.
   */
  private canReach(grid: Grid, px: number, pz: number, playerFloorY: number): boolean {
    return grid.raySightClear(this.x, this.groundY + 1.2, this.z, px, playerFloorY + 1.0, pz);
  }

  /** Where the demon's feet are, for eye-height maths. */
  private get groundY(): number {
    return 0;
  }

  /** Head sweep applied on top of body yaw while hunting. */
  private get scanOffset(): number {
    return this.state === 'lostSight' ? Math.sin(this.scanYaw) * 0.6 : 0;
  }

  // ------------------------------------------------------------- patrolling

  /** Start patrolling, seeded at the node nearest `x,z`. */
  beginPatrolNear(grid: Grid, x: number, z: number, forget = false): void {
    this.state = 'patrol';
    this.lostTimer = 0;
    if (forget) this.hasLastSeen = false;
    this.path = [];
    this.repathTimer = 0;
    this.dwell = 0;
    this.ensureVisitAges();
    // Make the area around the last sighting the freshest thing on its list,
    // so its next route starts there and then broadens outward.
    let best = -1;
    let bestD = Infinity;
    for (const n of PATROL_NODES) {
      const d = Math.hypot(cx(n.gx) - x, cz(n.gz) - z);
      if (d < bestD) {
        bestD = d;
        best = n.id;
      }
    }
    this.patrolTarget = best;
    void grid;
  }

  private ensureVisitAges(): void {
    if (this.visitAge.length === PATROL_NODES.length) return;
    this.visitAge = PATROL_NODES.map(() => 30 + this.rng.next() * 30);
  }

  /**
   * One tick of patrol. Returns the point to walk toward, or null while it is
   * standing at a node looking around.
   *
   * Destination choice is weighted toward nodes it has not visited recently,
   * preferring neighbours of where it is so the route reads as walking the
   * building rather than teleporting attention across it.
   */
  private patrolStep(dt: number, grid: Grid): { x: number; z: number } | null {
    this.ensureVisitAges();
    for (let i = 0; i < this.visitAge.length; i++) this.visitAge[i] += dt;

    if (this.patrolTarget < 0) {
      this.patrolTarget = this.pickPatrolTarget(this.nearestNode());
    }
    const node = PATROL_NODES[this.patrolTarget];
    const tx = cx(node.gx);
    const tz = cz(node.gz);

    if (Math.hypot(tx - this.x, tz - this.z) < 1.6) {
      // Arrived. Mark it seen, dwell a moment, turn, then pick the next.
      this.visitAge[node.id] = 0;
      if (this.dwell <= 0) {
        this.dwell =
          node.kind === 'intersection' ? PAUSE_INTERSECTION : node.kind === 'room' ? PAUSE_ROOM : PAUSE_HALL;
        this.dwellTurn = (this.rng.next() - 0.5) * (node.kind === 'intersection' ? 2.6 : 1.2);
      }
      this.dwell -= dt;
      // Look around while it stands there - this is real detection, not idle
      // animation, so standing in its view while it pauses is fatal.
      this.yaw = approachAngle(this.yaw, this.yaw + this.dwellTurn, dt * 1.6);
      if (this.dwell <= 0) {
        this.patrolTarget = this.pickPatrolTarget(node.id);
        this.path = [];
        this.repathTimer = 0;
      }
      return null;
    }

    // Unreachable destination: drop it and take another.
    if (this.patrolFailures > 2) {
      this.patrolFailures = 0;
      this.visitAge[node.id] = 0; // stop re-picking it immediately
      this.patrolTarget = this.pickPatrolTarget(this.nearestNode());
      this.path = [];
      this.repathTimer = 0;
      return null;
    }
    void grid;
    return { x: tx, z: tz };
  }

  private nearestNode(): number {
    let best = 0;
    let bestD = Infinity;
    for (const n of PATROL_NODES) {
      const d = Math.hypot(cx(n.gx) - this.x, cz(n.gz) - this.z);
      if (d < bestD) {
        bestD = d;
        best = n.id;
      }
    }
    return best;
  }

  /**
   * Weighted pick: neighbours of `fromId` weighted by how long since each was
   * visited, with a small chance of striking out for a distant stale node so
   * it does not get stuck pacing one wing.
   */
  private pickPatrolTarget(fromId: number): number {
    this.ensureVisitAges();
    const from = PATROL_NODES[fromId];
    const candidates = this.rng.next() < 0.18 ? PATROL_NODES.map((n) => n.id) : from.links;
    let total = 0;
    const weights: Array<{ id: number; w: number }> = [];
    for (const id of candidates) {
      if (id === fromId) continue;
      // Age is the whole point: stale places are interesting.
      const w = Math.pow(Math.max(0.1, this.visitAge[id]), 1.4);
      weights.push({ id, w });
      total += w;
    }
    if (!weights.length) return from.links[0] ?? fromId;
    let roll = this.rng.next() * total;
    for (const c of weights) {
      roll -= c.w;
      if (roll <= 0) return c.id;
    }
    return weights[weights.length - 1].id;
  }

  /**
   * It watched the player get into something. It does not know they are in
   * there, only where they were when it lost them.
   */
  noteHidingObserved(x: number, z: number): void {
    this.lastSeenX = x;
    this.lastSeenZ = z;
    this.hasLastSeen = true;
    this.lostTimer = 0;
    this.state = 'lostSight';
    this.path = [];
    this.repathTimer = 0;
  }

  private enterChase(px?: number, pz?: number): void {
    this.state = 'chase';
    if (px !== undefined && pz !== undefined) {
      this.lastSeenX = px;
      this.lastSeenZ = pz;
      this.hasLastSeen = true;
    }
    this.lostTimer = 0;
    this.path = [];
    this.repathTimer = 0;
  }

  private steer(dt: number, grid: Grid, goal: { x: number; z: number }, speed: number): void {
    this.repathTimer -= dt;
    if (this.repathTimer <= 0 || this.pathIndex >= this.path.length) {
      this.repathTimer = REPATH_INTERVAL;
      const p = grid.findPath(this.x, this.z, goal.x, goal.z);
      if (p && p.length) {
        this.path = p;
        this.pathIndex = 0;
      }
    }

    let tx = goal.x;
    let tz = goal.z;
    if (this.pathIndex < this.path.length) {
      const wp = this.path[this.pathIndex];
      if (Math.hypot(wp.x - this.x, wp.z - this.z) < 1.1) {
        this.pathIndex++;
      }
      const cur = this.path[Math.min(this.pathIndex, this.path.length - 1)];
      tx = cur.x;
      tz = cur.z;
    }

    const dx = tx - this.x;
    const dz = tz - this.z;
    const d = Math.hypot(dx, dz) || 1;
    const stepX = (dx / d) * speed * dt;
    const stepZ = (dz / d) * speed * dt;
    const moved = grid.moveDisc(this.x, this.z, stepX, stepZ, DEMON_RADIUS);
    this.x = moved.x;
    this.z = moved.z;

    // Face the direction of travel.
    this.yaw = approachAngle(this.yaw, Math.atan2(dx, dz), dt * 7);

    const travelled = Math.hypot(this.x - this.lastX, this.z - this.lastZ);
    this.walkPhase += travelled * 1.7;
    this.lastX = this.x;
    this.lastZ = this.z;

    // If it has not moved for a while it is wedged; force a replan.
    if (travelled < speed * dt * 0.2) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 0.45) {
        this.stuckTimer = 0;
        this.repathTimer = 0;
        this.path = [];
        this.pathIndex = 0;
      }
    } else {
      this.stuckTimer = 0;
    }
  }

  private animatePose(speed: number, dt: number): void {
    const running = this.state === 'chase';
    const attacking = this.state === 'attack';

    // Head twitches at irregular intervals. Nothing alive moves its head in a
    // clean sine wave, and the twitch is most of what makes it read as wrong.
    this.twitchTimer -= dt;
    if (this.twitchTimer <= 0) {
      this.twitchTimer = running ? 0.25 + Math.random() * 0.5 : 1.2 + Math.random() * 2.6;
      this.twitch = (Math.random() - 0.5) * (running ? 0.5 : 0.28);
    }
    this.twitch *= 1 - Math.min(1, dt * 7);

    const swing = running ? 0.95 : 0.42;
    const s = Math.sin(this.walkPhase);
    // The second leg lags slightly, so the gait limps instead of marching.
    const s2 = Math.sin(this.walkPhase + Math.PI * 0.86);
    const c = Math.cos(this.walkPhase);

    this.legs[0].rotation.x = s * swing;
    this.legs[1].rotation.x = -s2 * swing;
    // Knees bend backwards, and only ever one way.
    this.shins[0].rotation.x = -Math.max(0, -s) * (running ? 1.5 : 0.75) - 0.12;
    this.shins[1].rotation.x = -Math.max(0, s2) * (running ? 1.5 : 0.75) - 0.12;

    if (attacking) {
      const t = 1 - Math.max(0, this.attackTimer) / ATTACK_WINDUP;
      for (let i = 0; i < 2; i++) {
        this.arms[i].rotation.x = -1.6 - t * 0.7;
        this.arms[i].rotation.z = (i === 0 ? 1 : -1) * (0.4 - t * 0.3);
        this.forearms[i].rotation.x = -0.5 + t * 0.45;
      }
      this.torso.rotation.x = -0.4 - t * 0.25;
      this.head.rotation.x = 0.3 + t * 0.2;
      this.jaw.rotation.x = 0.75 + t * 0.35;
    } else if (running) {
      // Reaching, not jogging: arms forward and low, spine pitched over.
      this.arms[0].rotation.x = -1.0 - s * 0.45;
      this.arms[1].rotation.x = -1.0 + s2 * 0.45;
      this.arms[0].rotation.z = 0.26;
      this.arms[1].rotation.z = -0.26;
      this.forearms[0].rotation.x = -0.55 - Math.max(0, s) * 0.3;
      this.forearms[1].rotation.x = -0.55 - Math.max(0, -s2) * 0.3;
      this.torso.rotation.x = -0.42;
      this.head.rotation.x = 0.38;
      this.jaw.rotation.x = 0.5 + Math.abs(s) * 0.22;
    } else if (this.state === 'reveal') {
      // Dead still. Only the head moves, and only barely.
      for (let i = 0; i < 2; i++) {
        this.arms[i].rotation.x = 0.03;
        this.arms[i].rotation.z = (i === 0 ? 1 : -1) * 0.07;
        this.forearms[i].rotation.x = -0.18;
      }
      this.torso.rotation.x = -0.12;
      this.head.rotation.x = Math.sin(this.walkPhase * 0.6) * 0.05;
      this.jaw.rotation.x = 0.16;
    } else {
      this.arms[0].rotation.x = -0.22 - s * 0.26;
      this.arms[1].rotation.x = -0.22 + s2 * 0.26;
      this.arms[0].rotation.z = 0.1;
      this.arms[1].rotation.z = -0.1;
      this.forearms[0].rotation.x = -0.4;
      this.forearms[1].rotation.x = -0.4;
      this.torso.rotation.x = -0.2;
      this.head.rotation.x = 0.1;
      this.jaw.rotation.x = 0.1;
    }

    this.head.rotation.y = this.twitch;
    this.head.rotation.z = this.twitch * 0.5;

    // Vertical bob from the stride, and a lurch in the chase so its approach
    // is uneven rather than a smooth dolly toward the camera.
    const amp = speed > 0.1 ? (running ? 0.09 : 0.04) : 0;
    this.group.position.y = Math.abs(c) * amp;
    this.eyeMat.uniforms.uEmissive.value = running || attacking ? 3.4 : 2.4;
    const glow = this.state === 'reveal' ? 0.5 : 0.1;
    for (const m of this.materials) {
      if (m !== this.eyeMat) m.uniforms.uEmissive.value = glow;
    }
  }

  private animateDeath(): void {
    const t = Math.min(1, this.deathTimer / 1.5);
    const ease = t * t;
    this.group.rotation.x = -ease * 1.45;
    this.group.position.y = -ease * 0.35;
    const fade = Math.max(0, 1 - Math.max(0, this.deathTimer - 1.5) / 0.9);
    for (const m of this.materials) {
      m.uniforms.uOpacity.value = fade;
      m.transparent = fade < 0.999;
    }
    this.eyeMat.uniforms.uEmissive.value = 2.2 * fade;
    if (this.deathTimer > 2.4) this.group.visible = false;
  }

  private applyTransform(): void {
    this.group.position.x = this.x;
    this.group.position.z = this.z;
    // Local +z is the demon's forward, so the face and eye quads (which are
    // +z facing planes) point where it is looking. Adding PI here - which is
    // right for the camera, because a camera looks down -z - turns the face
    // round and makes it invisible.
    this.group.rotation.y = this.yaw;
    this.group.visible =
      this.state !== 'dormant' && this.state !== 'absent' && (this.alive || this.deathTimer <= 2.4);
  }

  /** Extra light sources that are not baked, e.g. burning flares. */
  extraLight: ((x: number, y: number, z: number, out: THREE.Color) => void) | null = null;

  private applyLighting(): void {
    this.wb.sampleLight(this.x, 1.5, this.z, this.tintColor);
    // A flare on the floor should light the thing standing over it.
    this.extraLight?.(this.x, 1.5, this.z, this.tintColor);
    // Floor the tint so the silhouette never vanishes completely; the player
    // has to be able to read where it is even in the darkest tunnel.
    const r = Math.max(this.tintColor.r, 0.24);
    const g = Math.max(this.tintColor.g, 0.22);
    const b = Math.max(this.tintColor.b, 0.26);
    for (const m of this.materials) (m.uniforms.uTint.value as THREE.Color).setRGB(r, g, b);
  }
}

function approachAngle(from: number, to: number, t: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + d * Math.min(1, t);
}
