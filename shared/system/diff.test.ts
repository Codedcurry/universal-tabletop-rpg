import { describe, expect, it } from 'vitest';
import { combineChanges, diffSystems } from './diff';
import { skirmish } from './samples/skirmish';
import type { GameSystem } from './types';
import { validateGameSystem } from './validate';

// Reviewing new rules: every difference as a change (add, change, remove)
// saying what it does to the site, and only the accepted ones combined.

/** Skirmish, the way an imported book might change it. */
const incoming: GameSystem = {
  ...skirmish,
  name: 'Skirmish Deluxe',
  defense: '11 + @dex_mod',
  resources: [{ id: 'focus', name: 'Focus', max: '2 + @level', refill: 'fight' }],
  critical: { hit: 20 },
  conditions: [...skirmish.conditions, { id: 'burning', name: 'Burning', description: 'Takes fire damage.' }],
  abilities: [
    ...skirmish.abilities.filter((ability) => ability.id !== 'shoot').map((ability) => (ability.id === 'strike' ? { ...ability, range: 2 } : ability)),
    {
      id: 'firebolt',
      name: 'Firebolt',
      range: 8,
      target: 'enemy',
      attack: { roll: '1d20 + @dex_mod' },
      effects: [{ type: 'damage', amount: '2d6' }, { type: 'applyCondition', condition: 'burning', rounds: 1 }],
      animation: 'spell',
      cost: { focus: 2 },
    },
  ],
  monsters: skirmish.monsters.map((monster) => ({ ...monster, abilities: monster.abilities.filter((id) => id !== 'shoot') })),
};

describe('diffSystems', () => {
  const changes = diffSystems(skirmish, incoming);
  const byId = (id: string) => changes.find((change) => change.id === id);

  it('lists every difference: basics first, then additions, changes, and removals by area', () => {
    expect(changes.map((change) => `${change.kind} ${change.id}`)).toEqual([
      'change basics:name',
      'change basics:defense',
      'change basics:critical',
      'add resources:focus',
      'add conditions:burning',
      'change abilities:strike',
      'add abilities:firebolt',
      'remove abilities:shoot',
      'change monsters:goblin',
    ]);
  });

  it('says what each one is, and what it does to the site', () => {
    expect(byId('basics:defense')).toMatchObject({ title: 'Defense', detail: '10 + @dex_mod → 11 + @dex_mod', site: 'Changes what attacks must roll to hit.' });
    expect(byId('resources:focus')).toMatchObject({ title: 'Resource: Focus', site: 'Adds a Focus meter to the combat bar, and Focus costs on ability buttons.' });
    expect(byId('abilities:firebolt')).toMatchObject({
      title: 'Ability: Firebolt',
      detail: 'an enemy, range 8 · attack 1d20 + @dex_mod · 2d6 damage · Burning for 1 round · 2 Focus',
      site: 'Adds a Firebolt button to the combat bar for creatures that have it.',
    });
    expect(byId('abilities:strike')?.detail).toBe('was: an enemy, range 1 · now: an enemy, range 2');
    expect(byId('abilities:shoot')?.site).toBe('Removes its button, and takes it from 1 monster.');
  });

  it('lists nothing for the same rules, and everything as an addition when there were none', () => {
    expect(diffSystems(skirmish, skirmish)).toEqual([]);
    expect(diffSystems(null, skirmish).every((change) => change.kind === 'add')).toBe(true);
  });
});

describe('combineChanges', () => {
  const all = new Set(diffSystems(skirmish, incoming).map((change) => change.id));

  it('takes every change when all are accepted', () => {
    const { system, tidied } = combineChanges(skirmish, incoming, all);
    expect(system).toEqual({ ...incoming, abilities: system.abilities, monsters: system.monsters });
    expect(system.abilities.map((ability) => ability.id)).toEqual(['strike', 'bash', 'mend', 'second_wind', 'firebolt']);
    expect(tidied).toEqual([]);
    expect(validateGameSystem(system).ok).toBe(true);
  });

  it('keeps the rules as they were for each change said no to', () => {
    const { system } = combineChanges(skirmish, incoming, new Set(['abilities:firebolt', 'resources:focus', 'conditions:burning']));
    expect(system.name).toBe('Skirmish');
    expect(system.defense).toBe('10 + @dex_mod');
    expect(system.abilities.map((ability) => ability.id)).toEqual(['strike', 'shoot', 'bash', 'mend', 'second_wind', 'firebolt']);
    expect(system.abilities[0]?.range).toBe(1);
    expect(system.critical).toBeUndefined();
    expect(validateGameSystem(system).ok).toBe(true);
  });

  it('takes out what points at something left out, and says so', () => {
    // Firebolt yes, but not Focus or Burning.
    const { system, tidied } = combineChanges(skirmish, incoming, new Set(['abilities:firebolt']));
    const firebolt = system.abilities.find((ability) => ability.id === 'firebolt');
    expect(firebolt?.effects).toEqual([{ type: 'damage', amount: '2d6' }]);
    expect(firebolt).not.toHaveProperty('cost');
    expect(tidied).toEqual(['Firebolt no longer Burning for 1 round, since that was left out.', 'Firebolt no longer costs a resource that was left out.']);
    expect(validateGameSystem(system).ok).toBe(true);
  });

  it('takes a removed ability off monsters', () => {
    const { system, tidied } = combineChanges(skirmish, incoming, new Set(['abilities:shoot']));
    expect(system.monsters.find((monster) => monster.id === 'goblin')?.abilities).toEqual(['strike']);
    expect(tidied).toEqual(['Goblin loses abilities that were left out.']);
  });
});
