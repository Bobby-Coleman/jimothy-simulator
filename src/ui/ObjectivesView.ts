import type { Game } from '../core/Game';
import type { Objective, ObjectivesSystem } from '../gameplay/Objectives';
import type { MutatorSystem } from '../gameplay/Mutators';
import { h, esc, fmt } from './dom';
import { ICONS } from './icons';
import type { Guide } from './Guide';
import type { UiCtx } from './types';

export interface CategoryInfo {
  id: string;
  label: string;
  short: string;
  color: string;
  icon: string;
}

/** Objective ("Instinct") categories: colors + icons shared by the panel and the toasts. */
export const CATEGORIES: CategoryInfo[] = [
  { id: 'raccoon', label: 'Raccoon Instincts', short: 'Raccoon', color: '#ffa23a', icon: ICONS.paw },
  { id: 'slop', label: 'Slop Patrol', short: 'AI Slop', color: '#b17dff', icon: ICONS.slop },
  { id: 'heart', label: 'Heartwarming', short: 'Heart', color: '#ff6f91', icon: ICONS.heart },
  { id: 'chaos', label: 'Glorious Chaos', short: 'Chaos', color: '#ff5b3a', icon: ICONS.boom },
  { id: 'secret', label: 'Secrets', short: 'Secret', color: '#ffd23f', icon: ICONS.secret },
];

export function categoryInfo(id: string | undefined): CategoryInfo {
  return CATEGORIES.find((c) => c.id === id) ?? { id: id ?? 'other', label: 'Other', short: 'Other', color: '#19c2b8', icon: ICONS.star };
}

function row(o: Objective, cat: CategoryInfo, muts: MutatorSystem | undefined): HTMLElement {
  const secret = !!o.hidden && !o.done;
  const target = o.target ?? 1;
  const r = h('div', { class: `obj-row${o.done ? ' done' : ''}${secret ? ' secret' : ''}`, style: { '--cat': cat.color } as any });
  r.append(h('div', { class: 'obj-check', html: o.done ? ICONS.check : secret ? ICONS.lock : '' }));
  const main = h('div', { class: 'obj-main' });
  main.append(
    h(
      'div',
      { class: 'obj-title' },
      h('span', { class: 'obj-name', text: secret ? '???' : o.title }),
      !secret && o.points ? h('span', { class: 'obj-pts', text: `+${fmt(o.points)}` }) : null,
    ),
  );
  main.append(h('div', { class: 'obj-desc', text: secret ? 'A secret Instinct. Keep being weird and it will find you.' : o.desc }));
  if (!secret && target > 1) {
    const pct = Math.max(0, Math.min(1, o.progress / target));
    const bar = h('div', { class: 'obj-bar' }, h('i', { style: { transform: `scaleX(${pct})` } }));
    main.append(h('div', { class: 'obj-prog' }, bar, h('span', { text: `${fmt(Math.min(o.progress, target))}/${fmt(target)}` })));
  }
  if (!secret && o.reward) {
    const m = muts?.get(o.reward);
    main.append(h('div', { class: 'obj-reward', html: `${ICONS.wand}<span>Unlocks mutator: <b>${esc(m?.name ?? o.reward)}</b></span>` }));
  }
  r.append(main);
  return r;
}

/**
 * "Suggested next": up to 3 Instincts picked by ui/Guide.ts (curated early-game order + distance), each with a
 * how-to line, where/how far, and a Track button. The tracked one drives the HUD pill + world waypoint.
 */
function renderSuggestions(game: Game, container: HTMLElement, onChange?: () => void) {
  const guide = (game.get<any>('ui') as { guide?: Guide } | undefined)?.guide;
  const sys = game.get<ObjectivesSystem>('objectives');
  if (!guide || !sys) return;
  guide.resolve();
  const rows = [...guide.suggestions];
  if (!rows.length) return;
  const sec = h('section', { class: 'obj-cat obj-sugg', style: { '--cat': '#ffd23f' } as any });
  sec.append(
    h(
      'header',
      { class: 'obj-cat-head' },
      h('span', { class: 'obj-cat-icon', html: ICONS.star }),
      h('span', { class: 'obj-cat-label', text: 'Suggested next' }),
      guide.manualId ? h('button', { class: 'sugg-auto', text: 'Auto-track', title: 'Always track the top suggestion', onclick: () => (guide.untrack(), onChange?.()) }) : null,
    ),
  );
  for (const s of rows) {
    const o = sys.get(s.id);
    const cat = categoryInfo(s.category);
    const tracked = guide.isTracked(s.id);
    const d = guide.describe(s);
    const r = h('div', { class: `obj-row sugg-row${tracked ? ' tracked' : ''}`, style: { '--cat': cat.color } as any });
    r.append(h('div', { class: 'obj-check sugg-icon', html: cat.icon }));
    const main = h('div', { class: 'obj-main' });
    main.append(
      h(
        'div',
        { class: 'obj-title' },
        h('span', { class: 'obj-name', text: s.title }),
        o?.points ? h('span', { class: 'obj-pts', text: `+${fmt(o.points)}` }) : null,
      ),
      h('div', { class: 'obj-desc', html: d.how }),
    );
    const meta = [s.progress, d.where].filter(Boolean).join('  ·  ');
    if (meta) main.append(h('div', { class: 'sugg-where', html: `${ICONS.pin}<span>${esc(meta)}</span>` }));
    r.append(main);
    const btn = h('button', {
      class: `sugg-track${tracked ? ' on' : ''}`,
      'aria-pressed': String(tracked),
      'aria-label': tracked ? `Tracking ${s.title}` : `Track ${s.title}`,
      html: `${ICONS.star}<span>${tracked ? 'Tracking' : 'Track'}</span>`,
      onclick: () => {
        if (tracked && guide.manualId === s.id) guide.untrack();
        else guide.track(s.id);
        (game.get<any>('ui') as UiCtx | undefined)?.sfx('ui_toggle');
        onChange?.();
      },
    });
    r.append(btn);
    sec.append(r);
  }
  container.append(sec);
}

/** Render the grouped objectives list into `container` (replacing its content). */
export function renderObjectives(game: Game, container: HTMLElement, opts: { summary?: boolean; suggest?: boolean; onChange?: () => void } = {}) {
  container.textContent = '';
  const sys = game.get<ObjectivesSystem>('objectives');
  const muts = game.get<MutatorSystem>('mutators');
  const list = sys?.list ?? [];
  if (opts.summary !== false) {
    const done = list.filter((o) => o.done).length;
    const pct = list.length ? done / list.length : 0;
    container.append(
      h(
        'div',
        { class: 'obj-summary' },
        h('div', { class: 'obj-sum-text', html: `<b>${done}</b> / ${list.length} Instincts` }),
        h('div', { class: 'obj-bar obj-bar-big' }, h('i', { style: { transform: `scaleX(${pct})` } })),
      ),
    );
  }
  if (opts.suggest !== false) renderSuggestions(game, container, opts.onChange);
  if (!list.length) {
    container.append(h('div', { class: 'obj-empty', text: 'No Instincts yet. Jimothy is simply vibing. (The objectives system is still being written overnight.)' }));
    return;
  }
  const known = new Set(CATEGORIES.map((c) => c.id));
  const groups: CategoryInfo[] = [...CATEGORIES];
  if (list.some((o) => !known.has(o.category))) groups.push(categoryInfo('other'));
  for (const cat of groups) {
    const items = list.filter((o) => (cat.id === 'other' ? !known.has(o.category) : o.category === cat.id));
    if (!items.length) continue;
    const done = items.filter((o) => o.done).length;
    const sec = h('section', { class: 'obj-cat', style: { '--cat': cat.color } as any });
    sec.append(
      h(
        'header',
        { class: 'obj-cat-head' },
        h('span', { class: 'obj-cat-icon', html: cat.icon }),
        h('span', { class: 'obj-cat-label', text: cat.label }),
        h('span', { class: 'obj-cat-count', text: `${done}/${items.length}` }),
      ),
    );
    for (const o of items) sec.append(row(o, cat, muts));
    container.append(sec);
  }
}
