import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { World, ZoneBuilder } from '../World';
import type { WaterSystem } from '../Water';
import { spawnProp, destroyProp, mat, box, cylinder, sphere } from '../../entities/Props';

/** Temporary test area around the spawn, used while the real zones are being built. */
export const DevPlayground: ZoneBuilder = {
  name: 'Dev Playground',
  build(game: Game, world: World) {
    const water = game.get<WaterSystem>('water')!;
    const ox = 20,
      oz = 20;
    const y = world.heightAt(ox, oz);
    // climb wall + ramp
    world.box(new THREE.Vector3(ox + 8, y + 3, oz), new THREE.Vector3(8, 6, 1), world.material(0xb85c3c));
    world.poi.set("spawn", new THREE.Vector3(ox - 4, y + 1.2, oz + 10));
    // fountain
    const f = new THREE.Vector3(ox, y + 0.45, oz - 10);
    water.addCircle({ name: 'Test Fountain', kind: 'fountain', center: f, radius: 2.4, depth: 0.5 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.25, 10, 40), world.material(0xd8d2c4));
    rim.rotation.x = Math.PI / 2;
    rim.position.set(f.x, y + 0.5, f.z);
    world.addStatic(rim, { collider: 'none' });
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.2, 40), world.material(0x8f8a80));
    basin.position.set(f.x, y + 0.02, f.z);
    world.addStatic(basin, { collider: 'none' });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      world.collider(new THREE.Vector3(f.x + Math.cos(a) * 2.6, y + 0.35, f.z + Math.sin(a) * 2.6), new THREE.Vector3(1.1, 0.7, 0.4), -a + Math.PI / 2);
    }
    // puddle
    water.addCircle({ name: 'Puddle', kind: 'puddle', center: new THREE.Vector3(ox - 5, y + 0.03, oz - 4), radius: 1.3, depth: 0.05 });

    // crates
    const crateMat = mat(0xb08850);
    for (let i = 0; i < 6; i++) {
      spawnProp(game, { name: 'Crate', object: box(0.7, 0.7, 0.7, crateMat), mass: 6, tags: ['grabbable', 'washable'] }, new THREE.Vector3(ox - 2 + (i % 3) * 0.8, y + Math.floor(i / 3) * 0.72, oz + 2));
    }
    // trash cans
    const canMat = mat(0x5f6b73, { metalness: 0.6, roughness: 0.4 });
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const c = cylinder(0.32, 0.28, 0.95, canMat);
      c.position.y = 0.475;
      g.add(c);
      const lid = cylinder(0.35, 0.35, 0.06, canMat);
      lid.position.y = 0.98;
      g.add(lid);
      spawnProp(game, { name: 'Trash Can', object: g, shape: 'cylinder', mass: 9, tags: ['grabbable', 'trashcan', 'washable'] }, new THREE.Vector3(ox + 3 + i * 1.2, y, oz + 5));
    }
    // beach ball
    spawnProp(game, { name: 'Beach Ball', object: sphere(0.4, mat(0xff5a5a, { roughness: 0.4 })), shape: 'ball', mass: 0.5, restitution: 0.8, tags: ['grabbable', 'washable'], data: { buoyancy: 4 } }, new THREE.Vector3(ox + 2, y, oz - 4));

    // cotton candy
    const cc = new THREE.Group();
    const stick = cylinder(0.015, 0.015, 0.35, mat(0xf2e3c6));
    stick.position.y = 0.17;
    cc.add(stick);
    const fluff = sphere(0.16, mat(0xff9fd2, { roughness: 1 }), 16);
    fluff.scale.set(1, 1.2, 1);
    fluff.position.y = 0.4;
    cc.add(fluff);
    spawnProp(game, {
      name: 'Cotton Candy',
      object: cc,
      mass: 0.2,
      tags: ['grabbable', 'food', 'cottoncandy'],
      onWash(g) {
        g.score(250, "Where'd It Go?");
        g.hint('Jimothy washed the cotton candy. It is gone. He stares at his empty hands.', 4);
        g.sfx('sad_trombone');
        g.events.emit('cottonCandyGone', {});
        const p = g.get<any>('player');
        const e = p?.held?.entity;
        if (e) {
          p.release(false);
          destroyProp(g, e);
        }
      },
    }, new THREE.Vector3(ox - 3, y, oz - 6));
  },
};
