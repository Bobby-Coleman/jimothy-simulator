/**
 * Shared toolbox for the capers (alien landing, the museum heist, trash & secrets). Re-exports the chaos/extras
 * helpers so every caper speaks the same dialect. Add genuinely shared caper helpers here (small, additive).
 */
export * from '../chaos/shared';
export { drawBoard, SignAtlas, smooth, between, mergeParts, WORLD_ONLY, DOWN, releaseCamera, clearView, aboveGround } from '../extras/shared';

/** One caper. Every hook is guarded by the CapersSystem (a failing caper logs and the rest keep running). */
export interface CaperFeature {
  readonly id: string;
  init?(): void | Promise<void>;
  update?(dt: number): void;
  postPhysics?(dt: number): void;
  lateUpdate?(dt: number): void;
}
