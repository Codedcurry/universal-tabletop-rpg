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
 * Connected players on open tiles at the west edge of the map, two monsters
 * at the east edge: goblins, or the first monster of the rules in play.
 * Throws if the map doesn't have room or the rules have no monsters.
 */
export function demoFight(host: HostSession): CombatantSetup[] {
  const { players, map } = host.snapshot();
  if (!map) throw new Error('Make a map first');
  const system = host.snapshot().system ?? skirmish;
  const monster = system.monsters.find((entry) => entry.id === 'goblin') ?? system.monsters[0];
  if (!monster) throw new Error(`${system.name} has no monsters to fight`);
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
    setupFromMonster(system, monster.id, { id: `${monster.id}-1`, side: 'monsters', position: east[0] as Cell, name: `${monster.name} 1` }),
    setupFromMonster(system, monster.id, { id: `${monster.id}-2`, side: 'monsters', position: east[1] as Cell, name: `${monster.name} 2` }),
  ];
}
