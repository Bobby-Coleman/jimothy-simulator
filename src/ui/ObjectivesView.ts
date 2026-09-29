import type { Game } from '../core/Game';
import type { Objective, ObjectivesSystem } from '../gameplay/Objectives';
import type { MutatorSystem } from '../gameplay/Mutators';
import { h, esc, fmt } from './dom';
import { ICONS } from './icons';

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

/** Render the grouped objectives list into `container` (replacing its content). */
export function renderObjectives(game: Game, container: HTMLElement, opts: { summary?: boolean } = {}) {
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
