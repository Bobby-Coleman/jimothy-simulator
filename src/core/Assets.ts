import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

/** Resolve a path relative to the site root (works under GitHub Pages sub-paths). */
export function assetUrl(path: string): string {
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  const base = import.meta.env.BASE_URL || './';
  return base.replace(/\/?$/, '/') + path.replace(/^\.?\//, '');
}

export class Assets {
  readonly manager = new THREE.LoadingManager();
  private gltfLoader = new GLTFLoader(this.manager);
  private texLoader = new THREE.TextureLoader(this.manager);
  private gltfCache = new Map<string, Promise<GLTF>>();
  private texCache = new Map<string, Promise<THREE.Texture>>();
  maxAnisotropy = 4;

  gltf(path: string): Promise<GLTF> {
    let p = this.gltfCache.get(path);
    if (!p) {
      p = this.gltfLoader.loadAsync(assetUrl(path));
      this.gltfCache.set(path, p);
      p.catch(() => this.gltfCache.delete(path));
    }
    return p;
  }

  /**
   * Load a model and return a fresh clone (geometry/materials shared).
   * Meshes get cast/receive shadows by default.
   */
  async model(path: string, opts: { shadows?: boolean } = {}): Promise<THREE.Object3D> {
    const g = await this.gltf(path);
    const clone = SkeletonUtils.clone(g.scene);
    const shadows = opts.shadows ?? true;
    clone.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = shadows;
        m.receiveShadow = true;
      }
    });
    return clone;
  }

  /** Try to load a model; resolves null instead of throwing if it doesn't exist. */
  async tryModel(path: string, opts: { shadows?: boolean } = {}): Promise<THREE.Object3D | null> {
    try {
      return await this.model(path, opts);
    } catch {
      return null;
    }
  }

  texture(path: string, opts: { srgb?: boolean; repeat?: number | [number, number] } = {}): Promise<THREE.Texture> {
    const key = `${path}|${opts.srgb ?? true}`;
    let p = this.texCache.get(key);
    if (!p) {
      p = this.texLoader.loadAsync(assetUrl(path)).then((t) => {
        t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = this.maxAnisotropy;
        return t;
      });
      this.texCache.set(key, p);
      p.catch(() => this.texCache.delete(key));
    }
    return p.then((t) => {
      if (opts.repeat == null) return t;
      const c = t.clone();
      const r = Array.isArray(opts.repeat) ? opts.repeat : [opts.repeat, opts.repeat];
      c.repeat.set(r[0], r[1]);
      c.needsUpdate = true;
      return c;
    });
  }

  async tryTexture(path: string, opts: { srgb?: boolean; repeat?: number | [number, number] } = {}) {
    try {
      return await this.texture(path, opts);
    } catch {
      return null;
    }
  }

  async json<T = any>(path: string): Promise<T | null> {
    try {
      const r = await fetch(assetUrl(path));
      if (!r.ok) return null;
      return (await r.json()) as T;
    } catch {
      return null;
    }
  }
}
