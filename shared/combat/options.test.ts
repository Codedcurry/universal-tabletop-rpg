import { describe, expect, it } from 'vitest';
import { type Cell, cellKey } from '../grid';
import { createWorldMap, rectangleTiles } from '../map';
import { scriptedRandom } from '../random';
import { skirmish } from '../system/samples/skirmish';
import {
  type CombatContext,
  type CombatState,
  type CombatantSetup,
  abilityReach,
  applyAction,
  moveOptions,
  setupFromMonster,
  startCombat,
  targetOptions,
} from './index';

// What the active creature can do right now, for highlighting the map. The
// key promise: an option is offered exactly when the engine would accept it.

const c = (q: number, r: number): Cell => ({ q, r });

const ctx: CombatContext = {
  system: skirmish,
  map: createWorldMap({
    formatVersion: 1,
    grid: 'hex',
    tiles: rectangleTiles('hex', 9, 7).map((cell) => ({
      ...cell,
      height: cell.q === 5 && cell.r === 2 ? 4 : 0, // one cliff
      ...(cell.q === 4 && cell.r === 4 ? { blocked: true } : {}),
    })),
    walls: [[c(1, 3), c(1, 2)]],
  }),
};

const hero: CombatantSetup = {
  sheet: { id: 'hero', name: 'Hero', stats: { str: 16, dex: 12, con: 14 }, xp: 0, abilities: ['strike', 'shoot', 'mend', 'second_wind'] },
  side: 'party',
  position: c(2, 3),
  isPlayerCharacter: true,
};
const cleric: CombatantSetup = {
  sheet: { id: 'cleric', name: 'Cleric', stats: {}, xp: 0, abilities: ['mend'] },
  side: 'party',
  position: c(1, 4),
  isPlayerCharacter: true,
  hp: 2,
};

function fight(): CombatState {
  const setups = [
    hero,
    cleric,
    setupFromMonster(skirmish, 'goblin', { id: 'near', side: 'monsters', position: c(3, 3) }),
    setupFromMonster(skirmish, 'goblin', { id: 'far', side: 'monsters', position: c(6, 1) }),
    { ...setupFromMonster(skirmish, 'goblin', { id: 'down', side: 'monsters', position: c(2, 5) }), hp: 0 },
  ];
  // The hero rolls highest, so it's the hero's turn.
  return startCombat(ctx, setups, scriptedRandom([19, 0, 0, 0, 0])).state;
}

const accepted = (state: CombatState, action: Parameters<typeof applyAction>[2]) =>
  applyAction(ctx, state, action, scriptedRandom(new Array(20).fill(0))).ok;

describe('moveOptions', () => {
  it("offers exactly the tiles the engine lets the hero move to", () => {
    const state = fight();
    const options = moveOptions(ctx, state, 'hero');
    expect(options.size).toBeGreaterThan(5);
    for (const cell of ctx.map.cells()) {
      const offered = options.has(cellKey(cell));
      const ok = cellKey(cell) !== cellKey(c(2, 3)) && accepted(state, { type: 'move', actorId: 'hero', to: cell });
      expect(offered, `(${cell.q}, ${cell.r})`).toBe(ok);
    }
  });

  it('gives the path and cost to each tile', () => {
    const option = moveOptions(ctx, fight(), 'hero').get(cellKey(c(1, 3)));
    expect(option?.cost).toBe(1);
    expect(option?.path).toEqual([c(2, 3), c(1, 3)]);
  });

  it('offers nothing to a creature that is not taking its turn, or has no movement left', () => {
    const state = fight();
    expect(moveOptions(ctx, state, 'cleric').size).toBe(0);
    expect(moveOptions(ctx, { ...state, movementLeft: 0 }, 'hero').size).toBe(0);
  });
});

describe('targetOptions', () => {
  it.each(['strike', 'shoot', 'mend', 'second_wind'])('offers exactly the creatures %s may target', (abilityId) => {
    const state = fight();
    const options = targetOptions(ctx, state, 'hero', abilityId);
    for (const targetId of Object.keys(state.combatants)) {
      const ok = accepted(state, { type: 'useAbility', actorId: 'hero', abilityId, targetId });
      expect(options.includes(targetId), `${abilityId} -> ${targetId}`).toBe(ok);
    }
  });

  it('reaches further with a ranged ability', () => {
    const state = fight();
    expect(targetOptions(ctx, state, 'hero', 'strike')).toEqual(['near']);
    expect(targetOptions(ctx, state, 'hero', 'shoot')).toEqual(['near', 'far']);
  });

  it('offers nothing once the action is used, or for an unknown ability', () => {
    const state = fight();
    expect(targetOptions(ctx, { ...state, actionUsed: true }, 'hero', 'strike')).toEqual([]);
    expect(targetOptions(ctx, state, 'hero', 'fireball')).toEqual([]);
  });
});

describe('abilityReach', () => {
  const keys = (cells: readonly Cell[]) => cells.map(cellKey).sort();
  const grid = ctx.map.grid;

  it('covers every tile within range, except the user\'s own and solid ones', () => {
    const reach = abilityReach(ctx, fight(), 'hero', 'shoot'); // range 6
    expect(reach.length).toBeGreaterThan(20);
    for (const cell of reach) {
      expect(grid.distance(c(2, 3), cell)).toBeLessThanOrEqual(6);
      expect(ctx.map.tile(cell)).toBeDefined();
    }
    expect(keys(reach)).not.toContain('2,3');
    expect(keys(reach)).not.toContain('4,4'); // solid
    expect(keys(reach)).toContain('6,1'); // the far goblin
  });

  it('is just the neighbors for a melee attack', () => {
    const reach = abilityReach(ctx, fight(), 'hero', 'strike'); // range 1
    expect(reach.every((cell) => grid.distance(c(2, 3), cell) === 1)).toBe(true);
    expect(reach).toHaveLength(6);
  });

  it('is the user\'s own tile for a self-only ability', () => {
    expect(abilityReach(ctx, fight(), 'hero', 'second_wind')).toEqual([c(2, 3)]);
  });

  it('holds every creature the ability can target', () => {
    const state = fight();
    for (const ability of ['strike', 'shoot', 'mend', 'second_wind']) {
      const reach = new Set(keys(abilityReach(ctx, state, 'hero', ability)));
      for (const id of targetOptions(ctx, state, 'hero', ability)) {
        expect(reach.has(cellKey(state.combatants[id]!.position))).toBe(true);
      }
    }
  });

  it("can be previewed any time, even when it isn't the creature's turn or its action is spent", () => {
    const state = fight();
    expect(abilityReach(ctx, state, 'cleric', 'mend').length).toBeGreaterThan(0);
    const spent = applyAction(ctx, state, { type: 'useAbility', actorId: 'hero', abilityId: 'strike', targetId: 'near' }, scriptedRandom([10, 3]));
    if (!spent.ok) throw new Error(spent.reason);
    expect(abilityReach(ctx, spent.state, 'hero', 'shoot').length).toBeGreaterThan(20);
  });

  it('is empty for an ability the creature lacks', () => {
    expect(abilityReach(ctx, fight(), 'cleric', 'shoot')).toEqual([]);
  });
});
