import type { DiceTermResult } from '../dice';
import type { Cell } from '../grid';
import type { WorldMap } from '../map';
import type { AbilityAnimation, CreatureSheet, GameSystem } from '../system';

export interface CombatContext {
  readonly system: GameSystem;
  readonly map: WorldMap;
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
}

/** The whole fight. Plain data, so the DM can sync it to players and save it. */
export interface CombatState {
  readonly status: 'active' | 'ended';
  readonly winner: string | null;
  readonly round: number;
  /** Combatant ids in initiative order. */
  readonly order: readonly string[];
  /** Index into `order` of whose turn it is. */
  readonly turnIndex: number;
  readonly movementLeft: number;
  readonly actionUsed: boolean;
  readonly combatants: Readonly<Record<string, Combatant>>;
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
    }
  /** `amount` is the damage dealt as rolled, even past 0 HP; `hp` is what's left. */
  | { readonly type: 'damaged'; readonly targetId: string; readonly amount: number; readonly hp: number; readonly dice: readonly DiceTermResult[] }
  /** `amount` is the HP actually restored, after capping at max HP. */
  | { readonly type: 'healed'; readonly targetId: string; readonly amount: number; readonly hp: number; readonly dice: readonly DiceTermResult[] }
  | { readonly type: 'downed'; readonly targetId: string }
  | { readonly type: 'revived'; readonly targetId: string }
  | { readonly type: 'conditionApplied'; readonly targetId: string; readonly conditionId: string; readonly rounds: number }
  | { readonly type: 'conditionExpired'; readonly targetId: string; readonly conditionId: string }
  | { readonly type: 'combatEnded'; readonly winner: string }
  | { readonly type: 'xpGained'; readonly combatantId: string; readonly amount: number; readonly xp: number }
  | { readonly type: 'levelUp'; readonly combatantId: string; readonly level: number };

export type ActionResult =
  | { readonly ok: true; readonly state: CombatState; readonly events: readonly CombatEvent[] }
  | { readonly ok: false; readonly reason: string };
