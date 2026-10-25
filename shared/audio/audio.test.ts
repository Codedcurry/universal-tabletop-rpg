import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMING, type Timeline, scheduleCombatEvents } from '../anim';
import type { CombatEvent } from '../combat';
import { planRollAnimation, roll } from '../dice';
import { scriptedRandom } from '../random';
import { MUSIC_KEY, combatSounds, diceSounds, musicScore } from './index';

// When sounds play: combat sounds follow the animation timeline (a hit
// sounds when the blow lands), dice sounds follow the roll animation, and
// background music is a calm loop written from a seed.

const T = DEFAULT_TIMING;
const context = {
  combatantIds: ['hero', 'goblin', 'ogre'],
  sideOf: (id: string) => (id === 'hero' ? 'party' : 'monsters'),
  isStanding: (id: string) => id !== 'goblin',
  conditionName: () => 'Stunned',
};
const timeline = (events: CombatEvent[]): Timeline => scheduleCombatEvents(events, context);
const cues = (events: CombatEvent[]) => combatSounds(timeline(events)).map((sound) => `${sound.cue}@${sound.at}`);
const used = (animation: 'melee' | 'ranged' | 'spell' | 'item'): CombatEvent => ({
  type: 'abilityUsed',
  actorId: 'hero',
  abilityId: 'x',
  targetId: 'goblin',
  animation,
});
const rolled = (hit: boolean): CombatEvent => ({ type: 'attackRolled', actorId: 'hero', targetId: 'goblin', total: 15, defense: 12, hit, dice: [] });

describe('combatSounds', () => {
  it('steps once per tile walked', () => {
    const path = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }];
    expect(cues([{ type: 'moved', combatantId: 'hero', path, cost: 2 }])).toEqual(['step@0', `step@${T.walkStepMs}`]);
  });

  it('swings, then hits when the blow lands', () => {
    expect(cues([used('melee'), rolled(true), { type: 'damaged', targetId: 'goblin', amount: 4, hp: 4, dice: [] }])).toEqual([
      'swing@0',
      `hit@${T.impactMs.melee}`,
    ]);
  });

  it('sounds each kind of attack its own way', () => {
    expect(cues([used('ranged')])[0]).toBe('shoot@0');
    expect(cues([used('spell')])[0]).toBe('spell@0');
    expect(cues([used('item')])[0]).toBe('item@0');
  });

  it('whooshes on a miss and clanks on a blow that does nothing', () => {
    expect(cues([used('melee'), rolled(false)])).toContain(`miss@${T.impactMs.melee}`);
    expect(cues([used('melee'), rolled(true), { type: 'damaged', targetId: 'goblin', amount: 0, hp: 8, dice: [] }])).toContain(
      `block@${T.impactMs.melee}`,
    );
  });

  it('thuds when someone goes down, chimes for healing, rings for a level-up', () => {
    const down = cues([used('melee'), rolled(true), { type: 'damaged', targetId: 'goblin', amount: 9, hp: 0, dice: [] }, { type: 'downed', targetId: 'goblin' }]);
    expect(down).toContain(`downed@${T.impactMs.melee + T.hitMs}`);
    expect(cues([used('spell'), { type: 'healed', targetId: 'goblin', amount: 3, hp: 5, dice: [] }])).toContain(`heal@${T.impactMs.spell}`);
    expect(cues([{ type: 'levelUp', combatantId: 'hero', level: 2 }])).toContain('levelUp@0');
  });

  it('plays the victory fanfare once, however many winners celebrate', () => {
    const won = cues([used('melee'), rolled(true), { type: 'damaged', targetId: 'goblin', amount: 9, hp: 0, dice: [] }, { type: 'combatEnded', winner: 'party' }]);
    expect(won.filter((cue) => cue.startsWith('victory'))).toHaveLength(1);
  });

  it('comes out in time order', () => {
    const sounds = combatSounds(timeline([used('melee'), rolled(true), { type: 'damaged', targetId: 'goblin', amount: 9, hp: 0, dice: [] }, { type: 'downed', targetId: 'goblin' }]));
    expect(sounds.map((sound) => sound.at)).toEqual([...sounds.map((sound) => sound.at)].sort((a, b) => a - b));
  });
});

describe('diceSounds', () => {
  /** A real roll with the given faces (scripted dice: 0-based draws). */
  const result = (faces: number[], sides = 6) => roll(`${faces.length}d${sides}`, scriptedRandom(faces.map((face) => face - 1)));

  it('rattles while the dice tumble and clacks as each one lands', () => {
    const plan = planRollAnimation(result([3, 5]), 'normal');
    const sounds = diceSounds(plan);
    expect(sounds[0]?.cue).toBe('diceRattle');
    expect(sounds.filter((sound) => sound.cue === 'diceClack').map((sound) => sound.at)).toEqual(plan.pieces.map((piece) => piece.landMs));
  });

  it('adds a sting for a natural max or a natural 1', () => {
    expect(diceSounds(planRollAnimation(result([20], 20), 'normal')).map((sound) => sound.cue)).toContain('critSting');
    expect(diceSounds(planRollAnimation(result([1], 20), 'normal')).map((sound) => sound.cue)).toContain('fumbleSting');
    expect(diceSounds(planRollAnimation(result([10], 20), 'normal')).map((sound) => sound.cue)).not.toContain('critSting');
  });

  it('is silent with dice animations off', () => {
    expect(diceSounds(planRollAnimation(result([20], 20), 'off'))).toEqual([]);
  });
});

describe('musicScore', () => {
  it('is the same for the same seed, and differs between seeds', () => {
    expect(musicScore(7)).toEqual(musicScore(7));
    expect(musicScore(7)).not.toEqual(musicScore(8));
  });

  it('is a calm loop of whole bars, with pads, bass, and a melody', () => {
    const score = musicScore(3);
    expect(score.tempo).toBeGreaterThanOrEqual(60);
    expect(score.tempo).toBeLessThanOrEqual(90);
    expect(score.lengthBeats % 4).toBe(0);
    expect(new Set(score.notes.map((note) => note.voice))).toEqual(new Set(['pad', 'bass', 'melody']));
    for (const note of score.notes) {
      expect(note.at).toBeGreaterThanOrEqual(0);
      expect(note.at + note.duration).toBeLessThanOrEqual(score.lengthBeats + 1e-9);
    }
  });

  it('stays in key, so it never clashes', () => {
    const inKey = new Set(MUSIC_KEY.map((pitch) => pitch % 12));
    for (const note of musicScore(11).notes) expect(inKey.has(note.pitch % 12)).toBe(true);
  });

  it('plays one melody note at a time', () => {
    const melody = musicScore(5)
      .notes.filter((note) => note.voice === 'melody')
      .sort((a, b) => a.at - b.at);
    for (let i = 1; i < melody.length; i++) expect(melody[i]!.at).toBeGreaterThanOrEqual(melody[i - 1]!.at + melody[i - 1]!.duration - 1e-9);
  });
});
