import { evaluateFormula, parseFormula } from '../formula';
import { cellKey, headingBetween } from '../grid';
import { type Occupant, type Reach, findPath, reachable } from '../movement';
import type { RandomSource } from '../random';
import {
  type AbilityDef,
  type ConditionDef,
  type EffectDef,
  type GameSystem,
  computeCreature,
  sheetFromMonster,
} from '../system';
import type {
  ActionResult,
  Combatant,
  CombatAction,
  CombatContext,
  CombatEvent,
  CombatState,
  CombatantSetup,
} from './types';

/**
 * The combat rules engine. Pure functions: state in, new state and events out.
 * The DM's device runs these and broadcasts the results; players' actions are
 * checked here before anything happens.
 */

export class CombatSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CombatSetupError';
  }
}

/** Thrown inside an action to reject it; turned into `{ ok: false }`. */
/** @internal Shared with dm.ts. */
export class RuleViolation extends Error {}

/** @internal */
export function violation(message: string): never {
  throw new RuleViolation(message);
}

// ---------------------------------------------------------------------------
// Helpers

/** @internal */
export function roll(text: string, vars: Readonly<Record<string, number>>, random: RandomSource) {
  const result = evaluateFormula(parseFormula(text), vars, random);
  return { value: Math.floor(result.value), dice: result.dice };
}

/** @internal */
export function standing(combatant: Combatant): boolean {
  return combatant.hp > 0;
}

function activeConditions(system: GameSystem, combatant: Combatant): ConditionDef[] {
  return combatant.conditions
    .map((active) => system.conditions.find((condition) => condition.id === active.id))
    .filter((condition): condition is ConditionDef => condition !== undefined);
}

function blockingCondition(
  system: GameSystem,
  combatant: Combatant,
  flag: 'preventsActions' | 'preventsMovement',
): ConditionDef | undefined {
  return activeConditions(system, combatant).find((condition) => condition[flag] === true);
}

/** @internal */
export function sidesStanding(combatants: Iterable<Combatant>): Set<string> {
  const sides = new Set<string>();
  for (const combatant of combatants) if (standing(combatant)) sides.add(combatant.side);
  return sides;
}

export function activeCombatant(state: CombatState): Combatant | undefined {
  const id = state.order[state.turnIndex];
  return id === undefined ? undefined : state.combatants[id];
}

/** Builds a setup for one instance of a monster from the system's list. */
export function setupFromMonster(
  system: GameSystem,
  monsterId: string,
  options: { id: string; side: string; position: CombatantSetup['position']; name?: string },
): CombatantSetup {
  const monster = system.monsters.find((entry) => entry.id === monsterId);
  if (!monster) throw new CombatSetupError(`${system.name} has no monster "${monsterId}"`);
  return {
    sheet: sheetFromMonster(system, monsterId, options.id, options.name),
    side: options.side,
    position: options.position,
    isPlayerCharacter: false,
    xpValue: monster.xpValue,
  };
}

/**
 * A working copy of the state used while resolving one action. Combatants are
 * replaced, never mutated, so the caller's state is untouched.
 */
/** @internal */
export class Draft {
  status: CombatState['status'];
  winner: string | null;
  round: number;
  turnIndex: number;
  movementLeft: number;
  actionUsed: boolean;
  readonly order: string[];
  readonly combatants: Record<string, Combatant>;
  readonly initiative: Record<string, number>;
  readonly events: CombatEvent[] = [];

  constructor(
    private readonly ctx: CombatContext,
    state: CombatState,
  ) {
    this.status = state.status;
    this.winner = state.winner;
    this.round = state.round;
    this.turnIndex = state.turnIndex;
    this.movementLeft = state.movementLeft;
    this.actionUsed = state.actionUsed;
    this.order = [...state.order];
    this.combatants = { ...state.combatants };
    this.initiative = { ...state.initiative };
  }

  get(id: string): Combatant {
    return this.combatants[id] ?? violation(`No combatant "${id}"`);
  }

  update(id: string, patch: Partial<Combatant>): Combatant {
    const updated = { ...this.get(id), ...patch };
    this.combatants[id] = updated;
    return updated;
  }

  emit(event: CombatEvent): void {
    this.events.push(event);
  }

  beginTurn(index: number): void {
    const id = this.order[index] as string;
    const combatant = this.get(id);
    this.turnIndex = index;
    this.actionUsed = false;
    this.movementLeft = blockingCondition(this.ctx.system, combatant, 'preventsMovement')
      ? 0
      : computeCreature(this.ctx.system, combatant.sheet).speed;
    this.emit({ type: 'turnStarted', combatantId: id, round: this.round });
  }

  /** Moves to the next creature still standing, starting a new round when the order wraps. */
  advanceTurn(): void {
    let index = this.turnIndex;
    for (let checked = 0; checked < this.order.length; checked++) {
      index++;
      if (index >= this.order.length) {
        index = 0;
        this.round++;
        this.emit({ type: 'roundStarted', round: this.round });
      }
      if (standing(this.get(this.order[index] as string))) {
        this.beginTurn(index);
        return;
      }
    }
    throw new Error('No creature is left standing to take a turn');
  }

  toState(): CombatState {
    return {
      status: this.status,
      winner: this.winner,
      round: this.round,
      order: this.order,
      turnIndex: this.turnIndex,
      movementLeft: this.movementLeft,
      actionUsed: this.actionUsed,
      combatants: this.combatants,
      initiative: this.initiative,
    };
  }
}

// ---------------------------------------------------------------------------
// Starting combat

/** @internal */
export function validateSetups(ctx: CombatContext, setups: readonly CombatantSetup[]): void {
  const ids = new Set<string>();
  const positions = new Set<string>();
  const abilityIds = new Set(ctx.system.abilities.map((ability) => ability.id));

  for (const { sheet, position, hp } of setups) {
    if (ids.has(sheet.id)) throw new CombatSetupError(`Two combatants share the id "${sheet.id}"`);
    ids.add(sheet.id);

    const tile = ctx.map.tile(position);
    if (!tile || tile.blocked) {
      throw new CombatSetupError(`${sheet.name} is placed at (${position.q}, ${position.r}), which can't be stood on`);
    }
    const key = cellKey(position);
    if (positions.has(key)) throw new CombatSetupError(`${sheet.name} is placed on an occupied tile`);
    positions.add(key);

    for (const abilityId of sheet.abilities) {
      if (!abilityIds.has(abilityId)) throw new CombatSetupError(`${sheet.name} has an unknown ability "${abilityId}"`);
    }

    let maxHp: number;
    try {
      maxHp = computeCreature(ctx.system, sheet).maxHp;
    } catch (error) {
      throw new CombatSetupError(error instanceof Error ? error.message : String(error));
    }
    if (hp !== undefined && (!Number.isInteger(hp) || hp < 0 || hp > maxHp)) {
      throw new CombatSetupError(`${sheet.name} can't start with ${hp} HP (max ${maxHp})`);
    }
  }
}

export interface StartOptions {
  /** False: no initiative rolls; creatures act in the order given. Default true. */
  readonly rollInitiative?: boolean;
}

export function startCombat(
  ctx: CombatContext,
  setups: readonly CombatantSetup[],
  random: RandomSource,
  options: StartOptions = {},
): { state: CombatState; events: readonly CombatEvent[] } {
  validateSetups(ctx, setups);

  const combatants: Record<string, Combatant> = {};
  for (const setup of setups) {
    combatants[setup.sheet.id] = {
      sheet: setup.sheet,
      side: setup.side,
      position: setup.position,
      isPlayerCharacter: setup.isPlayerCharacter,
      xpValue: setup.xpValue ?? 0,
      hp: setup.hp ?? computeCreature(ctx.system, setup.sheet).maxHp,
      conditions: [],
      facing: setup.facing ?? 0,
    };
  }
  // Everyone starts facing the nearest enemy, unless told otherwise.
  for (const setup of setups) {
    if (setup.facing !== undefined) continue;
    const self = combatants[setup.sheet.id] as Combatant;
    const enemies = Object.values(combatants).filter((other) => other.side !== self.side && standing(other));
    const nearest = enemies.reduce<Combatant | undefined>((best, other) => {
      if (!best) return other;
      const grid = ctx.map.grid;
      return grid.distance(self.position, other.position) < grid.distance(self.position, best.position) ? other : best;
    }, undefined);
    if (nearest) combatants[setup.sheet.id] = { ...self, facing: headingBetween(ctx.map.grid, self.position, nearest.position) };
  }
  if (sidesStanding(Object.values(combatants)).size < 2) {
    throw new CombatSetupError('Combat needs creatures standing on at least two sides');
  }

  const events: CombatEvent[] = [];
  // Without initiative, creatures act in the order given (the DM's list).
  const initiative = options.rollInitiative === false
    ? []
    : setups.map((setup, index) => {
        const vars = computeCreature(ctx.system, setup.sheet).vars;
        const { value, dice } = roll(ctx.system.initiative, vars, random);
        events.push({ type: 'initiativeRolled', combatantId: setup.sheet.id, total: value, dice });
        return { id: setup.sheet.id, total: value, index };
      });
  // Highest first; ties keep setup order.
  const order = options.rollInitiative === false
    ? setups.map((setup) => setup.sheet.id)
    : [...initiative].sort((a, b) => b.total - a.total || a.index - b.index).map((entry) => entry.id);
  events.push({ type: 'combatStarted', order });

  const draft = new Draft(ctx, {
    status: 'active',
    winner: null,
    round: 1,
    order,
    turnIndex: -1,
    movementLeft: 0,
    actionUsed: false,
    combatants,
    initiative: Object.fromEntries(initiative.map((entry) => [entry.id, entry.total])),
  });
  draft.events.push(...events, { type: 'roundStarted', round: 1 });
  // Setup guarantees at least two creatures are standing, so one exists.
  draft.beginTurn(order.findIndex((id) => standing(combatants[id] as Combatant)));
  return { state: draft.toState(), events: draft.events };
}

// ---------------------------------------------------------------------------
// Actions

export function applyAction(
  ctx: CombatContext,
  state: CombatState,
  action: CombatAction,
  random: RandomSource,
): ActionResult {
  try {
    if (state.status === 'ended') violation('Combat is over');
    if (state.status === 'setup') violation("The fight hasn't started yet");
    const draft = new Draft(ctx, state);
    const actor = draft.get(action.actorId);
    if (state.order[state.turnIndex] !== action.actorId) {
      violation(`It is not ${actor.sheet.name}'s turn`);
    }
    if (!standing(actor)) violation(`${actor.sheet.name} is down`);

    switch (action.type) {
      case 'move':
        move(ctx, draft, action.actorId, action.to);
        break;
      case 'useAbility':
        useAbility(ctx, draft, action.actorId, action.abilityId, action.targetId, random);
        break;
      case 'endTurn':
        endTurn(draft, action.actorId);
        break;
    }
    return { ok: true, state: draft.toState(), events: draft.events };
  } catch (error) {
    if (error instanceof RuleViolation) return { ok: false, reason: error.message };
    throw error;
  }
}

function move(ctx: CombatContext, draft: Draft, actorId: string, to: CombatantSetup['position']): void {
  const actor = draft.get(actorId);
  if (cellKey(actor.position) === cellKey(to)) violation(`${actor.sheet.name} is already there`);
  const blocker = blockingCondition(ctx.system, actor, 'preventsMovement');
  if (blocker) violation(`${actor.sheet.name} is ${blocker.name} and can't move`);

  const occupants = occupantsFor(draft.combatants, actorId);
  const path = findPath({ map: ctx.map, rules: ctx.system.movement, occupants }, actor.position, to, draft.movementLeft);
  if (!path) violation(`${actor.sheet.name} can't reach that tile this turn`);

  const steps = path.path;
  const facing = headingBetween(ctx.map.grid, steps[steps.length - 2] as CombatantSetup['position'], to);
  draft.update(actorId, { position: to, facing });
  draft.movementLeft -= path.cost;
  draft.emit({ type: 'moved', combatantId: actorId, path: path.path, cost: path.cost });
}

function checkTarget(ctx: CombatContext, ability: AbilityDef, actor: Combatant, target: Combatant): void {
  switch (ability.target) {
    case 'self':
      if (target.sheet.id !== actor.sheet.id) violation(`${ability.name} can only target yourself`);
      return;
    case 'enemy':
      if (target.side === actor.side) violation(`${ability.name} must target an enemy`);
      if (!standing(target)) violation(`${target.sheet.name} is already down`);
      break;
    case 'ally':
      if (target.side !== actor.side) violation(`${ability.name} must target an ally`);
      break;
  }
  if (ctx.map.grid.distance(actor.position, target.position) > ability.range) {
    violation(`${target.sheet.name} is out of range for ${ability.name} (range ${ability.range})`);
  }
}

function useAbility(
  ctx: CombatContext,
  draft: Draft,
  actorId: string,
  abilityId: string,
  targetId: string,
  random: RandomSource,
): void {
  const { system } = ctx;
  const actor = draft.get(actorId);
  if (draft.actionUsed) violation(`${actor.sheet.name} has already used an action this turn`);
  const blocker = blockingCondition(system, actor, 'preventsActions');
  if (blocker) violation(`${actor.sheet.name} is ${blocker.name} and can't act`);

  const ability = system.abilities.find((entry) => entry.id === abilityId) ?? violation(`Unknown ability "${abilityId}"`);
  if (!actor.sheet.abilities.includes(abilityId)) violation(`${actor.sheet.name} doesn't know ${ability.name}`);
  const target = draft.get(targetId);
  checkTarget(ctx, ability, actor, target);

  draft.actionUsed = true;
  if (targetId !== actorId) draft.update(actorId, { facing: headingBetween(ctx.map.grid, actor.position, target.position) });
  draft.emit({ type: 'abilityUsed', actorId, abilityId, targetId, animation: ability.animation });

  const actorVars = computeCreature(system, actor.sheet).vars;
  if (ability.attack) {
    const attack = roll(ability.attack.roll, actorVars, random);
    const defense = computeCreature(system, target.sheet).defense;
    const hit = attack.value >= defense;
    draft.emit({ type: 'attackRolled', actorId, targetId, total: attack.value, defense, hit, dice: attack.dice });
    if (!hit) return;
  }

  for (const effect of ability.effects) applyEffect(ctx, draft, effect, actorVars, targetId, random);
  checkForEnd(ctx, draft);
}

function applyEffect(
  ctx: CombatContext,
  draft: Draft,
  effect: EffectDef,
  actorVars: Readonly<Record<string, number>>,
  targetId: string,
  random: RandomSource,
): void {
  const target = draft.get(targetId);
  switch (effect.type) {
    case 'damage': {
      const { value, dice } = roll(effect.amount, actorVars, random);
      const amount = Math.max(0, value);
      const hp = Math.max(0, target.hp - amount);
      draft.update(targetId, { hp });
      draft.emit({ type: 'damaged', targetId, amount, hp, dice });
      if (target.hp > 0 && hp === 0) draft.emit({ type: 'downed', targetId });
      return;
    }
    case 'heal': {
      const { value, dice } = roll(effect.amount, actorVars, random);
      const maxHp = computeCreature(ctx.system, target.sheet).maxHp;
      const hp = Math.min(maxHp, target.hp + Math.max(0, value));
      draft.update(targetId, { hp });
      draft.emit({ type: 'healed', targetId, amount: hp - target.hp, hp, dice });
      if (target.hp === 0 && hp > 0) draft.emit({ type: 'revived', targetId });
      return;
    }
    case 'applyCondition': {
      // Reapplying a condition refreshes its duration rather than stacking it.
      const conditions = [
        ...target.conditions.filter((condition) => condition.id !== effect.condition),
        { id: effect.condition, remainingRounds: effect.rounds },
      ];
      draft.update(targetId, { conditions });
      draft.emit({ type: 'conditionApplied', targetId, conditionId: effect.condition, rounds: effect.rounds });
      return;
    }
  }
}

function endTurn(draft: Draft, actorId: string): void {
  const actor = draft.get(actorId);
  draft.emit({ type: 'turnEnded', combatantId: actorId });

  const remaining = [];
  for (const condition of actor.conditions) {
    const remainingRounds = condition.remainingRounds - 1;
    if (remainingRounds > 0) remaining.push({ ...condition, remainingRounds });
    else draft.emit({ type: 'conditionExpired', targetId: actorId, conditionId: condition.id });
  }
  draft.update(actorId, { conditions: remaining });

  draft.advanceTurn();
}

/** Ends combat when only one side has anyone standing, and shares out XP. */
/** @internal */
export function checkForEnd(ctx: CombatContext, draft: Draft): void {
  const sides = sidesStanding(Object.values(draft.combatants));
  if (sides.size > 1) return;
  const [winner] = sides;
  if (winner === undefined) return;

  draft.status = 'ended';
  draft.winner = winner;
  draft.emit({ type: 'combatEnded', winner });

  const losers = Object.values(draft.combatants).filter((combatant) => combatant.side !== winner);
  const totalXp = losers.reduce((sum, combatant) => sum + combatant.xpValue, 0);
  const earners = draft.order.filter((id) => {
    const combatant = draft.get(id);
    return combatant.side === winner && combatant.isPlayerCharacter;
  });
  if (earners.length === 0) return;
  const share = Math.floor(totalXp / earners.length);
  if (share === 0) return;

  for (const id of earners) {
    const combatant = draft.get(id);
    const before = computeCreature(ctx.system, combatant.sheet);
    const sheet = { ...combatant.sheet, xp: combatant.sheet.xp + share };
    const after = computeCreature(ctx.system, sheet);
    // Leveling up raises current HP by the same amount as max HP; the downed stay down.
    const hp = standing(combatant) ? combatant.hp + Math.max(0, after.maxHp - before.maxHp) : 0;
    draft.update(id, { sheet, hp });
    draft.emit({ type: 'xpGained', combatantId: id, amount: share, xp: sheet.xp });
    if (after.level > before.level) draft.emit({ type: 'levelUp', combatantId: id, level: after.level });
  }
}

// ---------------------------------------------------------------------------
// Options: what the active creature can do now, for highlighting the map.
// They reuse the engine's own checks, so an option is offered exactly when
// the action would be accepted.

/** Allies and downed bodies can be passed but not stopped on; standing enemies block. */
function occupantsFor(combatants: Readonly<Record<string, Combatant>>, actorId: string): Map<string, Occupant> {
  const actor = combatants[actorId] as Combatant;
  const occupants = new Map<string, Occupant>();
  for (const [id, other] of Object.entries(combatants)) {
    if (id === actorId) continue;
    const hostile = other.side !== actor.side && standing(other);
    occupants.set(cellKey(other.position), hostile ? 'enemy' : 'ally');
  }
  return occupants;
}

/** Whether it's this creature's turn and it can do anything at all. */
function canAct(state: CombatState, actorId: string): Combatant | null {
  const actor = state.combatants[actorId];
  if (state.status !== 'active' || !actor || !standing(actor)) return null;
  return state.order[state.turnIndex] === actorId ? actor : null;
}

/** Tiles the creature can move to this turn, with the cheapest path to each. */
export function moveOptions(ctx: CombatContext, state: CombatState, actorId: string): Map<string, Reach> {
  const actor = canAct(state, actorId);
  if (!actor || state.movementLeft <= 0 || blockingCondition(ctx.system, actor, 'preventsMovement')) return new Map();
  const occupants = occupantsFor(state.combatants, actorId);
  return reachable({ map: ctx.map, rules: ctx.system.movement, occupants }, actor.position, state.movementLeft);
}

/** Creatures the ability can target right now (in setup order). */
export function targetOptions(ctx: CombatContext, state: CombatState, actorId: string, abilityId: string): string[] {
  const actor = canAct(state, actorId);
  if (!actor || state.actionUsed || blockingCondition(ctx.system, actor, 'preventsActions')) return [];
  const ability = ctx.system.abilities.find((entry) => entry.id === abilityId);
  if (!ability || !actor.sheet.abilities.includes(abilityId)) return [];
  return Object.entries(state.combatants)
    .filter(([, target]) => {
      try {
        checkTarget(ctx, ability, actor, target);
        return true;
      } catch (error) {
        if (error instanceof RuleViolation) return false;
        throw error;
      }
    })
    .map(([id]) => id);
}
