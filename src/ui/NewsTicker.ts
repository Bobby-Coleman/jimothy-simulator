import type { Game, System } from '../core/Game';

/**
 * KRCN News: a breaking-news ticker that slides in with headlines reacting to Jimothy's chaos (he went viral —
 * the local news is obsessed). One headline at a time, rate-limited, plus the occasional deadpan filler.
 */

type Headline = string | ((p: any) => string | null);

const ON: Record<string, { lines: Headline[]; weight?: number; cooldown?: number }> = {
  cottonCandyGone: { lines: ["BREAKING: Cotton candy vanishes in Ballard. Local raccoon 'deeply confused.'", 'Cotton candy disappearance #2 this week. Police have one very round suspect.'] },
  itemWashed: {
    lines: [
      (p) => (p?.kind === 'cash' ? "Local raccoon launders money. Police: 'Technically, it IS clean now.'" : null),
      (p) => (p?.kind === 'phone' ? "Tourist's phone now 'extremely clean, extremely dead,' owner reports." : null),
      (p) => (p?.kind === 'diploma' ? 'University of Washing diploma found soggy. Registrar: "That tracks."' : null),
      (p) => (p?.kind === 'rookieCard' || p?.kind === 'rookiecard' ? 'Gold Jimothy rookie card washed; value drops from $20,000 to "damp."' : null),
      (p) => (p?.kind === 'fish' ? "Pike's Plaice fish now 'the cleanest fish in Seattle,' says raccoon, probably." : null),
    ],
  },
  hitByCar: { lines: ["Raccoon struck by car. Raccoon fine. Car 'shaken.'", 'Traffic advisory: Ballard avenues experiencing brief, round delays.'] },
  explosion: { lines: ['BBQ season off to an explosive start in the Hills.', "Fire Department reminds residents: propane is not a raccoon toy. Raccoon disagrees."] },
  dumpsterDive: { lines: ["Raccoon spotted dumpster diving. Critics call it 'a return to his roots.'", 'Local dumpster rated five stars by very round reviewer.'] },
  notACat: { lines: ["Woman mistakes raccoon for cat AGAIN. 'He turned around,' she reports.", 'Cat community issues statement: "He is not one of us."'] },
  slopWashed: { lines: ["AI-generated 'Jimothy' dissolves on contact with water. Experts: 'We should have seen this coming.'", 'Fake Jimothy count down by one. Real Jimothy count holding steady at one.'] },
  serverUnplugged: { lines: ['SlopCorp goes dark after raccoon unplugs data center. Internet reportedly 4% less weird.'], weight: 3 },
  serverReplugged: { lines: ["SlopCorp back online after 'pivoting to raccoon-safe outlets.'"] },
  billboardWashed: { lines: ['Six-fingered AI billboard scrubbed clean. Hand-painted Jimothy underneath has correct number of fingers.'] },
  degreeReceived: { lines: ['University of Washing awards honorary degree. Recipient immediately tries to wash it.'], weight: 3 },
  proclamation: { lines: ["City Council officially declares JIMOTHY SUMMER. Mayor's full statement: 'He's round.'"], weight: 3 },
  salmonRunWon: { lines: ['UPSET at Tee-Hee Park: raccoon defeats three salmon in the Salmon Run. Salmon demand rematch.'], weight: 3 },
  gumWall: { lines: ["Raccoon briefly adheres to Gum Wall. Officials confirm 'sticky situation.'"] },
  kitRescued: { lines: [(p) => (Number(p?.count) >= 5 ? "All five lost kits home with Mom. City reports 400% increase in 'awws.'" : 'Lost raccoon kit found and escorted home. Neighborhood collectively says "aww."')] },
  dannyReunion: { lines: ["Two round raccoons seen rolling together. Family resemblance described as 'spherical.'"], weight: 2 },
  grandmaVisit: { lines: ['Local grandmother knits tiny hat for local raccoon. City morale up 12%.'], weight: 2 },
  teddyReturned: { lines: ['Lost teddy bear returned freshly washed. Child: "best day ever." Teddy: unavailable for comment.'], weight: 2 },
  rodeSlopDragon: { lines: ['Footage of Jimothy riding a dragon confirmed REAL for the first time. Dragon: confirmed fake.'], weight: 3 },
  cannonLaunch: { lines: ["Jimothy Night cannon test 'mostly successful,' says nobody qualified."] },
  noodleSummit: { lines: ['Raccoon summits the Space Noodle. Tourists on observation deck "not mad, just surprised."'], weight: 2 },
  fishCaught: { lines: ["Pike's Plaice fishmonger throws fish; raccoon catches it. Union considering his application."] },
  officerScold: { lines: ['Wildlife officials remind public: please do not approach Jimothy. Jimothy approached anyway.'] },
  weather: { lines: [(p) => (p?.kind === 'rain' ? 'Seattle weather update: rain. In other news, water still wet.' : null)] },
  finaleEnd: { lines: ['Fireworks over Salmon Bay. "Best summer ever," says small round local.'], weight: 3 },
  catMet: { lines: ['Actual cat meets raccoon everyone thought was a cat. Cat: unimpressed.'] },
  animalSplash: {
    lines: [
      (p) => (p?.water === 'bay' && p?.species === 'gull' ? "Raccoon returns seagull to Salmon Bay. Seagull: 'I was already home, you round menace.'" : null),
      (p) => (p?.water === 'bay' && p?.species === 'gull' ? 'Waterfront seagull files formal complaint after unscheduled swim. Complaint was mostly screaming.' : null),
      (p) => (p?.water === 'bay' && !/^(mom|kit|danny)$/.test(p?.species ?? '') ? "Wildlife officials urge public to stop 'returning' animals to the sea. 'They did not ask.'" : null),
    ],
    weight: 2,
  },
};

const FILLER = [
  "Scientists confirm Jimothy is 'basically a sphere.' More at 11.",
  "Jimothy video passes 20 million views. Jimothy still unaware what a view is.",
  'SlopCorp unveils new AI model that generates raccoons with only seven fingers. "Huge improvement."',
  'Opinion: is it ethical to be this round? (Yes.)',
  'Mariners considering making Jimothy Night weekly. Salmon union objects.',
  'Local crows report booming trade in shiny objects.',
  'Fact check: that video of Jimothy casting spells was AI. The one of him washing a phone was not.',
  'Traffic on Ballard Ave: slow, round, occasionally airborne.',
  'University of Washing enrollment spikes after honorary degree news.',
  "Reminder: the real Jimothy is a wild animal. Admire from a distance. Do not hand him your phone.",
  'Poll: 78% of Seattle would let Jimothy wash their car. 22% already had it happen.',
];

export class NewsTicker implements System {
  name = 'news';
  private el: HTMLDivElement | null = null;
  private textEl: HTMLSpanElement | null = null;
  private queue: string[] = [];
  private showing = false;
  private lastShown = -1e9;
  private lastFiller = 0;
  private used = new Set<string>();
  private game!: Game;
  /** Minimum real seconds between headlines. */
  minGap = 38;
  enabled = true;

  init(game: Game) {
    this.game = game;
    if (navigator.webdriver && !new URLSearchParams(location.search).has('news')) this.enabled = false;
    for (const [ev, def] of Object.entries(ON)) {
      game.events.on(ev, (p) => this.onEvent(def, p));
    }
    this.lastFiller = performance.now() / 1000;
  }

  private onEvent(def: { lines: Headline[]; weight?: number }, p: any) {
    if (!this.enabled) return;
    const options: string[] = [];
    for (const l of def.lines) {
      const s = typeof l === 'function' ? l(p) : l;
      if (s && !this.used.has(s)) options.push(s);
    }
    if (!options.length) return;
    const pick = options[Math.floor(Math.random() * options.length)];
    // Big story beats jump the queue
    if ((def.weight ?? 1) >= 3) this.queue.unshift(pick);
    else if (this.queue.length < 2) this.queue.push(pick);
  }

  private build() {
    const el = document.createElement('div');
    el.style.cssText = [
      'position:fixed;left:50%;bottom:0;transform:translate(-50%,110%);transition:transform .45s cubic-bezier(.2,.9,.3,1.2)',
      'width:min(760px,92vw);height:30px;display:flex;align-items:stretch;overflow:hidden;z-index:22;pointer-events:none',
      'border-radius:10px 10px 0 0;box-shadow:0 -4px 16px rgba(0,0,0,.35);font:800 14px/30px system-ui,sans-serif',
    ].join(';');
    el.innerHTML =
      '<span style="background:#e0312b;color:#fff;padding:0 10px;letter-spacing:.06em;white-space:nowrap">🦝 KRCN NEWS</span>' +
      '<span style="background:#ffd23f;color:#1b1b1b;padding:0 8px;white-space:nowrap">BREAKING</span>' +
      '<span style="flex:1;background:rgba(15,20,32,.92);color:#fff;position:relative;overflow:hidden"><span data-t style="position:absolute;left:100%;white-space:nowrap;padding-left:12px"></span></span>';
    (document.getElementById('ui') ?? document.body).appendChild(el);
    this.el = el;
    this.textEl = el.querySelector('[data-t]') as HTMLSpanElement;
  }

  private show(text: string) {
    if (!this.el) this.build();
    const el = this.el!;
    const t = this.textEl!;
    this.showing = true;
    this.used.add(text);
    if (this.used.size > 60) this.used.clear();
    t.textContent = text;
    t.style.transition = 'none';
    t.style.left = '100%';
    el.style.transform = 'translate(-50%,0)';
    this.game.sfx('ui_open', undefined, 0.35, 1.3);
    // scroll across: duration based on text length
    const box = (t.parentElement as HTMLElement).clientWidth || 600;
    const w = t.scrollWidth || text.length * 8;
    const secs = Math.max(7, (box + w) / 85);
    requestAnimationFrame(() => {
      t.style.transition = `left ${secs}s linear`;
      t.style.left = `-${w + 20}px`;
    });
    window.setTimeout(() => {
      el.style.transform = 'translate(-50%,110%)';
      window.setTimeout(() => (this.showing = false), 500);
    }, secs * 1000 + 300);
  }

  lateUpdate(_dt: number, game: Game) {
    if (!this.enabled || this.showing || game.state !== 'playing') return;
    if (game.get<any>('photomode')?.active || game.get<any>('ui')?.hudVisible === false) return;
    const now = performance.now() / 1000;
    if (now - this.lastShown < this.minGap) return;
    let next = this.queue.shift();
    if (!next && now - this.lastFiller > 150 && now - this.lastShown > 90) {
      const fresh = FILLER.filter((f) => !this.used.has(f));
      next = (fresh.length ? fresh : FILLER)[Math.floor(Math.random() * (fresh.length || FILLER.length))];
      this.lastFiller = now;
    }
    if (!next) return;
    this.lastShown = now;
    this.show(next);
  }
}
