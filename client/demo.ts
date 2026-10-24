import { type CombatantSetup, setupFromMonster } from '@shared/combat';
import { blankMap } from '@shared/editor';
import { type Cell, createGrid } from '@shared/grid';
import type { MapData } from '@shared/map';
import type { HostSession } from '@shared/net';
import type { CreatureSheet } from '@shared/system';
import { skirmish } from '@shared/system/samples/skirmish';

// Placeholder content until character creation (step 14) and proper
// encounter setup exist: a stock character and two goblins.

export const demoSystem = skirmish;

/** Used when the DM starts a fight before making a map. */
export const demoMap: MapData = blankMap('hex', 8, 6);

export function demoCharacter(name: string): CreatureSheet {
  return {
    id: 'character',
    name,
    stats: { str: 14, dex: 12, con: 12 },
    xp: 0,
    abilities: ['strike', 'shoot', 'mend', 'second_wind'],
  };
}

/**
 * Connected players on open tiles at the west edge of the map, two goblins
 * at the east edge. Throws if the map doesn't have room.
 */
export function demoFight(host: HostSession): CombatantSetup[] {
  const { players, map } = host.snapshot();
  if (!map) throw new Error('Make a map first');
  const grid = createGrid(map.grid);
  const open: Cell[] = map.tiles
    .filter((tile) => !tile.blocked)
    .sort((a, b) => grid.toWorld(a, 1).x - grid.toWorld(b, 1).x || a.r - b.r);
  const heroes = players.filter((player) => player.connected && player.character);
  if (open.length < heroes.length + 2) throw new Error('The map needs more open tiles for this fight');

  const west = open.slice(0, heroes.length);
  const east = open.slice(-2);
  return [
    ...heroes.map((player, index) => host.playerSetup(player.id, west[index] as Cell)),
    setupFromMonster(skirmish, 'goblin', { id: 'goblin-1', side: 'monsters', position: east[0] as Cell, name: 'Goblin 1' }),
    setupFromMonster(skirmish, 'goblin', { id: 'goblin-2', side: 'monsters', position: east[1] as Cell, name: 'Goblin 2' }),
  ];
}
