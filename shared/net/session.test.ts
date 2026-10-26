import { describe, expect, it } from 'vitest';
import { type CombatAction, setupFromMonster } from '../combat';
import { applyEdit, diffMaps } from '../editor';
import { createWorldMap, rectangleTiles, type MapData } from '../map';
import type { CreatureSheet } from '../system';
import { skirmish } from '../system/samples/skirmish';
import { type ClientSession, HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS, type LogEntry, PROTOCOL_VERSION, validateSavedGame } from './index';
import { type TestPlayer, createTestNetwork } from './testing';

const anaSheet: CreatureSheet = {
  id: 'whatever-the-player-picked',
  name: 'Ana the Bold',
  stats: { str: 16, dex: 12, con: 14 },
  xp: 0,
  abilities: ['strike', 'second_wind'],
};

const map: MapData = {
  formatVersion: 1,
  grid: 'hex',
  tiles: rectangleTiles('hex', 7, 7).map((cell) => ({ ...cell, height: 0 })),
  walls: [],
};

function texts(log: readonly LogEntry[]): string[] {
  return log.map((entry) => (entry.kind === 'roll' ? `roll:${entry.result.total}` : entry.text));
}

/** The client's view must exactly match what the DM would send that player. */
function expectInSync(network: ReturnType<typeof createTestNetwork>, ...players: TestPlayer[]): void {
  for (const player of players) {
    const id = player.session.playerId as string;
    expect(player.session.state).toEqual(network.host.snapshotFor(id));
  }
}

function setupCombat(network: ReturnType<typeof createTestNetwork>, ana: TestPlayer) {
  network.host.setSystem(skirmish);
  network.host.setMap(map);
  const anaId = ana.session.playerId as string;
  // Ana's d20 initiative is drawn first, then the goblin's: Ana goes first.
  network.hostRandom.push(19, 0);
  network.host.startCombat([
    network.host.playerSetup(anaId, { q: 2, r: 3 }),
    { ...goblinSetup(), position: { q: 3, r: 3 } },
  ]);
  network.flush();
  return `pc-${anaId}`;
}

function goblinSetup() {
  return {
    sheet: { id: 'goblin', name: 'Goblin', stats: { str: 8, dex: 14, con: 10 }, xp: 0, abilities: ['strike'] },
    side: 'monsters',
    position: { q: 3, r: 3 },
    isPlayerCharacter: false,
    xpValue: 50,
  };
}

describe('joining', () => {
  it('welcomes a player with an id and the current session', () => {
    const network = createTestNetwork({ dmTitle: 'Keeper' });
    const ana = network.join('Ana');
    expect(ana.session.status).toBe('connected');
    expect(ana.session.playerId).toBe('p1');
    expect(ana.session.state?.dmTitle).toBe('Keeper');
    expect(network.host.snapshot().players).toEqual([
      { id: 'p1', name: 'Ana', connected: true, character: null, controls: [] },
    ]);
    expectInSync(network, ana);
  });

  it('tells everyone when someone joins', () => {
    const network = createTestNetwork();
    const ana = network.join('Ana');
    const ben = network.join('Ben');
    expect(ben.session.playerId).toBe('p2');
    expect(ana.session.state?.players.map((player) => player.name)).toEqual(['Ana', 'Ben']);
    expect(texts(ana.session.state?.log ?? [])).toEqual(['Ana joined', 'Ben joined']);
    expectInSync(network, ana, ben);
  });

  it('trims names and rejects empty or overlong ones', () => {
    const network = createTestNetwork();
    expect(network.join('  Ana  ').session.state?.players[0]?.name).toBe('Ana');
    for (const name of ['   ', 'x'.repeat(41)]) {
      const player = network.join(name);
      expect(player.session.status).toBe('rejected');
      expect(player.session.rejectionReason).toMatch(/name/i);
    }
    expect(network.host.snapshot().players).toHaveLength(1);
  });

  it('rejects a client speaking a different protocol version, and hangs up', () => {
    const network = createTestNetwork();
    const raw = network.rawConnection();
    raw.send({ type: 'hello', protocol: PROTOCOL_VERSION + 1, token: 'other_token_123456789', name: 'Old', character: null });
    expect(raw.messages).toEqual([{ type: 'joinRejected', reason: expect.stringMatching(/version/i) }]);
    expect(raw.closed).toBe(true);
    expect(network.host.snapshot().players).toEqual([]);
  });

  it('syncs the player character on join, under an id the DM assigns', () => {
    const network = createTestNetwork();
    network.host.setSystem(skirmish);
    const ana = network.join('Ana', { character: anaSheet });
    const [player] = network.host.snapshot().players;
    expect(player?.character).toEqual({ ...anaSheet, id: 'pc-p1' });
    expect(player?.controls).toEqual(['pc-p1']);
    expect(ana.session.canControl('pc-p1')).toBe(true);
    expect(ana.session.canControl('goblin')).toBe(false);
  });

  it("fits a character to the game system, dropping what the system doesn't have", () => {
    const network = createTestNetwork();
    network.host.setSystem(skirmish);
    const ana = network.join('Ana', { character: { ...anaSheet, stats: { ...anaSheet.stats, luck: 3 }, abilities: ['fireball', 'strike'] } });
    expect(ana.session.status).toBe('connected');
    const setup = network.host.playerSetup('p1', { q: 0, r: 0 });
    expect(setup.sheet.abilities).toEqual(['strike']);
    expect(setup.sheet.stats).not.toHaveProperty('luck');
  });

  it('gives a character left with no abilities the system\'s first, so it can still act', () => {
    const network = createTestNetwork();
    network.host.setSystem(skirmish);
    network.join('Ana', { character: { ...anaSheet, abilities: ['fireball'] } });
    expect(network.host.playerSetup('p1', { q: 0, r: 0 }).sheet.abilities).toEqual(['strike']);
  });

  it('fits creatures in play when the rules change, and logs what changed', () => {
    const network = createTestNetwork({ dmTitle: 'Keeper' });
    const ana = network.join('Ana', { character: anaSheet });
    network.host.setSystem(skirmish);
    network.host.setMap(map);
    network.host.addCreature(setupFromMonster(skirmish, 'goblin', { id: 'goblin', side: 'monsters', position: { q: 2, r: 2 } }));
    const changes = network.host.setSystem({
      ...skirmish,
      abilities: skirmish.abilities.filter((ability) => ability.id !== 'shoot'),
      monsters: skirmish.monsters.map((monster) => ({ ...monster, abilities: monster.abilities.filter((ability) => ability !== 'shoot') })),
    });
    network.flush();
    expect(changes).toEqual(['Goblin loses ability shoot']);
    expect(ana.session.state?.combat?.combatants.goblin?.sheet.abilities).toEqual(['strike']);
    expect(ana.session.state?.log.at(-1)).toMatchObject({ kind: 'system', text: 'Keeper updates the rules (Skirmish): Goblin loses ability shoot' });
    // The same rules again: nothing to log.
    const logged = network.host.snapshot().log.length;
    network.host.setSystem(network.host.snapshot().system!);
    expect(network.host.snapshot().log).toHaveLength(logged);
  });

  it('answers nothing before hello', () => {
    const network = createTestNetwork();
    const raw = network.rawConnection();
    raw.send({ type: 'chat', requestId: 'r1', text: 'sneaky', to: null });
    raw.send({ type: 'syncRequest' });
    expect(raw.messages).toEqual([]);
    expect(network.host.snapshot().log).toEqual([]);
  });

  it('ignores garbage from a joined player', () => {
    const network = createTestNetwork();
    const ana = network.join('Ana');
    for (const junk of [null, 'hello', [], { type: 'becomeDm' }, { type: 'chat', text: 5 }]) ana.sendRaw(junk);
    expect(ana.session.status).toBe('connected');
    expect(network.host.snapshot().log).toHaveLength(1);
  });
});

describe('reconnecting', () => {
  it('marks a dropped player as disconnected and tells the others', () => {
    const network = createTestNetwork();
    const ana = network.join('Ana');
    const ben = network.join('Ben');
    ana.disconnect();
    expect(ana.session.status).toBe('reconnecting');
    expect(ben.session.state?.players[0]).toMatchObject({ name: 'Ana', connected: false });
    expect(texts(ben.session.state?.log ?? []).at(-1)).toBe('Ana left');
  });

  it('gives the same seat back when the same token reconnects', () => {
    const network = createTestNetwork();
    network.host.setSystem(skirmish);
    const ana = network.join('Ana', { character: anaSheet });
    ana.disconnect();
    ana.reconnect();
    expect(ana.session.status).toBe('connected');
    expect(ana.session.playerId).toBe('p1');
    expect(network.host.snapshot().players).toHaveLength(1);
    expect(network.host.snapshot().players[0]).toMatchObject({ connected: true, controls: ['pc-p1'] });
    expect(texts(network.host.snapshot().log).at(-1)).toBe('Ana reconnected');
    expectInSync(network, ana);
  });

  it('keeps only the newest connection when the same player opens a second tab', () => {
    const network = createTestNetwork();
    const firstTab = network.join('Ana', { token: 'shared_token_abcdefgh' });
    const secondTab = network.join('Ana', { token: 'shared_token_abcdefgh' });
    expect(secondTab.session.playerId).toBe('p1');
    expect(firstTab.session.status).toBe('reconnecting');
    expect(network.host.snapshot().players).toHaveLength(1);
  });

  it("can't act while disconnected", () => {
    const network = createTestNetwork();
    const ana = network.join('Ana');
    ana.disconnect();
    expect(ana.session.say('hello?')).toBeNull();
    expect(network.host.snapshot().log.filter((entry) => entry.kind === 'chat')).toHaveLength(0);
  });
});

describe('settings', () => {
  it("shares the DM's chosen title with everyone", () => {
    const network = createTestNetwork();
    const ana = network.join('Ana');
    network.host.setDmTitle('  Narrator ');
    network.flush();
    expect(ana.session.state?.dmTitle).toBe('Narrator');
    expect(() => network.host.setDmTitle('')).toThrow();
    expect(() => network.host.setDmTitle('x'.repeat(41))).toThrow();
  });
});

describe('chat', () => {
  it('broadcasts player chat to everyone', () => {
    const network = createTestNetwork();
    const ana = network.join('Ana');
    const ben = network.join('Ben');
    ana.session.say('hi all');
    network.flush();
    for (const view of [network.host.snapshot().log, ben.session.state?.log ?? []]) {
      expect(view.at(-1)).toMatchObject({ kind: 'chat', from: 'p1', to: null, text: 'hi all' });
    }
    expectInSync(network, ana, ben);
  });

  it('delivers a DM whisper only to its recipient', () => {
    const network = createTestNetwork();
    const ana = network.join('Ana');
    const ben = network.join('Ben');
    network.host.say('the door is a mimic', 'p1');
    network.flush();
    expect(texts(ana.session.state?.log ?? [])).toContain('the door is a mimic');
    expect(texts(ben.session.state?.log ?? [])).not.toContain('the door is a mimic');
    expect(texts(network.host.snapshot().log)).toContain('the door is a mimic');
    expectInSync(network, ana, ben);
  });

  it('lets a player whisper to the DM, unseen by others', () => {
    const network = createTestNetwork();
    const ana = network.join('Ana');
    const ben = network.join('Ben');
    ana.session.say('I pocket the gem', 'dm');
    network.flush();
    expect(texts(network.host.snapshot().log)).toContain('I pocket the gem');
    expect(texts(ana.session.state?.log ?? [])).toContain('I pocket the gem');
    expect(texts(ben.session.state?.log ?? [])).not.toContain('I pocket the gem');
  });

  it("doesn't allow whispers between players", () => {
    const network = createTestNetwork();
    const ana = network.join('Ana');
    network.join('Ben');
    ana.session.say('secret plan', 'p2');
    network.flush();
    expect(ana.failures).toEqual([expect.stringMatching(/whisper/i)]);
    expect(texts(network.host.snapshot().log)).not.toContain('secret plan');
  });

  it('keeps whispers private from players who join later', () => {
    const network = createTestNetwork();
    network.join('Ana');
    network.host.say('psst', 'p1');
    const ben = network.join('Ben');
    expect(texts(ben.session.state?.log ?? [])).not.toContain('psst');
  });
});

describe('dice', () => {
  it("rolls on the player's device and everyone sees the same result", () => {
    const network = createTestNetwork();
    const ana = network.join('Ana', { random: [3, 5] });
    const ben = network.join('Ben');
    ana.session.roll('2d6+1');
    network.flush();
    const entry = network.host.snapshot().log.at(-1);
    expect(entry).toMatchObject({ kind: 'roll', from: 'p1', mode: 'player', hidden: false, result: { total: 11 } });
    expect(ben.session.state?.log.at(-1)).toEqual(entry);
    expectInSync(network, ana, ben);
  });

  it('rejects impossible dice from a tampered client', () => {
    const network = createTestNetwork();
    const ana = network.join('Ana');
    ana.sendRaw({ type: 'roll', requestId: 'x1', notation: '1d20', mode: 'player', draws: [25] });
    ana.sendRaw({ type: 'roll', requestId: 'x2', notation: '2d6', mode: 'player', draws: [5] });
    ana.sendRaw({ type: 'roll', requestId: 'x3', notation: '2d', mode: 'player', draws: [] });
    expect(ana.failures).toHaveLength(3);
    expect(network.host.snapshot().log.filter((entry) => entry.kind === 'roll')).toEqual([]);
  });

  it('can make the DM roll for players (DM-verified mode)', () => {
    const network = createTestNetwork();
    const ana = network.join('Ana', { random: [0] });
    network.host.setRollMode('dmVerified');
    network.flush();
    network.hostRandom.push(19);
    ana.session.roll('1d20');
    network.flush();
    expect(network.host.snapshot().log.at(-1)).toMatchObject({ kind: 'roll', from: 'p1', mode: 'dmVerified', result: { total: 20 } });
  });

  it('refuses player-made dice when the DM rolls for everyone', () => {
    const network = createTestNetwork();
    const ana = network.join('Ana');
    network.host.setRollMode('dmVerified');
    network.flush();
    ana.sendRaw({ type: 'roll', requestId: 'x1', notation: '1d20', mode: 'player', draws: [19] });
    expect(ana.failures).toEqual([expect.stringMatching(/DM/)]);
  });

  it('records physical dice as manual entries', () => {
    const network = createTestNetwork();
    const ana = network.join('Ana');
    network.host.setRollMode('physical');
    network.flush();
    ana.session.rollPhysical('1d20', [17]);
    network.flush();
    expect(network.host.snapshot().log.at(-1)).toMatchObject({ mode: 'physical', result: { total: 17 } });
  });

  it('keeps hidden DM rolls on the DM side only', () => {
    const network = createTestNetwork();
    const ana = network.join('Ana');
    network.hostRandom.push(4, 13);
    network.host.roll('1d20', { hidden: true });
    network.host.roll('1d20', { hidden: false });
    network.flush();
    const rolls = (log: readonly LogEntry[]) => log.filter((entry) => entry.kind === 'roll');
    expect(rolls(network.host.snapshot().log)).toHaveLength(2);
    expect(rolls(ana.session.state?.log ?? [])).toEqual([
      expect.objectContaining({ mode: 'dm', hidden: false, result: expect.objectContaining({ total: 14 }) }),
    ]);
    expectInSync(network, ana);
  });

  it('shows a bad notation error immediately, without sending anything', () => {
    const network = createTestNetwork();
    const ana = network.join('Ana');
    expect(() => ana.session.roll('2d')).toThrow();
  });
});

describe('combat', () => {
  it('broadcasts combat state and events from the DM', () => {
    const network = createTestNetwork();
    const ana = network.join('Ana', { character: anaSheet });
    network.host.setSystem(skirmish);
    const ben = network.join('Ben');
    setupCombat(network, ana);
    expect(ana.session.state?.combat?.order).toEqual(['pc-p1', 'goblin']);
    expect(ben.combatEvents.at(-1)?.map((event) => event.type)).toEqual([
      'initiativeRolled',
      'initiativeRolled',
      'combatStarted',
      'roundStarted',
      'turnStarted',
    ]);
    expectInSync(network, ana, ben);
  });

  it("lets a player act for their own character on its turn", () => {
    const network = createTestNetwork();
    const ana = network.join('Ana', { character: anaSheet });
    const characterId = setupCombat(network, ana);
    network.hostRandom.push(9, 0);
    ana.session.act({ type: 'useAbility', actorId: characterId, abilityId: 'strike', targetId: 'goblin' });
    network.flush();
    expect(ana.failures).toEqual([]);
    expect(ana.session.state?.combat?.combatants.goblin?.hp).toBe(4);
    expect(network.dmCombatEvents.at(-1)?.map((event) => event.type)).toEqual(['abilityUsed', 'attackRolled', 'damaged']);
    expectInSync(network, ana);
  });

  it("refuses actions for creatures the player doesn't control", () => {
    const network = createTestNetwork();
    const ana = network.join('Ana', { character: anaSheet });
    setupCombat(network, ana);
    const before = network.host.snapshot().combat;
    ana.session.act({ type: 'endTurn', actorId: 'goblin' });
    network.flush();
    expect(ana.failures).toEqual([expect.stringMatching(/control/i)]);
    expect(network.host.snapshot().combat).toEqual(before);
  });

  it('passes on rule violations from the engine', () => {
    const network = createTestNetwork();
    const ana = network.join('Ana', { character: anaSheet });
    const characterId = setupCombat(network, ana);
    ana.session.act({ type: 'move', actorId: characterId, to: { q: 3, r: 3 } });
    network.flush();
    expect(ana.failures).toEqual([expect.stringMatching(/reach/i)]);
  });

  it('lets the DM hand control of a creature to a player', () => {
    const network = createTestNetwork();
    const ana = network.join('Ana', { character: anaSheet });
    const characterId = setupCombat(network, ana);
    network.host.grantControl('p1', 'goblin');
    network.flush();
    expect(ana.session.canControl('goblin')).toBe(true);
    const endTurn: CombatAction = { type: 'endTurn', actorId: characterId };
    ana.session.act(endTurn);
    ana.session.act({ type: 'endTurn', actorId: 'goblin' });
    network.flush();
    expect(ana.failures).toEqual([]);
    expect(ana.session.state?.combat?.round).toBe(2);
    network.host.revokeControl('p1', 'goblin');
    network.flush();
    expect(ana.session.canControl('goblin')).toBe(false);
  });

  it("can stop players controlling their own characters, so the DM plays everyone, and hand it back", () => {
    const network = createTestNetwork();
    const ana = network.join('Ana', { character: anaSheet });
    const characterId = setupCombat(network, ana);
    expect(ana.session.state?.playersControlOwn).toBe(true);
    network.host.setPlayersControlOwn(false);
    network.flush();
    expect(ana.session.state?.playersControlOwn).toBe(false);
    expect(ana.session.canControl(characterId)).toBe(false);
    ana.session.act({ type: 'endTurn', actorId: characterId });
    network.flush();
    expect(ana.failures).toEqual([expect.stringMatching(/don't control/i)]);
    expect(network.host.act({ type: 'endTurn', actorId: characterId }).ok).toBe(true);
    expect(texts(network.host.snapshot().log)).toContain('DM now controls the players\' characters');

    network.host.setPlayersControlOwn(true);
    network.flush();
    expect(ana.session.canControl(characterId)).toBe(true);
    expect(texts(network.host.snapshot().log)).toContain('Players control their own characters again');
  });

  it('keeps creatures the DM handed over, even while players don\'t control their own', () => {
    const network = createTestNetwork();
    const ana = network.join('Ana', { character: anaSheet });
    setupCombat(network, ana);
    network.host.setPlayersControlOwn(false);
    network.host.grantControl('p1', 'goblin');
    network.flush();
    expect(ana.session.canControl('goblin')).toBe(true);
  });

  it('lets the DM act for any creature', () => {
    const network = createTestNetwork();
    const ana = network.join('Ana', { character: anaSheet });
    const characterId = setupCombat(network, ana);
    expect(network.host.act({ type: 'endTurn', actorId: characterId }).ok).toBe(true);
    expect(network.host.act({ type: 'endTurn', actorId: 'goblin' }).ok).toBe(true);
    network.flush();
    expect(ana.session.state?.combat?.round).toBe(2);
  });
});

describe('sync under bad network conditions', () => {
  it('recovers from a lost update by asking for a fresh snapshot', () => {
    const network = createTestNetwork();
    const ana = network.join('Ana');
    let dropped = false;
    network.intercept((envelope) => {
      if (!dropped && envelope.direction === 'toClient' && envelope.data?.includes('"update"')) {
        dropped = true;
        return 'drop';
      }
      return 'deliver';
    });
    network.host.setDmTitle('Lost title');
    network.host.say('after the gap');
    network.flush();
    expect(ana.session.state?.dmTitle).toBe('Lost title');
    expectInSync(network, ana);
  });

  it('ignores duplicated messages', () => {
    const network = createTestNetwork();
    const ana = network.join('Ana');
    network.intercept(() => 'duplicate');
    network.host.say('once');
    ana.session.say('also once');
    network.flush();
    expect(texts(ana.session.state?.log ?? []).filter((text) => text.endsWith('once'))).toEqual(['once', 'also once']);
    expectInSync(network, ana);
  });

  it('copes with updates arriving out of order', () => {
    const network = createTestNetwork();
    const ana = network.join('Ana');
    let first = true;
    network.intercept((envelope) => {
      if (first && envelope.direction === 'toClient') {
        first = false;
        return 'hold';
      }
      return 'deliver';
    });
    network.host.say('one');
    network.host.say('two');
    network.flush();
    network.intercept(null);
    network.release();
    expect(texts(ana.session.state?.log ?? []).slice(-2)).toEqual(['one', 'two']);
    expectInSync(network, ana);
  });

  it('catches a late joiner up on the whole session', () => {
    const network = createTestNetwork({ dmTitle: 'Keeper' });
    const ana = network.join('Ana', { character: anaSheet });
    setupCombat(network, ana);
    network.host.say('welcome');
    const ben = network.join('Ben');
    expect(ben.session.state?.combat).toEqual(network.host.snapshot().combat);
    expect(ben.session.state?.map).toEqual(createWorldMap(map).toData());
    expect(texts(ben.session.state?.log ?? [])).toContain('welcome');
    expectInSync(network, ana, ben);
  });

  it('resyncs everything after reconnecting', () => {
    const network = createTestNetwork();
    const ana = network.join('Ana');
    const ben = network.join('Ben');
    ana.disconnect();
    network.host.say('you missed this');
    ben.session.say('me too');
    network.flush();
    ana.reconnect();
    expect(texts(ana.session.state?.log ?? [])).toEqual(expect.arrayContaining(['you missed this', 'me too']));
    expectInSync(network, ana, ben);
  });
});

it('every player view is plain JSON', () => {
  const network = createTestNetwork();
  const ana: { session: ClientSession } = network.join('Ana', { character: anaSheet });
  expect(JSON.parse(JSON.stringify(ana.session.state))).toEqual(ana.session.state);
});

describe('heartbeat', () => {
  // WebRTC often doesn't notice when the other side vanishes (crashed tab,
  // phone asleep), so the DM pings and both sides watch for silence.

  it('keeps a quiet but healthy connection alive', () => {
    const network = createTestNetwork();
    const ana = network.join('Ana');
    for (let second = 0; second < 30; second += 2) {
      network.advance(HEARTBEAT_INTERVAL_MS);
      network.host.tick();
      network.flush();
    }
    expect(network.host.snapshot().players[0]?.connected).toBe(true);
    expect(ana.session.isStale(network.now())).toBe(false);
  });

  it('marks a player who goes silent as away', () => {
    const network = createTestNetwork();
    const ana = network.join('Ana');
    const ben = network.join('Ben');
    network.intercept((envelope) =>
      envelope.direction === 'toHost' && envelope.connectionId === ana.connectionId ? 'drop' : 'deliver',
    );
    // Pings go out every interval; Ben answers, Ana's answers never arrive.
    for (let elapsed = 0; elapsed <= HEARTBEAT_TIMEOUT_MS; elapsed += HEARTBEAT_INTERVAL_MS) {
      network.advance(HEARTBEAT_INTERVAL_MS);
      network.host.tick();
      network.flush();
    }
    expect(network.host.snapshot().players.map((player) => player.connected)).toEqual([false, true]);
    expect(texts(ben.session.state?.log ?? []).at(-1)).toBe('Ana left');
  });

  it("lets a player notice when the DM goes silent", () => {
    const network = createTestNetwork();
    const ana = network.join('Ana');
    expect(ana.session.isStale(network.now())).toBe(false);
    network.intercept((envelope) => (envelope.direction === 'toClient' ? 'drop' : 'deliver'));
    network.advance(HEARTBEAT_TIMEOUT_MS - 1);
    expect(ana.session.isStale(network.now())).toBe(false);
    network.advance(2);
    expect(ana.session.isStale(network.now())).toBe(true);
  });

  it('counts any message from the DM as a sign of life', () => {
    const network = createTestNetwork();
    const ana = network.join('Ana');
    network.advance(HEARTBEAT_TIMEOUT_MS - 1);
    network.host.say('still here');
    network.flush();
    network.advance(HEARTBEAT_TIMEOUT_MS - 1);
    expect(ana.session.isStale(network.now())).toBe(false);
  });
});

describe('live map editing', () => {
  const raiseCorner = (data: MapData) =>
    diffMaps(data, applyEdit(data, { type: 'raise', cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }], amount: 2 }));

  it("sends the DM's edits to players as small patches", () => {
    const network = createTestNetwork();
    const ana = network.join('Ana');
    network.host.setMap(map);
    network.flush();
    const sent: string[] = [];
    network.intercept((envelope) => {
      if (envelope.direction === 'toClient' && envelope.data) sent.push(envelope.data);
      return 'deliver';
    });
    network.host.editMap(raiseCorner(network.host.snapshot().map as MapData));
    network.flush();
    expect(ana.session.state?.map).toEqual(network.host.snapshot().map);
    expect(createWorldMap(ana.session.state?.map as MapData).tile({ q: 0, r: 0 })?.height).toBe(2);
    // A patch, not the whole 49-tile map.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('"mapPatch"');
    expect(sent[0]?.length).toBeLessThan(400);
    expectInSync(network, ana);
  });

  it('refuses edits before there is a map', () => {
    const network = createTestNetwork();
    expect(() => network.host.editMap(raiseCorner(map))).toThrow();
  });

  it('refuses an invalid patch and changes nothing', () => {
    const network = createTestNetwork();
    network.host.setMap(map);
    const before = network.host.snapshot();
    const bad = { tiles: [{ q: 0, r: 0, height: 999 }], removeTiles: [], addWalls: [], removeWalls: [] };
    expect(() => network.host.editMap(bad)).toThrow();
    expect(network.host.snapshot()).toBe(before);
  });

  it('ignores an empty patch', () => {
    const network = createTestNetwork();
    network.host.setMap(map);
    const version = network.host.snapshot().version;
    network.host.editMap(diffMaps(map, map));
    expect(network.host.snapshot().version).toBe(version);
  });

  it('applies the rules to the edited map during combat', () => {
    const network = createTestNetwork();
    const ana = network.join('Ana', { character: anaSheet });
    const characterId = setupCombat(network, ana);
    const current = network.host.snapshot().map as MapData;
    network.host.editMap(diffMaps(current, applyEdit(current, { type: 'setBlocked', cells: [{ q: 1, r: 3 }], blocked: true })));
    ana.session.act({ type: 'move', actorId: characterId, to: { q: 1, r: 3 } });
    network.flush();
    expect(ana.failures).toEqual([expect.stringMatching(/reach/i)]);
  });
});

describe('"focus everyone here"', () => {
  it("points every connected player's camera at a spot", () => {
    const network = createTestNetwork();
    const ana = network.join('Ana');
    const ben = network.join('Ben');
    ben.disconnect();
    network.host.focusPlayers({ q: 2, r: 3 });
    network.flush();
    expect(ana.focuses).toEqual([{ q: 2, r: 3 }]);
    expect(ben.focuses).toEqual([]);
  });

  it('is a one-off nudge, not shared state: late joiners are not sent there', () => {
    const network = createTestNetwork();
    network.join('Ana');
    network.host.focusPlayers({ q: 2, r: 3 });
    const before = network.host.snapshot().version;
    const cat = network.join('Cat');
    expect(cat.focuses).toEqual([]);
    expect(network.host.snapshot().version).toBeGreaterThan(before); // only the join changed state
  });
});

describe('combat in the log', () => {
  it('writes what happens in a fight to everyone\'s log: actions in the Game log, turns in General', () => {
    const network = createTestNetwork();
    const ana = network.join('Ana', { character: anaSheet });
    const characterId = setupCombat(network, ana);
    network.hostRandom.push(9, 0);
    ana.session.act({ type: 'useAbility', actorId: characterId, abilityId: 'strike', targetId: 'goblin' });
    ana.session.act({ type: 'endTurn', actorId: characterId });
    network.flush();
    const game = (log: readonly LogEntry[]) => log.filter((entry) => entry.kind === 'game').map((entry) => entry.text);
    const general = (log: readonly LogEntry[]) => log.filter((entry) => entry.kind === 'system').map((entry) => entry.text);
    for (const log of [network.host.snapshot().log, ana.session.state?.log ?? []]) {
      expect(game(log)).toEqual(
        expect.arrayContaining([
          'The fight begins! Turn order: Ana the Bold, Goblin',
          "Ana the Bold's Strike on Goblin: 15 vs defense 12, hit",
          'Goblin takes 4 damage (4 HP left)',
        ]),
      );
      expect(general(log)).toEqual(expect.arrayContaining(['Round 1', "Ana the Bold's turn", "Goblin's turn"]));
    }
    expectInSync(network, ana);
  });
});

describe("the DM's encounter controls", () => {
  function staged() {
    const network = createTestNetwork({ dmTitle: 'Keeper' });
    const ana = network.join('Ana', { character: anaSheet });
    network.host.setSystem(skirmish);
    network.host.setMap(map);
    expect(network.host.addCreature(network.host.playerSetup('p1', { q: 1, r: 3 })).ok).toBe(true);
    expect(network.host.addCreature({ ...goblinSetup(), position: { q: 4, r: 3 } }).ok).toBe(true);
    network.flush();
    return { network, ana };
  }

  it('places creatures before the fight, and players see them', () => {
    const { network, ana } = staged();
    expect(ana.session.state?.combat?.status).toBe('setup');
    expect(Object.keys(ana.session.state?.combat?.combatants ?? {})).toEqual(['pc-p1', 'goblin']);
    expect(texts(ana.session.state?.log ?? [])).toContain('Keeper adds Goblin');
    expectInSync(network, ana);
  });

  it('renames, edits, moves, and removes creatures at any moment', () => {
    const { network, ana } = staged();
    network.hostRandom.push(19, 0);
    expect(network.host.beginFight().ok).toBe(true);
    expect(network.host.renameCreature('goblin', 'Grizzle').ok).toBe(true);
    expect(network.host.editCreature('goblin', { hp: 3 }).ok).toBe(true);
    expect(network.host.placeCreature('goblin', { q: 5, r: 3 }).ok).toBe(true);
    network.flush();
    const goblin = ana.session.state?.combat?.combatants.goblin;
    expect(goblin?.sheet.name).toBe('Grizzle');
    expect(goblin?.hp).toBe(3);
    expect(goblin?.position).toEqual({ q: 5, r: 3 });
    expect(texts(ana.session.state?.log ?? [])).toEqual(
      expect.arrayContaining(['Keeper renames Goblin to Grizzle', 'Keeper changes Grizzle: HP 8 → 3', 'Keeper moves Grizzle']),
    );
    expect(network.host.removeCreature('goblin').ok).toBe(true);
    network.flush();
    expect(ana.session.state?.combat?.status).toBe('ended');
    expectInSync(network, ana);
  });

  it('reorders the turn order, and can start the fight in that order', () => {
    const { network, ana } = staged();
    expect(network.host.reorderCreatures(['goblin', 'pc-p1']).ok).toBe(true);
    expect(network.host.beginFight({ rollInitiative: false }).ok).toBe(true);
    network.flush();
    expect(ana.session.state?.combat?.order).toEqual(['goblin', 'pc-p1']);
    expect(ana.session.state?.combat?.order[ana.session.state.combat.turnIndex]).toBe('goblin');
    expect(texts(ana.session.state?.log ?? [])).toContain('Keeper changes the turn order: Goblin, Ana the Bold');
    expectInSync(network, ana);
  });

  it('reports a refused change instead of applying it', () => {
    const { network } = staged();
    const result = network.host.placeCreature('goblin', { q: 1, r: 3 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/occupied/i);
  });

  it('can stop a fight and keep everyone on the map, or clear the encounter', () => {
    const { network, ana } = staged();
    network.hostRandom.push(19, 0);
    network.host.beginFight();
    network.host.stopFight();
    network.flush();
    expect(ana.session.state?.combat?.status).toBe('setup');
    expect(Object.keys(ana.session.state?.combat?.combatants ?? {})).toHaveLength(2);
    network.host.endCombat();
    network.flush();
    expect(ana.session.state?.combat).toBeNull();
  });
});

describe('fog of war and DM notes', () => {
  it('turns fog of war on and off for everyone', () => {
    const network = createTestNetwork({ dmTitle: 'Keeper' });
    const ana = network.join('Ana');
    expect(ana.session.state?.fogOfWar).toBe(false);
    network.host.setFogOfWar(true);
    network.flush();
    expect(ana.session.state?.fogOfWar).toBe(true);
    expect(texts(ana.session.state?.log ?? [])).toContain('Keeper turns on fog of war');
    network.host.setFogOfWar(false);
    network.flush();
    expect(ana.session.state?.fogOfWar).toBe(false);
  });

  it('keeps DM notes on tiles for the DM only: nothing about them reaches players', () => {
    const network = createTestNetwork();
    const sent: string[] = [];
    network.intercept((envelope) => {
      if (envelope.direction === 'toClient' && typeof envelope.data === 'string') sent.push(envelope.data);
      return 'deliver';
    });
    const ana = network.join('Ana');
    network.host.setMap(map);
    network.host.setNote({ q: 2, r: 3 }, 'A trapdoor to the smugglers’ tunnel');
    network.host.setNote({ q: 4, r: 1 }, '  ');
    network.flush();
    expect(network.host.notes()).toEqual([{ cell: { q: 2, r: 3 }, text: 'A trapdoor to the smugglers’ tunnel' }]);
    expect(sent.join('\n')).not.toContain('trapdoor');
    expect(JSON.stringify(ana.session.state)).not.toContain('trapdoor');

    network.host.setNote({ q: 2, r: 3 }, '');
    expect(network.host.notes()).toEqual([]);
  });

  it('refuses notes that are too long', () => {
    const network = createTestNetwork();
    expect(() => network.host.setNote({ q: 0, r: 0 }, 'x'.repeat(2001))).toThrow(/long/);
  });
});

describe('custom art', () => {
  const grass = { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', width: 16, height: 16 };

  it('sends the DM\'s tile art to every player, and takes it away again', () => {
    const network = createTestNetwork();
    const ana = network.join('Ana');
    network.host.setTileArt('grass', grass);
    network.flush();
    expect(ana.session.state?.art.tiles.grass).toEqual(grass);
    network.host.setTileArt('grass', null);
    network.flush();
    expect(ana.session.state?.art.tiles).toEqual({});
  });

  it('refuses images that are not images, or too big', () => {
    const network = createTestNetwork();
    expect(() => network.host.setTileArt('grass', { ...grass, dataUrl: 'https://example.com/x.png' })).toThrow(/image/i);
    expect(() => network.host.setTileArt('grass', { ...grass, width: 5000 })).toThrow(/pixels/);
  });

  it('is saved with the game', () => {
    const network = createTestNetwork();
    network.host.setTileArt('stone', grass);
    const restored = createTestNetwork({ restore: JSON.parse(JSON.stringify(network.host.saveGame('CAVE42'))) });
    expect(restored.host.snapshot().art.tiles.stone).toEqual(grass);
  });
});

describe('character art', () => {
  const sheet = { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', width: 32, height: 64 };
  const row = (r: number) => ({ row: r, frames: 2, mirror: false });
  const goblinArt = { image: sheet, layout: { frameSize: 16, clips: { idle: { down: row(0), left: row(1), right: row(2), up: row(3) } } }, token: null };

  it('sends a character\'s sprite sheet to every player, and removes it', () => {
    const network = createTestNetwork();
    const ana = network.join('Ana');
    network.host.setCharacterArt('goblin', goblinArt);
    network.flush();
    expect(ana.session.state?.art.characters.goblin).toEqual(goblinArt);
    network.host.setCharacterArt('goblin', null);
    network.flush();
    expect(ana.session.state?.art.characters).toEqual({});
  });

  it('keeps how a character was built for the DM alone, to edit it again; saved, and gone with the art', () => {
    const network = createTestNetwork();
    const ana = network.join('Ana');
    const source = { image: sheet, picks: { side: { idle: [0, 1] } }, faces: 'left' as const, token: { sprite: 0, crop: { x: 1, y: 2, size: 12 } } };
    network.host.setCharacterArt('goblin', goblinArt, source);
    network.flush();
    expect(network.host.artSource('goblin')).toEqual(source);
    expect(JSON.stringify(ana.session.state)).not.toContain('"picks"');
    expect(JSON.stringify(network.host.snapshot())).not.toContain('"picks"');

    const saved = network.host.saveGame('CAVE42');
    expect(validateSavedGame(JSON.parse(JSON.stringify(saved))).ok).toBe(true);
    expect(createTestNetwork({ restore: saved }).host.artSource('goblin')).toEqual(source);

    network.host.setCharacterArt('goblin', null);
    expect(network.host.artSource('goblin')).toBeNull();
    expect(() => network.host.setCharacterArt('goblin', goblinArt, { ...source, faces: 'up' as 'left' })).toThrow(/faces/);
  });

  it('refuses a sheet layout that doesn\'t fit its image', () => {
    const network = createTestNetwork();
    expect(() => network.host.setCharacterArt('goblin', { ...goblinArt, layout: { frameSize: 16, clips: { idle: { down: row(9), left: row(1), right: row(2), up: row(3) } } } })).toThrow(/off the sheet/);
  });
});
