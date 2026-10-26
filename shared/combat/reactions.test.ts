import { describe, expect, it } from 'vitest';
import type { Cell } from '../grid';
import { createWorldMap, rectangleTiles } from '../map';
import { scriptedRandom } from '../random';
import { type GameSystem, validateGameSystem } from '../system';
import { skirmish } from '../system/samples/skirmish';
import {
  type CombatAction,
  type CombatContext,
  type CombatState,
  type CombatantSetup,
  actionProblems,
  applyAction,
  describeCombatEvents,
  setupFromMonster,
  startCombat,
  targetOptions,
} from './index';

// Reactions: on someone else's turn, when an enemy leaves its reach (an
// attack of opportunity) or an attack would hit it (a shield, a riposte).
// The fight waits for the reacting creature, once a round each.

const system: GameSystem = {
  ...skirmish,
  abilities: [
    ...skirmish.abilities,
    {
      id: 'opportunity',
      name: 'Opportunity Attack',
      range: 1,
      target: 'enemy',
      attack: { roll: '1d20 + @str_mod + @prof' },
      effects: [{ type: 'damage', amount: '1d8 + @str_mod' }],
      animation: 'melee',
      reaction: { trigger: 'enemyLeaves' },
    },
    { id: 'shield', name: 'Shield', range: 0, target: 'self', effects: [], animation: 'item', reaction: { trigger: 'attacked', defense: 5 } },
    { id: 'riposte', name: 'Riposte', range: 1, target: 'enemy', attack: { roll: '1d20 + 10' }, effects: [{ type: 'damage', amount: '1' }], animation: 'melee', reaction: { trigger: 'attacked' } },
  ],
};

const c = (q: number, r: number): Cell => ({ q, r });
const ctx: CombatContext = {
  system,
  map: createWorldMap({ formatVersion: 1, grid: 'hex', tiles: rectangleTiles('hex', 7, 7).map((cell) => ({ ...cell, height: 0 })), walls: [] }),
};

// Hero: dex 12 -> defense 11, 10 HP. Goblin: str 8 (-1), prof 2, defense 12.
const hero = (abilities: string[] = ['strike']): CombatantSetup => ({
  sheet: { id: 'hero', name: 'Hero', stats: { str: 16, dex: 12, con: 14 }, xp: 0, abilities },
  side: 'party',
  position: c(2, 3),
  isPlayerCharacter: true,
});
const goblin = (abilities: string[] = ['strike']): CombatantSetup => {
  const setup = setupFromMonster(system, 'goblin', { id: 'goblin', side: 'monsters', position: c(3, 3) });
  return { ...setup, sheet: { ...setup.sheet, abilities } };
};

/** The hero's turn first (initiative rolls favour the hero). */
const fight = (setups: CombatantSetup[]): CombatState => startCombat(ctx, setups, scriptedRandom([9, 4])).state;

function act(state: CombatState, action: CombatAction, rolls: number[] = []) {
  const random = scriptedRandom(rolls);
  const result = applyAction(ctx, state, action, random);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  expect(random.remaining()).toBe(0);
  return result;
}

const lines = (events: Parameters<typeof describeCombatEvents>[0]) =>
  describeCombatEvents(events, {
    nameOf: (id) => (id === 'hero' ? 'Hero' : 'Goblin'),
    abilityName: (id) => system.abilities.find((ability) => ability.id === id)?.name ?? id,
    conditionName: (id) => id,
  }).map((line) => line.text);

describe('attacks of opportunity', () => {
  const leave: CombatAction = { type: 'move', actorId: 'hero', to: c(1, 3) }; // out of the goblin's reach

  it('a creature leaving an enemy\'s reach gives it a reaction; the fight waits for it', () => {
    const moved = act(fight([hero(), goblin(['strike', 'opportunity'])]), leave);
    expect(moved.state.pending).toEqual({ trigger: 'enemyLeaves', triggerId: 'hero', options: [{ reactorId: 'goblin', abilityIds: ['opportunity'] }] });
    expect(lines(moved.events)).toContain('Goblin can react to Hero leaving');
    // Nothing else happens meanwhile, not even the hero ending its turn.
    expect(applyAction(ctx, moved.state, { type: 'endTurn', actorId: 'hero' }, scriptedRandom([]))).toEqual({ ok: false, reason: 'Waiting for Goblin to react' });
    expect(actionProblems(ctx, moved.state, { type: 'endTurn', actorId: 'hero' })).toEqual([{ message: 'Waiting for Goblin to react', fix: null }]);
    expect(actionProblems(ctx, moved.state, { type: 'pass', actorId: 'goblin' })).toEqual([]);
  });

  it('the enemy strikes as it leaves, and uses up its reaction until its turn', () => {
    const moved = act(fight([hero(), goblin(['strike', 'opportunity'])]), leave).state;
    // d20 rolls 20 (+1): a hit; 1d8 rolls 5 (-1): 4 damage.
    const reacted = act(moved, { type: 'react', actorId: 'goblin', abilityId: 'opportunity' }, [19, 4]);
    expect(reacted.state.pending).toBeUndefined();
    expect(reacted.state.combatants.hero?.hp).toBe(6);
    expect(reacted.state.combatants.goblin?.reactionUsed).toBe(true);
    expect(lines(reacted.events)[0]).toBe('Goblin reacts: Opportunity Attack');
    // Spent: leaving its reach again this round gives nothing.
    const back = act(reacted.state, { type: 'move', actorId: 'hero', to: c(2, 3) }).state;
    expect(act(back, leave).state.pending).toBeUndefined();
    // It comes back at the start of the goblin's turn.
    expect(act(back, { type: 'endTurn', actorId: 'hero' }).state.combatants.goblin?.reactionUsed).toBe(false);
  });

  it('the enemy can let it go', () => {
    const moved = act(fight([hero(), goblin(['strike', 'opportunity'])]), leave).state;
    const passed = act(moved, { type: 'pass', actorId: 'goblin' });
    expect(passed.state.pending).toBeUndefined();
    expect(passed.state.combatants.hero?.hp).toBe(10);
    expect(lines(passed.events)).toEqual(["Goblin doesn't react"]);
  });

  it('only the one who may react can answer, with what it was offered', () => {
    const moved = act(fight([hero(), goblin(['strike', 'opportunity'])]), leave).state;
    expect(applyAction(ctx, moved, { type: 'pass', actorId: 'hero' }, scriptedRandom([])).ok).toBe(false);
    expect(applyAction(ctx, moved, { type: 'react', actorId: 'goblin', abilityId: 'strike' }, scriptedRandom([]))).toEqual({ ok: false, reason: "Goblin can't react with that" });
  });

  it('nothing to react to: no reaction, or moving within reach', () => {
    expect(act(fight([hero(), goblin()]), leave).state.pending).toBeUndefined();
    expect(act(fight([hero(), goblin(['opportunity'])]), { type: 'move', actorId: 'hero', to: c(3, 2) }).state.pending).toBeUndefined();
    expect(applyAction(ctx, fight([hero(), goblin()]), { type: 'pass', actorId: 'goblin' }, scriptedRandom([]))).toEqual({ ok: false, reason: 'There is nothing to react to' });
  });
});

describe('reacting to an attack', () => {
  /** The goblin's turn: its Strike (1d20 + 1) at the hero (defense 11). */
  const goblinsTurn = (heroAbilities: string[]) => act(fight([hero(heroAbilities), goblin()]), { type: 'endTurn', actorId: 'hero' }).state;
  const strike: CombatAction = { type: 'useAbility', actorId: 'goblin', abilityId: 'strike', targetId: 'hero' };

  it('an attack that would hit waits for its target, who can raise its defense and turn it into a miss', () => {
    const swung = act(goblinsTurn(['strike', 'shield']), strike, [11]); // 12 + 1 = 13: would hit
    expect(swung.state.pending).toMatchObject({ trigger: 'attacked', triggerId: 'goblin', options: [{ reactorId: 'hero', abilityIds: ['shield'] }], attack: { total: 13, defense: 11 } });
    expect(lines(swung.events)).toEqual(['Goblin uses Strike on Hero', "Hero can react to Goblin's attack"]);
    const shielded = act(swung.state, { type: 'react', actorId: 'hero', abilityId: 'shield' });
    expect(shielded.events).toContainEqual(expect.objectContaining({ type: 'attackRolled', total: 13, defense: 16, hit: false }));
    expect(shielded.state.combatants.hero?.hp).toBe(10);
    expect(lines(shielded.events)).toEqual(['Hero reacts: Shield (+5 defense)', 'Goblin attacks Hero: 13 vs defense 16, miss']);
  });

  it('not reacting lets the hit land', () => {
    const swung = act(goblinsTurn(['strike', 'shield']), strike, [11]).state;
    const hit = act(swung, { type: 'pass', actorId: 'hero' }, [3]); // 1d8 - 1: 3
    expect(hit.state.combatants.hero?.hp).toBe(7);
  });

  it('a riposte strikes back, then the attack lands', () => {
    const swung = act(goblinsTurn(['strike', 'riposte']), strike, [11]).state;
    const riposte = act(swung, { type: 'react', actorId: 'hero', abilityId: 'riposte' }, [1, 3]); // riposte 2 + 10 = 12 hits for 1; then the goblin's damage, 3
    expect(riposte.state.combatants.goblin?.hp).toBe(7);
    expect(riposte.state.combatants.hero?.hp).toBe(7);
  });

  it('an attack that misses anyway waits for nothing', () => {
    expect(act(goblinsTurn(['strike', 'shield']), strike, [1]).state.pending).toBeUndefined(); // 2 + 1 = 3
  });
});

describe('reactions in the format', () => {
  it('are only used as reactions, not as actions', () => {
    const state = fight([hero(['strike', 'shield', 'opportunity']), goblin()]);
    expect(targetOptions(ctx, state, 'hero', 'opportunity')).toEqual([]);
    expect(applyAction(ctx, state, { type: 'useAbility', actorId: 'hero', abilityId: 'opportunity', targetId: 'goblin' }, scriptedRandom([]))).toEqual({
      ok: false,
      reason: "Opportunity Attack is a reaction: it's used on someone else's turn",
    });
  });

  it('are checked: a trigger, and a defense bonus only for reacting to attacks', () => {
    expect(validateGameSystem(system).ok).toBe(true);
    const broken = validateGameSystem({
      ...system,
      abilities: [{ ...system.abilities.at(-3)!, reaction: { trigger: 'enemyLeaves', defense: 2 } }, { ...system.abilities.at(-2)!, reaction: { trigger: 'sneeze' } }],
    });
    expect(broken.ok ? [] : broken.errors.map((error) => `${error.path}: ${error.message}`)).toEqual(
      expect.arrayContaining(['abilities[0].reaction.defense: Only a reaction to being attacked can add to defense', 'abilities[1].reaction.trigger: Must be enemyLeaves or attacked']),
    );
  });
});
