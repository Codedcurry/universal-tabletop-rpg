import { describe, expect, it } from 'vitest';
import { rectangleTiles, type MapData } from '../map';
import { setupFromMonster } from '../combat';
import type { CreatureSheet } from '../system';
import { skirmish } from '../system/samples/skirmish';
import { SAVED_GAME_VERSION, type SavedGame, validateSavedGame } from './index';
import { createTestNetwork } from './testing';

// Saving the whole game on the DM's side (map, system, fight, log, settings,
// notes, and each player's seat) so it survives a reload, and can be written
// to a file as a backup and loaded back.

const anaSheet: CreatureSheet = { id: 'ana', name: 'Ana the Bold', stats: { str: 14, dex: 12, con: 12 }, xp: 0, abilities: ['strike'] };
const map: MapData = {
  formatVersion: 1,
  grid: 'hex',
  tiles: rectangleTiles('hex', 6, 5).map((cell) => ({ ...cell, height: 0 })),
  walls: [],
};

/** A game in progress: a player with a character, a map, a fight, chat, notes, and changed settings. */
function gameInProgress() {
  const network = createTestNetwork({ dmTitle: 'Keeper' });
  const ana = network.join('Ana', { character: anaSheet, token: 'ana_token_abcdefgh' });
  network.host.setSystem(skirmish);
  network.host.setMap(map);
  network.host.setFogOfWar(true);
  network.host.setRollMode('dmVerified');
  network.host.addCreature(network.host.playerSetup('p1', { q: 1, r: 2 }));
  network.host.addCreature(setupFromMonster(skirmish, 'goblin', { id: 'goblin', side: 'monsters', position: { q: 4, r: 2 } }));
  network.host.grantControl('p1', 'goblin');
  network.host.say('Welcome to the cove');
  network.host.setNote({ q: 3, r: 3 }, 'Hidden stash under the stones');
  network.flush();
  return { network, ana };
}

describe('saving the game', () => {
  it('keeps everything needed to carry on: settings, system, map, fight, log, players, and notes', () => {
    const { network } = gameInProgress();
    const saved = network.host.saveGame('CAVE42');
    expect(saved.version).toBe(SAVED_GAME_VERSION);
    expect(saved.code).toBe('CAVE42');

    const restored = createTestNetwork({ restore: saved });
    const before = network.host.snapshot();
    const after = restored.host.snapshot();
    expect(after.dmTitle).toBe('Keeper');
    expect(after.fogOfWar).toBe(true);
    expect(after.rollMode).toBe('dmVerified');
    expect(after.system).toEqual(before.system);
    expect(after.map).toEqual(before.map);
    expect(after.combat).toEqual(before.combat);
    expect(after.log).toEqual(before.log);
    expect(after.players.map((player) => ({ ...player, connected: false }))).toEqual(before.players.map((player) => ({ ...player, connected: false })));
    expect(restored.host.notes()).toEqual(network.host.notes());
  });

  it('shows players as away until they come back', () => {
    const { network } = gameInProgress();
    const restored = createTestNetwork({ restore: network.host.saveGame('CAVE42') });
    expect(restored.host.snapshot().players.every((player) => !player.connected)).toBe(true);
  });

  it('gives a returning player their own seat back, character and handed-over creatures included', () => {
    const { network } = gameInProgress();
    const restored = createTestNetwork({ restore: network.host.saveGame('CAVE42') });
    const ana = restored.join('Ana', { token: 'ana_token_abcdefgh' });
    restored.flush();
    expect(ana.session.playerId).toBe('p1');
    expect(ana.session.canControl('goblin')).toBe(true);
    expect(ana.session.state?.combat?.combatants['pc-p1']).toBeDefined();
    // Someone new gets the next seat, not one already taken.
    const ben = restored.join('Ben');
    restored.flush();
    expect(ben.session.playerId).toBe('p2');
  });

  it('carries on numbering log entries after the saved ones', () => {
    const { network } = gameInProgress();
    const restored = createTestNetwork({ restore: network.host.saveGame('CAVE42') });
    const lastSeq = Math.max(...restored.host.snapshot().log.map((entry) => entry.seq));
    restored.host.say('We meet again');
    expect(restored.host.snapshot().log.at(-1)?.seq).toBe(lastSeq + 1);
  });
});

describe('game files', () => {
  const saved = (): SavedGame => gameInProgress().network.host.saveGame('CAVE42');

  it('survive being written to a file and read back', () => {
    const file = JSON.parse(JSON.stringify(saved()));
    expect(validateSavedGame(file)).toEqual({ ok: true, game: file });
  });

  it.each<[string, (game: Record<string, unknown>) => unknown]>([
    ['something that is not a game file', () => ({ hello: 'world' })],
    ['a file from a newer version', (game) => ({ ...game, version: SAVED_GAME_VERSION + 1 })],
    ['a broken map', (game) => ({ ...game, state: { ...(game.state as object), map: { tiles: 'nope' } } })],
    ['a broken game system', (game) => ({ ...game, state: { ...(game.state as object), system: { name: 3 } } })],
    ['a bad room code', (game) => ({ ...game, code: 'not a code!' })],
    ['broken players', (game) => ({ ...game, players: [{ id: 7 }] })],
  ])('refuse %s, with a reason', (_name, spoil) => {
    const result = validateSavedGame(spoil(JSON.parse(JSON.stringify(saved()))));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(5);
  });
});
