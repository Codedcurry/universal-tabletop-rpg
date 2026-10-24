import { describe, expect, it } from 'vitest';
import { type Cell, cellKey } from '../grid';
import { createWorldMap, rectangleTiles } from '../map';
import { scriptedRandom } from '../random';
import { skirmish } from '../system/samples/skirmish';
import {
  type CombatContext,
  type CombatState,
  type CombatantSetup,
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
