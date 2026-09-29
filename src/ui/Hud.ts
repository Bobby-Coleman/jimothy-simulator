import * as THREE from 'three';
import type { ScoreAdded, ScoreSystem } from '../gameplay/Score';
import type { ObjectivesSystem } from '../gameplay/Objectives';
import { G, groups } from '../core/Physics';
import { h, esc, fmt, replay, clamp, removeAfter } from './dom';
import { ICONS, iconFromSpec } from './icons';
import { fillTokens, glyph } from './glyphs';
import { categoryInfo } from './ObjectivesView';
import { comboWord } from './content';
import type { UiCtx } from './types';

const GRAB_FILTER = groups(G.ALL, G.PROP | G.NPC | G.RAGDOLL | G.VEHICLE | G.ANIMAL);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _p = new THREE.Vector3();

/** Read a world position out of whatever a gameplay system handed us. */
export function posOf(x: any, out: THREE.Vector3): THREE.Vector3 | null {
  if (!x) return null;
  if (x.isVector3) return out.copy(x);
  if (x.isObject3D) return x.getWorldPosition(out);
  if (typeof x.x === 'number' && typeof x.y === 'number' && typeof x.z === 'number') return out.set(x.x, x.y, x.z);
  if (x.object?.isObject3D) return x.object.getWorldPosition(out);
  if (x.body?.translation) {
    try {
      const t = x.body.translation();
      return out.set(t.x, t.y, t.z);
    } catch {
      return null;
    }
  }
  return null;
}

interface Popup {
  el: HTMLElement;
  label: string;
  points: number;
  t: number;
  life: number;
  dying: boolean;
  pts: HTMLElement;
  mult: HTMLElement;
}

interface ToastItem {
  el: HTMLElement;
  t: number;
  life: number;
  dying: boolean;
}

export interface ToastOpts {
  kind?: 'objective' | 'mutator' | 'generic';
  kicker?: string;
  title: string;
  text?: string;
  /** Icon name, image URL, raw <svg>, or emoji. */
  icon?: string;
  color?: string;
  points?: number;
  /** Extra line (may contain {action} tokens). */
  footer?: string;
  life?: number;
}

interface PromptItem {
  a?: string;
  label: string;
  held?: boolean;
  html?: string;
}

/**
 * The in-game HUD: score + combo, score popups, combo celebration, toasts, objective progress ticker,
 * area banner, hint line, context prompts, stamina / wash rings, camera flash, FPS/debug readout.
 */
export class Hud {
  readonly el: HTMLElement;
  private scoreVal: HTMLElement;
  private bestVal: HTMLElement;
  private comboBox: HTMLElement;
  private comboMult: HTMLElement;
  private comboCount: HTMLElement;
  private comboFill: HTMLElement;
  private popups: HTMLElement;
  private popupList: Popup[] = [];
  private toasts: HTMLElement;
  private toastList: ToastItem[] = [];
  private toastQueue: ToastOpts[] = [];
  private ticker: HTMLElement;
  private tickerT = 0;
  private tickerSeen = new Map<string, number>();
  private bannerEl: HTMLElement;
  private bannerT = 0;
  private celeEl: HTMLElement;
  private hintEl: HTMLElement;
  private hintT = 0;
  private promptsEl: HTMLElement;
  private promptKey = '';
  private promptTimer = 0;
  private custom: { text: string; until: number } | null = null;
  private stamina: HTMLElement;
  private staminaFg: SVGCircleElement;
  private wash: HTMLElement;
  private washFg: SVGCircleElement;
  private staminaA = 0;
  private staminaHold = 0;
  private washOn = false;
  private lastWashP = 0;
  private flashEl: HTMLElement;
  private flashA = 0;
  private fpsEl: HTMLElement;
  private debugEl: HTMLElement;
  debug = false;
  private shownScore = 0;
  private scoreTxt = '';
  private bestTxt = '';
  private comboOn = false;
  private comboTxt = '';
  private lowCombo = false;
  private frame = 0;

  constructor(
    private ctx: UiCtx,
    parent: HTMLElement,
  ) {
    const game = ctx.game;
    this.el = h('div', { class: 'hud' });
    parent.append(this.el);

    // --- score + combo (top-left)
    this.scoreVal = h('div', { class: 'score-val ol', text: '0' });
    this.bestVal = h('div', { class: 'score-best ol', text: '' });
    this.comboMult = h('div', { class: 'combo-mult', text: 'x1' });
    this.comboCount = h('div', { class: 'combo-count ol', text: '' });
    this.comboFill = h('i');
    this.comboBox = h(
      'div',
      { class: 'combo' },
      h('div', { class: 'combo-row' }, this.comboMult, this.comboCount),
      h('div', { class: 'combo-bar' }, this.comboFill),
    );
    this.el.append(
      h('div', { class: 'hud-score' }, h('div', { class: 'score-row' }, h('span', { class: 'score-icon', html: ICONS.paw }), this.scoreVal), this.bestVal, this.comboBox),
    );

    // --- toasts + objective ticker (top-right)
    this.toasts = h('div', { class: 'hud-toasts', 'aria-live': 'polite' });
    this.ticker = h('div', { class: 'hud-ticker' });
    this.el.append(h('div', { class: 'hud-right' }, this.toasts, this.ticker));

    // --- banner, celebration, popups, hint, prompts
    this.bannerEl = h('div', { class: 'hud-banner' });
    this.celeEl = h('div', { class: 'hud-cele' });
    this.popups = h('div', { class: 'hud-popups' });
    this.hintEl = h('div', { class: 'hud-hint', 'aria-live': 'polite' });
    this.promptsEl = h('div', { class: 'hud-prompts' });
    this.el.append(this.bannerEl, this.celeEl, this.popups, h('div', { class: 'hud-bottom' }, this.hintEl, this.promptsEl));

    // --- rings (follow Jimothy on screen)
    const ring = (cls: string, iconSvg: string) => {
      const wrap = h('div', { class: `ring ${cls}` });
      wrap.innerHTML = `<svg viewBox="0 0 44 44"><circle class="ring-bg" cx="22" cy="22" r="18"/><circle class="ring-fg" cx="22" cy="22" r="18" pathLength="100"/></svg><span class="ring-icon">${iconSvg}</span>`;
      this.el.append(wrap);
      return [wrap, wrap.querySelector('.ring-fg') as SVGCircleElement] as const;
    };
    const st = ring('ring-stamina', ICONS.paw);
    this.stamina = st[0];
    this.staminaFg = st[1];
    const wr = ring('ring-wash', ICONS.bubbles);
    this.wash = wr[0];
    this.washFg = wr[1];

    // --- flash + fps/debug
    this.flashEl = h('div', { class: 'hud-flash' });
    this.fpsEl = h('div', { class: 'hud-fps' });
    this.debugEl = h('div', { class: 'hud-debug' });
    parent.append(this.flashEl, this.fpsEl, this.debugEl);

    // --- events
    const ev = game.events;
    ev.on('scoreAdded', (e: ScoreAdded) => this.onScore(e));
    ev.on('comboUp', () => {
      replay(this.comboMult, 'bump');
      replay(this.comboBox, 'flash');
    });
    ev.on('comboEnd', (e: { combo: number; points: number; mult: number }) => {
      if (!e) return;
      this.celebrate(comboWord(e.combo), `${e.combo}-hit combo  ·  +${fmt(e.points)}`);
    });
    ev.on('objective', (o: any) => {
      if (!o) return;
      const cat = categoryInfo(o.category);
      this.toast({
        kind: 'objective',
        kicker: o.category === 'secret' ? 'Secret Instinct found!' : 'Instinct complete!',
        title: o.title ?? 'Something wonderful',
        text: o.desc,
        icon: cat.icon,
        color: cat.color,
        points: o.points,
        life: 6.5,
      });
    });
    ev.on('objectiveProgress', (p: any) => this.onProgress(p));
    ev.on('mutatorUnlocked', (m: any) => {
      if (!m) return;
      this.toast({
        kind: 'mutator',
        kicker: 'Mutator unlocked!',
        title: m.name ?? m.id,
        text: m.desc,
        icon: 'wand',
        color: '#19c2b8',
        footer: 'Equip it: {pause} › Mutators',
        life: 7.5,
      });
    });
    ev.on('toast', (t: any) => {
      if (!t || (!t.title && !t.text)) return;
      this.toast({ kind: 'generic', title: t.title ?? '', text: t.text, icon: t.icon, color: t.color, kicker: t.kicker, life: t.duration });
    });
    ev.on('hint', (e: { text: string; duration?: number }) => {
      if (e?.text) this.hint(e.text, e.duration ?? 2.5);
    });
    ev.on('cameraFlash', (p: any) => this.onCameraFlash(p));
  }

  // ------------------------------------------------------------------ score popups
  private onScore(e: ScoreAdded) {
    if (!e || !(e.points > 0)) return;
    replay(this.scoreVal, 'bump');
    const label = String(e.label || 'Something').toUpperCase();
    const live = this.popupList.filter((p) => !p.dying);
    const same = live.find((p) => p.label === label);
    if (same) {
      same.points += e.points;
      same.t = 0;
      same.pts.textContent = `+${fmt(same.points)}`;
      this.setMult(same.mult, e.mult);
      replay(same.el, 'bump');
      return;
    }
    const size = e.points >= 1000 ? 'xl' : e.points >= 250 ? 'lg' : e.points >= 60 ? 'md' : 'sm';
    const pts = h('span', { class: 'pop-pts', text: `+${fmt(e.points)}` });
    const mult = h('span', { class: 'pop-mult' });
    this.setMult(mult, e.mult);
    const el = h('div', { class: `pop pop-${size}` }, h('span', { class: 'pop-label', text: label }), pts, mult);
    el.style.setProperty('--tilt', `${(Math.random() * 6 - 3).toFixed(1)}deg`);
    this.popups.append(el);
    this.popupList.push({ el, label, points: e.points, t: 0, life: size === 'xl' ? 3.2 : 2.3, dying: false, pts, mult });
    const alive = this.popupList.filter((p) => !p.dying);
    for (let i = 0; i < alive.length - 5; i++) this.killPopup(alive[i]);
  }

  private setMult(el: HTMLElement, mult: number) {
    if (mult > 1) {
      el.textContent = `x${+mult.toFixed(1)}`;
      el.style.display = '';
    } else el.style.display = 'none';
  }

  private killPopup(p: Popup) {
    if (p.dying) return;
    p.dying = true;
    p.el.classList.add('out');
    window.setTimeout(() => {
      p.el.remove();
      const i = this.popupList.indexOf(p);
      if (i >= 0) this.popupList.splice(i, 1);
    }, 420);
  }

  // ------------------------------------------------------------------ celebration
  celebrate(word: string, sub?: string, color?: string) {
    this.celeEl.textContent = '';
    const c = h('div', { class: 'cele' }, h('div', { class: 'cele-word ol-thick', text: word }), sub ? h('div', { class: 'cele-sub ol', text: sub }) : null);
    if (color) c.style.setProperty('--cele', color);
    this.celeEl.append(c);
    window.setTimeout(() => c.classList.add('out'), 1700);
    removeAfter(c, 2300);
  }

  // ------------------------------------------------------------------ toasts
  toast(opts: ToastOpts) {
    const live = this.toastList.filter((t) => !t.dying).length;
    if (live >= 3) {
      this.toastQueue.push(opts);
      return;
    }
    const kind = opts.kind ?? 'generic';
    const el = h('div', { class: `toast toast-${kind}` });
    el.style.setProperty('--accent', opts.color ?? (kind === 'mutator' ? '#19c2b8' : '#ffa23a'));
    const iconHtml = opts.icon && opts.icon.startsWith('<svg') ? opts.icon : iconFromSpec(opts.icon, kind === 'mutator' ? 'wand' : 'star');
    el.append(h('div', { class: 'toast-icon', html: iconHtml }));
    const body = h('div', { class: 'toast-body' });
    if (opts.kicker) body.append(h('div', { class: 'toast-kicker', text: opts.kicker }));
    if (opts.title) body.append(h('div', { class: 'toast-title', text: opts.title }));
    if (opts.text) body.append(h('div', { class: 'toast-text', text: opts.text }));
    if (opts.footer) body.append(h('div', { class: 'toast-footer', html: fillTokens(opts.footer, this.ctx.device) }));
    el.append(body);
    if (opts.points) el.append(h('div', { class: 'toast-pts ol', text: `+${fmt(opts.points)}` }));
    this.toasts.append(el);
    this.toastList.push({ el, t: 0, life: opts.life ?? 5, dying: false });
  }

  private updateToasts(dt: number) {
    for (const t of this.toastList) {
      t.t += dt;
      if (!t.dying && t.t > t.life) {
        t.dying = true;
        t.el.classList.add('out');
        window.setTimeout(() => {
          t.el.remove();
          const i = this.toastList.indexOf(t);
          if (i >= 0) this.toastList.splice(i, 1);
          const next = this.toastQueue.shift();
          if (next) this.toast(next);
        }, 450);
      }
    }
  }

  // ------------------------------------------------------------------ objective progress ticker
  private onProgress(p: any) {
    if (!p?.id) return;
    const target = p.target ?? 1;
    if (target <= 1 || p.progress >= target) return;
    const o = this.ctx.game.get<ObjectivesSystem>('objectives')?.get(p.id);
    if (o?.hidden) return;
    const now = performance.now();
    const last = this.tickerSeen.get(p.id) ?? -1e9;
    // Throttle per objective, but always show round-number milestones.
    if (now - last < 2500 && p.progress % Math.max(1, Math.round(target / 4)) !== 0) return;
    this.tickerSeen.set(p.id, now);
    const cat = categoryInfo(o?.category);
    const pct = clamp(p.progress / target, 0, 1);
    this.ticker.innerHTML = `<span class="tick-icon">${cat.icon}</span><span class="tick-name">${esc(p.title ?? o?.title ?? '')}</span><span class="tick-bar"><i style="transform:scaleX(${pct})"></i></span><span class="tick-num">${fmt(p.progress)}/${fmt(target)}</span>`;
    this.ticker.style.setProperty('--cat', cat.color);
    replay(this.ticker, 'show');
    this.tickerT = 2.6;
  }

  // ------------------------------------------------------------------ banner / hint / prompt
  banner(text: string, sub?: string, kicker = 'Now entering') {
    this.bannerEl.innerHTML = `${kicker ? `<div class="banner-kicker">${esc(kicker)}</div>` : ''}<div class="banner-name ol-thick">${esc(text)}</div><div class="banner-swoosh"></div>${sub ? `<div class="banner-sub ol">${esc(sub)}</div>` : ''}`;
    this.bannerEl.classList.remove('hide');
    replay(this.bannerEl, 'show');
    this.bannerT = 3.4;
  }

  hint(text: string, duration = 2.5) {
    this.hintEl.innerHTML = fillTokens(text, this.ctx.device);
    this.hintEl.classList.add('show');
    replay(this.hintEl, 'pulse');
    this.hintT = duration;
  }

  /** Custom context prompt from gameplay (tokens like {grab} become key chips). `null` clears it. */
  setPrompt(text: string | null, ttl?: number) {
    this.custom = text ? { text, until: ttl ? performance.now() + ttl * 1000 : Infinity } : null;
    this.promptTimer = 0;
  }

  // ------------------------------------------------------------------ flash
  flash(strength = 0.3) {
    this.flashA = Math.max(this.flashA, clamp(strength, 0, 1));
  }

  private onCameraFlash(p: any) {
    if (!this.ctx.settings.flashes) return;
    const game = this.ctx.game;
    const player = game.get<any>('player');
    const src = posOf(p?.position, _w) ?? posOf(p?.entity, _w) ?? posOf(p?.by, _w) ?? posOf(p?.from, _w) ?? posOf(p?.npc, _w);
    if (src && player?.position) {
      const d = src.distanceTo(player.position);
      if (d > 6) return;
      this.flash(0.1 + 0.28 * (1 - d / 6));
    } else this.flash(0.14);
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number) {
    const game = this.ctx.game;
    this.frame++;
    this.updateScore(dt);

    for (const p of this.popupList) {
      p.t += dt;
      if (!p.dying && p.t > p.life) this.killPopup(p);
    }
    this.updateToasts(dt);
    if (this.tickerT > 0) {
      this.tickerT -= dt;
      if (this.tickerT <= 0) this.ticker.classList.remove('show');
    }
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) {
        this.bannerEl.classList.remove('show');
        this.bannerEl.classList.add('hide');
      }
    }
    if (this.hintT > 0) {
      this.hintT -= dt;
      if (this.hintT <= 0) this.hintEl.classList.remove('show');
    }
    this.updatePrompts(dt);
    this.updateRings(dt);

    if (this.flashA > 0.002) {
      this.flashEl.style.opacity = this.flashA.toFixed(3);
      this.flashA *= Math.exp(-dt * 7.5);
      if (this.flashA <= 0.002) this.flashEl.style.opacity = '0';
    }

    if ((this.ctx.settings.showFps || this.debug) && this.frame % 15 === 0) {
      this.fpsEl.textContent = `${Math.round(game.fps)} FPS`;
    }
    this.fpsEl.style.display = this.ctx.settings.showFps || this.debug ? '' : 'none';
    this.debugEl.style.display = this.debug ? '' : 'none';
    if (this.debug && this.frame % 10 === 0) {
      const p = game.get<any>('player');
      const pos = p?.position;
      const area = pos ? game.get<any>('world')?.areaAt?.(pos.x, pos.z) : null;
      this.debugEl.textContent = pos
        ? `${game.state} · ${p.mode}${p.grounded ? ' · ground' : ''}\n${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}\n${area ?? '(no area)'} · t=${game.get<any>('environment')?.timeOfDay?.toFixed?.(2) ?? '?'}h`
        : game.state;
    }
  }

  private updateScore(dt: number) {
    const s = this.ctx.game.get<ScoreSystem>('score');
    if (!s) return;
    if (this.shownScore !== s.total) {
      this.shownScore += (s.total - this.shownScore) * (1 - Math.exp(-dt * 11));
      if (Math.abs(s.total - this.shownScore) < 1) this.shownScore = s.total;
      const txt = fmt(this.shownScore);
      if (txt !== this.scoreTxt) {
        this.scoreTxt = txt;
        this.scoreVal.textContent = txt;
      }
    }
    const best = s.best > 0 ? `Best ${fmt(s.best)}` : '';
    if (best !== this.bestTxt) {
      this.bestTxt = best;
      this.bestVal.textContent = best;
    }
    const on = s.combo >= 2 && s.comboTimer > 0;
    if (on !== this.comboOn) {
      this.comboOn = on;
      this.comboBox.classList.toggle('on', on);
    }
    if (on) {
      const t = `${s.combo} combo`;
      if (t !== this.comboTxt) {
        this.comboTxt = t;
        this.comboCount.textContent = t;
        this.setMult(this.comboMult, s.mult);
        if (s.mult <= 1) {
          this.comboMult.style.display = '';
          this.comboMult.textContent = 'x1';
        }
      }
      const frac = clamp(s.comboTimer / (s.comboWindow || 3.2), 0, 1);
      this.comboFill.style.transform = `scaleX(${frac.toFixed(3)})`;
      const low = frac < 0.3;
      if (low !== this.lowCombo) {
        this.lowCombo = low;
        this.comboBox.classList.toggle('low', low);
      }
    }
  }

  private updatePrompts(dt: number) {
    this.promptTimer -= dt;
    if (this.promptTimer > 0) return;
    this.promptTimer = 0.1;
    const game = this.ctx.game;
    const items: PromptItem[] = [];
    if (this.custom && performance.now() > this.custom.until) this.custom = null;
    const p = game.get<any>('player');
    if (p && game.state === 'playing' && !p.frozen) {
      const held = p.held;
      const mode: string = p.mode;
      const water = game.get<any>('water');
      const nearWater = () => {
        if (mode === 'swim') return true;
        _p.set(Math.sin(p.facing), 0, Math.cos(p.facing));
        _v.copy(p.position).addScaledVector(_p, 0.5);
        _v.y -= 0.18;
        return !!water?.nearWater?.(_v, 0.95);
      };
      if (held?.entity) {
        items.push({ held: true, label: held.entity.name ?? 'Something' });
        if (held.kind === 'carry') {
          if (mode === 'walk' || mode === 'swim') {
            if (nearWater()) items.push({ a: 'wash', label: p.washing ? 'Scrub scrub…' : 'Wash it' });
          }
          items.push({ a: 'bonk', label: 'Throw' }, { a: 'grab', label: 'Drop' });
        } else items.push({ a: 'grab', label: 'Let go' });
      } else if (mode === 'walk' || mode === 'swim' || mode === 'climb') {
        const g = this.grabLabel(p);
        if (g) items.push({ a: 'grab', label: g });
        if (mode === 'climb') items.push({ a: 'jump', label: 'Wall jump' });
        else if (mode === 'swim') items.push({ a: 'jump', label: 'Hop out' });
        if (mode !== 'climb' && !g && nearWater()) items.push({ a: 'wash', label: p.washing ? 'Scrub scrub…' : 'Wash paws' });
        if (mode === 'walk' && game.input.held('sprint') && p.speed > 3) items.push({ a: 'roll', label: 'Tuck & Roll' });
      } else if (mode === 'roll') {
        items.push({ a: 'roll', label: 'Unroll' }, { a: 'bonk', label: 'Boost' });
      } else if (mode === 'hang') {
        items.push({ a: 'jump', label: 'Let go' });
      }
    }
    if (this.custom) items.unshift({ html: fillTokens(this.custom.text, this.ctx.device), label: this.custom.text });
    const dev = this.ctx.device;
    const key = dev + '|' + items.map((i) => `${i.a ?? ''}:${i.label}:${i.held ? 1 : 0}`).join('|');
    if (key === this.promptKey) return;
    this.promptKey = key;
    this.promptsEl.textContent = '';
    for (const it of items) {
      let el: HTMLElement;
      if (it.held) el = h('div', { class: 'prompt prompt-held', html: `${ICONS.hand}<span>${esc(it.label)}</span>` });
      else if (it.html) el = h('div', { class: 'prompt prompt-custom', html: `<span>${it.html}</span>` });
      else el = h('div', { class: 'prompt', html: `${glyph(it.a!, dev)}<span>${esc(it.label)}</span>` });
      this.promptsEl.append(el);
    }
  }

  private grabLabel(p: any): string | null {
    const game = this.ctx.game;
    _p.set(Math.sin(p.facing), 0, Math.cos(p.facing));
    const hand = _v.copy(p.position).addScaledVector(_p, 0.5);
    hand.y += 0.02;
    let cols: any[];
    try {
      cols = game.physics.overlapSphere(hand, 0.62, GRAB_FILTER, p.body);
    } catch {
      return null;
    }
    let best: any = null;
    let bestD = Infinity;
    for (const c of cols) {
      const e = game.entities.fromCollider(c);
      if (!e || !e.alive || !e.body || e.kind === 'player' || e.data?.heldByPlayer) continue;
      if (!(e.tags.has('grabbable') || e.kind === 'npc' || e.kind === 'vehicle' || e.kind === 'animal' || e.kind === 'slop')) continue;
      let t: { x: number; y: number; z: number };
      try {
        t = e.body.translation();
      } catch {
        continue;
      }
      const d = ((hand.x - t.x) ** 2 + (hand.y - t.y) ** 2 + (hand.z - t.z) ** 2) * (e.tags.has('grabbable') ? 0.6 : 1);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (!best) return null;
    if (typeof best.data?.grabLabel === 'string') return best.data.grabLabel;
    if (best.kind === 'vehicle') return 'Hang on';
    return `Grab ${best.name}`;
  }

  private updateRings(dt: number) {
    const game = this.ctx.game;
    const p = game.get<any>('player');
    const active = !!p && (game.state === 'playing' || game.state === 'paused');
    // Stamina: visible while climbing or recovering, lingers briefly once full.
    let sVis = false;
    if (active && p.position) {
      const st = clamp(p.stamina ?? 1, 0, 1);
      if (p.mode === 'climb' || st < 0.995) this.staminaHold = 0.9;
      else this.staminaHold -= dt;
      sVis = this.staminaHold > 0;
      if (sVis) {
        this.staminaFg.style.strokeDashoffset = (100 - st * 100).toFixed(1);
        this.stamina.classList.toggle('low', st < 0.25);
        this.stamina.classList.toggle('mid', st >= 0.25 && st < 0.55);
      }
    }
    this.staminaA += ((sVis ? 1 : 0) - this.staminaA) * (1 - Math.exp(-dt * 10));
    let wVis = false;
    if (active && p.washing) {
      wVis = true;
      const wp = clamp(p.washProgress ?? 0, 0, 1);
      if (this.lastWashP > 0.75 && wp < 0.25) replay(this.wash, 'pop');
      this.lastWashP = wp;
      this.washFg.style.strokeDashoffset = (100 - wp * 100).toFixed(1);
    } else this.lastWashP = 0;
    if (wVis !== this.washOn) {
      this.washOn = wVis;
      this.wash.classList.toggle('on', wVis);
    }
    if (!active || !p?.position || (this.staminaA < 0.01 && !wVis)) {
      this.stamina.style.opacity = '0';
      return;
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    _v.copy(p.position).project(game.camera);
    const behind = _v.z > 1;
    const x = (_v.x * 0.5 + 0.5) * W;
    const y = (-_v.y * 0.5 + 0.5) * H;
    this.stamina.style.opacity = behind ? '0' : this.staminaA.toFixed(3);
    this.stamina.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    if (wVis) {
      _v.copy(p.position);
      _v.y += 0.75 * (p.sizeMul ?? 1);
      _v.project(game.camera);
      const wx = (_v.x * 0.5 + 0.5) * W;
      const wy = (-_v.y * 0.5 + 0.5) * H;
      this.wash.style.transform = `translate3d(${wx.toFixed(1)}px, ${wy.toFixed(1)}px, 0)`;
    }
  }
}
