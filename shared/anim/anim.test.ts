import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '../combat';
import type { Cell } from '../grid';
import {
  type AnimationStep,
  CLIPS,
  type Clip,
  DEFAULT_TIMING,
  type FloatingText,
  proceduralPose,
  resolveClip,
  scheduleCombatEvents,
} from './index';

// Turns the events of one combat action into a timeline: which creature plays
// which animation when, and which numbers float up. Pure: no graphics.

const c = (q: number, r: number): Cell => ({ q, r });
const T = DEFAULT_TIMING;

const sides = { hero: 'party', cleric: 'party', goblin: 'monsters', ogre: 'monsters' } as Record<string, string>;
const context = {
  combatantIds: ['hero', 'cleric', 'goblin', 'ogre'],
  sideOf: (id: string) => sides[id] ?? 'none',
  isStanding: (id: string) => id !== 'goblin',
  conditionName: (id: string) => (id === 'stunned' ? 'Stunned' : id),
};

const steps = (timeline: { steps: readonly AnimationStep[] }, id?: string) =>
  timeline.steps.filter((step) => id === undefined || step.combatantId === id);
const texts = (timeline: { texts: readonly FloatingText[] }) => timeline.texts.map((t) => `${t.combatantId}:${t.text}@${t.start}`);

const used = (animation: 'melee' | 'ranged' | 'spell' | 'item', targetId = 'goblin'): CombatEvent => ({
  type: 'abilityUsed',
  actorId: 'hero',
  abilityId: 'x',
  targetId,
  animation,
});
const rolled = (hit: boolean): CombatEvent => ({
  type: 'attackRolled',
  actorId: 'hero',
  targetId: 'goblin',
  total: 15,
  defense: 12,
  hit,
  dice: [],
});
const damaged = (amount: number, hp: number, targetId = 'goblin'): CombatEvent => ({ type: 'damaged', targetId, amount, hp, dice: [] });

describe('scheduleCombatEvents', () => {
  it('walks a creature along its path, one step at a time', () => {
    const timeline = scheduleCombatEvents([{ type: 'moved', combatantId: 'hero', path: [c(0, 0), c(1, 0), c(2, 0)], cost: 2 }], context);
    expect(steps(timeline)).toEqual([
      { combatantId: 'hero', clip: 'walk', start: 0, duration: 2 * T.walkStepMs, path: [c(0, 0), c(1, 0), c(2, 0)] },
    ]);
    expect(timeline.duration).toBe(2 * T.walkStepMs);
  });

  it('plays a melee attack, then the hit and the damage number at the moment of impact', () => {
    const timeline = scheduleCombatEvents([used('melee'), rolled(true), damaged(4, 4)], context);
    const impact = T.impactMs.melee;
    expect(steps(timeline, 'hero')).toEqual([{ combatantId: 'hero', clip: 'attackMelee', start: 0, duration: T.attackMs }]);
    expect(steps(timeline, 'goblin')).toEqual([{ combatantId: 'goblin', clip: 'hit', start: impact, duration: T.hitMs }]);
    expect(timeline.texts).toEqual([{ combatantId: 'goblin', text: '-4', kind: 'damage', start: impact }]);
  });

  it('uses the right attack animation and later impacts for shots and spells', () => {
    const clipFor = (animation: 'melee' | 'ranged' | 'spell' | 'item') =>
      steps(scheduleCombatEvents([used(animation), rolled(true), damaged(1, 7)], context), 'hero')[0]?.clip;
    expect(clipFor('melee')).toBe('attackMelee');
    expect(clipFor('ranged')).toBe('attackRanged');
    expect(clipFor('spell')).toBe('cast');
    expect(clipFor('item')).toBe('useItem');
    expect(T.impactMs.ranged).toBeGreaterThan(T.impactMs.melee);
    expect(T.impactMs.spell).toBeGreaterThan(T.impactMs.melee);
  });

  it('makes the target dodge and shows "Miss" on a miss', () => {
    const timeline = scheduleCombatEvents([used('melee'), rolled(false)], context);
    expect(steps(timeline, 'goblin')).toEqual([{ combatantId: 'goblin', clip: 'dodge', start: T.impactMs.melee, duration: T.dodgeMs }]);
    expect(texts(timeline)).toEqual([`goblin:Miss@${T.impactMs.melee}`]);
  });

  it('braces instead of flinching when a hit does no damage', () => {
    const timeline = scheduleCombatEvents([used('melee'), rolled(true), damaged(0, 8)], context);
    expect(steps(timeline, 'goblin')[0]?.clip).toBe('defend');
    expect(texts(timeline)).toEqual([`goblin:0@${T.impactMs.melee}`]);
  });

  it('collapses a creature after the hit that drops it', () => {
    const timeline = scheduleCombatEvents(
      [used('melee'), rolled(true), damaged(8, 0), { type: 'downed', targetId: 'goblin' }],
      context,
    );
    const impact = T.impactMs.melee;
    expect(steps(timeline, 'goblin')).toEqual([
      { combatantId: 'goblin', clip: 'hit', start: impact, duration: T.hitMs },
      { combatantId: 'goblin', clip: 'downed', start: impact + T.hitMs, duration: T.downedMs },
    ]);
  });

  it('floats heals in green, with no attack roll needed', () => {
    const timeline = scheduleCombatEvents(
      [used('spell', 'cleric'), { type: 'healed', targetId: 'cleric', amount: 7, hp: 10, dice: [] }],
      context,
    );
    expect(timeline.texts).toEqual([{ combatantId: 'cleric', text: '+7', kind: 'heal', start: T.impactMs.spell }]);
  });

  it('stands a revived creature back up', () => {
    const timeline = scheduleCombatEvents(
      [used('spell', 'cleric'), { type: 'healed', targetId: 'cleric', amount: 3, hp: 3, dice: [] }, { type: 'revived', targetId: 'cleric' }],
      context,
    );
    expect(steps(timeline, 'cleric')).toEqual([{ combatantId: 'cleric', clip: 'idle', start: T.impactMs.spell, duration: 0 }]);
  });

  it('names conditions as they land', () => {
    const timeline = scheduleCombatEvents(
      [used('melee'), rolled(true), damaged(1, 7), { type: 'conditionApplied', targetId: 'goblin', conditionId: 'stunned', rounds: 1 }],
      context,
    );
    expect(timeline.texts.map((t) => t.text)).toEqual(['-1', 'Stunned']);
    expect(timeline.texts[1]?.kind).toBe('status');
  });

  it('starts an attack only after the walk before it finishes', () => {
    const timeline = scheduleCombatEvents(
      [{ type: 'moved', combatantId: 'hero', path: [c(0, 0), c(1, 0)], cost: 1 }, used('melee'), rolled(false)],
      context,
    );
    expect(steps(timeline, 'hero').map((step) => [step.clip, step.start])).toEqual([
      ['walk', 0],
      ['attackMelee', T.walkStepMs],
    ]);
  });

  it('celebrates with the winners left standing, then shows XP and level-ups', () => {
    const timeline = scheduleCombatEvents(
      [
        used('melee'),
        rolled(true),
        damaged(8, 0),
        { type: 'downed', targetId: 'goblin' },
        { type: 'combatEnded', winner: 'party' },
        { type: 'xpGained', combatantId: 'hero', amount: 50, xp: 350 },
        { type: 'levelUp', combatantId: 'hero', level: 2 },
      ],
      context,
    );
    const lastBlow = T.impactMs.melee + T.hitMs + T.downedMs;
    const victory = steps(timeline).filter((step) => step.clip === 'victory');
    expect(victory.map((step) => step.combatantId)).toEqual(['hero', 'cleric']);
    expect(victory.every((step) => step.start >= lastBlow)).toBe(true);
    expect(timeline.texts.filter((t) => t.kind === 'xp' || t.kind === 'level').map((t) => t.text)).toEqual(['+50 XP', 'Level 2!']);
    expect(timeline.duration).toBeGreaterThanOrEqual(victory[0]!.start + T.victoryMs);
  });

  it('ignores bookkeeping events with nothing to show', () => {
    const timeline = scheduleCombatEvents(
      [
        { type: 'turnEnded', combatantId: 'hero' },
        { type: 'roundStarted', round: 2 },
        { type: 'turnStarted', combatantId: 'goblin', round: 2 },
      ],
      context,
    );
    expect(timeline).toEqual({ steps: [], texts: [], duration: 0 });
  });
});

describe('resolveClip (the fallback rule)', () => {
  it('uses real frames whenever the character has them', () => {
    for (const clip of CLIPS) expect(resolveClip(new Set(CLIPS), clip)).toEqual({ kind: 'frames', clip });
  });

  it.each<[Clip, string]>([
    ['attackMelee', 'lunge'],
    ['attackRanged', 'lunge'],
    ['cast', 'lunge'],
    ['defend', 'brace'],
    ['hit', 'shake'],
    ['dodge', 'hop'],
    ['downed', 'tipOver'],
    ['victory', 'jump'],
    ['walk', 'bob'],
    ['useItem', 'itemBob'],
  ])('fakes a missing %s with the %s motion on the idle frame', (clip, motion) => {
    expect(resolveClip(new Set<Clip>(['idle']), clip)).toEqual({ kind: 'procedural', motion });
  });

  it('only ever needs the idle animation', () => {
    expect(resolveClip(new Set<Clip>(['idle']), 'idle')).toEqual({ kind: 'frames', clip: 'idle' });
  });
});

describe('proceduralPose', () => {
  // A pose over the motion's progress t from 0 to 1. forward is toward the
  // creature's facing, side is to its right, up is height; tilt in radians.
  const neutral = { forward: 0, side: 0, up: 0, tilt: 0, red: 0, alpha: 1, showItem: false };

  it.each(['lunge', 'brace', 'shake', 'hop', 'jump', 'bob', 'itemBob'] as const)(
    '%s starts and ends at rest, so the creature returns to idle',
    (motion) => {
      for (const t of [0, 1]) {
        const pose = proceduralPose(motion, t);
        expect(pose.forward).toBeCloseTo(0);
        expect(pose.side).toBeCloseTo(0);
        expect(pose.up).toBeCloseTo(0);
        expect(pose.tilt).toBeCloseTo(0);
        expect(pose.red).toBeCloseTo(0);
        expect(pose.alpha).toBeCloseTo(1);
      }
    },
  );

  it('lunges forward and back', () => {
    expect(proceduralPose('lunge', 0.4).forward).toBeGreaterThan(0.2);
  });

  it('braces by leaning back', () => {
    expect(proceduralPose('brace', 0.5).forward).toBeLessThan(0);
    expect(proceduralPose('brace', 0.5).tilt).not.toBe(0);
  });

  it('shakes and flashes red when hit', () => {
    const middle = proceduralPose('shake', 0.25);
    expect(middle.red).toBeGreaterThan(0.5);
    const sideways = [0.1, 0.2, 0.3, 0.4].map((t) => proceduralPose('shake', t).side);
    expect(sideways.some((s) => s > 0.02) && sideways.some((s) => s < -0.02)).toBe(true);
  });

  it('hops sideways to dodge', () => {
    const middle = proceduralPose('hop', 0.5);
    expect(Math.abs(middle.side)).toBeGreaterThan(0.2);
    expect(middle.up).toBeGreaterThan(0);
  });

  it('tips over and fades when downed, and stays down', () => {
    expect(proceduralPose('tipOver', 0)).toEqual(neutral);
    const end = proceduralPose('tipOver', 1);
    expect(Math.abs(end.tilt)).toBeCloseTo(Math.PI / 2);
    expect(end.alpha).toBeLessThan(0.7);
  });

  it('jumps for victory', () => {
    expect(proceduralPose('jump', 0.5).up).toBeGreaterThan(0.2);
  });

  it('shows the item icon while using an item', () => {
    expect(proceduralPose('itemBob', 0.5).showItem).toBe(true);
    expect(proceduralPose('itemBob', 1).showItem).toBe(false);
  });

  it('clamps progress outside 0..1', () => {
    expect(proceduralPose('lunge', -1)).toEqual(proceduralPose('lunge', 0));
    expect(proceduralPose('tipOver', 5)).toEqual(proceduralPose('tipOver', 1));
  });
});
