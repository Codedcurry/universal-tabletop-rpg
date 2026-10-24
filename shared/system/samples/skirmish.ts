import type { GameSystem } from '../types';

/**
 * "Skirmish": a tiny original system bundled as a demo and used by tests.
 * Written from scratch for this project; not taken from any published game.
 */
export const skirmish: GameSystem = {
  formatVersion: 1,
  id: 'skirmish',
  name: 'Skirmish',
  stats: [
    { id: 'str', name: 'Strength', default: 10 },
    { id: 'dex', name: 'Dexterity', default: 10 },
    { id: 'con', name: 'Constitution', default: 10 },
  ],
  derived: [
    { id: 'str_mod', name: 'Strength modifier', formula: 'floor((@str - 10) / 2)' },
    { id: 'dex_mod', name: 'Dexterity modifier', formula: 'floor((@dex - 10) / 2)' },
    { id: 'con_mod', name: 'Constitution modifier', formula: 'floor((@con - 10) / 2)' },
    { id: 'prof', name: 'Proficiency', formula: '2 + floor((@level - 1) / 4)' },
  ],
  levels: { xpThresholds: [0, 300, 900, 2700, 6500] },
  health: { max: '8 + @con_mod + (@level - 1) * (5 + @con_mod)' },
  defense: '10 + @dex_mod',
  initiative: '1d20 + @dex_mod',
  movement: {
    speed: '6',
    maxStepUp: 1,
    maxStepDown: 2,
    climb: { maxHeight: 3, costPerLevel: 1 },
  },
  conditions: [
    { id: 'stunned', name: 'Stunned', preventsActions: true, preventsMovement: true },
    { id: 'rooted', name: 'Rooted', preventsMovement: true },
  ],
  abilities: [
    {
      id: 'strike',
      name: 'Strike',
      range: 1,
      target: 'enemy',
      attack: { roll: '1d20 + @str_mod + @prof' },
      effects: [{ type: 'damage', amount: '1d8 + @str_mod' }],
      animation: 'melee',
    },
    {
      id: 'shoot',
      name: 'Shoot',
      range: 6,
      target: 'enemy',
      attack: { roll: '1d20 + @dex_mod + @prof' },
      effects: [{ type: 'damage', amount: '1d6 + @dex_mod' }],
      animation: 'ranged',
    },
    {
      id: 'bash',
      name: 'Shield Bash',
      range: 1,
      target: 'enemy',
      attack: { roll: '1d20 + @str_mod + @prof' },
      effects: [
        { type: 'damage', amount: '1d4' },
        { type: 'applyCondition', condition: 'stunned', rounds: 1 },
      ],
      animation: 'melee',
    },
    {
      id: 'mend',
      name: 'Mend',
      range: 3,
      target: 'ally',
      effects: [{ type: 'heal', amount: '1d8 + 2' }],
      animation: 'spell',
    },
    {
      id: 'second_wind',
      name: 'Second Wind',
      range: 0,
      target: 'self',
      effects: [{ type: 'heal', amount: '1d10 + @level' }],
      animation: 'item',
    },
  ],
  monsters: [
    {
      id: 'goblin',
      name: 'Goblin',
      level: 1,
      stats: { str: 8, dex: 14 },
      abilities: ['strike', 'shoot'],
      xpValue: 50,
    },
    {
      id: 'ogre',
      name: 'Ogre',
      level: 3,
      stats: { str: 18, dex: 8, con: 16 },
      abilities: ['strike'],
      xpValue: 450,
    },
  ],
};
