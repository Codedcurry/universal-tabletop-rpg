import { describe, expect, it } from 'vitest';
import type { Cell } from '../grid';
import { createWorldMap, rectangleTiles } from '../map';
import { scriptedRandom } from '../random';
import { skirmish } from '../system/samples/skirmish';
import {
  type CombatAction,
  type CombatContext,
  type CombatState,
  type CombatantSetup,
  type HouseRule,
  abilityReach,
  actionProblems,
  applyAction,
  describeHouseRule,
  moveOptions,
  parseHouseRule,
  ruleFits,
  setupFromMonster,
  startCombat,
  targetOptions,
  withRule,
} from './index';

// House rules: the engine says why it refuses something and what ruling
// would allow it; the DM allows it once, or keeps the ruling as a house rule.

const c = (q: number, r: number): Cell => ({ q, r });
const map = createWorldMap({ formatVersion: 1, grid: 'hex', tiles: rectangleTiles('hex', 7, 7).map((cell) => ({ ...cell, height: 0 })), walls: [] });
const ctx: CombatContext = { system: skirmish, map };
const withRules = (rules: HouseRule[]): CombatContext => ({ ...ctx, houseRules: rules });
const once = (rules: HouseRule[]): CombatContext => ({ ...ctx, overrules: rules });

const hero: CombatantSetup = {
  sheet: { id: 'hero', name: 'Hero', stats: { str: 16, dex: 12, con: 14 }, xp: 0, abilities: ['strike', 'bash', 'second_wind'] },
  side: 'party',
  position: c(2, 3),
  isPlayerCharacter: true,
};
const goblinAt = (position: Cell): CombatantSetup => setupFromMonster(skirmish, 'goblin', { id: 'goblin', side: 'monsters', position });

/** A fight where it's the hero's turn (initiative rolls favour the hero). */
function heroTurn(goblin: Cell, context: CombatContext = ctx, extra: CombatantSetup[] = []): CombatState {
  return startCombat(context, [hero, goblinAt(goblin), ...extra], scriptedRandom([9, 4, ...extra.map(() => 0)])).state;
}

const strikeAt = (targetId = 'goblin'): CombatAction => ({ type: 'useAbility', actorId: 'hero', abilityId: 'strike', targetId });

describe('explaining a refusal', () => {
  it('says a target is out of range, and that a little more reach would allow it', () => {
    const state = heroTurn(c(6, 1)); // 4 tiles away; Strike reaches 1
    expect(actionProblems(ctx, state, strikeAt())).toEqual([
      { message: 'Goblin is out of range for Strike (range 1)', fix: { kind: 'range', ability: 'strike', extra: 3 } },
    ]);
    expect(actionProblems(ctx, heroTurn(c(3, 3)), strikeAt())).toEqual([]);
  });

  it('offers nothing for what no ruling can change', () => {
    const state = heroTurn(c(3, 3));
    const down = { ...state, combatants: { ...state.combatants, goblin: { ...state.combatants.goblin!, hp: 0 } } };
    expect(actionProblems(ctx, down, strikeAt())).toEqual([{ message: 'Goblin is already down', fix: null }]);
    expect(actionProblems(ctx, { ...state, actionUsed: true }, strikeAt())[0]).toEqual({ message: 'Hero has already used an action this turn', fix: null });
    expect(actionProblems(ctx, state, { type: 'endTurn', actorId: 'goblin' })).toEqual([{ message: "It is not Goblin's turn", fix: null }]);
  });

  it('says a tile is too far to walk this turn, and by how much', () => {
    const state = { ...heroTurn(c(3, 3)), movementLeft: 3 };
    expect(actionProblems(ctx, state, { type: 'move', actorId: 'hero', to: c(0, 0) })).toEqual([
      { message: "Hero can't reach that tile this turn (5 movement needed, 3 left)", fix: { kind: 'movement', extra: 2 } },
    ]);
  });
});

describe('allowing it just once', () => {
  it('lets that one action through, and nothing after', () => {
    const state = heroTurn(c(6, 1));
    const [problem] = actionProblems(ctx, state, strikeAt());
    const result = applyAction(once([problem!.fix!]), state, strikeAt(), scriptedRandom([19, 0]));
    expect(result.ok).toBe(true);
    // Without the ruling, the same strike is still refused.
    expect(applyAction(ctx, state, strikeAt(), scriptedRandom([19, 0])).ok).toBe(false);
  });

  it('lets a creature walk further this once, leaving it no movement', () => {
    const state = { ...heroTurn(c(3, 3)), movementLeft: 3 };
    const result = applyAction(once([{ kind: 'movement', extra: 2 }]), state, { type: 'move', actorId: 'hero', to: c(0, 0) }, scriptedRandom([]));
    expect(result.ok && result.state.movementLeft).toBe(0);
  });

  it('lets a stunned creature move: the condition allowed, and the movement it lost this turn', () => {
    const state = heroTurn(c(3, 3));
    const stunned = {
      ...state,
      movementLeft: 0,
      combatants: { ...state.combatants, hero: { ...state.combatants.hero!, conditions: [{ id: 'stunned', remainingRounds: 1 }] } },
    };
    const move: CombatAction = { type: 'move', actorId: 'hero', to: c(2, 4) };
    const problems = actionProblems(ctx, stunned, move);
    expect(problems).toEqual([
      { message: "Hero is Stunned and can't move", fix: { kind: 'condition', condition: 'stunned', allows: 'move' } },
      { message: "Hero can't reach that tile this turn (1 movement needed, 0 left)", fix: { kind: 'movement', extra: 1 }, nowOnly: true },
    ]);
    expect(applyAction(once(problems.map((problem) => problem.fix!)), stunned, move, scriptedRandom([])).ok).toBe(true);
  });
});

describe('house rules', () => {
  it('a range rule lets the ability reach further, in its targets and its shown reach', () => {
    const rules = withRules([{ kind: 'range', ability: 'strike', extra: 3 }]);
    const state = heroTurn(c(6, 1), rules);
    expect(targetOptions(rules, state, 'hero', 'strike')).toEqual(['goblin']);
    expect(abilityReach(rules, state, 'hero', 'strike').length).toBeGreaterThan(abilityReach(ctx, state, 'hero', 'strike').length);
    expect(applyAction(rules, state, strikeAt(), scriptedRandom([19, 0])).ok).toBe(true);
  });

  it('a rule for every ability applies to each', () => {
    const rules = withRules([{ kind: 'range', ability: null, extra: 3 }]);
    expect(actionProblems(rules, heroTurn(c(6, 1), rules), { type: 'useAbility', actorId: 'hero', abilityId: 'bash', targetId: 'goblin' })).toEqual([]);
  });

  it('a target rule lets an ability aim at anyone', () => {
    const ally: CombatantSetup = { ...hero, sheet: { ...hero.sheet, id: 'ally', name: 'Ally' }, position: c(1, 3) };
    const state = heroTurn(c(6, 1), ctx, [ally]);
    expect(actionProblems(ctx, state, strikeAt('ally'))).toEqual([{ message: 'Strike must target an enemy', fix: { kind: 'target', ability: 'strike' } }]);
    expect(actionProblems(withRules([{ kind: 'target', ability: 'strike' }]), state, strikeAt('ally'))).toEqual([]);
  });

  it('a condition rule lets creatures under it act, or move', () => {
    const state = heroTurn(c(3, 3));
    const stunned = { ...state, combatants: { ...state.combatants, hero: { ...state.combatants.hero!, conditions: [{ id: 'stunned', remainingRounds: 1 }] } } };
    const act = withRules([{ kind: 'condition', condition: 'stunned', allows: 'act' }]);
    expect(actionProblems(act, stunned, strikeAt())).toEqual([]);
    expect(moveOptions(act, stunned, 'hero').size).toBe(0); // acting, not moving
    expect(moveOptions(withRules([{ kind: 'condition', condition: 'stunned', allows: 'move' }]), stunned, 'hero').size).toBeGreaterThan(0);
  });

  it('a movement rule gives every creature more movement from the start of each turn', () => {
    const rules = withRules([{ kind: 'movement', extra: 2 }]);
    expect(heroTurn(c(3, 3), rules).movementLeft).toBe(8);
  });
});

describe('house rules as data', () => {
  it('reads as a sentence', () => {
    expect(describeHouseRule({ kind: 'range', ability: 'shoot', extra: 1 }, skirmish)).toBe('Shoot reaches 1 more tile');
    expect(describeHouseRule({ kind: 'range', ability: null, extra: 2 }, skirmish)).toBe('Every ability reaches 2 more tiles');
    expect(describeHouseRule({ kind: 'sight', ability: 'shoot' }, skirmish)).toBe("Shoot doesn't need a clear view of its target");
    expect(describeHouseRule({ kind: 'target', ability: 'mend' }, skirmish)).toBe('Mend can target any creature');
    expect(describeHouseRule({ kind: 'condition', condition: 'stunned', allows: 'move' }, skirmish)).toBe('Stunned creatures can still move');
    expect(describeHouseRule({ kind: 'movement', extra: 1 }, skirmish)).toBe('Every creature moves 1 more tile each turn');
  });

  it('adds up range and movement rules, and keeps others once', () => {
    let rules = withRule([], { kind: 'range', ability: 'shoot', extra: 1 });
    rules = withRule(rules, { kind: 'range', ability: 'shoot', extra: 2 });
    rules = withRule(rules, { kind: 'range', ability: 'strike', extra: 1 });
    rules = withRule(rules, { kind: 'sight', ability: null });
    rules = withRule(rules, { kind: 'sight', ability: null });
    expect(rules).toEqual([
      { kind: 'range', ability: 'shoot', extra: 3 },
      { kind: 'range', ability: 'strike', extra: 1 },
      { kind: 'sight', ability: null },
    ]);
  });

  it('reads saved rules, refusing broken ones', () => {
    expect(parseHouseRule({ kind: 'range', ability: 'shoot', extra: 2, junk: 1 })).toEqual({ kind: 'range', ability: 'shoot', extra: 2 });
    expect(parseHouseRule({ kind: 'range', ability: 'shoot', extra: 0 })).toBeNull();
    expect(parseHouseRule({ kind: 'condition', condition: 'stunned', allows: 'fly' })).toBeNull();
    expect(parseHouseRule({ kind: 'teleport' })).toBeNull();
  });

  it('knows when a rule no longer means anything under changed rules', () => {
    expect(ruleFits({ kind: 'range', ability: 'shoot', extra: 1 }, skirmish)).toBe(true);
    expect(ruleFits({ kind: 'range', ability: 'fireball', extra: 1 }, skirmish)).toBe(false);
    expect(ruleFits({ kind: 'condition', condition: 'charmed', allows: 'act' }, skirmish)).toBe(false);
    expect(ruleFits({ kind: 'movement', extra: 1 }, skirmish)).toBe(true);
  });
});
