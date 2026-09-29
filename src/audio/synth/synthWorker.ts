/**
 * Web Worker that renders synth recipes off the main thread.
 * Request:  { id, recipe, variant }
 * Response: { id, ok: true, chans: Float32Array[], sr } (buffers transferred) | { id, ok: false, error }
 */
import { renderRecipe } from './recipes';

interface Req {
  id: number;
  recipe: string;
  variant: number;
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Req>) => void) | null;
  postMessage(msg: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = (e) => {
  const { id, recipe, variant } = e.data;
  try {
    const { data, sr } = renderRecipe(recipe, variant);
    const chans = Array.isArray(data) ? data : [data];
    scope.postMessage({ id, ok: true, chans, sr }, chans.map((c) => c.buffer as ArrayBuffer));
  } catch (err) {
    scope.postMessage({ id, ok: false, error: String(err) });
  }
};
