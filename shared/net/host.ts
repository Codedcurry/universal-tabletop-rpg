import {
  type ActionResult,
  type CombatAction,
  type CombatContext,
  type CombatEvent,
  type CombatState,
  type CombatantSetup,
  type CombatantPatch,
  applyAction,
  beginFight,
  createEncounter,
  describeCombatEvents,
  dmAddCombatant,
  dmEditCombatant,
  dmPlaceCombatant,
  dmRemoveCombatant,
  dmRenameCombatant,
  dmReorderCombatants,
  type StartOptions,
  startCombat,
} from '../combat';
import { DiceNotationError, RollReplayError, type RollResult, replayRoll, roll } from '../dice';
import type { Cell } from '../grid';
import { type MapPatch, applyPatch, isEmptyPatch } from '../editor';
import { type MapData, type WorldMap, createWorldMap } from '../map';
import type { RandomSource } from '../random';
import { type CreatureSheet, type GameSystem, computeCreature, validateGameSystem } from '../system';
import {
  type ClientMessage,
  type HostMessage,
  type LogEntry,
  HEARTBEAT_TIMEOUT_MS,
  MAX_CHAT_LENGTH,
  MAX_NAME_LENGTH,
  PROTOCOL_VERSION,
  type PublicPlayer,
  type RollMode,
  type SessionSnapshot,
  type SessionUpdate,
  parseClientMessage,
} from './protocol';
import { applyUpdate, canSee, insertLogEntry, isPublic, viewFor } from './state';

/**
 * The DM's side of a session. Owns the session state, checks every request
 * from players, and broadcasts results. Knows nothing about WebRTC: the
 * transport reports connections and messages and delivers what this sends.
 */

export interface HostOptions {
  send(connectionId: string, message: HostMessage): void;
  /** Ask the transport to close a connection. */
  disconnect(connectionId: string): void;
  random: RandomSource;
  now(): number;
  dmTitle?: string;
  /** Called after any change, for the DM's UI. */
  onChange?(): void;
  onCombatEvents?(events: readonly CombatEvent[]): void;
}

interface Connection {
  readonly id: string;
  playerId: string | null;
  /** When we last heard anything on this connection. */
  lastSeen: number;
  /** Recent request ids, to ignore retransmitted duplicates. */
  readonly seenRequests: string[];
}

interface PlayerRecord {
  readonly id: string;
  readonly token: string;
  name: string;
  connectionId: string | null;
  character: CreatureSheet | null;
  /** Extra combatants the DM has handed to this player. */
  granted: string[];
}

const DEDUPE_WINDOW = 200;
const NO_ENCOUNTER: ActionResult = { ok: false, reason: 'There is no encounter yet' };

export function characterIdFor(playerId: string): string {
  return `pc-${playerId}`;
}

function checkTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_NAME_LENGTH) {
    throw new Error(`The DM title must be 1 to ${MAX_NAME_LENGTH} characters`);
  }
  return trimmed;
}

export class HostSession {
  private state: SessionSnapshot;
  private worldMap: WorldMap | null = null;
  private readonly connections = new Map<string, Connection>();
  private readonly players: PlayerRecord[] = [];
  private nextPlayerNumber = 1;
  private nextSeq = 1;

  constructor(private readonly options: HostOptions) {
    this.state = {
      version: 0,
      dmTitle: checkTitle(options.dmTitle ?? 'DM'),
      rollMode: 'player',
      players: [],
      system: null,
      map: null,
      combat: null,
      log: [],
    };
  }

  // -------------------------------------------------------------------------
  // Views

  /** The DM's view: everything, including whispers and hidden rolls. */
  snapshot(): SessionSnapshot {
    return this.state;
  }

  /** Exactly what a given player is allowed to see. */
  snapshotFor(playerId: string): SessionSnapshot {
    return viewFor(this.state, playerId);
  }

  // -------------------------------------------------------------------------
  // Transport events

  connected(connectionId: string): void {
    this.connections.set(connectionId, { id: connectionId, playerId: null, lastSeen: this.options.now(), seenRequests: [] });
  }

  disconnected(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    this.connections.delete(connectionId);
    const player = connection?.playerId ? this.player(connection.playerId) : undefined;
    if (!player || player.connectionId !== connectionId) return;
    player.connectionId = null;
    this.publishPlayers();
    this.log({ kind: 'system', text: `${player.name} left` });
  }

  received(connectionId: string, data: unknown): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    connection.lastSeen = this.options.now();
    const message = parseClientMessage(data);
    if (!message) return;

    if (message.type === 'hello') {
      this.hello(connection, message);
      return;
    }
    const player = connection.playerId ? this.player(connection.playerId) : undefined;
    if (!player) return;

    if ('requestId' in message) {
      if (connection.seenRequests.includes(message.requestId)) return;
      connection.seenRequests.push(message.requestId);
      if (connection.seenRequests.length > DEDUPE_WINDOW) connection.seenRequests.shift();
    }

    switch (message.type) {
      case 'pong':
        return; // lastSeen is already updated
      case 'syncRequest':
        this.options.send(connectionId, { type: 'snapshot', snapshot: this.snapshotFor(player.id) });
        return;
      case 'combatAction':
        this.playerAction(connection, player, message.requestId, message.action);
        return;
      case 'chat':
        this.playerChat(connection, player, message.requestId, message.text, message.to);
        return;
      case 'roll':
      case 'rollRequest':
        this.playerRoll(connection, player, message);
        return;
    }
  }

  /**
   * Call every HEARTBEAT_INTERVAL_MS. Pings joined players and drops any
   * connection that has been silent too long, since WebRTC may never report it.
   */
  tick(): void {
    const now = this.options.now();
    for (const connection of [...this.connections.values()]) {
      if (now - connection.lastSeen > HEARTBEAT_TIMEOUT_MS) {
        this.options.disconnect(connection.id);
        this.disconnected(connection.id);
      } else if (connection.playerId) {
        this.options.send(connection.id, { type: 'ping' });
      }
    }
  }

  // -------------------------------------------------------------------------
  // DM controls

  setDmTitle(title: string): void {
    this.publish({ kind: 'settings', dmTitle: checkTitle(title), rollMode: this.state.rollMode });
  }

  setRollMode(rollMode: RollMode): void {
    this.publish({ kind: 'settings', dmTitle: this.state.dmTitle, rollMode });
  }

  setSystem(system: GameSystem): void {
    const result = validateGameSystem(system);
    if (!result.ok) throw new Error(`Invalid game system: ${result.errors[0]?.path} ${result.errors[0]?.message}`);
    this.publish({ kind: 'system', system: result.system });
  }

  setMap(data: MapData): void {
    this.worldMap = createWorldMap(data);
    this.publish({ kind: 'map', map: this.worldMap.toData() });
  }

  /**
   * A live edit from the map editor. Validated first (throws MapError and
   * changes nothing if the result would be invalid), then sent to players.
   */
  editMap(patch: MapPatch): void {
    const current = this.state.map;
    if (!current) throw new Error('Set a map before editing it');
    if (isEmptyPatch(patch)) return;
    this.worldMap = createWorldMap(applyPatch(current, patch));
    this.publish({ kind: 'mapPatch', patch });
  }

  /** Points every connected player's camera at a cell ("focus everyone here"). */
  focusPlayers(cell: Cell): void {
    for (const connection of this.connections.values()) {
      if (connection.playerId) this.options.send(connection.id, { type: 'focus', cell: { q: cell.q, r: cell.r } });
    }
  }

  /** A combat setup for a player's synced character. */
  playerSetup(playerId: string, position: Cell, side = 'party'): CombatantSetup {
    const player = this.player(playerId);
    if (!player?.character) throw new Error(`Player ${playerId} has no character`);
    return { sheet: player.character, side, position, isPlayerCharacter: true };
  }

  startCombat(setups: readonly CombatantSetup[]): readonly CombatEvent[] {
    const { state, events } = startCombat(this.combatContext(), setups, this.options.random);
    this.setCombat(state, events);
    return events;
  }

  /** Clears the encounter: no fight and no creatures on the map. */
  endCombat(): void {
    this.publish({ kind: 'combat', combat: null, events: [] });
  }

  // --- the encounter: placing and changing creatures, before or during a fight ---

  /** Places a creature on the map (starting an encounter if there isn't one). Mid-fight, it rolls initiative. */
  addCreature(setup: CombatantSetup): ActionResult {
    return this.dmEdit((context, combat) => dmAddCombatant(context, combat ?? createEncounter(), setup, this.options.random));
  }

  removeCreature(id: string): ActionResult {
    return this.dmEdit((context, combat) => (combat ? dmRemoveCombatant(context, combat, id) : NO_ENCOUNTER));
  }

  placeCreature(id: string, to: Cell): ActionResult {
    return this.dmEdit((context, combat) => (combat ? dmPlaceCombatant(context, combat, id, to) : NO_ENCOUNTER));
  }

  renameCreature(id: string, name: string): ActionResult {
    return this.dmEdit((_context, combat) => (combat ? dmRenameCombatant(combat, id, name) : NO_ENCOUNTER));
  }

  editCreature(id: string, patch: CombatantPatch): ActionResult {
    return this.dmEdit((context, combat) => (combat ? dmEditCombatant(context, combat, id, patch) : NO_ENCOUNTER));
  }

  /** Sets the turn order (in setup: the listed order, used if the fight starts without initiative). */
  reorderCreatures(order: readonly string[]): ActionResult {
    return this.dmEdit((_context, combat) => (combat ? dmReorderCombatants(combat, order) : NO_ENCOUNTER));
  }

  /**
   * Starts the fight (or starts it again after one ends): rolls initiative for
   * everyone placed, or with `rollInitiative: false` uses the listed order.
   */
  beginFight(options: StartOptions = {}): ActionResult {
    return this.dmEdit((context, combat) => (combat ? beginFight(context, combat, this.options.random, options) : NO_ENCOUNTER));
  }

  /** Stops the fight but keeps everyone on the map, ready to start again. */
  stopFight(): void {
    const combat = this.state.combat;
    if (!combat || combat.status === 'setup') return;
    this.publish({
      kind: 'combat',
      combat: { ...combat, status: 'setup', winner: null, round: 0, turnIndex: 0, movementLeft: 0, actionUsed: false, initiative: {} },
      events: [],
    });
    this.log({ kind: 'system', text: `${this.state.dmTitle} stops the fight` });
  }

  private dmEdit(change: (context: CombatContext, combat: CombatState | null) => ActionResult): ActionResult {
    let context: CombatContext;
    try {
      context = this.combatContext();
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
    const result = change(context, this.state.combat);
    if (result.ok) this.setCombat(result.state, result.events);
    return result;
  }

  /** The DM may act for any creature. */
  act(action: CombatAction): ActionResult {
    const combat = this.state.combat;
    if (!combat) return { ok: false, reason: 'No combat is running' };
    const result = applyAction(this.combatContext(), combat, action, this.options.random);
    if (result.ok) this.setCombat(result.state, result.events);
    return result;
  }

  grantControl(playerId: string, combatantId: string): void {
    const player = this.requirePlayer(playerId);
    if (!player.granted.includes(combatantId)) player.granted = [...player.granted, combatantId];
    this.publishPlayers();
  }

  revokeControl(playerId: string, combatantId: string): void {
    const player = this.requirePlayer(playerId);
    player.granted = player.granted.filter((id) => id !== combatantId);
    this.publishPlayers();
  }

  /** Chat as the DM; `to` whispers to one player. */
  say(text: string, to: string | null = null): void {
    const trimmed = text.trim();
    if (trimmed === '' || trimmed.length > MAX_CHAT_LENGTH) throw new Error('Message is empty or too long');
    if (to !== null) this.requirePlayer(to);
    this.log({ kind: 'chat', from: 'dm', to, text: trimmed });
  }

  /** A DM roll; hidden rolls are only ever seen by the DM. */
  roll(notation: string, { hidden }: { hidden: boolean }): RollResult {
    const result = roll(notation, this.options.random);
    this.log({ kind: 'roll', from: 'dm', mode: 'dm', hidden, result });
    return result;
  }

  // -------------------------------------------------------------------------
  // Player requests

  private hello(connection: Connection, message: Extract<ClientMessage, { type: 'hello' }>): void {
    if (connection.playerId) return;
    if (message.protocol !== PROTOCOL_VERSION) {
      this.rejectJoin(
        connection,
        `This game runs a different version (DM: ${PROTOCOL_VERSION}, you: ${message.protocol}). Reload the page to update.`,
      );
      return;
    }
    const name = message.name.trim();
    if (name.length < 1 || name.length > MAX_NAME_LENGTH) {
      this.rejectJoin(connection, `Pick a name between 1 and ${MAX_NAME_LENGTH} characters`);
      return;
    }

    let player = this.players.find((record) => record.token === message.token);
    const id = player?.id ?? `p${this.nextPlayerNumber}`;
    let character: CreatureSheet | null = null;
    if (message.character) {
      character = { ...message.character, id: characterIdFor(id) };
      const problem = this.characterProblem(character);
      if (problem) {
        this.rejectJoin(connection, `Your character doesn't fit this game: ${problem}`);
        return;
      }
    }

    const returning = player !== undefined;
    if (player) {
      // Same person again (reload, new tab, or network blip): newest connection wins.
      if (player.connectionId && player.connectionId !== connection.id) {
        this.connections.delete(player.connectionId);
        this.options.disconnect(player.connectionId);
      }
      player.name = name;
      player.character = character ?? player.character;
    } else {
      this.nextPlayerNumber++;
      player = { id, token: message.token, name, connectionId: null, character, granted: [] };
      this.players.push(player);
    }
    player.connectionId = connection.id;

    this.publishPlayers();
    this.log({ kind: 'system', text: returning ? `${name} reconnected` : `${name} joined` });
    // Join the broadcast list only now; the welcome snapshot already includes the updates above.
    connection.playerId = player.id;
    this.options.send(connection.id, { type: 'welcome', playerId: player.id, snapshot: this.snapshotFor(player.id) });
  }

  private playerAction(connection: Connection, player: PlayerRecord, requestId: string, action: CombatAction): void {
    const combat = this.state.combat;
    if (!combat) return this.fail(connection, requestId, 'No combat is running');
    if (!this.controls(player).includes(action.actorId)) {
      const name = combat.combatants[action.actorId]?.sheet.name ?? action.actorId;
      return this.fail(connection, requestId, `You don't control ${name}`);
    }
    const result = applyAction(this.combatContext(), combat, action, this.options.random);
    if (!result.ok) return this.fail(connection, requestId, result.reason);
    this.setCombat(result.state, result.events);
  }

  private playerChat(
    connection: Connection,
    player: PlayerRecord,
    requestId: string,
    text: string,
    to: string | null,
  ): void {
    if (to !== null && to !== 'dm') {
      return this.fail(connection, requestId, 'Whispers can only go to the DM');
    }
    this.log({ kind: 'chat', from: player.id, to, text: text.trim() });
  }

  private playerRoll(
    connection: Connection,
    player: PlayerRecord,
    message: Extract<ClientMessage, { type: 'roll' | 'rollRequest' }>,
  ): void {
    const mode = this.state.rollMode;
    const wanted = message.type === 'rollRequest' ? 'dmVerified' : message.mode;
    if (wanted !== mode) {
      const reasons: Record<RollMode, string> = {
        player: 'Roll on your own device in this session',
        dmVerified: 'The DM rolls all dice in this session',
        physical: 'This session uses physical dice: enter what you rolled',
      };
      return this.fail(connection, message.requestId, reasons[mode]);
    }
    let result: RollResult;
    try {
      result =
        message.type === 'rollRequest'
          ? roll(message.notation, this.options.random)
          : replayRoll(message.notation, message.draws);
    } catch (error) {
      if (error instanceof DiceNotationError || error instanceof RollReplayError) {
        return this.fail(connection, message.requestId, error.message);
      }
      throw error;
    }
    this.log({ kind: 'roll', from: player.id, mode, hidden: false, result });
  }

  // -------------------------------------------------------------------------
  // Internals

  private player(id: string): PlayerRecord | undefined {
    return this.players.find((player) => player.id === id);
  }

  private requirePlayer(id: string): PlayerRecord {
    const player = this.player(id);
    if (!player) throw new Error(`No player "${id}"`);
    return player;
  }

  private controls(player: PlayerRecord): string[] {
    const own = player.character ? [player.character.id] : [];
    return [...own, ...player.granted.filter((id) => !own.includes(id))];
  }

  private characterProblem(character: CreatureSheet): string | null {
    const system = this.state.system;
    if (!system) return null;
    const unknown = character.abilities.find((id) => !system.abilities.some((ability) => ability.id === id));
    if (unknown) return `unknown ability "${unknown}"`;
    try {
      computeCreature(system, character);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  private combatContext(): CombatContext {
    const system = this.state.system;
    if (!system || !this.worldMap) throw new Error('Set a game system and a map before combat');
    return { system, map: this.worldMap };
  }

  private setCombat(combat: CombatState, events: readonly CombatEvent[]): void {
    this.publish({ kind: 'combat', combat, events });
    this.options.onCombatEvents?.(events);
    // Write what happened to the log: actions to the Game log, turns and rounds to General.
    const system = this.state.system;
    const lines = describeCombatEvents(events, {
      dmTitle: this.state.dmTitle,
      nameOf: (id) => combat.combatants[id]?.sheet.name ?? id,
      abilityName: (id) => system?.abilities.find((ability) => ability.id === id)?.name ?? id,
      conditionName: (id) => system?.conditions.find((condition) => condition.id === id)?.name ?? id,
    });
    for (const line of lines) {
      if (line.channel === 'general') this.log({ kind: 'system', text: line.text });
      else this.log({ kind: 'game', text: line.text, tone: line.tone });
    }
  }

  private publishPlayers(): void {
    const players: PublicPlayer[] = this.players.map((player) => ({
      id: player.id,
      name: player.name,
      connected: player.connectionId !== null,
      character: player.character,
      controls: this.controls(player),
    }));
    this.publish({ kind: 'players', players });
  }

  /** Applies a public update and sends it to every joined player. */
  private publish(update: SessionUpdate): void {
    const version = this.state.version + 1;
    this.state = applyUpdate(this.state, version, update);
    for (const connection of this.connections.values()) {
      if (connection.playerId) this.options.send(connection.id, { type: 'update', version, update });
    }
    this.options.onChange?.();
  }

  /** Records a log entry and delivers it to exactly the participants who may see it. */
  private log(fields: DistributiveOmit<LogEntry, 'seq' | 'time'>): void {
    const entry = { ...fields, seq: this.nextSeq++, time: this.options.now() } as LogEntry;
    if (isPublic(entry)) {
      this.publish({ kind: 'log', entry });
      return;
    }
    this.state = { ...this.state, log: insertLogEntry(this.state.log, entry) };
    for (const connection of this.connections.values()) {
      if (connection.playerId && canSee(entry, connection.playerId)) {
        this.options.send(connection.id, { type: 'private', entry });
      }
    }
    this.options.onChange?.();
  }

  private rejectJoin(connection: Connection, reason: string): void {
    this.options.send(connection.id, { type: 'joinRejected', reason });
    this.connections.delete(connection.id);
    this.options.disconnect(connection.id);
  }

  private fail(connection: Connection, requestId: string, reason: string): void {
    this.options.send(connection.id, { type: 'requestFailed', requestId, reason });
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
