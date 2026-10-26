import { evaluateFormula, parseFormula } from '../formula';
import { type Cell, cellKey, headingBetween } from '../grid';
import { hasLineOfSight } from '../vision';
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
import { type HouseRule, MAX_RULE_EXTRA, type RuleProblem } from './houseRules';

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

/** A creature's resource points left: what it has spent down to, or full. */
export function resourceLeft(system: GameSystem, combatant: Combatant, resourceId: string): number {
  return combatant.resources?.[resourceId] ?? computeCreature(system, combatant.sheet).resources[resourceId] ?? 0;
}

/** The first resource an ability costs more of than the creature has, if any. */
function unaffordable(system: GameSystem, actor: Combatant, ability: AbilityDef): { name: string; cost: number; left: number } | null {
  for (const [id, cost] of Object.entries(ability.cost ?? {})) {
    const left = resourceLeft(system, actor, id);
    if (left < cost) return { name: system.resources?.find((resource) => resource.id === id)?.name ?? id, cost, left };
  }
  return null;
}

/** The natural roll of an attack: the kept die of its first dice term. */
function naturalRoll(dice: readonly { readonly dice: readonly { readonly value: number; readonly kept: boolean }[] }[]): number | null {
  return dice[0]?.dice.find((die) => die.kept)?.value ?? null;
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

/** The house rules in force for this action: the DM's, and any allowed just this once. */
function rulings(ctx: CombatContext): readonly HouseRule[] {
  return [...(ctx.houseRules ?? []), ...(ctx.overrules ?? [])];
}

const forAbility = (rule: { readonly ability: string | null }, abilityId: string) => rule.ability === null || rule.ability === abilityId;

function extraRange(ctx: CombatContext, abilityId: string): number {
  return rulings(ctx).reduce((total, rule) => (rule.kind === 'range' && forAbility(rule, abilityId) ? total + rule.extra : total), 0);
}

/** A condition stopping a creature acting or moving, unless a house rule lets it. */
function blockingCondition(ctx: CombatContext, combatant: Combatant, flag: 'preventsActions' | 'preventsMovement'): ConditionDef | undefined {
  const allows = flag === 'preventsActions' ? 'act' : 'move';
  return activeConditions(ctx.system, combatant).find(
    (condition) =>
      condition[flag] === true && !rulings(ctx).some((rule) => rule.kind === 'condition' && rule.condition === condition.id && rule.allows === allows),
  );
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
    // Speed, plus any house rule's extra movement (not this action's one-off rulings).
    const extra = (this.ctx.houseRules ?? []).reduce((total, rule) => (rule.kind === 'movement' ? total + rule.extra : total), 0);
    this.movementLeft = blockingCondition({ ...this.ctx, overrules: [] }, combatant, 'preventsMovement')
      ? 0
      : computeCreature(this.ctx.system, combatant.sheet).speed + extra;
    // Resources that refill each turn are full again.
    const refilled = (this.ctx.system.resources ?? []).filter((resource) => resource.refill === 'turn').map((resource) => resource.id);
    if (combatant.resources && refilled.some((resource) => resource in combatant.resources!)) {
      this.update(id, { resources: Object.fromEntries(Object.entries(combatant.resources).filter(([resource]) => !refilled.includes(resource))) });
    }
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
  const blocker = blockingCondition(ctx, actor, 'preventsMovement');
  if (blocker) violation(`${actor.sheet.name} is ${blocker.name} and can't move`);

  // Movement left, plus any allowed just this once.
  const budget = draft.movementLeft + oneOffMovement(ctx);
  const occupants = occupantsFor(draft.combatants, actorId);
  const path = findPath({ map: ctx.map, rules: ctx.system.movement, occupants }, actor.position, to, budget);
  if (!path) violation(`${actor.sheet.name} can't reach that tile this turn`);

  const steps = path.path;
  const facing = headingBetween(ctx.map.grid, steps[steps.length - 2] as CombatantSetup['position'], to);
  draft.update(actorId, { position: to, facing });
  draft.movementLeft = Math.max(0, budget - path.cost);
  draft.emit({ type: 'moved', combatantId: actorId, path: path.path, cost: path.cost });
}

/** Movement allowed just this once, on top of what's left. */
function oneOffMovement(ctx: CombatContext): number {
  return (ctx.overrules ?? []).reduce((total, rule) => (rule.kind === 'movement' ? total + rule.extra : total), 0);
}

/**
 * Everything wrong with aiming an ability at a target (nothing: it's
 * allowed), each with the house rule that would allow it, if a ruling can.
 */
function targetProblems(ctx: CombatContext, ability: AbilityDef, actor: Combatant, target: Combatant): RuleProblem[] {
  const problems: RuleProblem[] = [];
  const anyone = rulings(ctx).some((rule) => rule.kind === 'target' && rule.ability === ability.id);
  const anyTarget: HouseRule = { kind: 'target', ability: ability.id };
  switch (ability.target) {
    case 'self':
      if (target.sheet.id !== actor.sheet.id && !anyone) problems.push({ message: `${ability.name} can only target yourself`, fix: anyTarget });
      break;
    case 'enemy':
      if (target.side === actor.side && !anyone) problems.push({ message: `${ability.name} must target an enemy`, fix: anyTarget });
      if (!standing(target)) problems.push({ message: `${target.sheet.name} is already down`, fix: null });
      break;
    case 'ally':
      if (target.side !== actor.side && !anyone) problems.push({ message: `${ability.name} must target an ally`, fix: anyTarget });
      break;
  }
  const reach = ability.range + extraRange(ctx, ability.id);
  const distance = ctx.map.grid.distance(actor.position, target.position);
  if (distance > reach) {
    problems.push({
      message: `${target.sheet.name} is out of range for ${ability.name} (range ${reach})`,
      fix: { kind: 'range', ability: ability.id, extra: Math.min(MAX_RULE_EXTRA, distance - reach) },
    });
  }
  // Anything aimed at another creature needs a clear view of it (see shared/vision).
  const sightless = rulings(ctx).some((rule) => rule.kind === 'sight' && forAbility(rule, ability.id));
  if (target.sheet.id !== actor.sheet.id && !sightless && !hasLineOfSight(ctx.map, actor.position, target.position)) {
    problems.push({ message: `${target.sheet.name} is out of sight`, fix: { kind: 'sight', ability: ability.id } });
  }
  return problems;
}

function checkTarget(ctx: CombatContext, ability: AbilityDef, actor: Combatant, target: Combatant): void {
  const [problem] = targetProblems(ctx, ability, actor, target);
  if (problem) violation(problem.message);
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
  const blocker = blockingCondition(ctx, actor, 'preventsActions');
  if (blocker) violation(`${actor.sheet.name} is ${blocker.name} and can't act`);

  const ability = system.abilities.find((entry) => entry.id === abilityId) ?? violation(`Unknown ability "${abilityId}"`);
  if (!actor.sheet.abilities.includes(abilityId)) violation(`${actor.sheet.name} doesn't know ${ability.name}`);
  const target = draft.get(targetId);
  checkTarget(ctx, ability, actor, target);
  const short = unaffordable(system, actor, ability);
  if (short) violation(`${actor.sheet.name} doesn't have enough ${short.name} (${short.cost} needed, ${short.left} left)`);

  draft.actionUsed = true;
  // The cost is paid now, and reported after the attack roll (so the log reads: the attack, what it cost, what it did).
  const spent: CombatEvent[] = [];
  for (const [resource, amount] of Object.entries(ability.cost ?? {})) {
    const left = resourceLeft(system, draft.get(actorId), resource) - amount;
    draft.update(actorId, { resources: { ...draft.get(actorId).resources, [resource]: left } });
    spent.push({ type: 'resourceSpent', combatantId: actorId, resource, amount, left });
  }
  if (targetId !== actorId) draft.update(actorId, { facing: headingBetween(ctx.map.grid, actor.position, target.position) });
  draft.emit({ type: 'abilityUsed', actorId, abilityId, targetId, animation: ability.animation });

  const actorVars = computeCreature(system, actor.sheet).vars;
  let critical = false;
  if (ability.attack) {
    const attack = roll(ability.attack.roll, actorVars, random);
    const defense = computeCreature(system, target.sheet).defense;
    // A natural roll the system calls critical decides it, whatever the total.
    const natural = naturalRoll(attack.dice);
    const sure = natural === null ? undefined : system.critical?.miss !== undefined && natural <= system.critical.miss ? 'miss' : system.critical?.hit !== undefined && natural >= system.critical.hit ? 'hit' : undefined;
    const hit = sure ? sure === 'hit' : attack.value >= defense;
    critical = sure === 'hit';
    draft.emit({ type: 'attackRolled', actorId, targetId, total: attack.value, defense, hit, dice: attack.dice, ...(sure ? { critical: sure } : {}) });
    spent.forEach((event) => draft.emit(event));
    if (!hit) return;
  } else {
    spent.forEach((event) => draft.emit(event));
  }

  for (const effect of ability.effects) applyEffect(ctx, draft, effect, actorVars, targetId, random, critical);
  checkForEnd(ctx, draft);
}

function applyEffect(
  ctx: CombatContext,
  draft: Draft,
  effect: EffectDef,
  actorVars: Readonly<Record<string, number>>,
  targetId: string,
  random: RandomSource,
  critical = false,
): void {
  const target = draft.get(targetId);
  switch (effect.type) {
    case 'damage': {
      const first = roll(effect.amount, actorVars, random);
      // A critical hit rolls the damage dice again and adds them (not the bonuses).
      const again = critical ? roll(effect.amount, actorVars, random).dice : [];
      const value = first.value + again.reduce((total, term) => total + term.subtotal, 0);
      const dice = [...first.dice, ...again];
      const amount = Math.max(0, value);
      const hp = Math.max(0, target.hp - amount);
      draft.update(targetId, { hp });
      draft.emit({ type: 'damaged', targetId, amount, hp, dice, ...(critical ? { critical: true } : {}) });
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
    case 'restore': {
      const { value, dice } = roll(effect.amount, actorVars, random);
      const max = computeCreature(ctx.system, target.sheet).resources[effect.resource] ?? 0;
      const before = resourceLeft(ctx.system, target, effect.resource);
      const left = Math.min(max, before + Math.max(0, value));
      draft.update(targetId, { resources: { ...target.resources, [effect.resource]: left } });
      draft.emit({ type: 'resourceRestored', targetId, resource: effect.resource, amount: left - before, left, dice });
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
  if (!actor || state.movementLeft <= 0 || blockingCondition(ctx, actor, 'preventsMovement')) return new Map();
  const occupants = occupantsFor(state.combatants, actorId);
  return reachable({ map: ctx.map, rules: ctx.system.movement, occupants }, actor.position, state.movementLeft);
}

/** Creatures the ability can target right now (in setup order). */
export function targetOptions(ctx: CombatContext, state: CombatState, actorId: string, abilityId: string): string[] {
  const actor = canAct(state, actorId);
  if (!actor || state.actionUsed || blockingCondition(ctx, actor, 'preventsActions')) return [];
  const ability = ctx.system.abilities.find((entry) => entry.id === abilityId);
  if (!ability || !actor.sheet.abilities.includes(abilityId) || unaffordable(ctx.system, actor, ability)) return [];
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

/**
 * The tiles an ability reaches from where the creature stands: every
 * standable tile within its range. Its own tile counts only if it can be its
 * own target (an ally ability, or a self-only one, which reaches nothing else).
 * For showing an ability's range, so it ignores whose turn it is and whether
 * the action is spent; who can actually be targeted is `targetOptions`.
 */
export function abilityReach(ctx: CombatContext, state: CombatState, combatantId: string, abilityId: string): Cell[] {
  const creature = state.combatants[combatantId];
  const ability = ctx.system.abilities.find((entry) => entry.id === abilityId);
  if (!creature || !ability || !creature.sheet.abilities.includes(abilityId)) return [];
  if (ability.target === 'self') return [creature.position];
  const from = creature.position;
  return ctx.map.cells().filter((cell) => {
    if (cell.q === from.q && cell.r === from.r) return ability.target === 'ally';
    if (ctx.map.tile(cell)?.blocked) return false;
    return ctx.map.grid.distance(from, cell) <= ability.range + extraRange(ctx, ability.id);
  });
}

/** How far a path would have to go, ignoring movement left (null: there's no way there at all). */
const UNLIMITED = 10_000;

/**
 * Why an action isn't allowed, each problem with the house rule that would
 * allow it (none if no ruling can). Empty: it's allowed. For explaining a
 * refusal, and for the DM to overrule it.
 */
export function actionProblems(ctx: CombatContext, state: CombatState, action: CombatAction): RuleProblem[] {
  const actor = state.combatants[action.actorId];
  if (state.status !== 'active') return [{ message: 'The fight hasn\'t started', fix: null }];
  if (!actor) return [{ message: 'No such creature', fix: null }];
  if (state.order[state.turnIndex] !== action.actorId) return [{ message: `It is not ${actor.sheet.name}'s turn`, fix: null }];
  if (!standing(actor)) return [{ message: `${actor.sheet.name} is down`, fix: null }];

  if (action.type === 'endTurn') return [];
  if (action.type === 'move') {
    if (cellKey(actor.position) === cellKey(action.to)) return [{ message: `${actor.sheet.name} is already there`, fix: null }];
    const problems: RuleProblem[] = [];
    const blocker = blockingCondition(ctx, actor, 'preventsMovement');
    if (blocker) problems.push({ message: `${actor.sheet.name} is ${blocker.name} and can't move`, fix: { kind: 'condition', condition: blocker.id, allows: 'move' } });
    const occupants = occupantsFor(state.combatants, action.actorId);
    const path = findPath({ map: ctx.map, rules: ctx.system.movement, occupants }, actor.position, action.to, UNLIMITED);
    if (!path) return [...problems, { message: `${actor.sheet.name} can't get there`, fix: null }];
    // A creature a condition stopped has no movement this turn: it needs it all, just this once.
    const left = (blocker ? 0 : state.movementLeft) + oneOffMovement(ctx);
    if (path.cost > left) {
      const short = path.cost - left;
      problems.push({
        message: `${actor.sheet.name} can't reach that tile this turn (${path.cost} movement needed, ${left} left)`,
        fix: { kind: 'movement', extra: Math.min(MAX_RULE_EXTRA, short) },
        ...(blocker ? { nowOnly: true } : {}),
      });
    }
    return problems;
  }

  const problems: RuleProblem[] = [];
  if (state.actionUsed) problems.push({ message: `${actor.sheet.name} has already used an action this turn`, fix: null });
  const blocker = blockingCondition(ctx, actor, 'preventsActions');
  if (blocker) problems.push({ message: `${actor.sheet.name} is ${blocker.name} and can't act`, fix: { kind: 'condition', condition: blocker.id, allows: 'act' } });
  const ability = ctx.system.abilities.find((entry) => entry.id === action.abilityId);
  if (!ability) return [...problems, { message: `Unknown ability "${action.abilityId}"`, fix: null }];
  if (!actor.sheet.abilities.includes(ability.id)) problems.push({ message: `${actor.sheet.name} doesn't know ${ability.name}`, fix: null });
  const short = unaffordable(ctx.system, actor, ability);
  if (short) problems.push({ message: `${actor.sheet.name} doesn't have enough ${short.name} (${short.cost} needed, ${short.left} left)`, fix: null });
  const target = state.combatants[action.targetId];
  if (!target) return [...problems, { message: 'No such target', fix: null }];
  return [...problems, ...targetProblems(ctx, ability, actor, target)];
}
