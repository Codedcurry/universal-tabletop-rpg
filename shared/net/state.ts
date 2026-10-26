import { applyPatch } from '../editor';
import { type LogEntry, MAX_SNAPSHOT_LOG, type ParticipantId, type SessionSnapshot, type SessionUpdate } from './protocol';

// Shared by host and clients so both apply updates in exactly the same way.

/** Whether a participant ("dm" or a player id) may see a log entry. */
export function canSee(entry: LogEntry, viewer: ParticipantId): boolean {
  if (viewer === 'dm') return true;
  switch (entry.kind) {
    case 'system':
    case 'game':
      return true;
    case 'chat':
      return entry.to === null || entry.from === viewer || entry.to === viewer;
    case 'roll':
      return !entry.hidden;
  }
}

/** Everyone can see it, so it travels as a versioned public update. */
export function isPublic(entry: LogEntry): boolean {
  return canSee(entry, '\0nobody');
}

/** Adds an entry in seq order, ignoring duplicates, keeping at most `limit` entries. */
export function insertLogEntry(log: readonly LogEntry[], entry: LogEntry, limit = Infinity): LogEntry[] {
  if (log.some((existing) => existing.seq === entry.seq)) return [...log];
  const next = [...log];
  let index = next.length;
  while (index > 0 && (next[index - 1] as LogEntry).seq > entry.seq) index--;
  next.splice(index, 0, entry);
  return next.length > limit ? next.slice(next.length - limit) : next;
}

export function applyUpdate(
  snapshot: SessionSnapshot,
  version: number,
  update: SessionUpdate,
  logLimit = Infinity,
): SessionSnapshot {
  const next = { ...snapshot, version };
  switch (update.kind) {
    case 'players':
      return { ...next, players: update.players };
    case 'art':
      return { ...next, art: update.art };
    case 'settings':
      return { ...next, dmTitle: update.dmTitle, rollMode: update.rollMode, playersControlOwn: update.playersControlOwn, fogOfWar: update.fogOfWar };
    case 'system':
      return update.combat === undefined ? { ...next, system: update.system } : { ...next, system: update.system, combat: update.combat };
    case 'map':
      return { ...next, map: update.map };
    case 'mapPatch':
      if (!snapshot.map) throw new Error('A map patch arrived before any map');
      return { ...next, map: applyPatch(snapshot.map, update.patch) };
    case 'combat':
      return { ...next, combat: update.combat };
    case 'log':
      return { ...next, log: insertLogEntry(snapshot.log, update.entry, logLimit) };
  }
}

/** A player's view of the session: only log entries they may see, most recent first trimmed. */
export function viewFor(snapshot: SessionSnapshot, viewer: ParticipantId): SessionSnapshot {
  const log = snapshot.log.filter((entry) => canSee(entry, viewer));
  return { ...snapshot, log: log.slice(Math.max(0, log.length - MAX_SNAPSHOT_LOG)) };
}
