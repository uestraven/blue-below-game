/**
 * The player: a collision disc with a camera on top.
 *
 * Movement is deliberately a little heavy - the facility is meant to feel like
 * somewhere you are trespassing, not somewhere you can outrun trouble
 * indefinitely. Sprinting is finite, and it is also the loudest thing the
 * player can do, which is what gives the demon's hearing something to work on.
 */

import * as THREE from 'three';
import type { Input } from '../core/input';
import type { Grid } from '../world/grid';
import type { Settings } from '../core/settings';
import type { AudioEngine } from '../core/audio';

export const PLAYER_RADIUS = 0.42;
export const EYE_HEIGHT = 1.62;
export const WALK_SPEED = 4.3;
export const SPRINT_SPEED = 6.6;
/**
 * Velocity approaches its target exponentially, with these time constants in
 * seconds. This is deliberately not an impulse-and-friction model: that form
 * settles at an equilibrium below the speed cap, and the equilibrium moves with
 * the frame rate, so the player ends up slower on a slow machine and sprinting
 * stops doing anything at all - while the demon, which steps by `speed * dt`,
 * is unaffected. That turns a slow machine into an unwinnable chase.
 */
const ACCEL_TIME = 0.085;
const DECEL_TIME = 0.065;
const STAMINA_DRAIN = 0.225;
const STAMINA_REGEN = 0.16;
const PITCH_LIMIT = Math.PI / 2 - 0.08;

export class Player {
  readonly camera: THREE.PerspectiveCamera;
  x = 0;
  z = 0;
  yaw = 0;
  pitch = 0;
  velX = 0;
  velZ = 0;
  stamina = 1;
  /** Horizontal speed last frame, used by the demon's hearing model. */
  speed = 0;
  sprinting = false;
  /** Set while a puzzle or menu owns the view. */
  controlLocked = false;
  /** Inside a hide spot: cannot move, cannot be perceived, limited look arc. */
  hidden = false;
  private hideCam: THREE.Vector3 | null = null;
  private hideYaw = 0;
  private hideYawRange = 1.15;

  private bobPhase = 0;
  private stepAccum = 0;
  private viewTarget: THREE.Vector3 | null = null;

  readonly forward = new THREE.Vector3();
  readonly right = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(72, aspect, 0.08, 220);
  }

  teleport(x: number, z: number, yaw: number): void {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.pitch = 0;
    this.velX = 0;
    this.velZ = 0;
    this.stamina = 1;
    this.speed = 0;
    this.bobPhase = 0;
    this.viewTarget = null;
  }

  /** Point the camera at a world position and hold it there (puzzle views). */
  lockViewTo(target: THREE.Vector3): void {
    this.viewTarget = target.clone();
  }

  /**
   * Climb into a hide spot. The player keeps a limited look arc so they can
   * watch the demon go past, which is the entire appeal, but cannot move.
   */
  enterHide(cam: THREE.Vector3, yaw: number, yawRange: number): void {
    this.hidden = true;
    this.hideCam = cam.clone();
    this.hideYaw = yaw;
    this.hideYawRange = yawRange;
    this.yaw = yaw;
    this.pitch = 0;
    this.velX = 0;
    this.velZ = 0;
    this.speed = 0;
    this.sprinting = false;
  }

  /** Climb back out at `at`. */
  exitHide(at: THREE.Vector3): void {
    this.hidden = false;
    this.hideCam = null;
    this.x = at.x;
    this.z = at.z;
    this.velX = 0;
    this.velZ = 0;
    this.speed = 0;
  }

  releaseView(): void {
    this.viewTarget = null;
  }

  update(dt: number, input: Input, grid: Grid, settings: Settings, audio: AudioEngine): void {
    if (this.hidden && this.hideCam) {
      // Look around within the arc the hiding place allows; no movement.
      if (!this.controlLocked) {
        const look = input.consumeLook();
        const sens = 0.0021 * settings.sensitivity;
        this.yaw -= look.x * sens;
        this.pitch += (settings.invertY ? look.y : -look.y) * sens;
        let rel = this.yaw - this.hideYaw;
        while (rel > Math.PI) rel -= Math.PI * 2;
        while (rel < -Math.PI) rel += Math.PI * 2;
        rel = Math.max(-this.hideYawRange, Math.min(this.hideYawRange, rel));
        this.yaw = this.hideYaw + rel;
        this.pitch = Math.max(-0.7, Math.min(0.5, this.pitch));
      }
      this.velX = 0;
      this.velZ = 0;
      this.speed = 0;
      this.sprinting = false;
      // Stamina still recovers while you wait it out.
      this.stamina = Math.min(1, this.stamina + STAMINA_REGEN * dt);
      this.camera.position.copy(this.hideCam);
      this.camera.rotation.set(0, 0, 0);
      this.camera.rotateY(this.yaw + Math.PI);
      this.camera.rotateX(this.pitch);
      this.camera.updateMatrixWorld();
      this.forward.set(
        Math.sin(this.yaw) * Math.cos(this.pitch),
        Math.sin(this.pitch),
        Math.cos(this.yaw) * Math.cos(this.pitch),
      );
      this.right.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
      return;
    }

    if (this.viewTarget) {
      // Smoothly settle onto the puzzle face, then hold.
      const dx = this.viewTarget.x - this.x;
      const dz = this.viewTarget.z - this.z;
      const dy = this.viewTarget.y - (EYE_HEIGHT + grid.floorHeight(this.x, this.z));
      const wantYaw = Math.atan2(dx, dz);
      const wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
      this.yaw = approachAngle(this.yaw, wantYaw, dt * 9);
      this.pitch += (wantPitch - this.pitch) * Math.min(1, dt * 9);
      this.velX = 0;
      this.velZ = 0;
      this.speed = 0;
      this.syncCamera(grid, 0);
      return;
    }

    if (!this.controlLocked) {
      const look = input.consumeLook();
      const sens = 0.0021 * settings.sensitivity;
      this.yaw -= look.x * sens;
      this.pitch += (settings.invertY ? look.y : -look.y) * sens;
      if (this.pitch > PITCH_LIMIT) this.pitch = PITCH_LIMIT;
      if (this.pitch < -PITCH_LIMIT) this.pitch = -PITCH_LIMIT;
      if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
      if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
    }

    // Input in local space. Note yaw 0 looks toward +z.
    let ix = 0;
    let iz = 0;
    if (!this.controlLocked) {
      if (input.isHeld('forward')) iz += 1;
      if (input.isHeld('back')) iz -= 1;
      if (input.isHeld('left')) ix -= 1;
      if (input.isHeld('right')) ix += 1;
    }
    const mag = Math.hypot(ix, iz);
    if (mag > 1) {
      ix /= mag;
      iz /= mag;
    }

    const wantsSprint = !this.controlLocked && input.isHeld('sprint') && mag > 0.1 && this.stamina > 0.02;
    this.sprinting = wantsSprint;
    if (wantsSprint) {
      this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN * dt);
    } else {
      this.stamina = Math.min(1, this.stamina + STAMINA_REGEN * dt);
    }
    const maxSpeed = wantsSprint ? SPRINT_SPEED : WALK_SPEED;

    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    // Forward is (sin yaw, cos yaw), so right is cross(forward, up), which is
    // (-cos yaw, 0, sin yaw) - at yaw 0 the player faces +z and their right
    // hand points down -x. Using (cos, -sin) here is the *left* vector and
    // silently swaps A and D.
    const wishX = iz * sy - ix * cy;
    const wishZ = iz * cy + ix * sy;

    // Frame-rate independent approach to the target velocity.
    const targetX = wishX * maxSpeed;
    const targetZ = wishZ * maxSpeed;
    const tau = mag > 0.01 ? ACCEL_TIME : DECEL_TIME;
    const k = 1 - Math.exp(-dt / tau);
    this.velX += (targetX - this.velX) * k;
    this.velZ += (targetZ - this.velZ) * k;
    // Snap the last sliver so standing still really is standing still.
    if (mag <= 0.01 && Math.hypot(this.velX, this.velZ) < 0.05) {
      this.velX = 0;
      this.velZ = 0;
    }

    const moved = grid.moveDisc(this.x, this.z, this.velX * dt, this.velZ * dt, PLAYER_RADIUS);
    const actualDx = moved.x - this.x;
    const actualDz = moved.z - this.z;
    this.x = moved.x;
    this.z = moved.z;
    this.speed = Math.hypot(actualDx, actualDz) / Math.max(dt, 1e-5);
    if (moved.hit) {
      // Kill velocity into the wall so the player does not buzz along it.
      if (Math.abs(actualDx) < 1e-4) this.velX = 0;
      if (Math.abs(actualDz) < 1e-4) this.velZ = 0;
    }

    // Footsteps and head bob, both driven by distance travelled.
    const dist = Math.hypot(actualDx, actualDz);
    this.bobPhase += dist * 1.9;
    this.stepAccum += dist;
    const stride = wantsSprint ? 2.1 : 1.6;
    if (this.stepAccum >= stride) {
      this.stepAccum = 0;
      const region = grid.regionAt(this.x, this.z);
      const mat = region?.step ?? 'concrete';
      const name = mat === 'metal' ? 'step_metal' : mat === 'tile' ? 'step_tile' : 'step_concrete';
      audio.play(name, undefined, wantsSprint ? 1.25 : 0.85);
    }

    this.syncCamera(grid, Math.min(1, this.speed / WALK_SPEED));
  }

  private syncCamera(grid: Grid, bobAmount: number): void {
    const floor = grid.floorHeight(this.x, this.z);
    const bob = Math.sin(this.bobPhase) * 0.035 * bobAmount;
    const sway = Math.cos(this.bobPhase * 0.5) * 0.015 * bobAmount;
    this.camera.position.set(this.x + sway * Math.cos(this.yaw), floor + EYE_HEIGHT + bob, this.z - sway * Math.sin(this.yaw));
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw + Math.PI);
    this.camera.rotateX(this.pitch);
    this.camera.updateMatrixWorld();

    this.forward.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    this.right.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
  }

  get eyeY(): number {
    return this.camera.position.y;
  }

  /** Where a shot or an interaction ray starts. */
  get eye(): THREE.Vector3 {
    return this.camera.position;
  }
}

function approachAngle(from: number, to: number, t: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + d * Math.min(1, t);
}
