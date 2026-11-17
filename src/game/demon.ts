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
import { PATROL, cx, cz } from '../world/layout';
import { SURFACE, flatTexture } from '../world/textures';
import { PAL } from '../world/palette';
import type { PsxRenderer } from '../render/psx';
import type { WorldBuild } from '../world/build';

export type DemonState = 'dormant' | 'reveal' | 'patrol' | 'investigate' | 'chase' | 'search' | 'attack' | 'dead';

export const DEMON_RADIUS = 0.5;
const SPEED_PATROL = 2.35;
const SPEED_INVESTIGATE = 3.2;
const SPEED_CHASE = 5.0;
const SIGHT_RANGE = 34;
const SIGHT_HALF_ANGLE = Math.cos(THREE.MathUtils.degToRad(55));
const CATCH_DISTANCE = 1.55;
const ATTACK_WINDUP = 0.42;
const MEMORY_TIME = 5.0;
const SEARCH_TIME = 13.0;
const REPATH_INTERVAL = 0.33;

export interface DemonSenses {
  /** True if the demon can currently see the player. */
  sees: boolean;
  /** Straight-line distance to the player. */
  distance: number;
  /** 0..1 how worked up it is; drives audio and the HUD cue. */
  agitation: number;
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
  private patrolIndex = 0;
  private lastKnownX = 0;
  private lastKnownZ = 0;
  private memoryTimer = 0;
  private searchTimer = 0;
  private revealTimer = 0;
  private attackTimer = 0;
  private walkPhase = 0;
  private deathTimer = 0;
  private stuckTimer = 0;
  private lastX = 0;
  private lastZ = 0;
  private wanderTarget: { x: number; z: number } | null = null;

  readonly senses: DemonSenses = { sees: false, distance: 999, agitation: 0 };

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
    this.memoryTimer = 0;
    this.searchTimer = 0;
    this.revealTimer = 0;
    this.attackTimer = 0;
    this.deathTimer = 0;
    this.stuckTimer = 0;
    this.patrolIndex = 0;
    this.wanderTarget = null;
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
    player: { x: number; z: number; speed: number; sprinting: boolean },
    loud: boolean,
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

    // --- senses ---------------------------------------------------------
    let perceives = false;
    if (!playerHidden && dist < SIGHT_RANGE && grid.sightClear(this.x, this.z, player.x, player.z)) {
      const fx = Math.sin(this.yaw);
      const fz = Math.cos(this.yaw);
      const dot = (dx * fx + dz * fz) / (dist || 1);
      // Very close, it notices regardless of facing.
      if (dot > SIGHT_HALF_ANGLE || dist < 3.5) perceives = true;
    }
    this.senses.sees = perceives;

    const hearRadius = playerHidden ? 0 : loud ? 220 : player.sprinting ? 30 : player.speed > 0.6 ? 15 : 0;
    const hears = hearRadius > 0 && dist < hearRadius;

    if (this.state === 'reveal') {
      this.revealTimer -= dt;
      this.yaw = approachAngle(this.yaw, Math.atan2(dx, dz), dt * 3);
      this.walkPhase += dt * 1.2;
      this.senses.agitation = 1;
      if (this.revealTimer <= 0) {
        this.enterChase(player.x, player.z);
      }
      this.animatePose(0, dt);
      this.applyTransform();
      this.applyLighting();
      return;
    }

    if (perceives) {
      if (this.state !== 'chase' && this.state !== 'attack') {
        this.enterChase(player.x, player.z);
        this.onSpot?.();
      }
      this.lastKnownX = player.x;
      this.lastKnownZ = player.z;
      this.memoryTimer = MEMORY_TIME;
    } else if (hears) {
      this.lastKnownX = player.x;
      this.lastKnownZ = player.z;
      if (this.state === 'patrol' || this.state === 'search') {
        this.state = 'investigate';
        this.memoryTimer = MEMORY_TIME;
        this.path = [];
        this.repathTimer = 0;
      } else if (this.state === 'chase') {
        this.memoryTimer = MEMORY_TIME;
      }
    }

    // --- state machine --------------------------------------------------
    let speed = SPEED_PATROL;
    let goal: { x: number; z: number } | null = null;

    switch (this.state) {
      case 'chase': {
        speed = SPEED_CHASE;
        this.memoryTimer -= dt;
        goal = perceives ? { x: player.x, z: player.z } : { x: this.lastKnownX, z: this.lastKnownZ };
        this.senses.agitation = 1;
        if (!perceives && this.memoryTimer <= 0) {
          this.state = 'search';
          this.searchTimer = SEARCH_TIME;
          this.wanderTarget = null;
          this.path = [];
          this.repathTimer = 0;
        }
        if (dist < CATCH_DISTANCE && this.grace <= 0 && !playerHidden) {
          this.state = 'attack';
          this.attackTimer = ATTACK_WINDUP;
        }
        break;
      }
      case 'attack': {
        speed = 0;
        this.attackTimer -= dt;
        this.yaw = approachAngle(this.yaw, Math.atan2(dx, dz), dt * 12);
        this.senses.agitation = 1;
        if (this.attackTimer <= 0) {
          if (dist < CATCH_DISTANCE + 0.7 && this.grace <= 0 && !playerHidden) {
            this.onCatch?.();
          }
          this.state = 'chase';
          this.memoryTimer = MEMORY_TIME;
        }
        break;
      }
      case 'investigate': {
        speed = SPEED_INVESTIGATE;
        this.memoryTimer -= dt;
        goal = { x: this.lastKnownX, z: this.lastKnownZ };
        this.senses.agitation = 0.55;
        const atGoal = Math.hypot(this.lastKnownX - this.x, this.lastKnownZ - this.z) < 1.6;
        if (atGoal || this.memoryTimer <= 0) {
          this.state = 'search';
          this.searchTimer = SEARCH_TIME;
          this.wanderTarget = null;
          this.path = [];
          this.repathTimer = 0;
        }
        break;
      }
      case 'search': {
        speed = SPEED_INVESTIGATE * 0.82;
        this.searchTimer -= dt;
        this.senses.agitation = 0.4;
        if (!this.wanderTarget || Math.hypot(this.wanderTarget.x - this.x, this.wanderTarget.z - this.z) < 1.4) {
          this.wanderTarget = this.pickSearchSpot(grid);
          this.path = [];
          this.repathTimer = 0;
        }
        goal = this.wanderTarget;
        if (this.searchTimer <= 0) {
          this.state = 'patrol';
          this.path = [];
          this.repathTimer = 0;
          this.patrolIndex = this.nearestPatrolIndex();
        }
        break;
      }
      case 'patrol':
      default: {
        speed = SPEED_PATROL;
        this.senses.agitation = 0.12;
        const wp = PATROL[this.patrolIndex];
        goal = { x: cx(wp[0]), z: cz(wp[1]) };
        if (Math.hypot(goal.x - this.x, goal.z - this.z) < 1.8) {
          this.patrolIndex = (this.patrolIndex + 1) % PATROL.length;
          this.path = [];
          this.repathTimer = 0;
        }
        break;
      }
    }

    if (goal && speed > 0) this.steer(dt, grid, goal, speed);

    this.animatePose(speed, dt);
    this.applyTransform();
    this.applyLighting();
  }

  private enterChase(px: number, pz: number): void {
    this.state = 'chase';
    this.lastKnownX = px;
    this.lastKnownZ = pz;
    this.memoryTimer = MEMORY_TIME;
    this.path = [];
    this.repathTimer = 0;
  }

  private nearestPatrolIndex(): number {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < PATROL.length; i++) {
      const d = Math.hypot(cx(PATROL[i][0]) - this.x, cz(PATROL[i][1]) - this.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private pickSearchSpot(grid: Grid): { x: number; z: number } {
    // Look around the last place the player was, not at random across the map.
    for (let attempt = 0; attempt < 24; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 14;
      const tx = this.lastKnownX + Math.cos(a) * r;
      const tz = this.lastKnownZ + Math.sin(a) * r;
      const cell = grid.nearestWalkable(
        Math.floor(tx / 3) + 32,
        Math.floor(tz / 3) + 26,
        2,
      );
      if (cell) return { x: cx(cell[0]), z: cz(cell[1]) };
    }
    return { x: this.lastKnownX, z: this.lastKnownZ };
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
    this.group.visible = this.state !== 'dormant' && (this.alive || this.deathTimer <= 2.4);
  }

  private applyLighting(): void {
    this.wb.sampleLight(this.x, 1.5, this.z, this.tintColor);
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
