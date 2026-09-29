import * as THREE from 'three';
import type { Game, System } from '../core/Game';

/**
 * Distance culling for small dynamic things (props, items, animals) — the fog hides them anyway, and each one
 * costs draw calls in both the main and the shadow pass. Only toggles objects it hid itself (`userData.culled`),
 * so systems that hide things on purpose keep control.
 */
const RANGE: Record<string, number> = {
  prop: 85,
  item: 70,
  collectible: 140,
  animal: 90,
  vehicle: 190,
  slop: 110,
};

const _wp = new THREE.Vector3();

export class DetailCuller implements System {
  name = 'culler';
  private t = 0;
  /** Multiplier (low quality shrinks view distance). */
  scale = 1;

  init(game: Game) {
    const q = game.renderer.quality;
    this.scale = q === 'low' ? 0.6 : q === 'medium' ? 0.85 : 1;
  }

  lateUpdate(dt: number, game: Game) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.25;
    const cam = game.camera.position;
    for (const e of game.entities.list) {
      const obj = e.object;
      if (!obj || !e.alive) continue;
      const r = RANGE[e.kind];
      if (!r) continue;
      if (e.data.heldByPlayer) continue;
      // World position (objects may be parented under something else)
      const wp = obj.parent === game.scene ? obj.position : obj.getWorldPosition(_wp);
      const d2 = wp.distanceToSquared(cam);
      const far = d2 > r * r * this.scale * this.scale;
      if (far) {
        if (obj.visible) {
          obj.visible = false;
          obj.userData.culled = true;
        }
      } else if (obj.userData.culled) {
        obj.visible = true;
        obj.userData.culled = false;
      }
    }
  }
}

/** Utility: disable shadow casting on tiny meshes of an object (saves shadow-pass draws). */
export function noTinyShadows(obj: THREE.Object3D, minSize = 0.35) {
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    box.copy(m.geometry.boundingBox!);
    box.getSize(size).multiply(m.getWorldScale(new THREE.Vector3()));
    if (Math.max(size.x, size.y, size.z) < minSize) m.castShadow = false;
  });
}
