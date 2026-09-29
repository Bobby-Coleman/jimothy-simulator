import * as THREE from 'three';

/**
 * Dev-only registry of every text sign face in the world (centre, facing normal, size, texture aspect), so
 * tools/signtour.mjs can visit each one head-on and check readability. Costs nothing in production builds.
 *
 * Helpers that make sign faces call `registerSign` directly, or tag a geometry with `tagSign` and let the
 * zone Batch register it once its final transform is known (`registerTagged`).
 */
export interface SignInfo {
  src: string;
  center: [number, number, number];
  normal: [number, number, number];
  w: number;
  h: number;
  /** Texture region aspect (w/h) if known — compare with w/h to spot stretched text. */
  texAspect?: number;
  caller?: string;
}

const DEV = !!(import.meta as any).env?.DEV;

function list(): SignInfo[] {
  const g = globalThis as any;
  return (g.__signs ??= []);
}

function caller(): string {
  const st = new Error().stack?.split('\n') ?? [];
  const frames = st.slice(3).filter((l) => !/signRegistry|\/kit\.ts|lib\/signs\.ts|lib\/batch\.ts/.test(l));
  return frames
    .slice(0, 2)
    .map((l) => l.trim().replace(/^at /, '').replace(/\(?https?:\/\/[^/]+\/(src\/)?/, '').replace(/\?[^:]*/, ''))
    .join(' < ');
}

export function registerSign(s: Omit<SignInfo, 'caller'>) {
  if (!DEV) return;
  list().push({ ...s, caller: caller() });
}

/** Sign at `pos` facing local +Z rotated by yaw (and optional pitch tilt about local X). */
export function registerSignYaw(src: string, pos: ArrayLike<number>, rotY: number, w: number, h: number, texAspect?: number, tilt = 0) {
  if (!DEV) return;
  const n = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(tilt, rotY, 0, 'YXZ'));
  registerSign({ src, center: [pos[0], pos[1], pos[2]], normal: [n.x, n.y, n.z], w, h, texAspect });
}

/** Mark a sign geometry (front normal at vertex `nIdx`) so a batch can register it after transforming. */
export function tagSign(g: THREE.BufferGeometry, src: string, w: number, h: number, texAspect?: number, nIdx = 0) {
  if (DEV) g.userData.sign = { src, w, h, texAspect, nIdx };
  return g;
}

/** Called by Batch.add after the geometry got its final (world) transform. */
export function registerTagged(g: THREE.BufferGeometry, pre?: THREE.Matrix4) {
  const t = g.userData?.sign;
  if (!DEV || !t) return;
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  if (!pos || !nor) return;
  const box = new THREE.Box3().setFromBufferAttribute(pos as THREE.BufferAttribute);
  const c = box.getCenter(new THREE.Vector3());
  const n = new THREE.Vector3().fromBufferAttribute(nor as THREE.BufferAttribute, t.nIdx);
  if (pre) {
    c.applyMatrix4(pre);
    n.transformDirection(pre);
  }
  list().push({ src: t.src, center: [c.x, c.y, c.z], normal: [n.x, n.y, n.z], w: t.w, h: t.h, texAspect: t.texAspect, caller: caller() });
}
