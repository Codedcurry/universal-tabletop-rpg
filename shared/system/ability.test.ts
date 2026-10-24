import { describe, expect, it } from 'vitest';
import { abilityIntent } from './ability';
import { skirmish } from './samples/skirmish';
import type { AbilityDef } from './types';

// Whether an ability hurts or helps decides how its targets are shown (red
// for an attack, another color for help), so players can tell at a glance.

const ability = (id: string) => skirmish.abilities.find((entry) => entry.id === id) as AbilityDef;
const base: AbilityDef = { id: 'x', name: 'X', range: 1, target: 'ally', effects: [], animation: 'spell' };

describe('abilityIntent', () => {
  it.each([
    ['strike', 'harm'],
    ['shoot', 'harm'],
    ['bash', 'harm'],
    ['mend', 'help'],
    ['second_wind', 'help'],
  ])('%s is %s', (id, intent) => {
    expect(abilityIntent(ability(id))).toBe(intent);
  });

  it('counts anything aimed at enemies as harm, even without damage', () => {
    expect(abilityIntent({ ...base, target: 'enemy', effects: [{ type: 'applyCondition', condition: 'rooted', rounds: 1 }] })).toBe('harm');
  });

  it('counts damage or an attack roll as harm, whoever it targets', () => {
    expect(abilityIntent({ ...base, effects: [{ type: 'damage', amount: '1' }] })).toBe('harm');
    expect(abilityIntent({ ...base, attack: { roll: '1d20' } })).toBe('harm');
  });

  it('counts conditions put on allies as help', () => {
    expect(abilityIntent({ ...base, effects: [{ type: 'applyCondition', condition: 'rooted', rounds: 1 }] })).toBe('help');
  });
});
