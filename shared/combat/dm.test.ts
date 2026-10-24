import { describe, expect, it } from 'vitest';
import { type Cell } from '../grid';
import { createWorldMap, rectangleTiles } from '../map';
import { scriptedRandom } from '../random';
import type { CreatureSheet } from '../system';
import { skirmish } from '../system/samples/skirmish';
import {
  type ActionResult,
  type CombatContext,
  type CombatState,
  type CombatantSetup,
  applyAction,
  beginFight,
  createEncounter,
  dmAddCombatant,
  dmEditCombatant,
  dmPlaceCombatant,
  dmRemoveCombatant,
  dmRenameCombatant,
  dmReorderCombatants,
  setupFromMonster,
} from './index';

// The DM's controls over an encounter: place creatures before the fight,
// add, remove, move, rename, and edit them at any moment.

const c = (q: number, r: number): Cell => ({ q, r });
const ctx: CombatContext = {
  system: skirmish,
  map: createWorldMap({
    formatVersion: 1,
    grid: 'hex',
    tiles: rectangleTiles('hex', 8, 6).map((cell) => ({ ...cell, height: 0, ...(cell.q === 5 && cell.r === 5 ? { blocked: true } : {}) })),
    walls: [],
  }),
};

const heroSheet: CreatureSheet = { id: 'hero', name: 'Hero', stats: { str: 16, dex: 12, con: 14 }, xp: 0, abilities: ['strike'] };
const hero = (position = c(1, 2)): CombatantSetup => ({ sheet: heroSheet, side: 'party', position, isPlayerCharacter: true });
const goblin = (id: string, position: Cell): CombatantSetup => setupFromMonster(skirmish, 'goblin', { id, side: 'monsters', position, name: id });

function ok(result: ActionResult): { state: CombatState; events: ActionResult extends infer R ? R extends { events: infer E } ? E : never : never } {
  if (!result.ok) throw new Error(`rejected: ${result.reason}`);
  return result;
}
const reason = (result: ActionResult) => (result.ok ? null : result.reason);
const types = (events: readonly { type: string }[]) => events.map((event) => event.type);

/** Hero and two goblins placed in setup. */
function staged(): CombatState {
  let state = createEncounter();
  state = ok(dmAddCombatant(ctx, state, hero(), scriptedRandom([]))).state;
  state = ok(dmAddCombatant(ctx, state, goblin('g1', c(4, 2)), scriptedRandom([]))).state;
  return ok(dmAddCombatant(ctx, state, goblin('g2', c(5, 3)), scriptedRandom([]))).state;
}

/** Staged, then the fight begun: hero 1d20=10+1, g1 1d20=5+2, g2 1d20=20+2. Order g2, hero, g1. */
function fighting(): CombatState {
  return ok(beginFight(ctx, staged(), scriptedRandom([9, 4, 19]))).state;
}

describe('setting up an encounter', () => {
  it('starts empty, before the fight', () => {
    const state = createEncounter();
    expect(state.status).toBe('setup');
    expect(state.order).toEqual([]);
    expect(state.round).toBe(0);
  });

  it('places creatures without rolling anything', () => {
    let state = createEncounter();
    const result = ok(dmAddCombatant(ctx, state, hero(), scriptedRandom([])));
    state = result.state;
    expect(state.combatants.hero?.position).toEqual(c(1, 2));
    expect(state.combatants.hero?.hp).toBe(10);
    expect(state.order).toEqual(['hero']);
    expect(types(result.events)).toEqual(['combatantAdded']);
  });

  it.each<[string, CombatantSetup]>([
    ['a taken id', { ...goblin('hero', c(3, 3)) }],
    ['an occupied tile', goblin('g9', c(1, 2))],
    ['a solid tile', goblin('g9', c(5, 5))],
    ['a cell off the map', goblin('g9', c(40, 40))],
  ])('refuses %s', (_name, setup) => {
    const state = ok(dmAddCombatant(ctx, createEncounter(), hero(), scriptedRandom([]))).state;
    expect(reason(dmAddCombatant(ctx, state, setup, scriptedRandom([])))).not.toBeNull();
  });

  it("doesn't let anyone act before the fight starts", () => {
    expect(reason(applyAction(ctx, staged(), { type: 'endTurn', actorId: 'hero' }, scriptedRandom([])))).toMatch(/started/i);
  });
});

describe('beginning the fight', () => {
  it('rolls initiative for everyone placed and starts round 1', () => {
    const result = ok(beginFight(ctx, staged(), scriptedRandom([9, 4, 19])));
    expect(result.state.status).toBe('active');
    expect(result.state.round).toBe(1);
    expect(result.state.order).toEqual(['g2', 'hero', 'g1']);
    expect(result.state.initiative).toEqual({ hero: 11, g1: 7, g2: 22 });
    expect(types(result.events)).toEqual([
      'initiativeRolled',
      'initiativeRolled',
      'initiativeRolled',
      'combatStarted',
      'roundStarted',
      'turnStarted',
    ]);
  });

  it('keeps what the DM set up: HP and conditions', () => {
    let state = staged();
    state = ok(dmEditCombatant(ctx, state, 'g1', { hp: 3, conditions: [{ id: 'rooted', remainingRounds: 2 }] })).state;
    const begun = ok(beginFight(ctx, state, scriptedRandom([9, 4, 19]))).state;
    expect(begun.combatants.g1?.hp).toBe(3);
    expect(begun.combatants.g1?.conditions).toEqual([{ id: 'rooted', remainingRounds: 2 }]);
  });

  it('needs creatures on two sides', () => {
    const onlyHero = ok(dmAddCombatant(ctx, createEncounter(), hero(), scriptedRandom([]))).state;
    expect(reason(beginFight(ctx, onlyHero, scriptedRandom([9])))).toMatch(/two sides/i);
  });

  it('can start again after a fight ends, with whoever is still on the map', () => {
    let state = fighting();
    state = ok(dmRemoveCombatant(ctx, state, 'hero')).state;
    expect(state.status).toBe('ended');
    state = ok(dmAddCombatant(ctx, state, hero(c(0, 0)), scriptedRandom([]))).state;
    const again = ok(beginFight(ctx, state, scriptedRandom([0, 0, 0])));
    expect(again.state.status).toBe('active');
    expect(again.state.round).toBe(1);
  });
});

describe('adding during a fight', () => {
  it('rolls initiative for the newcomer and slots it in, keeping the current turn', () => {
    const state = fighting(); // order g2 (22), hero (11), g1 (7); g2's turn
    const result = ok(dmAddCombatant(ctx, state, goblin('g3', c(6, 1)), scriptedRandom([14])));
    // g3 rolls 15 + 2 = 17: after g2, before hero.
    expect(result.state.order).toEqual(['g2', 'g3', 'hero', 'g1']);
    expect(result.state.order[result.state.turnIndex]).toBe('g2');
    expect(result.state.initiative.g3).toBe(17);
    expect(types(result.events)).toEqual(['combatantAdded', 'initiativeRolled']);
  });

  it('goes after creatures that tied with it', () => {
    const state = fighting();
    const result = ok(dmAddCombatant(ctx, state, goblin('g3', c(6, 1)), scriptedRandom([8]))); // 9 + 2 = 11, ties hero
    expect(result.state.order).toEqual(['g2', 'hero', 'g3', 'g1']);
  });

  it("doesn't take the current creature's turn when slotted in ahead of it", () => {
    let state = fighting();
    state = ok(applyAction(ctx, state, { type: 'endTurn', actorId: 'g2' }, scriptedRandom([]))).state; // hero's turn
    const result = ok(dmAddCombatant(ctx, state, goblin('g3', c(6, 1)), scriptedRandom([19]))); // 22: top of the order
    expect(result.state.order[result.state.turnIndex]).toBe('hero');
  });
});

describe('removing', () => {
  it('keeps the same creature acting when someone else is removed', () => {
    let state = fighting();
    state = ok(applyAction(ctx, state, { type: 'endTurn', actorId: 'g2' }, scriptedRandom([]))).state; // hero's turn
    const result = ok(dmRemoveCombatant(ctx, state, 'g2'));
    expect(result.state.order).toEqual(['hero', 'g1']);
    expect(result.state.order[result.state.turnIndex]).toBe('hero');
    expect(result.state.combatants.g2).toBeUndefined();
    expect(types(result.events)).toEqual(['combatantRemoved']);
  });

  it("starts the next creature's turn when the one acting is removed", () => {
    const result = ok(dmRemoveCombatant(ctx, fighting(), 'g2')); // g2 was acting
    expect(result.state.order[result.state.turnIndex]).toBe('hero');
    expect(types(result.events)).toEqual(['combatantRemoved', 'turnStarted']);
  });

  it('ends the fight, with no XP, when only one side is left', () => {
    let state = fighting();
    state = ok(dmRemoveCombatant(ctx, state, 'g1')).state;
    const result = ok(dmRemoveCombatant(ctx, state, 'g2'));
    expect(result.state.status).toBe('ended');
    expect(result.state.winner).toBe('party');
    expect(types(result.events)).toEqual(['combatantRemoved', 'combatEnded']);
  });

  it('refuses an unknown creature', () => {
    expect(reason(dmRemoveCombatant(ctx, fighting(), 'dragon'))).toMatch(/dragon/);
  });
});

describe('moving, renaming, editing', () => {
  it('moves a creature anywhere it can stand, ignoring movement rules', () => {
    const result = ok(dmPlaceCombatant(ctx, fighting(), 'hero', c(5, 4)));
    expect(result.state.combatants.hero?.position).toEqual(c(5, 4));
    expect(result.events).toEqual([{ type: 'combatantPlaced', combatantId: 'hero', to: c(5, 4) }]);
    expect(reason(dmPlaceCombatant(ctx, fighting(), 'hero', c(4, 2)))).toMatch(/occupied/i);
    expect(reason(dmPlaceCombatant(ctx, fighting(), 'hero', c(5, 5)))).not.toBeNull();
  });

  it('renames at any moment', () => {
    const result = ok(dmRenameCombatant(fighting(), 'g1', '  Grizzle '));
    expect(result.state.combatants.g1?.sheet.name).toBe('Grizzle');
    expect(result.events).toEqual([{ type: 'combatantRenamed', combatantId: 'g1', from: 'g1', to: 'Grizzle' }]);
    expect(reason(dmRenameCombatant(fighting(), 'g1', '   '))).not.toBeNull();
    expect(reason(dmRenameCombatant(fighting(), 'g1', 'x'.repeat(41)))).not.toBeNull();
  });

  it('edits stats, recomputing max HP and keeping HP within it', () => {
    const result = ok(dmEditCombatant(ctx, fighting(), 'hero', { stats: { con: 6 } })); // con mod -2: max HP 6
    expect(result.state.combatants.hero?.sheet.stats.con).toBe(6);
    expect(result.state.combatants.hero?.hp).toBe(6);
    expect(result.events).toEqual([
      { type: 'combatantEdited', combatantId: 'hero', changes: ['Constitution 14 → 6', 'HP 10 → 6'] },
    ]);
  });

  it('sets HP directly; dropping to 0 downs the creature and passes the turn on', () => {
    const result = ok(dmEditCombatant(ctx, fighting(), 'g2', { hp: 0 })); // g2 is acting
    expect(types(result.events)).toEqual(['combatantEdited', 'downed', 'turnStarted']);
    expect(result.state.order[result.state.turnIndex]).toBe('hero');
  });

  it('brings a downed creature back by raising its HP', () => {
    let state = ok(dmEditCombatant(ctx, fighting(), 'g1', { hp: 0 })).state;
    state = ok(dmEditCombatant(ctx, state, 'g1', { hp: 5 })).state;
    expect(state.combatants.g1?.hp).toBe(5);
  });

  it('changes XP (and level), side, and conditions', () => {
    const result = ok(
      dmEditCombatant(ctx, fighting(), 'hero', { xp: 300, conditions: [{ id: 'stunned', remainingRounds: 1 }] }),
    );
    expect(result.state.combatants.hero?.sheet.xp).toBe(300);
    expect(result.state.combatants.hero?.conditions).toEqual([{ id: 'stunned', remainingRounds: 1 }]);
    expect((result.events[0] as { changes: readonly string[] }).changes).toEqual(['XP 0 → 300', 'Conditions: stunned']);
  });

  it.each<[string, Parameters<typeof dmEditCombatant>[3]]>([
    ['an unknown stat', { stats: { wis: 3 } }],
    ['a fractional stat', { stats: { str: 1.5 } }],
    ['negative HP', { hp: -1 }],
    ['negative XP', { xp: -5 }],
    ['an unknown condition', { conditions: [{ id: 'frozen', remainingRounds: 1 }] }],
    ['an unknown ability', { abilities: ['fireball'] }],
  ])('refuses %s', (_name, patch) => {
    expect(reason(dmEditCombatant(ctx, fighting(), 'hero', patch))).not.toBeNull();
  });

  it('caps HP at the maximum', () => {
    expect(ok(dmEditCombatant(ctx, fighting(), 'hero', { hp: 99 })).state.combatants.hero?.hp).toBe(10);
  });

  it('works in setup too', () => {
    expect(ok(dmRenameCombatant(staged(), 'g1', 'Snik')).state.combatants.g1?.sheet.name).toBe('Snik');
  });
});

describe('reordering the turn order', () => {
  it('in setup, sets the order the creatures are listed in', () => {
    const result = ok(dmReorderCombatants(staged(), ['g2', 'hero', 'g1']));
    expect(result.state.order).toEqual(['g2', 'hero', 'g1']);
    expect(result.events).toEqual([{ type: 'turnOrderChanged', order: ['g2', 'hero', 'g1'] }]);
  });

  it('mid-fight, keeps the same creature acting', () => {
    const state = fighting(); // g2, hero, g1; g2's turn
    const result = ok(dmReorderCombatants(state, ['hero', 'g1', 'g2']));
    expect(result.state.order).toEqual(['hero', 'g1', 'g2']);
    expect(result.state.order[result.state.turnIndex]).toBe('g2');
    expect(result.state.round).toBe(1);
  });

  it.each<[string, string[]]>([
    ['a missing creature', ['g2', 'hero']],
    ['a creature twice', ['g2', 'hero', 'g2']],
    ['an unknown creature', ['g2', 'hero', 'dragon']],
  ])('refuses an order with %s', (_name, order) => {
    expect(reason(dmReorderCombatants(staged(), order))).not.toBeNull();
  });
});

describe('beginning the fight in the order listed', () => {
  it("rolls no initiative and keeps the DM's order", () => {
    const listed = ok(dmReorderCombatants(staged(), ['g1', 'hero', 'g2'])).state;
    const result = ok(beginFight(ctx, listed, scriptedRandom([]), { rollInitiative: false }));
    expect(result.state.order).toEqual(['g1', 'hero', 'g2']);
    expect(result.state.order[result.state.turnIndex]).toBe('g1');
    expect(types(result.events)).toEqual(['combatStarted', 'roundStarted', 'turnStarted']);
  });

  it('puts creatures added later at the end, without rolling', () => {
    const state = ok(beginFight(ctx, staged(), scriptedRandom([]), { rollInitiative: false })).state;
    const result = ok(dmAddCombatant(ctx, state, goblin('g3', c(6, 1)), scriptedRandom([])));
    expect(result.state.order).toEqual(['hero', 'g1', 'g2', 'g3']);
    expect(types(result.events)).toEqual(['combatantAdded']);
  });
});
