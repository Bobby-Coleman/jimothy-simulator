import type { ObjectiveDef } from '../Objectives';

/**
 * Every objective ("Instinct") in the game. Triggers live in ObjectiveContent.ts (see the table in its header).
 * Tone: PG slapstick; Jimothy's roundness is celebrated, never mocked.
 */
export const OBJECTIVES: ObjectiveDef[] = [
  // ------------------------------------------------------------------ raccoon instincts
  { id: 'wash10', category: 'raccoon', points: 500, target: 10, title: 'Squeaky Clean Machine', desc: "Wash 10 things. Anything. Everything. He can't stop." },
  { id: 'cottonCandy', category: 'raccoon', points: 750, title: "Where'd It Go?", desc: 'Wash some cotton candy. Stare at your empty hands.' },
  { id: 'moneyLaundering', category: 'raccoon', points: 1000, title: 'Money Laundering', desc: "Wash some cash. It's legal when a raccoon does it." },
  { id: 'deepClean', category: 'raccoon', points: 500, title: 'Water Resistant*', desc: 'Wash a phone. *Terms and conditions apply.' },
  { id: 'dumpsterDiver', category: 'raccoon', points: 1000, target: 5, title: 'Dumpster Diver', desc: "Go dumpster diving 5 times. One human's trash is one raccoon's brunch." },
  { id: 'trashTornado', category: 'raccoon', points: 1500, target: 20, title: 'Trash Panda Tornado', desc: 'Tip over 20 trash cans. The bins had it coming.' },
  { id: 'roundBoy', category: 'raccoon', points: 1500, target: 500, title: 'Round Boy', desc: 'Roll 500 m in total. Aerodynamically: a ball.', reward: 'chonk' },
  { id: 'notACat', category: 'raccoon', points: 750, title: 'Not A Cat', desc: "Let someone call 'here kitty kitty'. Then turn around." },
  { id: 'cryptid', category: 'raccoon', points: 1500, target: 12, title: 'Cryptid Sighting', desc: 'Get filmed by 12 different people. Every photo is somehow blurry.' },
  { id: 'fiveFingerDiscount', category: 'raccoon', points: 750, title: 'Five-Finger Discount', desc: 'Steal a whole pizza. Tiny hands, big dreams.' },
  { id: 'stickyFingers', category: 'raccoon', points: 1500, target: 10, title: 'Sticky Fingers', desc: 'Steal 10 things from humans. Phones, lunches, their sense of security.' },
  { id: 'stickySituation', category: 'raccoon', points: 750, title: 'Sticky Situation', desc: 'Get stuck to the Gum Wall. Ew. Ewww. Ewwwww.' },
  { id: 'spaceNoodle', category: 'raccoon', points: 3000, title: 'Climb the Space Noodle', desc: 'Reach the top of the Space Noodle. Wave at the tourists.', reward: 'spaceJimothy' },
  { id: 'nocturnal', category: 'raccoon', points: 750, target: 60, title: 'Nocturnal', desc: 'Stay out for a full minute of night. Raccoon business hours.' },
  { id: 'bathTime', category: 'raccoon', points: 1500, target: 4, title: 'Bath Time', desc: 'Swim in 4 different kinds of water. Rinse and repeat.', reward: 'wetJimothy' },
  { id: 'marathon', category: 'raccoon', points: 1500, target: 2000, title: 'Tiny Legs, Big Journey', desc: 'Walk 2 km. Those little legs are doing their very best.', reward: 'zoomies' },
  { id: 'catchOfTheDay', category: 'raccoon', points: 750, title: 'Catch of the Day', desc: "Catch a flying fish at Pike's Plaice Market." },
  { id: 'bobbleheadCollector', category: 'raccoon', points: 5000, target: 10, title: 'Bobblehead Collector', desc: 'Find all 10 golden Jimothy bobbleheads. Limited edition!', reward: 'bobblehead' },
  // THE BIG ROLL (src/gameplay/bigroll): a bowling-ball race from the Hilltop Lanes roof; one Instinct per medal
  { id: 'bigRoll', category: 'raccoon', points: 2000, title: 'The Big Roll', desc: 'Bowl yourself from the Hilltop Lanes roof across town through every checkpoint. Bronze Pin for finishing.' },
  { id: 'bigRollSilver', category: 'raccoon', points: 2500, title: 'The Big Roll: Silver Pin', desc: 'Finish The Big Roll in under 0:52. Less sightseeing.' },
  { id: 'bigRollGold', category: 'raccoon', points: 3500, title: 'The Big Roll: Gold Pin', desc: 'Finish The Big Roll in under 0:40. Hold sprint and cut the corners.' },
  { id: 'bigRollPlatinum', category: 'raccoon', points: 6000, title: 'The Big Roll: Platinum Pin', desc: 'Finish The Big Roll in under 0:34. A perfect line, no bumps, no cars. Bowling legends only.' },

  // ------------------------------------------------------------------ AI slop
  { id: 'washSlop', category: 'slop', points: 2000, target: 10, title: 'Wash Away The Slop', desc: 'Wash away 10 Slopothys (slop signs count too). Soap: the original content filter.' },
  { id: 'touchGrass', category: 'slop', points: 5000, title: 'Touch Grass', desc: "Unplug SlopCorp's server farm. Everyone go outside.", reward: 'aiEnhanced' },
  { id: 'closeThisWindow', category: 'slop', points: 1000, target: 5, title: "Don't Show This Again", desc: 'Dismiss SlopBot 5 times. It will be back.' },
  { id: 'countToFive', category: 'slop', points: 1500, title: 'Count To Five', desc: 'Wash the six-fingered SlopCorp billboard. Fingers: fixed.' },
  { id: 'dragonRider', category: 'slop', points: 2000, title: 'Seven-Legged Steed', desc: 'Ride the Slop Dragon. Hold on to at least three of its legs.' },

  // ------------------------------------------------------------------ heartwarming
  { id: 'mamasBoy', category: 'heart', points: 2000, target: 3, title: "Mama's Boy", desc: "Bring Mom 3 snacks. She's so proud of you." },
  { id: 'familyReunion', category: 'heart', points: 3000, title: 'Family Reunion', desc: 'Find Danny, the other round raccoon, and roll with him. The resemblance is uncanny.' },
  { id: 'kitCollector', category: 'heart', points: 3000, target: 5, title: 'Kit Collector', desc: 'Bring all 5 lost kits home to Mom. Count them twice.', reward: 'tiny' },
  { id: 'crowDeals', category: 'heart', points: 2000, target: 3, title: 'Crow Deals', desc: 'Trade shiny (or freshly washed) things with the crows 3 times. They drive a hard bargain.', reward: 'crowRider' },
  { id: 'teddyRescue', category: 'heart', points: 2500, title: 'Teddy Rescue', desc: 'Wash the lost teddy bear and return it to the sad kid.' },
  { id: 'grandmasFavorite', category: 'heart', points: 2500, title: "Grandma's Favorite", desc: "Visit Grandma Rosie at night. She's been knitting something.", reward: 'grandmaHat' },
  { id: 'honoraryDegree', category: 'heart', points: 3000, title: 'Honorary Degree', desc: 'Accept your degree from the University of Washing. Magna cum raccoon.', reward: 'honoraryGrad' },
  { id: 'jimothySummer', category: 'heart', points: 3000, title: 'Jimothy Summer', desc: 'Attend your own proclamation at City Hall. Try to look official.', reward: 'jimothySummer' },
  { id: 'salmonRun', category: 'heart', points: 3000, title: 'Salmon Run', desc: 'Win the Salmon Run at Tee-Hee Park. Outrun the fish costumes.' },
  { id: 'rookieCard', category: 'heart', points: 3000, title: 'Rookie Card', desc: 'Find your gold-bordered rookie card. Mint condition. Mostly.', reward: 'rookie' },
  { id: 'awww', category: 'heart', points: 1000, target: 15, title: 'Awww', desc: 'Chitter at 15 different humans. Watch them melt.' },
  { id: 'localCelebrity', category: 'heart', points: 5000, target: 100000, title: 'Local Celebrity', desc: 'Score 100,000 points. Signed paw prints available on request.' },

  // ------------------------------------------------------------------ slapstick chaos
  { id: 'strike', category: 'chaos', points: 1500, target: 5, title: 'Strike!', desc: 'Bowl over 5 people in a single roll.' },
  { id: 'chainReaction', category: 'chaos', points: 2500, target: 5, title: 'Chain Reaction', desc: 'Ragdoll 5 people within 5 seconds. Crowds + propane = cartoon science.' },
  { id: 'kaboom', category: 'chaos', points: 750, title: 'Kaboom', desc: 'Blow something up. For science. Cartoon science.' },
  { id: 'carSurfer', category: 'chaos', points: 1500, target: 10, title: 'Car Surfer', desc: 'Hang onto a moving car for 10 seconds in total.' },
  { id: 'leapOfFaith', category: 'chaos', points: 1500, target: 25, title: 'Leap of Faith', desc: 'Fall 25 m and walk it off. Round things bounce.' },
  { id: 'frequentFlyer', category: 'chaos', points: 2000, target: 8, title: 'Frequent Flyer', desc: 'Get launched 8 m into the air. Backyard trampolines are a start. Earn miles.' },
  { id: 'jaywalker', category: 'chaos', points: 500, title: 'Look Both Ways', desc: "Get bonked by a car. He's fine! He's round!" },
  { id: 'whenceYouCame', category: 'chaos', points: 1500, title: 'Return From Whence You Came', desc: "Throw an animal into the ocean. It's a seagull. It'll be fine. It will not be happy." },
  { id: 'flopEra', category: 'chaos', points: 300, target: 25, title: 'Flop Era', desc: 'Ragdoll 25 times. Floppiness is a lifestyle.' },
  { id: 'officerScold', category: 'chaos', points: 1500, target: 10, title: "Please Don't Approach Jimothy", desc: 'Get the Wildlife Officer to scold 10 fans.' },

  // ------------------------------------------------------------------ secrets
  { id: 'humanMade', category: 'secret', points: 2000, hidden: true, title: 'Human Made', desc: 'Admire the hand-painted Jimothy mural. Correct number of fingers!' },
  { id: 'hydrophobic', category: 'secret', points: 1500, target: 60, hidden: true, title: 'Hydrophobic?', desc: 'Spend a whole minute swimming. ...Never mind.' },
  { id: 'heNeverLearns', category: 'secret', points: 1500, target: 3, hidden: true, title: 'He Never Learns', desc: 'Wash cotton candy 3 times. Where does it GO?' },
  { id: 'backFromTheVoid', category: 'secret', points: 1000, hidden: true, title: 'Back From The Void', desc: "Fall out of the world. He doesn't want to talk about it." },
  { id: 'spinMeRound', category: 'secret', points: 2000, target: 60, hidden: true, title: 'You Spin Me Right Round', desc: 'Roll non-stop for 60 seconds. Peak form.' },
  { id: 'mutantRaccoon', category: 'secret', points: 1500, hidden: true, title: 'Mutant Raccoon', desc: 'Have 5 mutators active at once.' },
];
