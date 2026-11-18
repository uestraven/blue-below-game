/**
 * Burning flares.
 *
 * The facility's own lighting is baked into vertex colours at load time, so a
 * flare cannot be one of those: it is thrown, it moves, it dies. Each burning
 * flare therefore occupies one of three dynamic light slots in the world
 * shader, and contributes to the JS-side light sampling that shades the demon
 * and the props as well, so firing one genuinely lights the room and anything
 * standing in it.
 *
 * A fired flare is a real projectile - it travels, falls, and skids off
 * geometry - but whether it *hit the demon* is decided by a ray check at the
 * moment of firing, not by the projectile's collision. Aiming should be judged
 * once, reliably, against what the player saw down the sights.
 */

import * as THREE from 'three';
import type { Grid } from '../world/grid';
import type { PsxRenderer } from '../render/psx';
import { flatTexture, glowTexture } from '../world/textures';
import { PAL } from '../world/palette';
import { FLARE_BURN_SECONDS } from './state';

/** Simultaneous burning flares. Matches the shader's slot count. */
const MAX_ACTIVE = 3;
const THROW_SPEED = 26;
const GRAVITY = 14;
const PROJECTILE_RADIUS = 0.12;
/** Peak light radius of a burning flare, in world units. */
const BURN_RANGE = 15;
const FLARE_COLOR = new THREE.Color(1.0, 0.52, 0.2);

interface Flare {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** Seconds of burn left. Counts down only while it is on the ground. */
  burn: number;
  flying: boolean;
  /** Flight time, so a dud cannot fly forever. */
  age: number;
  mesh: THREE.Group;
  lightMat: THREE.ShaderMaterial;
  /** Set when this flare was fired at a confirmed demon hit. */
  igniteTarget: boolean;
}

export class Flares {
  private readonly active: Flare[] = [];
  readonly root = new THREE.Group();

  /** Fired once when a flare fired at the demon reaches it. */
  onIgniteDemon: (() => void) | null = null;

  constructor(
    private readonly psx: PsxRenderer,
    private readonly grid: Grid,
  ) {
    this.root.name = 'flares';
  }

  get activeCount(): number {
    return this.active.length;
  }

  /** Burning flares currently on the ground, for HUD and tests. */
  get burningCount(): number {
    return this.active.filter((f) => !f.flying).length;
  }

  clear(): void {
    for (const f of this.active) this.root.remove(f.mesh);
    this.active.length = 0;
    this.writeUniforms();
  }

  /**
   * Launch a flare from `from` along `dir`. `hitDemon` says the shot was
   * already judged a hit, in which case the projectile is aimed at
   * `demonPoint` and ignites on arrival.
   */
  fire(from: THREE.Vector3, dir: THREE.Vector3, hitDemon: boolean, demonPoint: THREE.Vector3 | null): void {
    // Oldest flare gives up its slot rather than refusing the shot.
    while (this.active.length >= MAX_ACTIVE) {
      const dead = this.active.shift();
      if (dead) this.root.remove(dead.mesh);
    }

    const mesh = new THREE.Group();
    const bodyGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.22, 6);
    bodyGeo.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(new Array(bodyGeo.attributes.position.count * 3).fill(1), 3),
    );
    const bodyMat = this.psx.createMaterial({
      map: flatTexture('flareburn', PAL.white),
      jitter: 0.4,
      affine: 0,
      emissive: 2.6,
    });
    mesh.add(new THREE.Mesh(bodyGeo, bodyMat));

    // Billboarded halo: the flare reads as a light source, not a lit object.
    const haloGeo = new THREE.PlaneGeometry(3.4, 3.4);
    haloGeo.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(new Array(haloGeo.attributes.position.count * 3).fill(1), 3),
    );
    const haloMat = this.psx.createMaterial({
      map: glowTexture(PAL.amber),
      jitter: 0,
      affine: 0,
      emissive: 1.8,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      noFog: true,
    });
    haloMat.uniforms.uOpacity.value = 0.75;
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.name = 'halo';
    mesh.add(halo);

    const f: Flare = {
      pos: from.clone(),
      vel: dir.clone().normalize().multiplyScalar(THROW_SPEED),
      burn: FLARE_BURN_SECONDS,
      flying: true,
      age: 0,
      mesh,
      lightMat: haloMat,
      igniteTarget: hitDemon,
    };
    if (hitDemon && demonPoint) {
      // Fly straight at the demon rather than arcing past it.
      f.vel.copy(demonPoint).sub(from).normalize().multiplyScalar(THROW_SPEED);
    }
    mesh.position.copy(f.pos);
    this.root.add(mesh);
    this.active.push(f);
  }

  /**
   * `dt` is active-gameplay time. Pass 0 while paused so flares do not burn
   * down behind a menu.
   */
  update(dt: number, cameraPos: THREE.Vector3, demonPos: THREE.Vector3 | null): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const f = this.active[i];

      if (f.flying) {
        f.age += dt;
        // Integrate in small steps so a fast flare cannot tunnel a wall.
        const steps = Math.max(1, Math.ceil((f.vel.length() * dt) / 0.4));
        const h = dt / steps;
        for (let k = 0; k < steps && f.flying; k++) {
          if (f.igniteTarget && demonPos) {
            // The shot was already judged a hit at the trigger, so this one
            // flies true: no drop, and it tracks the target it was aimed at.
            // A ballistic arc would fall six units over a twenty-four unit
            // corridor and bury itself in the floor, turning every confirmed
            // hit into a miss.
            const tx = demonPos.x - f.pos.x;
            const ty = demonPos.y - f.pos.y;
            const tz = demonPos.z - f.pos.z;
            const td = Math.hypot(tx, ty, tz) || 1;
            f.vel.set((tx / td) * THROW_SPEED, (ty / td) * THROW_SPEED, (tz / td) * THROW_SPEED);
            const nx2 = f.pos.x + f.vel.x * h;
            const ny2 = f.pos.y + f.vel.y * h;
            const nz2 = f.pos.z + f.vel.z * h;
            if (td < 1.4) {
              f.flying = false;
              f.pos.set(demonPos.x, Math.max(demonPos.y, 0.2), demonPos.z);
              this.onIgniteDemon?.();
              this.onIgniteDemon = null;
              break;
            }
            f.pos.set(nx2, ny2, nz2);
            continue;
          }

          f.vel.y -= GRAVITY * h;
          const nx = f.pos.x + f.vel.x * h;
          const ny = f.pos.y + f.vel.y * h;
          const nz = f.pos.z + f.vel.z * h;

          const floor = this.grid.floorHeight(nx, nz);
          if (this.grid.discBlocked(nx, nz, PROJECTILE_RADIUS) || ny <= floor + 0.08) {
            // Skid along the floor and settle.
            f.pos.set(
              this.grid.discBlocked(nx, nz, PROJECTILE_RADIUS) ? f.pos.x : nx,
              Math.max(floor + 0.1, ny),
              this.grid.discBlocked(nx, nz, PROJECTILE_RADIUS) ? f.pos.z : nz,
            );
            f.pos.y = this.grid.floorHeight(f.pos.x, f.pos.z) + 0.1;
            f.flying = false;
            break;
          }
          f.pos.set(nx, ny, nz);
        }
        // A tracer that never reaches its target (the demon vanished) falls
        // back to being an ordinary burning flare where it got to.
        if (f.age > 4) {
          f.flying = false;
          f.igniteTarget = false;
          f.pos.y = this.grid.floorHeight(f.pos.x, f.pos.z) + 0.1;
        }
      } else {
        f.burn -= dt;
      }

      f.mesh.position.copy(f.pos);
      const halo = f.mesh.getObjectByName('halo');
      if (halo) halo.lookAt(cameraPos);

      // Flicker, and gutter out over the last two seconds.
      const fade = Math.min(1, Math.max(0, f.burn) / 2);
      const flicker = 0.78 + 0.22 * Math.sin(f.age * 37 + i);
      f.lightMat.uniforms.uEmissive.value = 1.8 * fade * flicker;

      if (f.burn <= 0) {
        this.root.remove(f.mesh);
        this.active.splice(i, 1);
      }
    }
    this.writeUniforms();
  }

  private writeUniforms(): void {
    const posArr = this.psx.shared.uFlarePos.value as THREE.Vector3[];
    const colArr = this.psx.shared.uFlareColor.value as THREE.Color[];
    const rngArr = this.psx.shared.uFlareRange.value as number[];
    for (let i = 0; i < MAX_ACTIVE; i++) {
      const f = this.active[i];
      if (!f) {
        rngArr[i] = 0;
        continue;
      }
      posArr[i].copy(f.pos);
      const fade = Math.min(1, Math.max(0, f.burn) / 2);
      const flicker = 0.85 + 0.15 * Math.sin(f.age * 31 + i);
      colArr[i].copy(FLARE_COLOR).multiplyScalar(fade * flicker * (f.flying ? 0.7 : 1));
      rngArr[i] = BURN_RANGE * (0.55 + 0.45 * fade);
    }
  }

  /** Flare contribution at a point, so dynamic objects are lit by flares too. */
  sample(x: number, y: number, z: number, out: THREE.Color): void {
    for (const f of this.active) {
      const d = Math.hypot(f.pos.x - x, f.pos.y - y, f.pos.z - z);
      const range = BURN_RANGE * (0.55 + 0.45 * Math.min(1, Math.max(0, f.burn) / 2));
      if (d >= range) continue;
      let att = 1 - d / range;
      att *= att;
      out.r += FLARE_COLOR.r * att;
      out.g += FLARE_COLOR.g * att;
      out.b += FLARE_COLOR.b * att;
    }
  }

  /** Position of the brightest burning flare, for audio placement. */
  brightest(): THREE.Vector3 | null {
    let best: Flare | null = null;
    for (const f of this.active) if (!best || f.burn > best.burn) best = f;
    return best ? best.pos : null;
  }
}
