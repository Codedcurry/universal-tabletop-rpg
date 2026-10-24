/**
 * Game system file format, version 1.
 *
 * Describes a tabletop system as plain JSON-friendly data. Numbers that depend
 * on a creature are formulas (see shared/formula): arithmetic with dice,
 * functions (floor, ceil, round, min, max, abs), and @variables.
 *
 * Variables available to creature formulas:
 * - every stat id (e.g. @str)
 * - every derived value id (e.g. @str_mod), in declaration order
 * - @level
 *
 * Fractional formula results are rounded down wherever a whole number is
 * needed (HP, damage, defense, speed, initiative).
 */
export const GAME_SYSTEM_FORMAT_VERSION = 1;

export interface GameSystem {
  readonly formatVersion: typeof GAME_SYSTEM_FORMAT_VERSION;
  readonly id: string;
  readonly name: string;
  readonly stats: readonly StatDef[];
  readonly derived: readonly DerivedDef[];
  readonly levels: LevelTable;
  readonly health: { readonly max: string };
  /** What an attack roll must meet or beat to hit (e.g. armor class). No dice. */
  readonly defense: string;
  /** Rolled at the start of combat; highest goes first. */
  readonly initiative: string;
  readonly movement: MovementDef;
  readonly conditions: readonly ConditionDef[];
  readonly abilities: readonly AbilityDef[];
  readonly monsters: readonly MonsterDef[];
}

export interface StatDef {
  readonly id: string;
  readonly name: string;
  readonly default: number;
}

/** A value computed from stats, level, and earlier derived values. No dice. */
export interface DerivedDef {
  readonly id: string;
  readonly name: string;
  readonly formula: string;
}

export interface LevelTable {
  /**
   * Total XP needed to reach each level: entry i is the XP for level i + 1.
   * The first entry must be 0 and the list strictly increasing; its length is the max level.
   */
  readonly xpThresholds: readonly number[];
}

export interface MovementDef {
  /** Tiles a creature can move per turn. No dice. */
  readonly speed: string;
  /** Highest step up (in height levels) a creature can walk without climbing. */
  readonly maxStepUp: number;
  /** Highest drop a creature can step down. */
  readonly maxStepDown: number;
  /** If present, creatures can climb higher steps at extra movement cost. */
  readonly climb?: ClimbDef;
}

export interface ClimbDef {
  /** Highest step up a climb can manage. */
  readonly maxHeight: number;
  /** Extra movement per height level above maxStepUp. */
  readonly costPerLevel: number;
}

export interface ConditionDef {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** The creature can't use abilities. */
  readonly preventsActions?: boolean;
  /** The creature can't move. */
  readonly preventsMovement?: boolean;
}

export type AbilityTarget = 'enemy' | 'ally' | 'self';

/** Which attack animation to play; the renderer falls back if a sprite lacks it. */
export type AbilityAnimation = 'melee' | 'ranged' | 'spell' | 'item';

export interface AbilityDef {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** Max distance in tiles to the target. Ignored for self-targeted abilities. */
  readonly range: number;
  readonly target: AbilityTarget;
  /** If present, effects apply only when the roll meets or beats the target's defense. */
  readonly attack?: { readonly roll: string };
  readonly effects: readonly EffectDef[];
  readonly animation: AbilityAnimation;
}

export type EffectDef =
  | { readonly type: 'damage'; readonly amount: string }
  | { readonly type: 'heal'; readonly amount: string }
  | { readonly type: 'applyCondition'; readonly condition: string; readonly rounds: number };

export interface MonsterDef {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  /** Stat values; stats left out use the stat's default. */
  readonly stats: Readonly<Record<string, number>>;
  readonly abilities: readonly string[];
  /** XP shared among the winning party when this monster is defeated. */
  readonly xpValue: number;
}
