# Getting Jimothy Simulator onto Steam

Everything for the Steam release lives here: this checklist and the store page text (below), the store artwork in
`steam/store/`, and the Windows desktop build in `desktop/` (Electron + steamworks.js; see `desktop/README.md`).

## The clock (Valve's rules, checked 2026-10-01)

* **$100 Steam Direct fee** per game, non-refundable, credited back once the game earns $1,000.
* **30 days** must pass between paying the fee and releasing your first game (one Steamworks page says 21; plan on 30).
* The store page must be public as **"Coming Soon" for at least 2 weeks** before release.
* Valve **reviews the store page and the build** (1–5 days each) before either goes live.
* The **tax interview can take 10–15 business days**, so do it first.

| When (if the fee is paid Oct 1) | What |
|---|---|
| Oct 1 | Steamworks account, paperwork, tax, bank, **$100 fee** (starts the 30 days) |
| Oct 2–6 | Account verified, App ID issued; fill in the store page (text below, art in `steam/store/`); submit it for review |
| ~Oct 8–13 | Store page approved → publish **Coming Soon** (wishlists start; 2-week minimum) |
| ~Oct 20 | Upload the release build from `desktop/`, submit it for review |
| **Oct 31 at the earliest** | Release (realistically the first week of November) |

## Your part (only you can do these)

1. **Steam account** with Steam Guard (mobile authenticator) on.
2. **Join Steamworks**: <https://partner.steamgames.com/newpartner>, sign in with that account.
3. **Digital paperwork**: the NDA and the Steam Distribution Agreement.
4. **Company identification**: your legal name (no aliases); a company name if you have one, or sole proprietor. This
   name has to match your bank and tax details.
5. **Tax interview** (W-9 for US individuals / companies): start it now, it's the slowest step.
6. **Bank details** for payouts (account holder name = the legal name above).
7. **Pay the $100 app fee.** This starts the 30-day clock and creates the app (App ID).
8. Decide the **price** (free, or paid: Steam keeps 30%) and whether the **free web version** stays up (keep it as is,
   turn it into a demo, or take it down at launch).
9. Decide the **developer / publisher name** shown on the store page.
10. Maybe tone down the in-game disclaimer ("made in one night by an AI… load-bearing slop", `src/ui/content.ts`) for a
    paid release, or keep it: it's on brand.

## Store page text

**Name:** Jimothy Simulator

**Short description** (Steam allows 300 characters; this is 247):

> Be Jimothy, the real short-spined raccoon who went viral in Ballard, Seattle. Wash everything. Steal a whole pizza.
> Bowl over a tour group. Climb the Space Noodle, unplug the AI slop factory and bring your mom snacks in this goofy
> physics sandbox.

**About This Game** (paste as-is; Steam's markup):

```
[h2]He's round. He's real. He's washing your phone.[/h2]
Jimothy is a real wild raccoon from Ballard, Seattle with an unusually short spine: a round, domed back, next to no neck and long legs that high-step when he walks. In July 2026 a nice lady with a phone thought he was a cat, until he turned around. The internet did the rest. Now you can be him.

[h2]A raccoon, not a goat[/h2]
[list]
[*][b]Grabby hands:[/b] carry things on your back, steal phones and coffee from pedestrians, hang onto moving cars.
[*][b]Washing:[/b] raccoons wash things. Hold anything near water and scrub. Cotton candy dissolves. Cash gets laundered. Phones become "water resistant".
[*][b]Tuck & Roll:[/b] curl into a ball and bowl through crowds, or race The Big Roll from the roof of Hilltop Lanes.
[*][b]Climb, swim, flop:[/b] scale buildings, paddle across the bay, ragdoll whenever you like.
[/list]

[h2]Ballard-ish Seattle[/h2]
Old Ballard Ave and the thrift store where it all began, Downtown and the climbable Space Noodle, Tumble St (it's for rolling), the University of Washing, Pike's Plaice Market and the Gum Wall, Tee-Hee Park for Jimothy Night, and SlopCorp's AI campus.

[h2]The real story, as a game[/h2]
Mistaken for a cat. The Jimothy Summer proclamation. An honorary degree. Winning the Salmon Run. A $20,000 gold rookie card. Bring Mom snacks, find her five lost kits (one of them takes after you), trade shiny things with the crows and visit Grandma Rosie at night. Finish the family story for a fireworks finale.

[h2]AI slop, lovingly mocked[/h2]
SlopCorp's fake Jimothys roam town with six legs, long necks and too many eyes. Wash them away, ride the seven-legged Slop Dragon, wash the billboard until it tells the truth and unplug the data center.

[h2]Goat-Sim chaos[/h2]
[list]
[*]About 60 ragdolling pedestrians, traffic, trampolines, propane BBQs and raccoon cannons
[*]59 Instincts to complete, 13 mutators to unlock (Space Jimothy, Bobblehead, Perfectly Spherical…) and 10 golden bobbleheads to find
[*]Photo mode, slow-mo, day and night, and Seattle weather
[*]Keyboard and mouse, or a gamepad
[/list]

[i]Jimothy Simulator is an unofficial fan game. Jimothy is a wild animal: admire him from a distance and never feed him.[/i]
```

**Genres:** Casual, Simulation, Indie

**Tags** (pick up to 20, most important first): Funny, Physics, Sandbox, Comedy, Cute, Open World, Simulation, Casual,
Singleplayer, Indie, 3D, Colorful, Cartoony, Family Friendly, Exploration, Parody, Destruction, Wholesome, Animals,
Third Person

**Supported languages:** English (interface; there's no voice audio).

**Controller support:** gamepad works throughout (menus included). Mark "Full Controller Support" once the desktop
build has been played start to finish on a pad; otherwise "Partial".

**System requirements** (Windows; estimates — check them on a low-end PC before release):

| | Minimum | Recommended |
|---|---|---|
| OS | Windows 10 64-bit | Windows 10/11 64-bit |
| Processor | Dual-core 2.0 GHz | Quad-core 3.0 GHz |
| Memory | 4 GB RAM | 8 GB RAM |
| Graphics | WebGL 2 capable GPU (Intel UHD 620, GeForce GT 1030, Radeon RX 550) | GeForce GTX 1060 / Radeon RX 580 or better |
| Storage | 1 GB available space | 1 GB available space |
| Notes | Graphics quality setting: Low | High |

## Content survey (draft answers)

* **Violence:** cartoon slapstick only: you can bump, bowl over and "bonk" pedestrians, who ragdoll, get up and carry
  on. No blood, gore, weapons or death. Propane tanks make cartoon explosions (no injuries shown).
* **Sexual content, nudity:** none. **Profanity:** none. **Drugs/alcohol:** none (espresso only). **Gambling:** none.
* **Mature content descriptors:** none needed; suitable for all ages.
* **AI-generated content (Pre-Generated: Yes; Live-Generated: No).** Valve's January 2026 form asks only about AI
  content players see (coding assistants are exempt). Suggested disclosure text:

  > This game was made with the help of an AI assistant. The in-game writing (signs, jokes, character lines and the
  > news ticker) and the game's original 3D models and 2D artwork (made with code) were created with AI assistance and
  > reviewed by the developer. Music, sound effects, fonts and photo textures are human-made assets under open (CC0 /
  > OFL / Apache) licences. Nothing is generated by AI while you play.

## Rights check

* **Assets:** all third-party art, audio, music and textures are CC0 (Kenney, OpenGameArt, Poly Haven), and the fonts
  are OFL/Apache, so commercial use is fine. They're listed in `CREDITS.md`, and the font licence texts ship with the
  fonts. Code libraries: three.js (MIT), Rapier (Apache-2.0); their notices go in the desktop build.
* **The name:** two "Jimothy" trademark applications were filed in July 2026, for stuffed animals and baby products,
  not games. IP lawyers quoted in the coverage doubt anyone can own a wild raccoon's name.
* **Brands and people:** parody names only, and no real private people.
