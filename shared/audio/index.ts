import type { Timeline } from '../anim';
import type { RollPlan } from '../dice';
import { seededRandom } from '../random';

/**
 * When sounds play. Combat sounds follow the animation timeline (a blow
 * sounds as it lands), dice sounds follow the roll animation, and the
 * background music is a calm loop written from a seed. Pure: which sound,
 * and when; how each one sounds is the sound pack's business (client).
 */

export type SoundCue =
  // Combat
  | 'step'
  | 'swing'
  | 'shoot'
  | 'spell'
  | 'item'
  | 'hit'
  | 'miss'
  | 'block'
  | 'downed'
  | 'heal'
  | 'status'
  | 'levelUp'
  | 'victory'
  | 'yourTurn'
  // Dice
  | 'diceRattle'
  | 'diceClack'
  | 'coinClink'
  | 'critSting'
  | 'fumbleSting'
  // Interface
  | 'click';

export interface TimedSound {
  readonly cue: SoundCue;
  /** Milliseconds from the start of the animation. */
  readonly at: number;
}

const ATTACK_SOUNDS: Partial<Record<string, SoundCue>> = {
  attackMelee: 'swing',
  attackRanged: 'shoot',
  cast: 'spell',
  useItem: 'item',
  hit: 'hit',
  dodge: 'miss',
  defend: 'block',
  downed: 'downed',
};

const TEXT_SOUNDS: Partial<Record<string, SoundCue>> = { heal: 'heal', level: 'levelUp', status: 'status' };

const inOrder = (sounds: TimedSound[]) => sounds.sort((a, b) => a.at - b.at);

/** The sounds of one combat action, timed to its animation. */
export function combatSounds(timeline: Timeline): TimedSound[] {
  const sounds: TimedSound[] = [];
  let victory = false;
  for (const step of timeline.steps) {
    if (step.clip === 'walk' && step.path && step.path.length > 1) {
      // A footstep at the start of each tile walked.
      const tiles = step.path.length - 1;
      for (let i = 0; i < tiles; i++) sounds.push({ cue: 'step', at: step.start + (step.duration * i) / tiles });
    } else if (step.clip === 'victory') {
      if (!victory) sounds.push({ cue: 'victory', at: step.start });
      victory = true;
    } else {
      const cue = ATTACK_SOUNDS[step.clip];
      if (cue) sounds.push({ cue, at: step.start });
    }
  }
  for (const text of timeline.texts) {
    const cue = TEXT_SOUNDS[text.kind];
    if (cue) sounds.push({ cue, at: text.start });
  }
  return inOrder(sounds);
}

/** The sounds of a dice roll: a rattle while they tumble, a clack as each lands, a sting for a big moment. */
export function diceSounds(plan: RollPlan): TimedSound[] {
  if (plan.pieces.length === 0 || plan.pieces.every((piece) => piece.landMs === 0)) return []; // animation off
  const sounds: TimedSound[] = [{ cue: 'diceRattle', at: Math.min(...plan.pieces.map((piece) => piece.startMs)) }];
  for (const piece of plan.pieces) sounds.push({ cue: piece.kind === 'coin' ? 'coinClink' : 'diceClack', at: piece.landMs });
  if (plan.bigMoment) sounds.push({ cue: plan.bigMoment === 'max' ? 'critSting' : 'fumbleSting', at: plan.totalAtMs });
  return inOrder(sounds);
}

// ---------------------------------------------------------------------------
// Music

/** The key everything is written in (C major, as MIDI note numbers), so nothing ever clashes. */
export const MUSIC_KEY: readonly number[] = [60, 62, 64, 65, 67, 69, 71];

export interface MusicNote {
  readonly voice: 'pad' | 'bass' | 'melody';
  /** MIDI note number (60 is middle C). */
  readonly pitch: number;
  /** Start and length, in beats. */
  readonly at: number;
  readonly duration: number;
}

export interface MusicScore {
  /** Beats per minute. */
  readonly tempo: number;
  readonly lengthBeats: number;
  readonly notes: readonly MusicNote[];
}

/** Chords by scale degree (0 = C): calm progressions that loop back on themselves. */
const PROGRESSIONS: readonly (readonly number[])[] = [
  [5, 3, 0, 4], // Am F C G
  [0, 4, 5, 3], // C G Am F
  [3, 4, 2, 5], // F G Em Am
  [5, 2, 3, 4], // Am Em F G
  [0, 5, 3, 4], // C Am F G
];
/** The melody keeps to the pentatonic notes (C D E G A): they sound fine over any of these chords. */
const PENTATONIC = [0, 2, 4, 7, 9];
/** Rhythms for one bar of melody, in beats; a negative length is a rest. */
const BAR_RHYTHMS: readonly (readonly number[])[] = [[2, 2], [1, 1, 2], [3, 1], [4], [2, -1, 1], [-2, 2], [1, 1, 1, 1]];
const BARS_PER_CHORD = 2;

/** The pitch of a scale degree (any whole number; 7 is the next octave up). */
function degreePitch(degree: number, octaveBase: number): number {
  const octave = Math.floor(degree / 7);
  return octaveBase + octave * 12 + ((MUSIC_KEY[((degree % 7) + 7) % 7] as number) - 60);
}

/** A calm background loop, the same every time for the same seed. */
export function musicScore(seed: number): MusicScore {
  const random = seededRandom(seed);
  const progression = PROGRESSIONS[random.nextInt(PROGRESSIONS.length)] as readonly number[];
  const tempo = 66 + random.nextInt(15);
  const chordBeats = BARS_PER_CHORD * 4;
  const lengthBeats = progression.length * chordBeats;
  const notes: MusicNote[] = [];

  progression.forEach((root, index) => {
    const start = index * chordBeats;
    // A soft three-note chord held for the whole chord.
    for (const step of [0, 2, 4]) notes.push({ voice: 'pad', pitch: degreePitch(root + step, 48), at: start, duration: chordBeats });
    // The root in the bass, once a bar.
    for (let bar = 0; bar < BARS_PER_CHORD; bar++) notes.push({ voice: 'bass', pitch: degreePitch(root, 36), at: start + bar * 4, duration: 4 });
  });

  // A gentle melody wandering a step or two at a time over the pentatonic notes.
  let place = random.nextInt(PENTATONIC.length) + PENTATONIC.length; // start in the middle octave
  for (let bar = 0; bar < lengthBeats / 4; bar++) {
    let beat = bar * 4;
    for (const length of BAR_RHYTHMS[random.nextInt(BAR_RHYTHMS.length)] as readonly number[]) {
      if (length > 0) {
        place = Math.min(PENTATONIC.length * 2 - 1, Math.max(0, place + random.nextInt(5) - 2));
        const octave = Math.floor(place / PENTATONIC.length);
        const pitch = 72 + octave * 12 + (PENTATONIC[place % PENTATONIC.length] as number) - 12;
        notes.push({ voice: 'melody', pitch, at: beat, duration: length });
      }
      beat += Math.abs(length);
    }
  }
  return { tempo, lengthBeats, notes };
}
