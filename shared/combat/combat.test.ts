import { describe, expect, it } from 'vitest';
import type { Cell } from '../grid';
import { createWorldMap, rectangleTiles } from '../map';
import { scriptedRandom } from '../random';
import type { CreatureSheet } from '../system';
import { skirmish } from '../system/samples/skirmish';
import {
  type CombatAction,
  type CombatContext,
  type CombatEvent,
  type CombatState,
  type CombatantSetup,
  CombatSetupError,
  activeCombatant,
  applyAction,
  setupFromMonster,
  startCombat,
} from './index';

// Numbers below come from the Skirmish sample system:
// - Hero: str 16 (+3), dex 12 (+1), con 14 (+2), prof 2 -> 10 HP, defense 11, strike +5 / 1d8+3
// - Cleric: dex 10 (+0), con 12 (+1) -> 9 HP, defense 10
// - Goblin: str 8 (-1), dex 14 (+2), con 10 -> 8 HP, defense 12, strike +1 / 1d8-1, shoot +4 / 1d6+2
// scriptedRandom values are 0-based: a d20 value of 9 rolls a 10.

const c = (q: number, r: number): Cell => ({ q, r });

const ctx: CombatContext = {
  system: skirmish,
  map: createWorldMap({
    formatVersion: 1,
    grid: 'hex',
    tiles: rectangleTiles('hex', 7, 7).map((cell) => ({ ...cell, height: 0 })),
    walls: [],
  }),
};

const heroSheet: CreatureSheet = {
  id: 'hero',
  name: 'Hero',
  stats: { str: 16, dex: 12, con: 14 },
  xp: 0,
  abilities: ['strike', 'bash', 'second_wind'],
};

const clericSheet: CreatureSheet = {
  id: 'cleric',
  name: 'Cleric',
  stats: { con: 12 },
  xp: 0,
  abilities: ['strike', 'mend'],
};

function hero(overrides: Partial<CombatantSetup> = {}): CombatantSetup {
  return { sheet: heroSheet, side: 'party', position: c(2, 3), isPlayerCharacter: true, ...overrides };
}

function cleric(overrides: Partial<CombatantSetup> = {}): CombatantSetup {
  return { sheet: clericSheet, side: 'party', position: c(1, 3), isPlayerCharacter: true, ...overrides };
}

function goblin(position: Cell = c(3, 3), id = 'goblin'): CombatantSetup {
  return setupFromMonster(skirmish, 'goblin', { id, side: 'monsters', position });
}

function start(setups: CombatantSetup[], rolls: number[]) {
  const random = scriptedRandom(rolls);
  const result = startCombat(ctx, setups, random);
  expect(random.remaining()).toBe(0);
  return result;
}

/** Applies an action that must succeed and must use exactly the scripted rolls. */
function act(state: CombatState, action: CombatAction, rolls: number[] = []) {
  const random = scriptedRandom(rolls);
  const result = applyAction(ctx, state, action, random);
  if (!result.ok) throw new Error(`action rejected: ${result.reason}`);
  expect(random.remaining()).toBe(0);
  return result;
}

function reject(state: CombatState, action: CombatAction): string {
  const result = applyAction(ctx, state, action, scriptedRandom([]));
  if (result.ok) throw new Error('expected the action to be rejected');
  return result.reason;
}

const types = (events: readonly CombatEvent[]) => events.map((event) => event.type);

describe('startCombat', () => {
  it('rolls initiative and gives the first turn to the highest', () => {
    const { state, events } = start([hero(), goblin()], [9, 4]);
    expect(events).toMatchObject([
      { type: 'initiativeRolled', combatantId: 'hero', total: 11 },
      { type: 'initiativeRolled', combatantId: 'goblin', total: 7 },
      { type: 'combatStarted', order: ['hero', 'goblin'] },
      { type: 'roundStarted', round: 1 },
      { type: 'turnStarted', combatantId: 'hero', round: 1 },
    ]);
    expect(state.status).toBe('active');
    expect(state.round).toBe(1);
    expect(activeCombatant(state)?.sheet.id).toBe('hero');
    expect(state.movementLeft).toBe(6);
    expect(state.actionUsed).toBe(false);
    expect(state.combatants.hero?.hp).toBe(10);
    expect(state.combatants.goblin?.hp).toBe(8);
  });

  it('records the initiative dice for the log', () => {
    const { events } = start([hero(), goblin()], [9, 4]);
    expect(events[0]).toMatchObject({ dice: [{ sides: 20, dice: [{ value: 10 }] }] });
  });

  it('can give the first turn to a monster', () => {
    const { state } = start([hero(), goblin()], [2, 15]);
    expect(state.order).toEqual(['goblin', 'hero']);
  });

  it('breaks initiative ties by setup order', () => {
    // Hero rolls 5 + 1 and goblin rolls 4 + 2: both 6.
    const heroFirst = start([hero(), goblin()], [4, 3]);
    expect(heroFirst.events.slice(0, 2).map((e) => (e.type === 'initiativeRolled' ? e.total : null))).toEqual([6, 6]);
    expect(heroFirst.state.order).toEqual(['hero', 'goblin']);
    expect(start([goblin(), hero()], [3, 4]).state.order).toEqual(['goblin', 'hero']);
  });

  it('can start with a creature already hurt', () => {
    expect(start([hero({ hp: 3 }), goblin()], [9, 4]).state.combatants.hero?.hp).toBe(3);
  });

  describe('rejects a bad setup', () => {
    it.each<[string, () => CombatantSetup[]]>([
      ['duplicate ids', () => [hero(), goblin(c(3, 3)), goblin(c(4, 3))]],
      ['a position outside the map', () => [hero({ position: c(20, 20) }), goblin()]],
      ['two creatures on one tile', () => [hero(), goblin(c(2, 3))]],
      ['an unknown ability', () => [hero({ sheet: { ...heroSheet, abilities: ['fireball'] } }), goblin()]],
      ['an unknown stat', () => [hero({ sheet: { ...heroSheet, stats: { wis: 3 } } }), goblin()]],
      ['only one side', () => [hero(), cleric()]],
      ['HP above the maximum', () => [hero({ hp: 11 }), goblin()]],
    ])('%s', (_name, setups) => {
      expect(() => startCombat(ctx, setups(), scriptedRandom([1, 1, 1]))).toThrow(CombatSetupError);
    });
  });
});

describe('turns', () => {
  it("only lets the creature whose turn it is act", () => {
    const { state } = start([hero(), goblin()], [9, 4]);
    expect(reject(state, { type: 'endTurn', actorId: 'goblin' })).toMatch(/turn/i);
    expect(reject(state, { type: 'endTurn', actorId: 'nobody' })).toMatch(/nobody/);
  });

  it('passes the turn along and starts a new round after the last creature', () => {
    const first = start([hero(), goblin()], [9, 4]);
    const second = act(first.state, { type: 'endTurn', actorId: 'hero' });
    expect(second.events).toMatchObject([
      { type: 'turnEnded', combatantId: 'hero' },
      { type: 'turnStarted', combatantId: 'goblin', round: 1 },
    ]);
    const third = act(second.state, { type: 'endTurn', actorId: 'goblin' });
    expect(third.events).toMatchObject([
      { type: 'turnEnded', combatantId: 'goblin' },
      { type: 'roundStarted', round: 2 },
      { type: 'turnStarted', combatantId: 'hero', round: 2 },
    ]);
    expect(third.state.round).toBe(2);
  });

  it('resets movement and the action at the start of each turn', () => {
    let { state } = start([hero(), goblin(c(5, 3))], [9, 4]);
    state = act(state, { type: 'move', actorId: 'hero', to: c(1, 3) }).state;
    state = act(state, { type: 'useAbility', actorId: 'hero', abilityId: 'second_wind', targetId: 'hero' }, [0]).state;
    state = act(state, { type: 'endTurn', actorId: 'hero' }).state;
    state = act(state, { type: 'endTurn', actorId: 'goblin' }).state;
    expect(state.movementLeft).toBe(6);
    expect(state.actionUsed).toBe(false);
  });

  it('skips creatures that are down', () => {
    let { state } = start([cleric(), hero({ hp: 0 }), goblin()], [19, 18, 0]);
    expect(activeCombatant(state)?.sheet.id).toBe('cleric');
    const result = act(state, { type: 'endTurn', actorId: 'cleric' });
    expect(result.events).toMatchObject([
      { type: 'turnEnded', combatantId: 'cleric' },
      { type: 'turnStarted', combatantId: 'goblin' },
    ]);
    state = result.state;
    expect(activeCombatant(state)?.sheet.id).toBe('goblin');
  });
});

describe('moving', () => {
  it('moves along the cheapest path and spends movement', () => {
    const { state } = start([hero(), goblin()], [9, 4]);
    const result = act(state, { type: 'move', actorId: 'hero', to: c(1, 3) });
    expect(result.events).toEqual([{ type: 'moved', combatantId: 'hero', path: [c(2, 3), c(1, 3)], cost: 1 }]);
    expect(result.state.combatants.hero?.position).toEqual(c(1, 3));
    expect(result.state.movementLeft).toBe(5);
  });

  it('can split movement across several moves, but not exceed it', () => {
    let { state } = start([hero(), goblin()], [9, 4]);
    state = act(state, { type: 'move', actorId: 'hero', to: c(-1, 3) }).state;
    expect(state.movementLeft).toBe(3);
    expect(reject(state, { type: 'move', actorId: 'hero', to: c(2, 6) })).toMatch(/reach/i);
    state = act(state, { type: 'move', actorId: 'hero', to: c(0, 3) }).state;
    expect(state.movementLeft).toBe(2);
  });

  it('refuses occupied, off-map, and current tiles', () => {
    const { state } = start([hero(), goblin()], [9, 4]);
    expect(reject(state, { type: 'move', actorId: 'hero', to: c(3, 3) })).toMatch(/reach/i);
    expect(reject(state, { type: 'move', actorId: 'hero', to: c(30, 3) })).toMatch(/reach/i);
    expect(reject(state, { type: 'move', actorId: 'hero', to: c(2, 3) })).toMatch(/already/i);
  });

  it('still allows an action after moving', () => {
    let { state } = start([hero(), goblin(c(4, 3))], [9, 4]);
    state = act(state, { type: 'move', actorId: 'hero', to: c(3, 3) }).state;
    const result = act(state, { type: 'useAbility', actorId: 'hero', abilityId: 'strike', targetId: 'goblin' }, [1]);
    expect(types(result.events)).toEqual(['abilityUsed', 'attackRolled']);
  });
});

describe('attacking', () => {
  it('hits when the roll meets the defense and deals damage', () => {
    const { state } = start([hero(), goblin()], [9, 4]);
    const result = act(state, { type: 'useAbility', actorId: 'hero', abilityId: 'strike', targetId: 'goblin' }, [9, 0]);
    expect(result.events).toMatchObject([
      { type: 'abilityUsed', actorId: 'hero', abilityId: 'strike', targetId: 'goblin', animation: 'melee' },
      { type: 'attackRolled', actorId: 'hero', targetId: 'goblin', total: 15, defense: 12, hit: true },
      { type: 'damaged', targetId: 'goblin', amount: 4, hp: 4 },
    ]);
    expect(result.state.combatants.goblin?.hp).toBe(4);
    expect(result.state.actionUsed).toBe(true);
    expect(result.state.status).toBe('active');
  });

  it('hits on a roll exactly equal to the defense', () => {
    const { state } = start([hero(), goblin()], [9, 4]);
    const result = act(state, { type: 'useAbility', actorId: 'hero', abilityId: 'strike', targetId: 'goblin' }, [6, 0]);
    expect(result.events[1]).toMatchObject({ total: 12, defense: 12, hit: true });
  });

  it('does nothing to the target on a miss', () => {
    const { state } = start([hero(), goblin()], [9, 4]);
    const result = act(state, { type: 'useAbility', actorId: 'hero', abilityId: 'strike', targetId: 'goblin' }, [1]);
    expect(result.events).toMatchObject([
      { type: 'abilityUsed' },
      { type: 'attackRolled', total: 7, defense: 12, hit: false },
    ]);
    expect(result.state.combatants.goblin?.hp).toBe(8);
    expect(result.state.actionUsed).toBe(true);
  });

  it('records the attack and damage dice for the log', () => {
    const { state } = start([hero(), goblin()], [9, 4]);
    const result = act(state, { type: 'useAbility', actorId: 'hero', abilityId: 'strike', targetId: 'goblin' }, [9, 0]);
    expect(result.events[1]).toMatchObject({ dice: [{ sides: 20 }] });
    expect(result.events[2]).toMatchObject({ dice: [{ sides: 8, dice: [{ value: 1 }] }] });
  });

  it('never deals negative damage', () => {
    const { state } = start([hero(), goblin()], [0, 19]);
    const result = act(state, { type: 'useAbility', actorId: 'goblin', abilityId: 'strike', targetId: 'hero' }, [19, 0]);
    expect(result.events[2]).toMatchObject({ type: 'damaged', amount: 0, hp: 10 });
  });

  it('allows only one action per turn', () => {
    let { state } = start([hero(), goblin()], [9, 4]);
    state = act(state, { type: 'useAbility', actorId: 'hero', abilityId: 'strike', targetId: 'goblin' }, [1]).state;
    expect(reject(state, { type: 'useAbility', actorId: 'hero', abilityId: 'strike', targetId: 'goblin' })).toMatch(
      /action/i,
    );
  });

  it('checks range', () => {
    const { state } = start([hero(), goblin(c(5, 3))], [9, 4]);
    expect(reject(state, { type: 'useAbility', actorId: 'hero', abilityId: 'strike', targetId: 'goblin' })).toMatch(
      /range/i,
    );
  });

  it('lets ranged abilities reach further', () => {
    const { state } = start([hero(), goblin(c(5, 3))], [0, 19]);
    const result = act(state, { type: 'useAbility', actorId: 'goblin', abilityId: 'shoot', targetId: 'hero' }, [9, 2]);
    expect(result.events).toMatchObject([
      { type: 'abilityUsed', animation: 'ranged' },
      { type: 'attackRolled', total: 14, defense: 11, hit: true },
      { type: 'damaged', targetId: 'hero', amount: 5, hp: 5 },
    ]);
  });

  describe('targeting', () => {
    it.each<[string, CombatAction, RegExp]>([
      ['an ally with an enemy-only ability', { type: 'useAbility', actorId: 'hero', abilityId: 'strike', targetId: 'cleric' }, /target/i],
      ['someone else with a self-only ability', { type: 'useAbility', actorId: 'hero', abilityId: 'second_wind', targetId: 'cleric' }, /target/i],
      ['an ability the creature does not know', { type: 'useAbility', actorId: 'hero', abilityId: 'mend', targetId: 'cleric' }, /know/i],
      ['an ability the system does not have', { type: 'useAbility', actorId: 'hero', abilityId: 'fireball', targetId: 'goblin' }, /fireball/],
      ['a target that does not exist', { type: 'useAbility', actorId: 'hero', abilityId: 'strike', targetId: 'dragon' }, /dragon/],
    ])('refuses %s', (_name, action, reason) => {
      const { state } = start([hero(), cleric(), goblin()], [19, 0, 0]);
      expect(reject(state, action)).toMatch(reason);
    });

    it('refuses healing an enemy', () => {
      const { state } = start([cleric(), goblin(c(2, 3))], [19, 0]);
      expect(reject(state, { type: 'useAbility', actorId: 'cleric', abilityId: 'mend', targetId: 'goblin' })).toMatch(
        /target/i,
      );
    });

    it('refuses attacking an enemy that is already down', () => {
      const { state } = start([hero(), goblin(c(3, 3)), goblin(c(5, 3), 'goblin2')], [19, 0, 0]);
      const downed = { ...state, combatants: { ...state.combatants, goblin: { ...state.combatants.goblin!, hp: 0 } } };
      expect(reject(downed, { type: 'useAbility', actorId: 'hero', abilityId: 'strike', targetId: 'goblin' })).toMatch(
        /down/i,
      );
    });
  });
});

describe('healing', () => {
  it('heals an ally without an attack roll, up to max HP', () => {
    const { state } = start([cleric(), hero({ hp: 3 }), goblin()], [19, 0, 0]);
    const result = act(state, { type: 'useAbility', actorId: 'cleric', abilityId: 'mend', targetId: 'hero' }, [5]);
    expect(result.events).toEqual([
      { type: 'abilityUsed', actorId: 'cleric', abilityId: 'mend', targetId: 'hero', animation: 'spell' },
      expect.objectContaining({ type: 'healed', targetId: 'hero', amount: 7, hp: 10 }),
    ]);
  });

  it('heals yourself with a self ability', () => {
    const { state } = start([hero({ hp: 3 }), goblin()], [19, 0]);
    const result = act(state, { type: 'useAbility', actorId: 'hero', abilityId: 'second_wind', targetId: 'hero' }, [3]);
    expect(result.events[1]).toMatchObject({ type: 'healed', amount: 5, hp: 8 });
  });

  it('revives a downed ally, who then takes turns again', () => {
    let { state } = start([cleric(), hero({ hp: 0 }), goblin()], [19, 18, 0]);
    const healed = act(state, { type: 'useAbility', actorId: 'cleric', abilityId: 'mend', targetId: 'hero' }, [0]);
    expect(healed.events.slice(1)).toMatchObject([
      { type: 'healed', targetId: 'hero', amount: 3, hp: 3 },
      { type: 'revived', targetId: 'hero' },
    ]);
    state = act(healed.state, { type: 'endTurn', actorId: 'cleric' }).state;
    expect(activeCombatant(state)?.sheet.id).toBe('hero');
  });
});

describe('conditions', () => {
  it('applies a condition on hit that stops the target acting on its next turn, then expires', () => {
    let { state } = start([hero(), goblin()], [9, 4]);
    const bash = act(state, { type: 'useAbility', actorId: 'hero', abilityId: 'bash', targetId: 'goblin' }, [9, 0]);
    expect(bash.events.slice(2)).toMatchObject([
      { type: 'damaged', targetId: 'goblin', amount: 1, hp: 7 },
      { type: 'conditionApplied', targetId: 'goblin', conditionId: 'stunned', rounds: 1 },
    ]);
    state = act(bash.state, { type: 'endTurn', actorId: 'hero' }).state;

    expect(state.movementLeft).toBe(0);
    expect(reject(state, { type: 'move', actorId: 'goblin', to: c(4, 3) })).toMatch(/stunned/i);
    expect(reject(state, { type: 'useAbility', actorId: 'goblin', abilityId: 'strike', targetId: 'hero' })).toMatch(
      /stunned/i,
    );

    const goblinEnds = act(state, { type: 'endTurn', actorId: 'goblin' });
    expect(goblinEnds.events).toMatchObject([
      { type: 'turnEnded', combatantId: 'goblin' },
      { type: 'conditionExpired', targetId: 'goblin', conditionId: 'stunned' },
      { type: 'roundStarted', round: 2 },
      { type: 'turnStarted', combatantId: 'hero' },
    ]);
    state = act(goblinEnds.state, { type: 'endTurn', actorId: 'hero' }).state;
    expect(state.combatants.goblin?.conditions).toEqual([]);
    expect(state.movementLeft).toBe(6);
  });

  it('refreshes a condition instead of stacking it', () => {
    const { state } = start([hero(), goblin()], [9, 4]);
    const stunned = {
      ...state,
      combatants: {
        ...state.combatants,
        goblin: { ...state.combatants.goblin!, conditions: [{ id: 'stunned', remainingRounds: 1 }] },
      },
    };
    const result = act(stunned, { type: 'useAbility', actorId: 'hero', abilityId: 'bash', targetId: 'goblin' }, [9, 0]);
    expect(result.state.combatants.goblin?.conditions).toEqual([{ id: 'stunned', remainingRounds: 1 }]);
  });
});

describe('ending combat', () => {
  it('ends when one side is left standing and gives XP to the winners', () => {
    const { state } = start([hero(), goblin()], [9, 4]);
    const result = act(state, { type: 'useAbility', actorId: 'hero', abilityId: 'strike', targetId: 'goblin' }, [9, 4]);
    expect(result.events.slice(2)).toMatchObject([
      { type: 'damaged', targetId: 'goblin', amount: 8, hp: 0 },
      { type: 'downed', targetId: 'goblin' },
      { type: 'combatEnded', winner: 'party' },
      { type: 'xpGained', combatantId: 'hero', amount: 50, xp: 50 },
    ]);
    expect(result.state.status).toBe('ended');
    expect(result.state.winner).toBe('party');
    expect(result.state.combatants.hero?.sheet.xp).toBe(50);
  });

  it('rejects every action once combat is over', () => {
    const { state } = start([hero(), goblin()], [9, 4]);
    const ended = act(state, { type: 'useAbility', actorId: 'hero', abilityId: 'strike', targetId: 'goblin' }, [9, 4]);
    expect(reject(ended.state, { type: 'endTurn', actorId: 'hero' })).toMatch(/over/i);
  });

  it('splits XP among player characters only, and levels them up', () => {
    const dog: CombatantSetup = {
      sheet: { id: 'dog', name: 'Dog', stats: {}, xp: 0, abilities: ['strike'] },
      side: 'party',
      position: c(2, 4),
      isPlayerCharacter: false,
    };
    const { state } = start([hero({ sheet: { ...heroSheet, xp: 280 } }), cleric(), dog, goblin()], [19, 0, 0, 0]);
    const result = act(state, { type: 'useAbility', actorId: 'hero', abilityId: 'strike', targetId: 'goblin' }, [9, 4]);
    expect(result.events.slice(5)).toMatchObject([
      { type: 'xpGained', combatantId: 'hero', amount: 25, xp: 305 },
      { type: 'levelUp', combatantId: 'hero', level: 2 },
      { type: 'xpGained', combatantId: 'cleric', amount: 25, xp: 25 },
    ]);
    // Leveling to 2 raises max HP from 10 to 17; current HP rises by the same 7.
    expect(result.state.combatants.hero?.hp).toBe(17);
    expect(result.state.combatants.dog?.sheet.xp).toBe(0);
  });

  it('gives no XP when the monsters win', () => {
    const { state } = start([hero({ hp: 1 }), goblin()], [0, 19]);
    const result = act(state, { type: 'useAbility', actorId: 'goblin', abilityId: 'strike', targetId: 'hero' }, [19, 7]);
    expect(types(result.events)).toEqual(['abilityUsed', 'attackRolled', 'damaged', 'downed', 'combatEnded']);
    expect(result.state.winner).toBe('monsters');
  });
});

it('never changes the state it was given', () => {
  const { state } = start([hero(), goblin()], [9, 4]);
  const before = JSON.stringify(state);
  act(state, { type: 'useAbility', actorId: 'hero', abilityId: 'strike', targetId: 'goblin' }, [9, 4]);
  act(state, { type: 'move', actorId: 'hero', to: c(1, 3) });
  expect(JSON.stringify(state)).toBe(before);
});
