import type { DiceTermResult } from '../dice';
import type { Cell } from '../grid';
import type { WorldMap } from '../map';
import type { AbilityAnimation, CreatureSheet, GameSystem } from '../system';
import type { HouseRule } from './houseRules';

export interface CombatContext {
  readonly system: GameSystem;
  readonly map: WorldMap;
  /** The DM's house rules, applied on top of the system's. */
  readonly houseRules?: readonly HouseRule[];
  /** Rulings for this one action only (the DM allowing it just this once). */
  readonly overrules?: readonly HouseRule[];
}

export interface CombatantSetup {
  readonly sheet: CreatureSheet;
  /** Team name; creatures on the same side are allies. */
  readonly side: string;
  readonly position: Cell;
  /** Player characters earn XP; NPC allies and monsters don't. */
  readonly isPlayerCharacter: boolean;
  /** XP the winners share when this creature is on the losing side. Defaults to 0. */
  readonly xpValue?: number;
  /** Starting HP, e.g. when resuming a fight. Defaults to max HP. */
  readonly hp?: number;
  /** Starting facing; defaults to toward the nearest enemy. */
  readonly facing?: number;
}

export interface ActiveCondition {
  readonly id: string;
  /** Counts down at the end of each of the affected creature's turns. */
  readonly remainingRounds: number;
}

export interface Combatant {
  readonly sheet: CreatureSheet;
  readonly side: string;
  readonly position: Cell;
  readonly isPlayerCharacter: boolean;
  readonly xpValue: number;
  /** 0 means downed: skipped in turn order until healed. */
  readonly hp: number;
  readonly conditions: readonly ActiveCondition[];
  /** Compass heading the creature faces (0 = north, PI/2 = east): picks its sprite direction. */
  readonly facing: number;
  /** Resource points left, by id; a resource left out is full. */
  readonly resources?: Readonly<Record<string, number>>;
}

/** The whole fight. Plain data, so the DM can sync it to players and save it. */
export interface CombatState {
  /** setup: the DM is placing creatures; active: the fight is on; ended: one side is left standing. */
  readonly status: 'setup' | 'active' | 'ended';
  readonly winner: string | null;
  readonly round: number;
  /** Combatant ids in initiative order. */
  readonly order: readonly string[];
  /** Index into `order` of whose turn it is. */
  readonly turnIndex: number;
  readonly movementLeft: number;
  readonly actionUsed: boolean;
  readonly combatants: Readonly<Record<string, Combatant>>;
  /** Initiative totals, so creatures added mid-fight slot into the order. Empty before the fight. */
  readonly initiative: Readonly<Record<string, number>>;
}

export type CombatAction =
  | { readonly type: 'move'; readonly actorId: string; readonly to: Cell }
  | { readonly type: 'useAbility'; readonly actorId: string; readonly abilityId: string; readonly targetId: string }
  | { readonly type: 'endTurn'; readonly actorId: string };

/**
 * Everything that happens, in order. The animation state machine, damage
 * numbers, sounds, and the game log all react to these.
 */
export type CombatEvent =
  | { readonly type: 'initiativeRolled'; readonly combatantId: string; readonly total: number; readonly dice: readonly DiceTermResult[] }
  | { readonly type: 'combatStarted'; readonly order: readonly string[] }
  | { readonly type: 'roundStarted'; readonly round: number }
  | { readonly type: 'turnStarted'; readonly combatantId: string; readonly round: number }
  | { readonly type: 'turnEnded'; readonly combatantId: string }
  | { readonly type: 'moved'; readonly combatantId: string; readonly path: readonly Cell[]; readonly cost: number }
  | {
      readonly type: 'abilityUsed';
      readonly actorId: string;
      readonly abilityId: string;
      readonly targetId: string;
      readonly animation: AbilityAnimation;
    }
  | {
      readonly type: 'attackRolled';
      readonly actorId: string;
      readonly targetId: string;
      readonly total: number;
      readonly defense: number;
      readonly hit: boolean;
      readonly dice: readonly DiceTermResult[];
      /** A natural roll the system calls a critical: a sure hit (damage dice rolled twice) or a sure miss. */
      readonly critical?: 'hit' | 'miss';
    }
  /** `amount` is the damage dealt as rolled, even past 0 HP; `hp` is what's left. */
  | {
      readonly type: 'damaged';
      readonly targetId: string;
      readonly amount: number;
      readonly hp: number;
      readonly dice: readonly DiceTermResult[];
      /** From a critical hit: the damage dice were rolled twice. */
      readonly critical?: boolean;
    }
  /** Resource points spent on an ability; `left` is what remains. */
  | { readonly type: 'resourceSpent'; readonly combatantId: string; readonly resource: string; readonly amount: number; readonly left: number }
  /** Resource points given back (up to the max); `amount` is what was actually restored. */
  | { readonly type: 'resourceRestored'; readonly targetId: string; readonly resource: string; readonly amount: number; readonly left: number; readonly dice: readonly DiceTermResult[] }
  /** `amount` is the HP actually restored, after capping at max HP. */
  | { readonly type: 'healed'; readonly targetId: string; readonly amount: number; readonly hp: number; readonly dice: readonly DiceTermResult[] }
  | { readonly type: 'downed'; readonly targetId: string }
  | { readonly type: 'revived'; readonly targetId: string }
  | { readonly type: 'conditionApplied'; readonly targetId: string; readonly conditionId: string; readonly rounds: number }
  | { readonly type: 'conditionExpired'; readonly targetId: string; readonly conditionId: string }
  | { readonly type: 'combatEnded'; readonly winner: string }
  | { readonly type: 'xpGained'; readonly combatantId: string; readonly amount: number; readonly xp: number }
  | { readonly type: 'levelUp'; readonly combatantId: string; readonly level: number }
  // The DM's changes, recorded in the Game log.
  | { readonly type: 'combatantAdded'; readonly combatantId: string }
  | { readonly type: 'combatantRemoved'; readonly combatantId: string; readonly name: string }
  | { readonly type: 'combatantPlaced'; readonly combatantId: string; readonly to: Cell }
  | { readonly type: 'combatantRenamed'; readonly combatantId: string; readonly from: string; readonly to: string }
  /** `changes` are readable, e.g. "HP 8 → 3". */
  | { readonly type: 'combatantEdited'; readonly combatantId: string; readonly changes: readonly string[] }
  | { readonly type: 'turnOrderChanged'; readonly order: readonly string[] };

/** What the DM can change about a creature at any moment. */
export interface CombatantPatch {
  readonly stats?: Readonly<Record<string, number>>;
  readonly hp?: number;
  readonly xp?: number;
  readonly side?: string;
  readonly isPlayerCharacter?: boolean;
  readonly xpValue?: number;
  readonly abilities?: readonly string[];
  readonly conditions?: readonly ActiveCondition[];
  /** Resource points left, by id (up to each one's max). */
  readonly resources?: Readonly<Record<string, number>>;
}

export type ActionResult =
  | { readonly ok: true; readonly state: CombatState; readonly events: readonly CombatEvent[] }
  | { readonly ok: false; readonly reason: string };
