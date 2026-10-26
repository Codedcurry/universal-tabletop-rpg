import { describe, expect, it } from 'vitest';
import { blankSystem, fitCreatures, fitSheet, idFrom, removeAbility, removeCondition, removeStat, renameEntryId, renameVariableId, describePath, pathSection } from './edit';
import { skirmish } from './samples/skirmish';
import { validateGameSystem } from './validate';

// Editing a game system by hand: a blank start, readable ids, tidy removals,
// and fitting creatures already in play to the changed rules.

describe('blankSystem', () => {
  it('is a small system that works as it is', () => {
    const system = blankSystem('Moonfall');
    expect(validateGameSystem(system).ok).toBe(true);
    expect(system.id).toBe('moonfall');
  });
});

describe('idFrom', () => {
  it('makes a readable id from a name, unlike any taken one', () => {
    expect(idFrom('Shield Bash!', new Set())).toBe('shield_bash');
    expect(idFrom('Strike', new Set(['strike', 'strike_2']))).toBe('strike_3');
    expect(idFrom('3 Headed Dog', new Set())).toBe('headed_dog');
    expect(idFrom('???', new Set())).toBe('entry');
  });
});

describe('removals', () => {
  it('takes a removed ability off every monster', () => {
    const system = removeAbility(skirmish, 'shoot');
    expect(system.abilities.map((ability) => ability.id)).not.toContain('shoot');
    expect(system.monsters.find((monster) => monster.id === 'goblin')?.abilities).toEqual(['strike']);
    expect(validateGameSystem(system).ok).toBe(true);
  });

  it('takes a removed condition out of the effects that applied it', () => {
    const system = removeCondition(skirmish, 'stunned');
    expect(system.abilities.find((ability) => ability.id === 'bash')?.effects).toEqual([{ type: 'damage', amount: '1d4' }]);
    expect(validateGameSystem(system).ok).toBe(true);
  });

  it('takes a removed stat off monsters, and leaves the formulas that used it for the DM to fix', () => {
    const system = removeStat(skirmish, 'dex');
    expect(system.monsters.find((monster) => monster.id === 'goblin')?.stats).toEqual({ str: 8 });
    const result = validateGameSystem(system);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.message.includes('@dex'))).toBe(true);
  });
});

describe('fitting creatures in play', () => {
  const goblin = { id: 'goblin-1', name: 'Goblin', stats: { str: 8, dex: 14, con: 10 }, xp: 0, abilities: ['strike', 'shoot'] };

  it('drops stats and abilities a sheet has that the system doesn\'t', () => {
    const { sheet, dropped } = fitSheet(goblin, removeAbility(skirmish, 'shoot'));
    expect(sheet.abilities).toEqual(['strike']);
    expect(dropped).toEqual(['ability shoot']);
    expect(fitSheet(goblin, skirmish).sheet).toBe(goblin);
  });

  it('fits a fight: lost abilities and conditions go, and HP stays within the new maximum', () => {
    const creatures = {
      'goblin-1': { sheet: goblin, hp: 7, conditions: [{ id: 'stunned', remainingRounds: 1 }], side: 'monsters' },
    };
    const tougher = { ...skirmish, health: { max: '4' } };
    const { creatures: fitted, changes } = fitCreatures(creatures, removeCondition(removeAbility(tougher, 'shoot'), 'stunned'));
    expect(fitted['goblin-1']).toMatchObject({ hp: 4, conditions: [], side: 'monsters', sheet: { abilities: ['strike'] } });
    expect(changes).toEqual(['Goblin loses ability shoot', 'Goblin is no longer stunned', 'Goblin\'s HP drops to the new maximum, 4']);
  });

  it('changes nothing when the creatures already fit', () => {
    const creatures = { 'goblin-1': { sheet: goblin, hp: 5, conditions: [] } };
    expect(fitCreatures(creatures, skirmish)).toEqual({ creatures, changes: [] });
    expect(fitCreatures(creatures, skirmish).creatures).toBe(creatures);
  });
});

describe('renaming', () => {
  it('renames a formula name everywhere it is used, and nothing that only starts the same', () => {
    const system = renameVariableId(skirmish, 'str', 'might');
    expect(system.stats[0]?.id).toBe('might');
    expect(system.derived[0]?.formula).toBe('floor((@might - 10) / 2)');
    // @str_mod is another variable: untouched.
    expect(system.abilities[0]?.attack?.roll).toBe('1d20 + @str_mod + @prof');
    expect(system.monsters.find((monster) => monster.id === 'ogre')?.stats).toEqual({ might: 18, dex: 8, con: 16 });
    expect(validateGameSystem(system).ok).toBe(true);
    expect(() => renameVariableId(skirmish, 'str', 'dex')).toThrow(/already/);
  });

  it('renames a derived value in the formulas that use it', () => {
    const system = renameVariableId(skirmish, 'str_mod', 'brawn');
    expect(system.abilities[0]?.attack?.roll).toBe('1d20 + @brawn + @prof');
    expect(validateGameSystem(system).ok).toBe(true);
  });

  it('renames an ability or condition id, and every reference to it', () => {
    const abilities = renameEntryId(skirmish, 'ability', 'strike', 'slash');
    expect(abilities.monsters.find((monster) => monster.id === 'goblin')?.abilities).toEqual(['slash', 'shoot']);
    const conditions = renameEntryId(skirmish, 'condition', 'stunned', 'dazed');
    expect(conditions.abilities.find((ability) => ability.id === 'bash')?.effects[1]).toEqual({ type: 'applyCondition', condition: 'dazed', rounds: 1 });
    expect(validateGameSystem(abilities).ok && validateGameSystem(conditions).ok).toBe(true);
  });
});

describe('describePath', () => {
  it('says where a problem is in words, and which section it is in', () => {
    expect(describePath(skirmish, 'abilities[2].effects[0].amount')).toBe('Abilities › Shield Bash › effect 1 › amount');
    expect(describePath(skirmish, 'abilities[0].attack.roll')).toBe('Abilities › Strike › attack roll');
    expect(describePath(skirmish, 'monsters[1].stats.str')).toBe('Monsters › Ogre › stats › str');
    expect(describePath(skirmish, 'derived[3].formula')).toBe('Stats › Proficiency › formula');
    expect(describePath(skirmish, 'health.max')).toBe('Basics › max HP');
    expect(describePath(skirmish, 'movement.climb.maxHeight')).toBe('Basics › climb height');
    expect(describePath(skirmish, 'defense')).toBe('Basics › defense');
    expect(pathSection('derived[0].formula')).toBe('stats');
    expect(pathSection('monsters[0].level')).toBe('monsters');
    expect(pathSection('initiative')).toBe('basics');
  });
});

describe('renames in play', () => {
  it('keeps a renamed stat\'s value on creatures in play', () => {
    const goblin = { id: 'goblin-1', name: 'Goblin', stats: { str: 8, dex: 14 }, xp: 0, abilities: ['strike'] };
    const { sheet, dropped } = fitSheet(goblin, renameVariableId(skirmish, 'str', 'might'), { str: 'might' });
    expect(sheet.stats).toEqual({ might: 8, dex: 14 });
    expect(dropped).toEqual([]);
  });
});
