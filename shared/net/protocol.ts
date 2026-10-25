import type { CustomArt } from '../style/art';
import type { CombatAction, CombatEvent, CombatState } from '../combat';
import type { RollResult } from '../dice';
import type { MapPatch } from '../editor';
import type { Cell } from '../grid';
import type { MapData } from '../map';
import type { CreatureSheet, GameSystem } from '../system';

/**
 * Messages between the DM's browser (host) and players' browsers (clients).
 * The DM is the source of truth: clients send requests, the host checks them
 * and broadcasts results.
 */

export const PROTOCOL_VERSION = 1;

export const MAX_NAME_LENGTH = 40;
export const MAX_CHAT_LENGTH = 1000;
export const MAX_NOTATION_LENGTH = 200;
export const MAX_DRAWS = 5000;
/** The DM pings this often; players answer. */
export const HEARTBEAT_INTERVAL_MS = 2000;
/** Silence longer than this means the other side is gone, even if WebRTC hasn't noticed. */
export const HEARTBEAT_TIMEOUT_MS = 7000;
/** How many recent log entries a player's snapshot carries. */
export const MAX_SNAPSHOT_LOG = 500;

/** Who generates dice results for players this session. */
export type RollMode = 'player' | 'dmVerified' | 'physical';
/** Shown in the roll log next to every roll. */
export type RollSource = RollMode | 'dm';

/** "dm" or a player id such as "p1". */
export type ParticipantId = string;

export interface PublicPlayer {
  readonly id: string;
  readonly name: string;
  readonly connected: boolean;
  readonly character: CreatureSheet | null;
  /** Combatant ids this player may act for. */
  readonly controls: readonly string[];
}

interface LogBase {
  /** Increases with every entry; orders and de-duplicates the log. */
  readonly seq: number;
  readonly time: number;
}

export type LogEntry =
  | (LogBase & { readonly kind: 'system'; readonly text: string })
  /** What happened in a fight (the Game log tab). */
  | (LogBase & { readonly kind: 'game'; readonly text: string; readonly tone: 'action' | 'damage' | 'heal' | 'info' | 'xp' })
  | (LogBase & {
      readonly kind: 'chat';
      readonly from: ParticipantId;
      /** null for everyone, otherwise a whisper to one participant. */
      readonly to: ParticipantId | null;
      readonly text: string;
    })
  | (LogBase & {
      readonly kind: 'roll';
      readonly from: ParticipantId;
      readonly mode: RollSource;
      /** Hidden DM rolls are never sent to players. */
      readonly hidden: boolean;
      readonly result: RollResult;
    });

/** Everything a participant can see of the session. */
export interface SessionSnapshot {
  /** Increases with every public update. */
  readonly version: number;
  readonly dmTitle: string;
  readonly rollMode: RollMode;
  /** Players act for their own characters (otherwise the DM plays everyone, apart from creatures handed over). */
  readonly playersControlOwn: boolean;
  /** Players see only what their creatures can see (see shared/vision). */
  readonly fogOfWar: boolean;
  /** The DM's own art for the game, sent to everyone. */
  readonly art: CustomArt;
  readonly players: readonly PublicPlayer[];
  readonly system: GameSystem | null;
  readonly map: MapData | null;
  readonly combat: CombatState | null;
  readonly log: readonly LogEntry[];
}

export type SessionUpdate =
  | { readonly kind: 'players'; readonly players: readonly PublicPlayer[] }
  | { readonly kind: 'settings'; readonly dmTitle: string; readonly rollMode: RollMode; readonly playersControlOwn: boolean; readonly fogOfWar: boolean }
  | { readonly kind: 'system'; readonly system: GameSystem | null }
  | { readonly kind: 'map'; readonly map: MapData | null }
  /** A live edit: just the changed tiles and walls. */
  | { readonly kind: 'mapPatch'; readonly patch: MapPatch }
  | { readonly kind: 'combat'; readonly combat: CombatState | null; readonly events: readonly CombatEvent[] }
  | { readonly kind: 'log'; readonly entry: LogEntry }
  /** The DM's own art for the game (tile textures). */
  | { readonly kind: 'art'; readonly art: CustomArt };

export type ClientMessage =
  | {
      readonly type: 'hello';
      readonly protocol: number;
      /** Secret, kept on the player's device; proves who is reconnecting. */
      readonly token: string;
      readonly name: string;
      readonly character: CreatureSheet | null;
    }
  | { readonly type: 'syncRequest' }
  | { readonly type: 'pong' }
  | { readonly type: 'combatAction'; readonly requestId: string; readonly action: CombatAction }
  | { readonly type: 'chat'; readonly requestId: string; readonly text: string; readonly to: ParticipantId | null }
  | {
      readonly type: 'roll';
      readonly requestId: string;
      readonly notation: string;
      readonly mode: 'player' | 'physical';
      /** The raw random draws, which the DM replays to verify the result. */
      readonly draws: readonly number[];
    }
  | { readonly type: 'rollRequest'; readonly requestId: string; readonly notation: string };

export type HostMessage =
  | { readonly type: 'welcome'; readonly playerId: string; readonly snapshot: SessionSnapshot }
  | { readonly type: 'joinRejected'; readonly reason: string }
  | { readonly type: 'snapshot'; readonly snapshot: SessionSnapshot }
  | { readonly type: 'update'; readonly version: number; readonly update: SessionUpdate }
  /** A log entry only some participants may see (a whisper). Not versioned. */
  | { readonly type: 'private'; readonly entry: LogEntry }
  | { readonly type: 'requestFailed'; readonly requestId: string; readonly reason: string }
  | { readonly type: 'ping' }
  /** "Focus everyone here": a one-off nudge for players' cameras, not session state. */
  | { readonly type: 'focus'; readonly cell: Cell };

// ---------------------------------------------------------------------------
// Validation of untrusted client messages

type Data = Record<string, unknown>;

const isObject = (value: unknown): value is Data =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isInteger = (value: unknown): value is number => Number.isSafeInteger(value);
const isString = (value: unknown, max: number, min = 1): value is string =>
  typeof value === 'string' && value.length >= min && value.length <= max;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

function parseCell(value: unknown): Cell | null {
  if (!isObject(value) || !isInteger(value.q) || !isInteger(value.r)) return null;
  return { q: value.q, r: value.r };
}

function parseSheet(value: unknown): CreatureSheet | null {
  if (!isObject(value)) return null;
  const { id, name, stats, xp, abilities } = value;
  if (!isString(id, 64) || !isString(name, 100) || !isInteger(xp) || xp < 0) return null;
  if (!isObject(stats) || Object.keys(stats).length > 50) return null;
  if (!Object.values(stats).every(isInteger)) return null;
  if (!Array.isArray(abilities) || abilities.length > 100) return null;
  if (!abilities.every((ability) => isString(ability, 64))) return null;
  return { id, name, stats: { ...(stats as Record<string, number>) }, xp, abilities: [...(abilities as string[])] };
}

function parseAction(value: unknown): CombatAction | null {
  if (!isObject(value) || !isString(value.actorId, 64)) return null;
  const actorId = value.actorId;
  switch (value.type) {
    case 'move': {
      const to = parseCell(value.to);
      return to ? { type: 'move', actorId, to } : null;
    }
    case 'useAbility':
      if (!isString(value.abilityId, 64) || !isString(value.targetId, 64)) return null;
      return { type: 'useAbility', actorId, abilityId: value.abilityId, targetId: value.targetId };
    case 'endTurn':
      return { type: 'endTurn', actorId };
    default:
      return null;
  }
}

/**
 * Returns a clean, well-formed message, or null for anything else. Extra
 * fields are dropped. Game-rule checks happen later, in the host session.
 */
export function parseClientMessage(data: unknown): ClientMessage | null {
  if (!isObject(data)) return null;
  switch (data.type) {
    case 'hello': {
      const { protocol, token, name } = data;
      if (!isInteger(protocol) || typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
      if (!isString(name, 200, 0)) return null;
      const character = data.character === null ? null : parseSheet(data.character);
      if (data.character !== null && character === null) return null;
      return { type: 'hello', protocol, token, name, character };
    }
    case 'syncRequest':
      return { type: 'syncRequest' };
    case 'pong':
      return { type: 'pong' };
    default:
      break;
  }

  const requestId = data.requestId;
  if (!isString(requestId, 64)) return null;
  switch (data.type) {
    case 'combatAction': {
      const action = parseAction(data.action);
      return action ? { type: 'combatAction', requestId, action } : null;
    }
    case 'chat': {
      const { text, to } = data;
      if (!isString(text, MAX_CHAT_LENGTH) || text.trim() === '') return null;
      if (to !== null && !isString(to, 64)) return null;
      return { type: 'chat', requestId, text, to };
    }
    case 'roll': {
      const { notation, mode, draws } = data;
      if (!isString(notation, MAX_NOTATION_LENGTH)) return null;
      if (mode !== 'player' && mode !== 'physical') return null;
      if (!Array.isArray(draws) || draws.length > MAX_DRAWS || !draws.every(isInteger)) return null;
      return { type: 'roll', requestId, notation, mode, draws: [...(draws as number[])] };
    }
    case 'rollRequest':
      if (!isString(data.notation, MAX_NOTATION_LENGTH)) return null;
      return { type: 'rollRequest', requestId, notation: data.notation };
    default:
      return null;
  }
}

const HOST_MESSAGE_TYPES = new Set(['welcome', 'joinRejected', 'snapshot', 'update', 'private', 'requestFailed', 'ping', 'focus']);

/** Light check for messages from the DM, who is trusted; guards against stray data. */
export function parseHostMessage(data: unknown): HostMessage | null {
  return isObject(data) && HOST_MESSAGE_TYPES.has(data.type as string) ? (data as unknown as HostMessage) : null;
}
