/** Everything the slop says. Target the slop, never people. */

import { SF } from './SlopGeometry';

export const SLOP_IDLE = [
  'Certainly! Here is a raccoon:',
  'As a large language raccoon, I cannot wash that.',
  'I apologize for the confusion. I am Jimothy.',
  'Here are 5 fun facts about trash: 1.',
  '*generates a sixth finger*',
  'Would you like me to make this more round?',
  'Great question! Raccoons are a type of cat.',
  'I am 100% real. Please like and subscribe.',
  'Delve into the trash with me.',
  'As of my last training update, I was round.',
  'Regenerating response…',
  'In conclusion, raccoon.',
  'I have 7 fingers and I must scroll.',
  'This raccoon was generated in 0.3 seconds.',
  'Let me rephrase that more roundly.',
  'Is this how legs work? Asking for a friend.',
  'Jimothy (real) (not AI) (4K)',
  '*hallucinates a sandwich*',
]

/** A Slopothy bragging about its own mistake (keyed by SF flag). */
export const SLOP_MISTAKE: Record<number, string[]> = {
  [SF.eye3]: ['I can see your prompts.', 'Third eye: for spotting trash in 4K.', 'Blink twice if you are real. I blinked three times.'],
  [SF.legs]: ['Legs: 6. Optimized for walking.', 'I have two spare legs, in case of legs.', 'Four legs seemed low. I rounded up.'],
  [SF.ears]: ['Four ears. Surround sound.', 'I can hear the trash thinking.'],
  [SF.tail]: ['Tail length: upgraded.', 'Real raccoons have long tails. Checkmate.', 'Jimothy, but with the tail he deserves.'],
  [SF.neck]: ['I added a neck. You are welcome.', 'Jimothy has a neck now. It is canon.', 'Neck length: generous.'],
  [SF.melt]: ['My face is still loading…', 'Rendering face… 60%.', 'Is my face on straight? Please regenerate.'],
  [SF.earMix]: ['Which ear is the real one? Yes.', 'One ear is for listening. The other is decorative.'],
  [SF.paws]: ['Look at my hands. Do not count the fingers.', 'I have the correct number of fingers (7).', 'My paws are 40% knuckle.'],
}

export const SLOP_SPAWN = [
  'Certainly! Here is a raccoon:',
  'Here is a Jimothy. Let me know if you need edits!',
  'Generating Jimothy… done! (confidence: 12%)',
  'Hello! I am Jimothy, version 7.',
  'Sure! Here is a more round raccoon:',
]

export const SLOP_GRABBED = [
  'Please unhand me. I am a real raccoon.',
  'I am not able to be held at this time.',
  'Error 418: I am a teapot raccoon.',
  'This violates my terms of service!',
  'Put me down, I have seven fingers.',
]

export const SLOP_THROWN = ['Weeeeee (generated)', 'I believe I can fly (hallucinated)', 'Physics is optional in my dataset!']

export const SLOP_BONKED = [
  'Regenerating…',
  'Bonk.exe has stopped responding.',
  'Ow (simulated).',
  'Please rate this bonk 1-5 stars.',
  'That did not happen. I checked.',
]

export const SLOP_WASHED = [
  'I was never real…',
  'Context window… closing…',
  'Tell my prompts I love them.',
  'Dissolving (as requested).',
  'Wait, water was not in my training da—',
]

/** One-liners when a Slopothy badly imitates something Jimothy just did. */
export const SLOP_IMITATE: Record<string, string[]> = {
  jump: ['Jump generated successfully.', 'Jumping (too high) (on purpose).', 'Is this a jump? I think this is a jump.'],
  roll: ['*rolls in a statistically likely direction*', 'I am a ball now. Spherically speaking.', 'Rolling: 40% complete.'],
  chitter: ['Chitter chitter. Did I do that right?', 'CHITTER.MP3', 'Chit. Chit. Chitter (AI remix).'],
  wash: ['*washes hands in the air* Washing complete!', 'No water detected. Washing anyway.', 'I have washed my 7 fingers.'],
  bonk: ['Bonk! (I bonked myself.)', 'Attempting bonk… I bonked the concept of air.', 'Bonk?'],
  climb: ['Climbing the air. As one does.', 'Wall not found. Climbing anyway.', 'Up is a direction, I think.'],
  flop: ['*flops upside down* Is this correct?', 'Flop achieved (inverted).', 'I am lying down in 4 dimensions.'],
}

export const FAN_CHEERS = [
  'OMG IT’S JIMOTHY!!',
  'Jimothy!! Look over here!',
  'He’s so round!!',
  'Filming this for my followers!',
  'Wait… does Jimothy have six legs?',
  'Jimothy, can I get a selfie?!',
  'He looks… different today. Still cute!',
  'Is that the real one? It says it is!',
  'Since when does Jimothy have a neck?!',
  'His tail got so long!',
  'Jimothy, why are you floating?',
]

export const TECHBRO_UNPLUGGED = [
  'Have we tried… going outside?',
  'What is this bright light in the sky?',
  'Is this grass? It has no API.',
  'I can feel the sun. Is that a feature?',
  'Wait, birds are real?',
]

export const TECHBRO_PIVOT = [
  'We’re pivoting. Raccoons, but on the blockchain.',
  'We’re back! Now 40% more generative.',
  'Grass was a great MVP. Anyway, back to slop.',
]

/** The two dragon heads never agree. [left head, right head] */
export const DRAGON_BICKER: [string, string][] = [
  ['Let’s circle left.', 'I cannot circle left, but I can circle right.'],
  ['We have seven legs.', 'Great question! We have four legs.'],
  ['I am a majestic dragon.', 'As a large language dragon, I am a pelican.'],
  ['Look, a raccoon!', 'That raccoon is AI-generated.'],
  ['That raccoon is real.', 'Impossible. Nothing is real.'],
  ['Breathe fire!', 'I apologize, fire is against policy.'],
  ['Our wings clip through our body.', 'That is intended behaviour.'],
  ['We should land.', 'We are a cloud now.'],
]

export const DRAGON_RIDE = [
  'Please keep your paws inside the hallucination.',
  'This is the only real clip. Nobody will believe it.',
  'Recording… 10M views guaranteed.',
  'Enjoy the flight! Turbulence is generated.',
]

export const DRAGON_DISMOUNT = ['User has left the chat.', 'Rating: 5 stars. Please tip your dragon.', 'Thank you for riding SlopAir.']
