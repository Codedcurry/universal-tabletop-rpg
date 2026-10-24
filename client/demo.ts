import { type CombatantSetup, setupFromMonster } from '@shared/combat';
import type { Cell } from '@shared/grid';
import { type MapData, rectangleTiles } from '@shared/map';
import type { HostSession } from '@shared/net';
import type { CreatureSheet } from '@shared/system';
import { skirmish } from '@shared/system/samples/skirmish';

// Placeholder content until the map editor (step 5) and character creation
// (step 14) exist: a flat hex field, a stock character, and two goblins.

const WIDTH = 8;
const HEIGHT = 6;

export const demoSystem = skirmish;

export const demoMap: MapData = {
  formatVersion: 1,
  grid: 'hex',
  tiles: rectangleTiles('hex', WIDTH, HEIGHT).map((cell) => ({ ...cell, height: 0 })),
  walls: [],
};

/** Column/row on screen to an axial hex cell (rows are offset, see rectangleTiles). */
function at(column: number, row: number): Cell {
  return { q: column - Math.floor(row / 2), r: row };
}

export function demoCharacter(name: string): CreatureSheet {
  return {
    id: 'character',
    name,
    stats: { str: 14, dex: 12, con: 12 },
    xp: 0,
    abilities: ['strike', 'shoot', 'mend', 'second_wind'],
  };
}

/** Every connected player with a character on the left, two goblins on the right. */
export function demoFight(host: HostSession): CombatantSetup[] {
  const players = host
    .snapshot()
    .players.filter((player) => player.connected && player.character)
    .slice(0, HEIGHT);
  return [
    ...players.map((player, index) => host.playerSetup(player.id, at(1, index))),
    setupFromMonster(skirmish, 'goblin', { id: 'goblin-1', side: 'monsters', position: at(WIDTH - 2, 1), name: 'Goblin 1' }),
    setupFromMonster(skirmish, 'goblin', { id: 'goblin-2', side: 'monsters', position: at(WIDTH - 2, 3), name: 'Goblin 2' }),
  ];
}
