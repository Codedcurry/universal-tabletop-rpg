import type { CombatEvent } from '../combat';
import type { Cell } from '../grid';

/**
 * Animation rules, as pure logic: which creature plays which animation when,
 * the fallback motions for animations a character's art doesn't have, and
 * which numbers float up. The renderer just plays the resulting timeline.
 */

/** Every animation a character can have. Only idle is required. */
export const CLIPS = [
  'idle',
  'walk',
  'attackMelee',
  'attackRanged',
  'cast',
  'useItem',
  'defend',
  'hit',
  'dodge',
  'downed',
  'victory',
] as const;
export type Clip = (typeof CLIPS)[number];

/** Combat animation timings, in milliseconds. */
export interface AnimationTiming {
  readonly walkStepMs: number;
  readonly attackMs: number;
  /** When the blow lands, from the start of the attack: arrows and spells travel. */
  readonly impactMs: Readonly<Record<'melee' | 'ranged' | 'spell' | 'item', number>>;
  readonly hitMs: number;
  readonly dodgeMs: number;
  readonly defendMs: number;
  readonly downedMs: number;
  readonly victoryMs: number;
  /** Pause after the last blow before the winners celebrate. */
  readonly victoryDelayMs: number;
}

/** All timings in milliseconds, in one place for tuning during playtesting. */
export const DEFAULT_TIMING: AnimationTiming = {
  walkStepMs: 220,
  attackMs: 500,
  /** When the blow lands, from the start of the attack: arrows and spells travel. */
  impactMs: { melee: 250, ranged: 420, spell: 450, item: 300 },
  hitMs: 350,
  dodgeMs: 350,
  defendMs: 350,
  downedMs: 600,
  victoryMs: 700,
  /** Pause after the last blow before the winners celebrate. */
  victoryDelayMs: 150,
};

/** How fast combat plays out: a per-device preference, like the dice speed. */
export type AnimationSpeed = 'fast' | 'normal' | 'off';
export const ANIMATION_SPEEDS: readonly AnimationSpeed[] = ['fast', 'normal', 'off'];
const SPEED_FACTOR: Record<AnimationSpeed, number> = { fast: 0.5, normal: 1, off: 0 };

/** The timing for a speed: every duration scaled; "off" makes everything happen at once. */
export function timingFor(speed: AnimationSpeed): AnimationTiming {
  if (speed === 'normal') return DEFAULT_TIMING;
  const f = SPEED_FACTOR[speed];
  const t = DEFAULT_TIMING;
  return {
    walkStepMs: t.walkStepMs * f,
    attackMs: t.attackMs * f,
    impactMs: { melee: t.impactMs.melee * f, ranged: t.impactMs.ranged * f, spell: t.impactMs.spell * f, item: t.impactMs.item * f },
    hitMs: t.hitMs * f,
    dodgeMs: t.dodgeMs * f,
    defendMs: t.defendMs * f,
    downedMs: t.downedMs * f,
    victoryMs: t.victoryMs * f,
    victoryDelayMs: t.victoryDelayMs * f,
  };
}

/** People who ask their device for reduced motion start with combat animations off. */
export function defaultAnimationSpeed(prefersReducedMotion: boolean): AnimationSpeed {
  return prefersReducedMotion ? 'off' : 'normal';
}

export interface AnimationStep {
  readonly combatantId: string;
  readonly clip: Clip;
  readonly start: number;
  readonly duration: number;
  /** For walk: the cells to move through, start to end. */
  readonly path?: readonly Cell[];
}

export type FloatingTextKind = 'damage' | 'heal' | 'miss' | 'status' | 'xp' | 'level';

export interface FloatingText {
  readonly combatantId: string;
  readonly text: string;
  readonly kind: FloatingTextKind;
  readonly start: number;
}

export interface Timeline {
  readonly steps: readonly AnimationStep[];
  readonly texts: readonly FloatingText[];
  readonly duration: number;
}

/** What the scheduler needs to know about the fight (after the action). */
export interface ScheduleContext {
  /** Everyone in the fight, in turn order. */
  readonly combatantIds: readonly string[];
  sideOf(combatantId: string): string;
  isStanding(combatantId: string): boolean;
  conditionName(conditionId: string): string;
}

const ATTACK_CLIPS = { melee: 'attackMelee', ranged: 'attackRanged', spell: 'cast', item: 'useItem' } as const;

/**
 * Lays out the events of one combat action on a timeline. Moves play first,
 * then the ability; reactions (hit, dodge, numbers) happen at the moment of
 * impact; the winners celebrate after the last blow.
 */
export function scheduleCombatEvents(
  events: readonly CombatEvent[],
  context: ScheduleContext,
  timing: AnimationTiming = DEFAULT_TIMING,
): Timeline {
  const steps: AnimationStep[] = [];
  const texts: FloatingText[] = [];
  /** When the next action starts. */
  let cursor = 0;
  /** When the current ability's blow lands. */
  let impact = 0;
  /** When everything so far is over. */
  let end = 0;

  const add = (step: AnimationStep) => {
    steps.push(step);
    end = Math.max(end, step.start + step.duration);
  };
  const say = (combatantId: string, text: string, kind: FloatingTextKind, start: number) => {
    texts.push({ combatantId, text, kind, start });
    end = Math.max(end, start);
  };

  for (const event of events) {
    switch (event.type) {
      case 'moved': {
        const duration = (event.path.length - 1) * timing.walkStepMs;
        add({ combatantId: event.combatantId, clip: 'walk', start: cursor, duration, path: event.path });
        cursor += duration;
        break;
      }
      case 'abilityUsed':
        add({ combatantId: event.actorId, clip: ATTACK_CLIPS[event.animation], start: cursor, duration: timing.attackMs });
        impact = cursor + timing.impactMs[event.animation];
        cursor += timing.attackMs;
        break;
      case 'attackRolled':
        if (!event.hit) {
          add({ combatantId: event.targetId, clip: 'dodge', start: impact, duration: timing.dodgeMs });
          say(event.targetId, 'Miss', 'miss', impact);
        }
        break;
      case 'damaged':
        add(
          event.amount > 0
            ? { combatantId: event.targetId, clip: 'hit', start: impact, duration: timing.hitMs }
            : { combatantId: event.targetId, clip: 'defend', start: impact, duration: timing.defendMs },
        );
        // A critical hit's number gets a "!".
        say(event.targetId, event.amount > 0 ? `-${event.amount}${event.critical ? '!' : ''}` : '0', 'damage', impact);
        break;
      case 'downed':
        add({ combatantId: event.targetId, clip: 'downed', start: impact + timing.hitMs, duration: timing.downedMs });
        break;
      case 'healed':
        say(event.targetId, `+${event.amount}`, 'heal', impact);
        break;
      case 'revived':
        add({ combatantId: event.targetId, clip: 'idle', start: impact, duration: 0 });
        break;
      case 'conditionApplied':
        say(event.targetId, context.conditionName(event.conditionId), 'status', impact);
        break;
      case 'combatEnded': {
        const start = end + timing.victoryDelayMs;
        const winners = context.combatantIds.filter((id) => context.sideOf(id) === event.winner && context.isStanding(id));
        for (const id of winners) {
          add({ combatantId: id, clip: 'victory', start, duration: timing.victoryMs });
        }
        cursor = start;
        break;
      }
      case 'xpGained':
        say(event.combatantId, `+${event.amount} XP`, 'xp', cursor);
        break;
      case 'levelUp':
        say(event.combatantId, `Level ${event.level}!`, 'level', cursor);
        break;
      default:
        break;
    }
  }
  return { steps, texts, duration: end };
}

// ---------------------------------------------------------------------------
// The fallback rule

/** Motions that fake a missing animation using the idle frame. */
export type Motion = 'none' | 'lunge' | 'brace' | 'shake' | 'hop' | 'tipOver' | 'jump' | 'bob' | 'itemBob';

const FALLBACKS: Record<Clip, Motion> = {
  idle: 'none',
  walk: 'bob',
  attackMelee: 'lunge',
  attackRanged: 'lunge',
  cast: 'lunge',
  useItem: 'itemBob',
  defend: 'brace',
  hit: 'shake',
  dodge: 'hop',
  downed: 'tipOver',
  victory: 'jump',
};

/** Real frames whenever the character has them; otherwise a procedural motion on the idle frame. */
export function resolveClip(
  available: ReadonlySet<Clip>,
  clip: Clip,
): { readonly kind: 'frames'; readonly clip: Clip } | { readonly kind: 'procedural'; readonly motion: Motion } {
  if (available.has(clip)) return { kind: 'frames', clip };
  return { kind: 'procedural', motion: FALLBACKS[clip] };
}

/**
 * Offsets applied to the idle sprite. forward is toward the creature's
 * facing, side to its right, up is height (all in tile widths); tilt in
 * radians; red is a flash strength 0..1; alpha is opacity.
 */
export interface Pose {
  readonly forward: number;
  readonly side: number;
  readonly up: number;
  readonly tilt: number;
  readonly red: number;
  readonly alpha: number;
  readonly showItem: boolean;
}

const REST: Pose = { forward: 0, side: 0, up: 0, tilt: 0, red: 0, alpha: 1, showItem: false };

/** 0 at both ends, 1 in the middle: a smooth there-and-back. */
const bump = (t: number) => Math.sin(Math.PI * t);

/** The pose of a fallback motion at progress t (0 to 1). */
export function proceduralPose(motion: Motion, progress: number): Pose {
  const t = Math.min(1, Math.max(0, progress));
  switch (motion) {
    case 'none':
      return REST;
    case 'lunge':
      // Quick out, slower back.
      return { ...REST, forward: 0.35 * bump(t ** 0.7) };
    case 'brace':
      return { ...REST, forward: -0.12 * bump(t), tilt: -0.2 * bump(t) };
    case 'shake':
      return {
        ...REST,
        side: 0.08 * Math.sin(t * Math.PI * 8) * (1 - t),
        red: t < 0.6 ? bump(t / 0.6) : 0,
      };
    case 'hop':
      return { ...REST, side: 0.4 * bump(t), up: 0.2 * bump(t) };
    case 'tipOver': {
      const fall = t * t * (3 - 2 * t);
      return { ...REST, tilt: (Math.PI / 2) * fall, alpha: 1 - 0.45 * fall };
    }
    case 'jump':
      return { ...REST, up: 0.45 * bump(t) };
    case 'bob':
      return { ...REST, up: 0.08 * Math.abs(Math.sin(Math.PI * 2 * t)) };
    case 'itemBob':
      return { ...REST, up: 0.1 * bump(t), showItem: t > 0.1 && t < 0.9 };
  }
}
