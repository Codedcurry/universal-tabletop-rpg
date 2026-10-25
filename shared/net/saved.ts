import type { CombatState } from '../combat';
import type { Cell } from '../grid';
import { type MapData, validateMapData } from '../map';
import { type CreatureSheet, type GameSystem, validateGameSystem } from '../system';
import { type LogEntry, MAX_NAME_LENGTH, type RollMode } from './protocol';
import { normalizeRoomCode } from './room';

/**
 * A saved game: everything the DM's side needs to carry on after a reload,
 * or on another computer from a file. Players' seats are saved with their
 * secret tokens, so returning players get their own seats back; that makes
 * this file the DM's alone (it also holds the DM's notes).
 */

export const SAVED_GAME_FORMAT = 'universal-tabletop-rpg/game';
export const SAVED_GAME_VERSION = 1;

export interface SavedPlayer {
  readonly id: string;
  readonly token: string;
  readonly name: string;
  readonly character: CreatureSheet | null;
  /** Creatures the DM handed to this player. */
  readonly granted: readonly string[];
}

export interface SavedGame {
  readonly format: typeof SAVED_GAME_FORMAT;
  readonly version: typeof SAVED_GAME_VERSION;
  /** The room code, so players' join links keep working. */
  readonly code: string;
  /** When it was saved (milliseconds since 1970). */
  readonly savedAt: number;
  readonly state: {
    readonly dmTitle: string;
    readonly rollMode: RollMode;
    readonly playersControlOwn: boolean;
    readonly fogOfWar: boolean;
    readonly system: GameSystem | null;
    readonly map: MapData | null;
    readonly combat: CombatState | null;
    readonly log: readonly LogEntry[];
  };
  readonly players: readonly SavedPlayer[];
  readonly notes: readonly { readonly cell: Cell; readonly text: string }[];
  readonly nextPlayerNumber: number;
  readonly nextSeq: number;
}

export type SavedGameValidation = { readonly ok: true; readonly game: SavedGame } | { readonly ok: false; readonly error: string };

type Data = Record<string, unknown>;
const isObject = (value: unknown): value is Data => typeof value === 'object' && value !== null && !Array.isArray(value);
const ROLL_MODES: readonly string[] = ['player', 'dmVerified', 'physical'];

function sheetProblem(sheet: unknown): string | null {
  if (sheet === null) return null;
  if (!isObject(sheet)) return 'is not a character';
  if (typeof sheet.id !== 'string' || typeof sheet.name !== 'string') return 'has no id or name';
  if (!isObject(sheet.stats) || !Array.isArray(sheet.abilities) || typeof sheet.xp !== 'number') return 'is missing stats, abilities, or XP';
  return null;
}

/** Checks a saved game (from storage or a file someone picked) before it is used. */
export function validateSavedGame(data: unknown): SavedGameValidation {
  const fail = (error: string): SavedGameValidation => ({ ok: false, error });
  if (!isObject(data) || data.format !== SAVED_GAME_FORMAT) return fail('This is not a saved game file');
  if (typeof data.version !== 'number' || data.version > SAVED_GAME_VERSION) {
    return fail('This game was saved by a newer version of the app; update to load it');
  }
  if (data.version !== SAVED_GAME_VERSION) return fail(`Unsupported saved game version ${String(data.version)}`);
  if (typeof data.code !== 'string' || normalizeRoomCode(data.code) !== data.code) return fail('The saved room code is invalid');
  if (typeof data.savedAt !== 'number') return fail('The save has no date');

  const state = data.state;
  if (!isObject(state)) return fail('The saved game has no state');
  if (typeof state.dmTitle !== 'string' || state.dmTitle.trim().length < 1 || state.dmTitle.length > MAX_NAME_LENGTH) {
    return fail('The DM title is invalid');
  }
  if (typeof state.rollMode !== 'string' || !ROLL_MODES.includes(state.rollMode)) return fail('The dice setting is invalid');
  if (typeof state.playersControlOwn !== 'boolean' || typeof state.fogOfWar !== 'boolean') return fail('The game settings are invalid');
  if (state.system !== null) {
    const system = validateGameSystem(state.system);
    if (!system.ok) return fail(`The game system is broken: ${system.errors[0]?.message ?? 'unknown problem'}`);
  }
  if (state.map !== null) {
    const map = validateMapData(state.map);
    if (!map.ok) return fail(`The map is broken: ${map.error}`);
  }
  if (state.combat !== null && (!isObject(state.combat) || !Array.isArray(state.combat.order) || !isObject(state.combat.combatants))) {
    return fail('The fight is broken');
  }
  if (!Array.isArray(state.log) || !state.log.every((entry) => isObject(entry) && typeof entry.seq === 'number' && typeof entry.kind === 'string')) {
    return fail('The log is broken');
  }

  if (!Array.isArray(data.players)) return fail('The players are missing');
  for (const [index, player] of data.players.entries()) {
    if (!isObject(player) || typeof player.id !== 'string' || typeof player.token !== 'string' || typeof player.name !== 'string') {
      return fail(`Player ${index + 1} is broken`);
    }
    if (!Array.isArray(player.granted) || !player.granted.every((id) => typeof id === 'string')) return fail(`Player ${index + 1} is broken`);
    const problem = sheetProblem(player.character ?? null);
    if (problem) return fail(`Player ${index + 1}'s character ${problem}`);
  }
  if (!Array.isArray(data.notes) || !data.notes.every((note) => isObject(note) && isObject(note.cell) && typeof note.text === 'string')) {
    return fail('The notes are broken');
  }
  for (const counter of ['nextPlayerNumber', 'nextSeq'] as const) {
    const value = data[counter];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return fail('The saved counters are broken');
  }
  return { ok: true, game: data as unknown as SavedGame };
}
