/**
 * Heist HUD: the escape timer pill (top centre, under the guide pill) and a pulsing red alarm vignette.
 * DOM only, inline styles + one tiny <style> for the keyframes (class prefix `heist-`).
 */
export class HeistHud {
  private box: HTMLDivElement | null = null;
  private label: HTMLDivElement | null = null;
  private fill: HTMLDivElement | null = null;
  private vignette: HTMLDivElement | null = null;
  private lastText = '';

  private ensure() {
    if (this.box) return;
    const host = document.getElementById('ui') ?? document.body;
    if (!document.getElementById('heist-css')) {
      const st = document.createElement('style');
      st.id = 'heist-css';
      st.textContent =
        '@keyframes heist-pulse{0%,100%{opacity:.25}50%{opacity:.85}}' +
        '@keyframes heist-throb{0%,100%{transform:translateX(-50%) scale(1)}50%{transform:translateX(-50%) scale(1.05)}}' +
        '.heist-vig{position:absolute;inset:0;pointer-events:none;z-index:4;box-shadow:inset 0 0 140px 30px rgba(230,30,40,.55);animation:heist-pulse .9s ease-in-out infinite;display:none}' +
        '.heist-vig.heist-calm{animation:none;opacity:.35}' +
        '.heist-timer{position:absolute;left:50%;top:66px;transform:translateX(-50%);min-width:250px;padding:7px 14px 9px;border-radius:16px;' +
        "background:rgba(60,8,14,.88);color:#fff1e6;font:17px 'Lilita One','Arial Black',sans-serif;letter-spacing:.5px;text-align:center;" +
        'pointer-events:none;z-index:6;border:2px solid #ff5a4a;box-shadow:0 3px 0 rgba(0,0,0,.35);display:none}' +
        '.heist-timer.heist-hurry{animation:heist-throb .5s ease-in-out infinite;border-color:#ffd23f}' +
        '.heist-bar{height:9px;margin-top:5px;border-radius:6px;background:rgba(255,255,255,.18);overflow:hidden}' +
        '.heist-fill{height:100%;border-radius:6px;background:linear-gradient(90deg,#ff5a4a,#ffd23f)}';
      document.head.append(st);
    }
    const vig = document.createElement('div');
    vig.className = 'heist-vig';
    const box = document.createElement('div');
    box.className = 'heist-timer';
    const label = document.createElement('div');
    label.style.cssText = 'white-space:nowrap;text-shadow:0 2px 0 rgba(0,0,0,.45)';
    const bar = document.createElement('div');
    bar.className = 'heist-bar';
    const fill = document.createElement('div');
    fill.className = 'heist-fill';
    bar.append(fill);
    box.append(label, bar);
    host.append(vig, box);
    this.box = box;
    this.label = label;
    this.fill = fill;
    this.vignette = vig;
  }

  /** Show the alarm state. `left`/`total` in seconds (null = no countdown, just the alarm line). */
  show(text: string, left: number | null, total: number, reduceFlashing: boolean) {
    this.ensure();
    this.box!.style.display = 'block';
    this.vignette!.style.display = 'block';
    this.vignette!.classList.toggle('heist-calm', reduceFlashing);
    const secs = Math.max(0, Math.ceil(left ?? 0));
    const t = left == null ? text : `${text} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    if (t !== this.lastText) {
      this.label!.textContent = t;
      this.lastText = t;
    }
    const k = left == null ? 1 : Math.max(0, Math.min(1, left / total));
    this.fill!.style.width = `${(k * 100).toFixed(1)}%`;
    this.box!.classList.toggle('heist-hurry', left != null && left < 15 && !reduceFlashing);
  }

  hide() {
    if (!this.box) return;
    this.box.style.display = 'none';
    this.vignette!.style.display = 'none';
  }
}
