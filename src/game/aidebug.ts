/**
 * Development-only visualisation of the demon's hunting state.
 *
 * Draws the sight cone, the per-body-point sight rays (green clear, red
 * blocked), the last seen position, the current patrol destination, and a text
 * readout of the state and the lost-sight timer.
 *
 * This module is only ever imported behind `import.meta.env.VITE_DEBUG_API`,
 * so the release build does not contain it at all - see `main.ts` and the
 * release gate in `test/release-check.mjs`, which asserts that.
 */

import * as THREE from 'three';
import type { Demon } from './demon';
import { PATROL_NODES, cx, cz } from '../world/layout';

export class AiDebug {
  readonly root = new THREE.Group();
  private readonly cone: THREE.Line;
  private readonly rays: THREE.Line[] = [];
  private readonly lastSeen: THREE.Mesh;
  private readonly destination: THREE.Mesh;
  private readonly nodes: THREE.Points;
  private readonly readout: HTMLDivElement;
  private on = false;

  constructor(uiRoot: HTMLElement) {
    this.root.name = 'ai-debug';
    this.root.visible = false;
    this.root.renderOrder = 999;

    const lineMat = (color: number): THREE.LineBasicMaterial =>
      new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 });

    // Sight cone: a fan of edges on the floor plane at eye height.
    const coneGeo = new THREE.BufferGeometry();
    coneGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Array(3 * 34).fill(0), 3));
    this.cone = new THREE.Line(coneGeo, lineMat(0x39b6e8));
    this.cone.frustumCulled = false;
    this.root.add(this.cone);

    for (let i = 0; i < 3; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
      const l = new THREE.Line(g, lineMat(0x5f7a4e));
      l.frustumCulled = false;
      this.rays.push(l);
      this.root.add(l);
    }

    const marker = (color: number, size: number): THREE.Mesh => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(size, size * 6, size),
        new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.7 }),
      );
      m.frustumCulled = false;
      this.root.add(m);
      return m;
    };
    this.lastSeen = marker(0xa8181c, 0.3);
    this.destination = marker(0xd79a3c, 0.3);

    // Every patrol node, so the graph itself is visible.
    const pts = new THREE.BufferGeometry();
    const arr: number[] = [];
    for (const n of PATROL_NODES) arr.push(cx(n.gx), 0.4, cz(n.gz));
    pts.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    this.nodes = new THREE.Points(
      pts,
      new THREE.PointsMaterial({ color: 0x7b8794, size: 6, sizeAttenuation: false, depthTest: false }),
    );
    this.nodes.frustumCulled = false;
    this.root.add(this.nodes);

    this.readout = document.createElement('div');
    this.readout.style.cssText =
      'position:absolute;left:22px;top:44px;font:11px/1.6 "DejaVu Sans Mono",monospace;' +
      'color:#39b6e8;text-shadow:0 1px 0 #000;white-space:pre;pointer-events:none;display:none';
    uiRoot.appendChild(this.readout);
  }

  get enabled(): boolean {
    return this.on;
  }

  setEnabled(on: boolean): void {
    this.on = on;
    this.root.visible = on;
    this.readout.style.display = on ? 'block' : 'none';
  }

  toggle(): void {
    this.setEnabled(!this.on);
  }

  update(demon: Demon, fovDegrees: number, range: number): void {
    if (!this.on) return;

    const eyeY = 2.06;
    const half = THREE.MathUtils.degToRad(fovDegrees / 2);
    const pos = this.cone.geometry.getAttribute('position') as THREE.BufferAttribute;
    // Centre, then an arc across the cone, then back to centre.
    let i = 0;
    const put = (x: number, y: number, z: number): void => {
      pos.setXYZ(i++, x, y, z);
    };
    put(demon.x, eyeY, demon.z);
    for (let k = 0; k <= 31; k++) {
      const a = demon.yaw - half + (k / 31) * half * 2;
      put(demon.x + Math.sin(a) * range, eyeY, demon.z + Math.cos(a) * range);
    }
    put(demon.x, eyeY, demon.z);
    pos.needsUpdate = true;

    for (let k = 0; k < this.rays.length; k++) {
      const ray = demon.senses.rays[k];
      const line = this.rays[k];
      if (!ray) {
        line.visible = false;
        continue;
      }
      line.visible = true;
      const p = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      p.setXYZ(0, demon.x, eyeY, demon.z);
      p.setXYZ(1, ray.x, ray.y, ray.z);
      p.needsUpdate = true;
      (line.material as THREE.LineBasicMaterial).color.setHex(
        ray.clear && ray.inCone ? 0x5f7a4e : ray.clear ? 0xd79a3c : 0xa8181c,
      );
    }

    this.lastSeen.visible = demon.hasLastSeen;
    if (demon.hasLastSeen) this.lastSeen.position.set(demon.lastSeenX, 0.9, demon.lastSeenZ);

    const target = demon.patrolTarget >= 0 ? PATROL_NODES[demon.patrolTarget] : null;
    this.destination.visible = !!target;
    if (target) this.destination.position.set(cx(target.gx), 0.9, cz(target.gz));

    this.readout.textContent = [
      `AI DEBUG  (F3)`,
      `state        ${demon.state}${demon.suspended ? ' [SUSPENDED]' : ''}`,
      `sees player  ${demon.senses.sees ? 'YES' : 'no'}`,
      `lost timer   ${demon.lostTimer.toFixed(2)}s`,
      `last seen    ${demon.hasLastSeen ? `${demon.lastSeenX.toFixed(1)}, ${demon.lastSeenZ.toFixed(1)}` : '-'}`,
      `patrol dest  ${target ? `${target.id} ${target.name}` : '-'}`,
      `distance     ${demon.senses.distance.toFixed(1)}`,
      `grace        ${demon.grace.toFixed(2)}s`,
    ].join('\n');
  }
}
