import { cellKey, headingBetween } from '../grid';
import type { RandomSource } from '../random';
import { computeCreature } from '../system';
import {
  CombatSetupError,
  Draft,
  type StartOptions,
  RuleViolation,
  checkForEnd,
  roll,
  sidesStanding,
  standing,
  startCombat,
  validateSetups,
  violation,
} from './engine';
import type {
  ActionResult,
  CombatContext,
  CombatEvent,
  CombatState,
  Combatant,
  CombatantPatch,
  CombatantSetup,
} from './types';

/**
 * The DM's controls: set up an encounter, then add, remove, move, rename, and
 * edit creatures at any moment. They bypass the turn rules (the DM is in
 * charge) but keep the fight consistent: the turn order, whose turn it is,
 * and whether the fight is over.
 */

const MAX_NAME = 40;
type Cell = CombatantSetup['position'];

/** An empty encounter: the DM places creatures, then begins the fight. */
export function createEncounter(): CombatState {
  return {
    status: 'setup',
    winner: null,
    round: 0,
    order: [],
    turnIndex: 0,
    movementLeft: 0,
    actionUsed: false,
    combatants: {},
    initiative: {},
  };
}

function dmChange(ctx: CombatContext, state: CombatState, change: (draft: Draft) => void): ActionResult {
  try {
    const draft = new Draft(ctx, state);
    change(draft);
    return { ok: true, state: draft.toState(), events: draft.events };
  } catch (error) {
    if (error instanceof RuleViolation) return { ok: false, reason: error.message };
    throw error;
  }
}

/** A creature can stand on a cell that's on the map, not solid, and not taken by someone else. */
function checkStandable(ctx: CombatContext, draft: Draft, cell: Cell, except?: string): void {
  const tile = ctx.map.tile(cell);
  if (!tile) violation(`(${cell.q}, ${cell.r}) is off the map`);
  if (tile.blocked) violation(`(${cell.q}, ${cell.r}) is solid`);
  const taken = Object.entries(draft.combatants).find(
    ([id, other]) => id !== except && cellKey(other.position) === cellKey(cell),
  );
  if (taken) violation(`(${cell.q}, ${cell.r}) is occupied by ${taken[1].sheet.name}`);
}

function faceNearestEnemy(ctx: CombatContext, combatants: Readonly<Record<string, Combatant>>, self: Combatant): number {
  let nearest: Combatant | undefined;
  for (const other of Object.values(combatants)) {
    if (other.side === self.side || !standing(other)) continue;
    const grid = ctx.map.grid;
    if (!nearest || grid.distance(self.position, other.position) < grid.distance(self.position, nearest.position)) {
      nearest = other;
    }
  }
  return nearest ? headingBetween(ctx.map.grid, self.position, nearest.position) : self.facing;
}

/** After a DM change to who's standing: end the fight, or move on if the acting creature can't act. */
function settle(ctx: CombatContext, draft: Draft, actingRemoved = false): void {
  if (draft.status !== 'active') return;
  if (sidesStanding(Object.values(draft.combatants)).size < 2) {
    checkForEnd(ctx, draft);
    if (draft.status === 'active') {
      // Nobody is standing at all: the fight just stops.
      draft.status = 'ended';
      draft.winner = null;
    }
    return;
  }
  const actingId = draft.order[draft.turnIndex];
  const acting = actingId === undefined ? undefined : draft.combatants[actingId];
  if (actingRemoved || !acting || !standing(acting)) draft.advanceTurn();
}

export function dmAddCombatant(
  ctx: CombatContext,
  state: CombatState,
  setup: CombatantSetup,
  random: RandomSource,
): ActionResult {
  return dmChange(ctx, state, (draft) => {
    const id = setup.sheet.id;
    if (draft.combatants[id]) violation(`There is already a creature "${id}"`);
    checkStandable(ctx, draft, setup.position);
    try {
      validateSetups(ctx, [setup]);
    } catch (error) {
      if (error instanceof CombatSetupError) violation(error.message);
      throw error;
    }
    const combatant: Combatant = {
      sheet: setup.sheet,
      side: setup.side,
      position: setup.position,
      isPlayerCharacter: setup.isPlayerCharacter,
      xpValue: setup.xpValue ?? 0,
      hp: setup.hp ?? computeCreature(ctx.system, setup.sheet).maxHp,
      conditions: [],
      facing: setup.facing ?? 0,
    };
    draft.combatants[id] = { ...combatant, facing: setup.facing ?? faceNearestEnemy(ctx, draft.combatants, combatant) };
    draft.emit({ type: 'combatantAdded', combatantId: id });

    // In setup, or in a fight run in the DM's order (no initiative), newcomers go last.
    if (draft.status !== 'active' || Object.keys(draft.initiative).length === 0) {
      draft.order.push(id);
      return;
    }
    // Mid-fight: roll initiative and slot in after everyone with an equal or higher total.
    const { value, dice } = roll(ctx.system.initiative, computeCreature(ctx.system, setup.sheet).vars, random);
    draft.initiative[id] = value;
    let index = draft.order.findIndex((other) => (draft.initiative[other] ?? -Infinity) < value);
    if (index === -1) index = draft.order.length;
    draft.order.splice(index, 0, id);
    if (index <= draft.turnIndex) draft.turnIndex++;
    draft.emit({ type: 'initiativeRolled', combatantId: id, total: value, dice });
  });
}

/**
 * Sets the turn order (or, in setup, the order creatures are listed and act
 * in if the fight starts without initiative). Mid-fight the creature acting
 * keeps its turn; the round continues from its new place.
 */
export function dmReorderCombatants(state: CombatState, order: readonly string[]): ActionResult {
  const known = new Set(state.order);
  if (order.length !== state.order.length || new Set(order).size !== order.length || order.some((id) => !known.has(id))) {
    return { ok: false, reason: 'The new order must list every creature exactly once' };
  }
  const acting = state.order[state.turnIndex];
  const turnIndex = state.status === 'active' && acting !== undefined ? order.indexOf(acting) : state.turnIndex;
  return {
    ok: true,
    state: { ...state, order: [...order], turnIndex },
    events: [{ type: 'turnOrderChanged', order: [...order] }],
  };
}

export function dmRemoveCombatant(ctx: CombatContext, state: CombatState, id: string): ActionResult {
  return dmChange(ctx, state, (draft) => {
    const removed = draft.get(id);
    const index = draft.order.indexOf(id);
    delete draft.combatants[id];
    delete draft.initiative[id];
    if (index !== -1) draft.order.splice(index, 1);
    draft.emit({ type: 'combatantRemoved', combatantId: id, name: removed.sheet.name });
    if (draft.status !== 'active') return;
    const wasActing = index === draft.turnIndex;
    if (index !== -1 && index < draft.turnIndex) draft.turnIndex--;
    // advanceTurn steps forward from here: to whoever now fills the removed creature's place.
    if (wasActing) draft.turnIndex = index - 1;
    settle(ctx, draft, wasActing);
  });
}

export function dmPlaceCombatant(ctx: CombatContext, state: CombatState, id: string, to: Cell): ActionResult {
  return dmChange(ctx, state, (draft) => {
    draft.get(id);
    checkStandable(ctx, draft, to, id);
    draft.update(id, { position: to });
    draft.emit({ type: 'combatantPlaced', combatantId: id, to });
  });
}

export function dmRenameCombatant(state: CombatState, id: string, name: string): ActionResult {
  const combatant = state.combatants[id];
  if (!combatant) return { ok: false, reason: `No combatant "${id}"` };
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_NAME) return { ok: false, reason: `Names are 1 to ${MAX_NAME} characters` };
  const renamed = { ...combatant, sheet: { ...combatant.sheet, name: trimmed } };
  return {
    ok: true,
    state: { ...state, combatants: { ...state.combatants, [id]: renamed } },
    events: [{ type: 'combatantRenamed', combatantId: id, from: combatant.sheet.name, to: trimmed }],
  };
}

export function dmEditCombatant(ctx: CombatContext, state: CombatState, id: string, patch: CombatantPatch): ActionResult {
  return dmChange(ctx, state, (draft) => {
    const { system } = ctx;
    const before = draft.get(id);
    const changes: string[] = [];
    let sheet = before.sheet;

    if (patch.stats) {
      const stats = { ...sheet.stats };
      for (const [statId, value] of Object.entries(patch.stats)) {
        const stat = system.stats.find((entry) => entry.id === statId) ?? violation(`Unknown stat "${statId}"`);
        if (!Number.isInteger(value)) violation(`${stat.name} must be a whole number`);
        const old = sheet.stats[statId] ?? stat.default;
        if (old !== value) changes.push(`${stat.name} ${old} → ${value}`);
        stats[statId] = value;
      }
      sheet = { ...sheet, stats };
    }
    if (patch.xp !== undefined) {
      if (!Number.isInteger(patch.xp) || patch.xp < 0) violation('XP must be a whole number of at least 0');
      if (patch.xp !== sheet.xp) changes.push(`XP ${sheet.xp} → ${patch.xp}`);
      sheet = { ...sheet, xp: patch.xp };
    }
    if (patch.abilities) {
      for (const abilityId of patch.abilities) {
        if (!system.abilities.some((ability) => ability.id === abilityId)) violation(`Unknown ability "${abilityId}"`);
      }
      changes.push(`Abilities: ${patch.abilities.join(', ') || 'none'}`);
      sheet = { ...sheet, abilities: [...patch.abilities] };
    }

    let next: Combatant = { ...before, sheet };
    if (patch.side !== undefined) {
      const side = patch.side.trim();
      if (side.length < 1 || side.length > MAX_NAME) violation(`Side names are 1 to ${MAX_NAME} characters`);
      if (side !== before.side) changes.push(`Side ${before.side} → ${side}`);
      next = { ...next, side };
    }
    if (patch.isPlayerCharacter !== undefined && patch.isPlayerCharacter !== before.isPlayerCharacter) {
      changes.push(patch.isPlayerCharacter ? 'Now a player character' : 'No longer a player character');
      next = { ...next, isPlayerCharacter: patch.isPlayerCharacter };
    }
    if (patch.xpValue !== undefined) {
      if (!Number.isInteger(patch.xpValue) || patch.xpValue < 0) violation('XP value must be a whole number of at least 0');
      if (patch.xpValue !== before.xpValue) changes.push(`XP value ${before.xpValue} → ${patch.xpValue}`);
      next = { ...next, xpValue: patch.xpValue };
    }
    if (patch.conditions) {
      for (const condition of patch.conditions) {
        if (!system.conditions.some((entry) => entry.id === condition.id)) violation(`Unknown condition "${condition.id}"`);
        if (!Number.isInteger(condition.remainingRounds) || condition.remainingRounds < 1) {
          violation('A condition lasts a whole number of rounds, at least 1');
        }
      }
      changes.push(`Conditions: ${patch.conditions.map((condition) => condition.id).join(', ') || 'none'}`);
      next = { ...next, conditions: [...patch.conditions] };
    }

    let numbers: ReturnType<typeof computeCreature> | null = null;
    try {
      numbers = computeCreature(system, sheet);
    } catch (error) {
      violation(error instanceof Error ? error.message : String(error));
    }
    const maxHp = numbers.maxHp;
    if (patch.resources) {
      const resources = { ...next.resources };
      for (const [resourceId, value] of Object.entries(patch.resources)) {
        const resource = system.resources?.find((entry) => entry.id === resourceId) ?? violation(`Unknown resource "${resourceId}"`);
        const max = numbers.resources[resourceId] ?? 0;
        if (!Number.isInteger(value) || value < 0 || value > max) violation(`${resource.name} must be a whole number from 0 to ${max}`);
        const old = next.resources?.[resourceId] ?? max;
        if (old !== value) changes.push(`${resource.name} ${old} → ${value}`);
        resources[resourceId] = value;
      }
      next = { ...next, resources };
    }
    if (patch.hp !== undefined && (!Number.isInteger(patch.hp) || patch.hp < 0)) violation('HP must be a whole number of at least 0');
    const hp = Math.min(patch.hp ?? before.hp, maxHp);
    if (hp !== before.hp) changes.push(`HP ${before.hp} → ${hp}`);
    next = { ...next, hp };

    draft.update(id, next);
    if (changes.length > 0) draft.emit({ type: 'combatantEdited', combatantId: id, changes });
    if (before.hp > 0 && hp === 0) draft.emit({ type: 'downed', targetId: id });
    if (before.hp === 0 && hp > 0) draft.emit({ type: 'revived', targetId: id });
    settle(ctx, draft);
  });
}

/** Starts (or restarts, after one ends) the fight with the creatures placed: rolls initiative, round 1. */
export function beginFight(ctx: CombatContext, state: CombatState, random: RandomSource, options: StartOptions = {}): ActionResult {
  if (state.status === 'active') return { ok: false, reason: 'The fight is already on' };
  const setups: CombatantSetup[] = state.order.map((id) => {
    const combatant = state.combatants[id] as Combatant;
    return {
      sheet: combatant.sheet,
      side: combatant.side,
      position: combatant.position,
      isPlayerCharacter: combatant.isPlayerCharacter,
      xpValue: combatant.xpValue,
      hp: combatant.hp,
    };
  });
  let started: { state: CombatState; events: readonly CombatEvent[] };
  try {
    started = startCombat(ctx, setups, random, options);
  } catch (error) {
    if (error instanceof CombatSetupError) return { ok: false, reason: error.message };
    throw error;
  }
  // Keep the conditions the DM set up.
  const combatants = Object.fromEntries(
    Object.entries(started.state.combatants).map(([id, combatant]) => [
      id,
      { ...combatant, conditions: state.combatants[id]?.conditions ?? [] },
    ]),
  );
  return { ok: true, state: { ...started.state, combatants }, events: started.events };
}
