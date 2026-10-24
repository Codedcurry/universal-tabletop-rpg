import { describe, expect, it } from 'vitest';
import { skirmish } from './samples/skirmish';
import { type CreatureSheet, type GameSystem, computeCreature, levelForXp, sheetFromMonster } from './index';

const hero: CreatureSheet = {
  id: 'hero',
  name: 'Hero',
  stats: { str: 16, dex: 12, con: 14 },
  xp: 0,
  abilities: ['strike', 'bash'],
};

describe('levelForXp', () => {
  it.each([
    [0, 1],
    [299, 1],
    [300, 2],
    [899, 2],
    [900, 3],
    [6500, 5],
    [1_000_000, 5],
  ])('%d XP is level %d', (xp, level) => {
    expect(levelForXp(skirmish, xp)).toBe(level);
  });

  it('rejects negative XP', () => {
    expect(() => levelForXp(skirmish, -1)).toThrow(RangeError);
  });
});

describe('computeCreature', () => {
  it('computes stats, derived values, max HP, defense, and speed', () => {
    const creature = computeCreature(skirmish, hero);
    expect(creature.level).toBe(1);
    expect(creature.vars).toEqual({ str: 16, dex: 12, con: 14, str_mod: 3, dex_mod: 1, con_mod: 2, prof: 2, level: 1 });
    expect(creature.maxHp).toBe(10);
    expect(creature.defense).toBe(11);
    expect(creature.speed).toBe(6);
  });

  it('scales with level', () => {
    const veteran = computeCreature(skirmish, { ...hero, xp: 6500 });
    expect(veteran.level).toBe(5);
    expect(veteran.vars.prof).toBe(3);
    expect(veteran.maxHp).toBe(8 + 2 + 4 * (5 + 2));
  });

  it('uses stat defaults for stats the sheet leaves out', () => {
    const creature = computeCreature(skirmish, { ...hero, stats: {} });
    expect(creature.vars).toMatchObject({ str: 10, dex: 10, con: 10, str_mod: 0 });
    expect(creature.maxHp).toBe(8);
    expect(creature.defense).toBe(10);
  });

  it('rejects a stat the system does not define', () => {
    expect(() => computeCreature(skirmish, { ...hero, stats: { wis: 12 } })).toThrow(/wis/);
  });

  it('rounds fractional results down', () => {
    const system: GameSystem = { ...skirmish, defense: '10 + @dex / 4' };
    expect(computeCreature(system, hero).defense).toBe(13);
  });

  it('keeps max HP at least 1 and speed at least 0', () => {
    const system: GameSystem = {
      ...skirmish,
      health: { max: '@con - 20' },
      movement: { ...skirmish.movement, speed: '@dex_mod - 5' },
    };
    const creature = computeCreature(system, hero);
    expect(creature.maxHp).toBe(1);
    expect(creature.speed).toBe(0);
  });
});

describe('sheetFromMonster', () => {
  it('builds a full sheet from a monster entry, filling in default stats', () => {
    expect(sheetFromMonster(skirmish, 'goblin', 'goblin-1')).toEqual({
      id: 'goblin-1',
      name: 'Goblin',
      stats: { str: 8, dex: 14, con: 10 },
      xp: 0,
      abilities: ['strike', 'shoot'],
    });
  });

  it("starts at the XP for the monster's level", () => {
    const ogre = sheetFromMonster(skirmish, 'ogre', 'ogre-1', 'Grug');
    expect(ogre.name).toBe('Grug');
    expect(ogre.xp).toBe(900);
    expect(computeCreature(skirmish, ogre).level).toBe(3);
  });

  it('returns a copy, not shared references into the system', () => {
    const sheet = sheetFromMonster(skirmish, 'goblin', 'goblin-1');
    expect(sheet.abilities).not.toBe(skirmish.monsters[0]?.abilities);
  });

  it('rejects an unknown monster', () => {
    expect(() => sheetFromMonster(skirmish, 'dragon', 'x')).toThrow(/dragon/);
  });
});
