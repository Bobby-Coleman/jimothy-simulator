import type { NpcType } from './types';

/** Dialogue. PG, affectionate, a bit silly. Jimothy is beloved and round, never mocked. */

export type LineKey =
  | 'notice'
  | 'film'
  | 'selfie'
  | 'flee'
  | 'getup'
  | 'stolen'
  | 'giveUp'
  | 'caught'
  | 'washed'
  | 'kitty'
  | 'kitty2'
  | 'notACat'
  | 'kittyGiveUp'
  | 'chitter'
  | 'scold'
  | 'scolded'
  | 'bump'
  | 'ouch'
  | 'hat'
  | 'charmed'
  | 'ambient'
  | 'chaosFilm'
  | 'returned'
  | 'fetch'
  | 'grabbed'
  | 'bonkedOfficer';

const COMMON: Record<LineKey, string[]> = {
  notice: ['Is that JIMOTHY?!', 'Aww, look at him!', "He's so ROUND!", "It's the round boy!", "He's real!", 'Hi Jimothy!', 'Look at his little hands!', 'Perfectly spherical!'],
  film: ['Nobody move, I\'m filming!', 'This is going viral!', 'Getting this for the group chat!', 'Hold still, round boy!', '*click click click*'],
  selfie: ['Selfie with the legend!', 'Say cheese, Jimothy!', 'OMG OMG OMG', 'Profile pic secured!'],
  flee: ['AAAH!', 'RUN!', 'Everybody panic!', 'Round boy rampage!', 'Not the face!', 'Whaaa!', 'Chaos raccoon!'],
  getup: ['My back!', "I'm okay!", 'Was that... a raccoon?', 'Worth it.', 'Ow! ...still cute though.', 'Did anyone get that on video?', '10/10 would get bonked again', "I'm filing a complaint. A cute one.", 'Who put a raccoon there?!', 'Ugh, my latte...', 'I felt that in my soul.'],
  stolen: ['HEY!', 'HEY! That\'s mine!', 'Give that back!', 'Thief! Tiny round thief!'],
  giveUp: ['Ugh, fine. Keep it.', "He's surprisingly fast. Those LEGS!", "I'll just buy another one...", 'I respect the hustle.', 'Enjoy it, I guess!'],
  caught: ['Give that BACK!', 'Gotcha! ...no, wait.', 'Please? Pretty please?'],
  washed: ['...thank you?', 'Did a raccoon just wash my face?', 'I feel... refreshed?', 'Spa day, apparently.', 'My pores have never been cleaner.'],
  kitty: ['Here kitty kitty...', 'Aww, a kitty!', 'C\'mere, kitty!'],
  kitty2: ['Pspspsps...', 'Kitty? Kiiitty?', 'Who\'s a good kitty?'],
  notACat: ['WHAT AM I LOOKING AT?!', 'THAT IS NOT A CAT!', 'WHAT IS THAT?!'],
  kittyGiveUp: ['Huh. Weird cat.', 'Shy kitty.', 'Rude.'],
  chitter: ['Awww!', "He's talking to me!", 'Did you hear that?!', 'Chirp chirp to you too!', 'My heart!'],
  scold: ['Please don\'t approach Jimothy!', "He's a wild animal, sir!", 'Ma\'am, please give him space!', 'Wild raccoons can carry germs!', 'Nobody touch the raccoon!', 'Step away from the round boy!'],
  scolded: ['Sorry, officer!', 'Worth it!', 'Just one more pic?', 'Okay, okay!', 'He came to ME!'],
  bump: ['Oh! Hi, little guy!', 'Excuse you!', 'Oof, sorry buddy!', 'Watch it, fuzzball!'],
  hat: ['Is he wearing a little HAT?!', "Grandma knitted that, didn't she?", "I can't. I literally can't.", 'The hat! THE HAT!', 'Precious. Round. Knitwear.'],
  charmed: ['...Carry on, then.', 'Nice hat, Jimothy.', "I'll allow it. This once."],
  ouch: ['Ow!', 'Hey! Rude!', 'Did he just throw that at me?!', 'Bonk.', 'I felt that!'],
  ambient: ['Nice weather for Seattle.', 'Have you seen the round raccoon?', 'My phone is at 2%.', 'Is it Jimothy Summer yet?', 'I heard he washes things.'],
  chaosFilm: ['This is going viral!', 'Are you getting this?!', 'Best vacation ever!'],
  returned: ['You brought it back!', 'Aww, good boy!', 'He returned it! Best raccoon!'],
  fetch: ['My stuff!', 'Phew, got it.', 'Mine, thank you!'],
  grabbed: ['Hey! Put me down!', 'Where are we going?!', 'Whoa whoa whoa!', 'Tiny hands! Strong grip!'],
  bonkedOfficer: ['Sir, that\'s a wildlife violation.', 'Jimothy, please!', 'Noted for my report.'],
};

const BY_TYPE: Partial<Record<NpcType, Partial<Record<LineKey, string[]>>>> = {
  tourist: {
    notice: ['Honey, get the camera!', 'Is this the famous raccoon?', 'This is going on the vacation slideshow!', 'The raccoon from the internet!'],
    film: ['Smile for the slideshow!', 'For the fridge!', 'Honey, look!'],
  },
  fan: {
    notice: ['JIMOTHY!!!', 'OMG it\'s HIM!', 'I have your rookie card!', 'JIMOTHY SUMMER!!!', 'I love you, Jimothy!'],
    flee: ['I still love you, Jimothy!', 'AAAH! (affectionate)'],
    getup: ['Best day of my life.', 'He touched me! Sort of!', 'I got bonked by JIMOTHY!'],
  },
  officer: {
    notice: ['Keep your distance, folks.', 'Afternoon, Jimothy.', 'Please don\'t approach the raccoon.'],
    getup: ['That\'s... noted.', 'Wildlife 1, officer 0.', 'I\'m fine. Everyone stay back.'],
    flee: ['Everyone stay calm!', 'Clear the area!'],
    ambient: ['Please don\'t approach Jimothy.', 'Keep wildlife wild, folks.'],
  },
  fishmonger: {
    notice: ['Hey Jimothy! No free samples!', 'Fresh salmon, round boy?', 'Catch! ...wait, no.'],
    ambient: ['Fresh salmon!', 'Get yer fish here!', 'Fish! Fish! Fish!'],
  },
  mayor: {
    notice: ['Ah, our most distinguished citizen!', 'I hereby declare... Jimothy Summer!', 'Vote for me, Jimothy!'],
    getup: ['This will not affect my approval rating.', 'I meant to do that.', 'No comment.'],
    ambient: ['Jimothy Summer is a go!', 'Kiss babies, not raccoons.'],
  },
  dean: {
    notice: ['Congratulations, Doctor Jimothy!', 'Your honorary degree awaits!', 'Please don\'t wash the diploma.'],
    getup: ['Most unacademic.', 'I have a doctorate in this.', 'Ahem. Class dismissed.'],
    washed: ['...thank you? That\'s a first.', 'Most irregular. Refreshing, though.'],
  },
  grandma: {
    notice: ['Oh, there\'s my sweet round boy!', 'Have you eaten, dear?', 'I\'m knitting you a hat!', 'Such a handsome boy!'],
    getup: ['Oh my! I\'m alright, dear.', 'Back in my day raccoons were rectangular.', 'Goodness gracious!'],
    washed: ['Oh! Thank you, sweetie.', 'Such good manners!'],
    kitty: ['Here kitty kitty...', 'Come to Grandma, kitty!'],
  },
  kid: {
    notice: ['RACCOON!!!', 'Mom look, a round kitty!', 'Can we keep him?!', 'JIMOTHY!!!'],
    getup: ['AGAIN! AGAIN!', 'That was AWESOME!', 'Wheee! Again!', 'Hehehe!'],
    flee: ['Wheee!', 'Hehe, run!'],
  },
  racer: {
    notice: ['Training for the Salmon Run!', 'You\'ll never catch me, raccoon!', 'Swim upstream, Jimothy!'],
    ambient: ['Swim upstream!', 'Salmon Run, baby!', 'Fins up!'],
  },
  techbro: {
    notice: ["We're disrupting raccoons.", 'Imagine the dataset!', 'Raccoon-as-a-Service.', 'Is he AI-generated?', "Let's circle back, Jimothy."],
    film: ['Great content.', 'Posting this to my 12 followers.', 'Training data!'],
    getup: ['Pivoting.', 'That was a learning experience.', 'Failing fast!'],
    ambient: ['We\'re pre-revenue.', 'Let\'s take this offline.', 'It\'s like Uber, but for trash.'],
  },
  jogger: {
    notice: ['Morning, Jimothy!', 'On your left!', 'Can\'t stop, cardio!'],
  },
};

export function line(type: NpcType, key: LineKey): string {
  const arr = BY_TYPE[type]?.[key] ?? COMMON[key];
  return arr[Math.floor(Math.random() * arr.length)];
}
