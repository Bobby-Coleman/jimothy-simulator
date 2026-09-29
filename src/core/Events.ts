/**
 * Tiny event bus shared by every system.
 *
 * Common events (payload shapes):
 *  - 'score'        { points: number; label: string; position?: THREE.Vector3; silent?: boolean }
 *  - 'hint'         { text: string; duration?: number }      short contextual hint for the HUD
 *  - 'toast'        { title: string; text?: string; icon?: string }  big announcement (objective/mutator)
 *  - 'wash'         { entity?: Entity; kind: string }         something got washed ('item' | 'hands' | 'npc' | ...)
 *  - 'grab'         { entity: Entity }
 *  - 'release'      { entity: Entity; thrown: boolean }
 *  - 'steal'        { entity: Entity; from: Entity }
 *  - 'bonk'         { entity: Entity }
 *  - 'npcRagdoll'   { entity: Entity; cause: string }
 *  - 'playerRagdoll'{ cause: string }
 *  - 'chitter'      { position: THREE.Vector3 }
 *  - 'jump' | 'land' { height?: number }
 *  - 'filmed'       { by: Entity }
 *  - 'trashTipped'  { entity: Entity }
 *  - 'objective'    { id: string; title: string }
 *  - 'mutator'      { id: string; enabled: boolean }
 *  - 'sfx'          { key: string; position?: THREE.Vector3; volume?: number; pitch?: number }
 */
type Handler = (payload: any) => void;

export class Events {
  private map = new Map<string, Set<Handler>>();

  on(name: string, fn: Handler): () => void {
    let set = this.map.get(name);
    if (!set) this.map.set(name, (set = new Set()));
    set.add(fn);
    return () => this.off(name, fn);
  }

  once(name: string, fn: Handler): () => void {
    const off = this.on(name, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off(name: string, fn: Handler) {
    this.map.get(name)?.delete(fn);
  }

  emit(name: string, payload?: any) {
    const set = this.map.get(name);
    if (!set || set.size === 0) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[events] handler for "${name}" failed`, err);
      }
    }
  }
}
