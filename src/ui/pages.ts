import type { ScoreSystem } from '../gameplay/Score';
import type { ObjectivesSystem } from '../gameplay/Objectives';
import type { MutatorSystem } from '../gameplay/Mutators';
import * as SoundBank from '../audio/soundBank';
import { h, esc, fmt, pick } from './dom';
import { ICONS, JIMOTHY_FACE } from './icons';
import { keyChip } from './glyphs';
import { renderObjectives } from './ObjectivesView';
import { PAUSE_QUIPS } from './content';
import type { MenuHost, PageDef } from './MenuHost';
import type { Settings } from './settings';
import type { UiCtx } from './types';

/** What menu pages need from the UI system. */
export interface MenuApi extends UiCtx {
  readonly settings: Settings;
  /** Persist + apply one changed setting. */
  commitSettings(key: keyof Settings): void;
  resume(): void;
  resetProgress(): void;
  /** Resume and send Jimothy back to the den (same as H). */
  respawnHome(): void;
  /** Resume straight into photo mode (same as V). */
  photoFromMenu(): void;
  readonly isTouch: boolean;
}

// ------------------------------------------------------------------ small widgets

function section(title: string) {
  return h('h3', { class: 'set-section', text: title });
}

function sliderRow(label: string, min: number, max: number, step: number, value: number, show: (v: number) => string, onInput: (v: number) => void) {
  const out = h('span', { class: 'set-value', text: show(value) });
  const input = h('input', { type: 'range', min, max, step, value: String(value), 'aria-label': label }) as HTMLInputElement;
  input.style.setProperty('--fill', `${((value - min) / (max - min)) * 100}%`);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = show(v);
    input.style.setProperty('--fill', `${((v - min) / (max - min)) * 100}%`);
    onInput(v);
  });
  return h('label', { class: 'set-row' }, h('span', { class: 'set-label', text: label }), input, out);
}

function toggleRow(label: string, value: boolean, onChange: (on: boolean) => void, desc?: string, api?: UiCtx) {
  const sw = h('button', { class: `switch${value ? ' on' : ''}`, role: 'switch', 'aria-checked': String(value), 'aria-label': label }, h('i'));
  sw.addEventListener('click', () => {
    const on = !sw.classList.contains('on');
    sw.classList.toggle('on', on);
    sw.setAttribute('aria-checked', String(on));
    api?.sfx('ui_toggle');
    onChange(on);
  });
  return h('div', { class: 'set-row' }, h('span', { class: 'set-label' }, label, desc ? h('small', { text: desc }) : null), sw);
}

function segRow(label: string, options: [string, string][], current: string | null, onPick: (v: string) => void, api?: UiCtx) {
  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
  for (const [value, text] of options) {
    const b = h('button', { class: `seg-btn${value === current ? ' on' : ''}`, role: 'radio', 'aria-checked': String(value === current), text });
    b.addEventListener('click', () => {
      for (const o of seg.querySelectorAll('.seg-btn')) {
        o.classList.toggle('on', o === b);
        o.setAttribute('aria-checked', String(o === b));
      }
      api?.sfx('ui_toggle');
      onPick(value);
    });
    seg.append(b);
  }
  return h('div', { class: 'set-row' }, h('span', { class: 'set-label', text: label }), seg);
}

function bigButton(text: string, iconSvg: string, onClick: () => void, cls = '') {
  return h('button', { class: `btn ${cls}`, html: `<span class="btn-icon">${iconSvg}</span><span>${esc(text)}</span>`, onclick: onClick });
}

export function clock(hours: number) {
  const hh = Math.floor(((hours % 24) + 24) % 24);
  const mm = Math.floor((hours - Math.floor(hours)) * 60);
  return `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
}

// ------------------------------------------------------------------ pages

function buildPauseMain(api: MenuApi, host: MenuHost) {
  const game = api.game;
  const score = game.get<ScoreSystem>('score');
  const objs = game.get<ObjectivesSystem>('objectives');
  const muts = game.get<MutatorSystem>('mutators');
  const p = game.get<any>('player');
  const env = game.get<any>('environment');
  const area = p?.position ? game.get<any>('world')?.areaAt?.(p.position.x, p.position.z) : null;
  const unlocked = muts?.list.filter((m) => m.unlocked).length ?? 0;

  const left = h(
    'div',
    { class: 'pause-left' },
    h('div', { class: 'pause-quip', text: pick(PAUSE_QUIPS) }),
    h(
      'div',
      { class: 'pause-btns' },
      (() => {
        const b = bigButton('Resume', ICONS.play, () => api.resume(), 'btn-primary');
        b.setAttribute('data-autofocus', '');
        return b;
      })(),
      bigButton('Instincts', ICONS.list, () => host.push('objectives')),
      bigButton('Mutators', ICONS.wand, () => host.push('mutators')),
      bigButton('Settings', ICONS.gear, () => host.push('settings')),
      bigButton('Controls', api.device === 'pad' ? ICONS.gamepad : ICONS.keyboard, () => host.push('controls')),
      bigButton('Credits', ICONS.star, () => host.push('credits')),
      h(
        'div',
        { class: 'pause-small' },
        bigButton('Back to the den', ICONS.home, () => api.respawnHome(), 'btn-small'),
        bigButton('Photo mode', ICONS.camera, () => api.photoFromMenu(), 'btn-small'),
        bigButton('Reset progress', ICONS.close, () => host.push('reset'), 'btn-small btn-danger'),
      ),
    ),
  );
  const stat = (label: string, value: string) => h('div', { class: 'card-stat' }, h('span', { text: label }), h('b', { text: value }));
  const card = h(
    'div',
    { class: 'pause-card' },
    h('div', { class: 'card-face', html: JIMOTHY_FACE }),
    h('div', { class: 'card-title', text: "Jimothy's Report Card" }),
    stat('Score', fmt(score?.total ?? 0)),
    stat('Best', fmt(score?.best ?? 0)),
    stat('Instincts', `${objs?.doneCount ?? 0} / ${objs?.list.length ?? 0}`),
    stat('Mutators', `${unlocked} / ${muts?.list.length ?? 0}`),
    stat('Location', area ?? 'Somewhere round'),
    stat('Local time', env ? `${clock(env.timeOfDay)}${env.isNight ? ' · raccoon hours' : ''}` : '—'),
    stat('Roundness', '100%'),
  );
  return h('div', { class: 'pause-main' }, left, card);
}

function buildObjectivesPage(api: MenuApi, host: MenuHost) {
  const box = h('div', { class: 'scroll obj-list' });
  renderObjectives(api.game, box, { onChange: () => host.refresh() });
  return box;
}

function buildMutators(api: MenuApi, host: MenuHost) {
  const game = api.game;
  const muts = game.get<MutatorSystem>('mutators');
  const wrap = h('div', { class: 'scroll mut-page' });
  const list = muts?.list ?? [];
  const all = !!muts?.allUnlocked;
  if (!list.length) {
    wrap.append(h('div', { class: 'obj-empty', text: 'No mutators yet. They are still being generated. Please hold. (Hold what? Great question.)' }));
  }
  wrap.append(h('p', { class: 'mut-intro', text: 'Mutators are unlocked by completing Instincts. Mix and match (mutators in the same group replace each other).' }));
  for (const m of list) {
    const avail = m.unlocked || all;
    const row = h('div', { class: `mut-row${avail ? '' : ' locked'}${m.enabled ? ' on' : ''}` });
    row.append(h('div', { class: 'mut-icon', html: avail ? ICONS.wand : ICONS.lock }));
    const main = h('div', { class: 'mut-main' }, h('div', { class: 'mut-name' }, m.name, m.group ? h('span', { class: 'mut-group', text: m.group }) : null));
    main.append(h('div', { class: 'mut-desc', text: avail ? m.desc : `Locked — ${m.unlockHint}` }));
    row.append(main);
    if (avail) {
      const sw = h('button', { class: `switch${m.enabled ? ' on' : ''}`, role: 'switch', 'aria-checked': String(m.enabled), 'aria-label': m.name }, h('i'));
      sw.addEventListener('click', () => {
        muts!.setEnabled(m.id, !m.enabled);
        api.sfx(m.enabled ? 'ui_confirm' : 'ui_toggle');
        host.refresh();
      });
      row.append(sw);
    }
    wrap.append(row);
  }
  // "I just want to play" → dev unlock-all toggle
  const dev = h('div', { class: 'mut-dev' });
  const devToggle = toggleRow(
    'Dev: unlock every mutator',
    all,
    (on) => {
      if (!muts) return;
      if (!on) for (const m of muts.list) if (m.enabled && !m.unlocked) muts.setEnabled(m.id, false);
      muts.allUnlocked = on;
      api.settings.unlockAll = on;
      api.commitSettings('unlockAll');
      host.refresh();
    },
    'No Instincts were harmed. Your achievements stay honest.',
    api,
  );
  dev.append(devToggle);
  if (!all) dev.style.display = 'none';
  const reveal = h('button', {
    class: 'link-btn',
    text: all ? 'Unlock-all is on' : 'I just want to play',
    onclick: () => {
      dev.style.display = '';
      reveal.style.display = 'none';
      (devToggle.querySelector('button') as HTMLElement | null)?.focus();
    },
  });
  if (all) reveal.style.display = 'none';
  wrap.append(h('div', { class: 'mut-foot' }, reveal, dev));
  return wrap;
}

function buildSettings(api: MenuApi) {
  const s = api.settings;
  const game = api.game;
  const env = game.get<any>('environment');
  const wrap = h('div', { class: 'scroll settings' });
  wrap.append(section('Graphics'));
  wrap.append(
    segRow(
      'Quality',
      [
        ['low', 'Low'],
        ['medium', 'Medium'],
        ['high', 'High'],
      ],
      game.renderer.quality,
      (v) => game.renderer.setQuality(v as 'low' | 'medium' | 'high'),
      api,
    ),
  );
  wrap.append(section('Audio'));
  const pct = (v: number) => `${Math.round(v)}%`;
  let sndT = 0;
  const blip = () => {
    const now = performance.now();
    if (now - sndT > 140) {
      sndT = now;
      api.sfx('ui_hover');
    }
  };
  wrap.append(
    sliderRow('Master volume', 0, 100, 5, s.master * 100, pct, (v) => {
      s.master = v / 100;
      api.commitSettings('master');
      blip();
    }),
    sliderRow('Sound effects', 0, 100, 5, s.sfx * 100, pct, (v) => {
      s.sfx = v / 100;
      api.commitSettings('sfx');
      blip();
    }),
    sliderRow('Music', 0, 100, 5, s.music * 100, pct, (v) => {
      s.music = v / 100;
      api.commitSettings('music');
    }),
  );
  wrap.append(section('Controls'));
  wrap.append(
    sliderRow('Look sensitivity', 0.2, 3, 0.1, s.sensitivity, (v) => `${v.toFixed(1)}x`, (v) => {
      s.sensitivity = Math.round(v * 10) / 10;
      api.commitSettings('sensitivity');
    }),
    toggleRow('Invert camera Y', s.invertY, (on) => {
      s.invertY = on;
      api.commitSettings('invertY');
    }, undefined, api),
  );
  wrap.append(section('World'));
  wrap.append(
    sliderRow('Day length', 5, 60, 5, s.dayLength, (v) => `${v} min`, (v) => {
      s.dayLength = v;
      api.commitSettings('dayLength');
    }),
    toggleRow('Freeze time of day', s.freezeTime, (on) => {
      s.freezeTime = on;
      api.commitSettings('freezeTime');
    }, 'Eternal golden hour, if you time it right.', api),
  );
  if (env?.setTime) {
    wrap.append(
      segRow(
        'Time of day',
        [
          ['8', 'Morning'],
          ['12.5', 'Noon'],
          ['19.6', 'Sunset'],
          ['23', 'Night'],
        ],
        null,
        (v) => env.setTime(Number(v)),
        api,
      ),
    );
  }
  wrap.append(section('Interface'));
  wrap.append(
    toggleRow('Show HUD', s.showHud, (on) => {
      s.showHud = on;
      api.commitSettings('showHud');
    }, 'Turn off for screenshots. Jimothy is very photogenic.', api),
    toggleRow('Goal tracker', s.showGuide, (on) => {
      s.showGuide = on;
      api.commitSettings('showGuide');
    }, 'The ★ marker and pill pointing at a suggested Instinct.', api),
    toggleRow('Show FPS', s.showFps, (on) => {
      s.showFps = on;
      api.commitSettings('showFps');
    }, undefined, api),
  );
  wrap.append(section('Accessibility'));
  wrap.append(
    toggleRow('Reduce flashing & shake', !s.flashes, (on) => {
      s.flashes = !on;
      api.commitSettings('flashes');
    }, 'No white camera-flash overlays, no screen shake.', api),
  );
  return wrap;
}

const CONTROLS: [string, string[], string[]][] = [
  ['Waddle', ['WASD'], ['LS']],
  ['Look around', ['Mouse'], ['RS']],
  ['Sprint', ['Shift'], ['LT']],
  ['Jump / climb (hold against walls)', ['Space'], ['A']],
  ['Grabby Hands: grab, drag, steal', ['E', 'LMB'], ['X', 'RT']],
  ['Bonk (throws what you carry)', ['F', 'RMB'], ['RB']],
  ['Wash (hold near water)', ['R'], ['Y']],
  ['Tuck & Roll', ['Q'], ['B']],
  ['Flop (hold)', ['Z'], ['LB', 'D↓']],
  ['Chitter', ['C'], ['D↑']],
  ['Photo mode (snap: click / A)', ['V'], ['R3']],
  ['Map (click an icon to track it)', ['M'], []],
  ['Slow-mo', ['T'], []],
  ['Back to the den (also in Pause)', ['H'], []],
  ['Zoom camera', ['Wheel'], []],
  ['Instincts (★ Track a goal)', ['Tab'], ['View']],
  ['Pause', ['Esc', 'P'], ['Menu']],
];

function buildControls(api: MenuApi) {
  const wrap = h('div', { class: 'scroll controls' });
  const table = h('table', { class: 'ctl-table' });
  table.append(h('thead', null, h('tr', null, h('th', { text: 'Action' }), h('th', { text: 'Keyboard & mouse' }), h('th', { text: 'Gamepad' }))));
  const tb = h('tbody');
  for (const [name, kbm, pad] of CONTROLS) {
    const k = kbm.map((l) => keyChip(l, 'kbm')).join('<i class="or">/</i>');
    const p = pad.length ? pad.map((l) => keyChip(l, 'pad')).join('<i class="or">/</i>') : '<i class="na">—</i>';
    tb.append(h('tr', null, h('td', { text: name }), h('td', { html: k }), h('td', { html: p })));
  }
  table.append(tb);
  wrap.append(table);
  if (api.isTouch) {
    // Phones: the touch layout first (the key table is for keyboards / pads)
    wrap.prepend(
      h('p', {
        class: 'ctl-note ctl-touch',
        text: 'Touch: drag on the left side to move (push the stick all the way to sprint), drag on the right side to look, and use the round buttons for everything else. Top-right: Instincts, photo mode and pause. Tap the minimap for the big map; tap an icon there to track it.',
      }),
    );
  }
  wrap.append(h('p', { class: 'ctl-note', text: 'Tip: chain silly acts within ~3 seconds to build a combo multiplier.' }));
  return wrap;
}

function buildCredits(_api: MenuApi) {
  const wrap = h('div', { class: 'scroll credits' });
  wrap.append(
    h('div', { class: 'cred-face', html: JIMOTHY_FACE }),
    h('p', { class: 'cred-joke ol', text: 'Made in one night by an AI while its human slept. The raccoon is real. Everything else is load-bearing slop.' }),
  );
  const row = (a: string, b: string) => h('div', { class: 'cred-row' }, h('span', { text: a }), h('b', { text: b }));
  wrap.append(
    h('h3', { class: 'set-section', text: 'Starring' }),
    row('Jimothy', 'the round raccoon of Ballard (as himself, sort of)'),
    row('Inspired by', 'a real, wild raccoon in Seattle — please admire him from a distance'),
    row('Design, code & 3 a.m. decisions', 'an AI, overnight'),
    row('Supervising human', 'asleep'),
    h('h3', { class: 'set-section', text: 'Borrowed with love (thank you!)' }),
    row('3D models', 'Kenney — kenney.nl (CC0)'),
    row('Textures & sky', 'Poly Haven — polyhaven.com (CC0)'),
    row('Sound effects', 'Kenney (CC0), plus sounds synthesized from scratch in your browser'),
    row('Music', 'OpenGameArt.org artists (CC0) — listed below'),
    row('Fonts', 'Luckiest Guy (Apache 2.0), Lilita One & Nunito (SIL OFL) via Google Fonts'),
    row('Raccoons, Slopothys & hats', 'modelled for this game in Blender (by the AI, somehow)'),
    row('Engine', 'three.js, Rapier, postprocessing, Vite'),
  );
  const music = (SoundBank as any).MUSIC_BANK as Record<string, { files: { title: string; author: string }[] }> | undefined;
  if (music) {
    const seen = new Set<string>();
    const tracks: string[] = [];
    for (const def of Object.values(music)) {
      for (const f of def.files ?? []) {
        const k = `${f.title} — ${f.author}`;
        if (!seen.has(k)) {
          seen.add(k);
          tracks.push(k);
        }
      }
    }
    if (tracks.length) {
      wrap.append(h('h3', { class: 'set-section', text: 'Music (CC0, via OpenGameArt.org)' }));
      for (const t of tracks) wrap.append(h('div', { class: 'cred-track', text: t }));
    }
  }
  wrap.append(
    h('h3', { class: 'set-section', text: 'Legal-ish' }),
    h('p', {
      class: 'cred-small',
      text:
        'Unofficial fan game. All businesses are parodies (Goodwheel Thrift, SlopCorp, the Space Noodle…). No real people are named. ' +
        'No raccoons were washed in the making of this game. Full asset sources and licenses: CREDITS.md in the game repository.',
    }),
  );
  return wrap;
}

function buildReset(api: MenuApi, host: MenuHost) {
  const no = h('button', { class: 'btn btn-primary', text: 'Never mind', onclick: () => host.back(), 'data-autofocus': '' });
  const yes = h('button', {
    class: 'btn btn-danger',
    text: 'Yes, forget everything',
    onclick: () => api.resetProgress(),
  });
  return h(
    'div',
    { class: 'reset-page' },
    h('div', { class: 'cred-face', html: JIMOTHY_FACE }),
    h('p', { text: 'This forgets every Instinct, every unlocked Mutator and your best score. Settings are kept.' }),
    h('p', { class: 'cred-small', text: 'Jimothy will not remember you. (To be fair, he never did. He is a raccoon.)' }),
    h('div', { class: 'reset-btns' }, no, yes),
  );
}

// ------------------------------------------------------------------ page sets

export function pausePages(api: MenuApi): Record<string, PageDef> {
  return {
    pause: { title: 'Paused', noBack: true, cls: 'wide', build: (host) => buildPauseMain(api, host) },
    objectives: { title: 'Instincts', cls: 'wide', build: (host) => buildObjectivesPage(api, host) },
    mutators: { title: 'Mutators', build: (host) => buildMutators(api, host) },
    settings: { title: 'Settings', build: () => buildSettings(api) },
    controls: { title: 'Controls', cls: 'wide', build: () => buildControls(api) },
    credits: { title: 'Credits', build: () => buildCredits(api) },
    reset: { title: 'Reset progress?', build: (host) => buildReset(api, host) },
  };
}

export function titlePages(api: MenuApi): Record<string, PageDef> {
  return {
    settings: { title: 'Settings', build: () => buildSettings(api) },
    controls: { title: 'Controls', cls: 'wide', build: () => buildControls(api) },
    credits: { title: 'Credits', build: () => buildCredits(api) },
    objectives: { title: 'Instincts', cls: 'wide', build: (host) => buildObjectivesPage(api, host) },
  };
}
