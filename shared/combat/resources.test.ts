import { describe, expect, it } from 'vitest';
import type { Cell } from '../grid';
import { createWorldMap, rectangleTiles } from '../map';
import { scriptedRandom } from '../random';
import { type GameSystem, computeCreature, fitCreatures, removeResource, renameEntryId, validateGameSystem } from '../system';
import { skirmish } from '../system/samples/skirmish';
import {
  type CombatAction,
  type CombatContext,
  type CombatState,
  type CombatantSetup,
  actionProblems,
  applyAction,
  describeCombatEvents,
  dmEditCombatant,
  setupFromMonster,
  startCombat,
  targetOptions,
} from './index';

// Resources (points abilities spend, refilled each turn or each fight, given
// back by restore effects) and critical hits and misses on the natural roll.

const system: GameSystem = {
  ...skirmish,
  resources: [
    { id: 'mana', name: 'Mana', max: '2 + @level', refill: 'fight' },
    { id: 'stamina', name: 'Stamina', max: '1', refill: 'turn' },
  ],
  critical: { hit: 20, miss: 1 },
  abilities: [
    ...skirmish.abilities,
    {
      id: 'firebolt',
      name: 'Firebolt',
      range: 6,
      target: 'enemy',
      attack: { roll: '1d20 + @dex_mod + @prof' },
      effects: [{ type: 'damage', amount: '2d6' }],
      animation: 'spell',
      cost: { mana: 2 },
    },
    { id: 'drink', name: 'Drink', range: 0, target: 'self', effects: [{ type: 'restore', resource: 'mana', amount: '1d4' }], animation: 'item' },
    { id: 'lunge', name: 'Lunge', range: 1, target: 'enemy', attack: { roll: '1d20' }, effects: [{ type: 'damage', amount: '1d8' }], animation: 'melee', cost: { stamina: 1 } },
    { id: 'sure', name: 'Sure Shot', range: 1, target: 'enemy', attack: { roll: '1d20 + 50' }, effects: [{ type: 'damage', amount: '1' }], animation: 'ranged' },
  ],
};

const c = (q: number, r: number): Cell => ({ q, r });
const ctx: CombatContext = {
  system,
  map: createWorldMap({ formatVersion: 1, grid: 'hex', tiles: rectangleTiles('hex', 7, 7).map((cell) => ({ ...cell, height: 0 })), walls: [] }),
};
const hero: CombatantSetup = {
  sheet: { id: 'hero', name: 'Hero', stats: { str: 16, dex: 12, con: 14 }, xp: 0, abilities: ['firebolt', 'drink', 'lunge', 'sure'] },
  side: 'party',
  position: c(2, 3),
  isPlayerCharacter: true,
};
const goblin = setupFromMonster(system, 'goblin', { id: 'goblin', side: 'monsters', position: c(3, 3) });

/** The hero's turn (initiative rolls favour the hero). */
const heroTurn = (): CombatState => startCombat(ctx, [hero, goblin], scriptedRandom([9, 4])).state;

function act(state: CombatState, action: CombatAction, rolls: number[] = []) {
  const random = scriptedRandom(rolls);
  const result = applyAction(ctx, state, action, random);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  expect(random.remaining()).toBe(0);
  return result;
}

const use = (abilityId: string, targetId = 'goblin'): CombatAction => ({ type: 'useAbility', actorId: 'hero', abilityId, targetId });
const endTurns = (state: CombatState) => act(act(state, { type: 'endTurn', actorId: 'hero' }).state, { type: 'endTurn', actorId: 'goblin' }).state;
const lines = (events: Parameters<typeof describeCombatEvents>[0]) =>
  describeCombatEvents(events, {
    nameOf: (id) => (id === 'hero' ? 'Hero' : 'Goblin'),
    abilityName: (id) => system.abilities.find((ability) => ability.id === id)?.name ?? id,
    conditionName: (id) => id,
    resourceName: (id) => system.resources?.find((resource) => resource.id === id)?.name ?? id,
  }).map((line) => line.text);

describe('resources', () => {
  it('works out each resource\'s maximum from its formula', () => {
    expect(computeCreature(system, hero.sheet).resources).toEqual({ mana: 3, stamina: 1 });
    expect(computeCreature(skirmish, hero.sheet).resources).toEqual({});
  });

  it('spends an ability\'s cost, and says so in the log', () => {
    // A 10 on the d20 (+1 dex, +2 prof) hits the goblin's 12; 2d6 rolls 3 and 4.
    const result = act(heroTurn(), use('firebolt'), [9, 2, 3]);
    expect(result.state.combatants.hero?.resources).toEqual({ mana: 1 });
    expect(result.events).toContainEqual({ type: 'resourceSpent', combatantId: 'hero', resource: 'mana', amount: 2, left: 1 });
    expect(lines(result.events)).toContain('Hero spends 2 Mana (1 left)');
  });

  it('refuses an ability the creature can\'t pay for, and no ruling changes that', () => {
    const state = endTurns(act(heroTurn(), use('firebolt'), [9, 2, 3]).state);
    // Mana refills only at the start of a fight: still 1.
    expect(state.combatants.hero?.resources?.mana).toBe(1);
    expect(actionProblems(ctx, state, use('firebolt'))).toEqual([{ message: "Hero doesn't have enough Mana (2 needed, 1 left)", fix: null }]);
    expect(applyAction(ctx, state, use('firebolt'), scriptedRandom([])).ok).toBe(false);
    // Nothing to aim it at, either.
    expect(targetOptions(ctx, state, 'hero', 'firebolt')).toEqual([]);
  });

  it('refills a per-turn resource at the start of each of the creature\'s turns', () => {
    const spent = act(heroTurn(), use('lunge'), [9]).state; // a miss: still paid for
    expect(spent.combatants.hero?.resources?.stamina).toBe(0);
    expect(endTurns(spent).combatants.hero?.resources).toEqual({});
  });

  it('gives points back with a restore effect, up to the maximum', () => {
    const low = act(heroTurn(), use('firebolt'), [9, 2, 3]).state; // 1 mana left
    const next = endTurns(low);
    const result = act(next, use('drink', 'hero'), [3]); // 1d4 rolls 4: only 2 fit
    expect(result.state.combatants.hero?.resources?.mana).toBe(3);
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'resourceRestored', targetId: 'hero', resource: 'mana', amount: 2, left: 3 }));
    expect(lines(result.events)).toContain('Hero regains 2 Mana (3)');
  });

  it('lets the DM set a creature\'s points, within the maximum', () => {
    const result = dmEditCombatant(ctx, heroTurn(), 'hero', { resources: { mana: 0 } });
    expect(result.ok && result.state.combatants.hero?.resources).toEqual({ mana: 0 });
    expect(result.ok && result.events).toContainEqual({ type: 'combatantEdited', combatantId: 'hero', changes: ['Mana 3 → 0'] });
    expect(dmEditCombatant(ctx, heroTurn(), 'hero', { resources: { mana: 9 } })).toMatchObject({ ok: false, reason: 'Mana must be a whole number from 0 to 3' });
  });
});

describe('critical hits and misses', () => {
  it('a natural 20 always hits and rolls the damage dice twice', () => {
    const result = act(heroTurn(), use('lunge'), [19, 2, 4]); // 1d8: 3, then 5 again
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'attackRolled', hit: true, critical: 'hit' }));
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'damaged', amount: 8, critical: true }));
    expect(lines(result.events)[0]).toMatch(/critical hit!$/);
  });

  it('a natural 1 always misses, however big the bonus', () => {
    const result = act(heroTurn(), use('sure'), [0]);
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'attackRolled', total: 51, hit: false, critical: 'miss' }));
    expect(lines(result.events)[0]).toMatch(/critical miss$/);
  });

  it('reads the kept die, so rolling two and keeping the higher can crit', () => {
    const kept: GameSystem = { ...system, abilities: system.abilities.map((ability) => (ability.id === 'lunge' ? { ...ability, attack: { roll: '2d20kh1' } } : ability)) };
    const keptCtx = { ...ctx, system: kept };
    const state = startCombat(keptCtx, [hero, goblin], scriptedRandom([9, 4])).state;
    const result = applyAction(keptCtx, state, use('lunge'), scriptedRandom([3, 19, 0, 0]));
    expect(result.ok && result.events).toContainEqual(expect.objectContaining({ type: 'attackRolled', critical: 'hit' }));
  });

  it('has no criticals in a system without them', () => {
    const plain = { ...ctx, system: { ...system, critical: undefined } as unknown as GameSystem };
    const result = applyAction(plain, startCombat(plain, [hero, goblin], scriptedRandom([9, 4])).state, use('sure'), scriptedRandom([0]));
    expect(result.ok && result.events).toContainEqual(expect.objectContaining({ type: 'attackRolled', hit: true }));
  });
});

describe('the format', () => {
  it('checks resources, costs, restore effects, and criticals', () => {
    expect(validateGameSystem(system).ok).toBe(true);
    const problems = (changed: object) => {
      const result = validateGameSystem({ ...system, ...changed });
      return result.ok ? [] : result.errors.map((error) => `${error.path}: ${error.message}`);
    };
    expect(problems({ resources: [{ id: 'mana', name: 'Mana', max: '1d4', refill: 'week' }] })).toEqual(
      expect.arrayContaining(['resources[0].max: Must not roll dice', 'resources[0].refill: Must be turn or fight']),
    );
    expect(problems({ abilities: [{ ...system.abilities.at(-4)!, cost: { gold: 1 } }] })).toContain('abilities[0].cost.gold: Unknown resource "gold"');
    expect(problems({ critical: { hit: 2, miss: 2 } })).toContain('critical.miss: Must be lower than the critical hit roll');
    expect(problems({ resources: [] })).toEqual(expect.arrayContaining(['abilities[6].effects[0].resource: Unknown resource "mana"']));
  });

  it('removing or renaming a resource follows into costs and restore effects', () => {
    const without = removeResource(system, 'mana');
    expect(without.abilities.find((ability) => ability.id === 'firebolt')).not.toHaveProperty('cost');
    expect(without.abilities.find((ability) => ability.id === 'drink')?.effects).toEqual([]);
    const renamed = renameEntryId(system, 'resource', 'mana', 'focus');
    expect(renamed.abilities.find((ability) => ability.id === 'firebolt')?.cost).toEqual({ focus: 2 });
    expect(renamed.abilities.find((ability) => ability.id === 'drink')?.effects[0]).toEqual({ type: 'restore', resource: 'focus', amount: '1d4' });
    expect(validateGameSystem(renamed).ok).toBe(true);
  });

  it('fits creatures in play: points in resources the rules dropped go, the rest stay within the new maximum', () => {
    const creatures = { hero: { sheet: hero.sheet, hp: 5, conditions: [], resources: { mana: 3, stamina: 1 } } };
    const fewer = { ...removeResource(system, 'stamina'), resources: [{ id: 'mana', name: 'Mana', max: '1', refill: 'fight' as const }] };
    expect(fitCreatures(creatures, fewer).creatures.hero?.resources).toEqual({ mana: 1 });
  });
});
