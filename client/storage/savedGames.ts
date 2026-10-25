import { type SavedGame, validateSavedGame } from '@shared/net';

// Saved games, kept in this browser's IndexedDB (one per room code). The
// DM's game is saved here as it changes, so a reload or a closed tab
// doesn't end it. If storage is blocked (some private windows), every call
// quietly does nothing: the game still runs, it just isn't kept.

const DB_NAME = 'universal-tabletop-rpg';
const STORE = 'games';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'code' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = work(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/** Every saved game in this browser, newest first (ones that no longer check out are skipped). */
export async function listSavedGames(): Promise<SavedGame[]> {
  try {
    const all = await run('readonly', (store) => store.getAll() as IDBRequest<unknown[]>);
    return all
      .map((entry) => validateSavedGame(entry))
      .flatMap((result) => (result.ok ? [result.game] : []))
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

/** Saves a game (replacing its last save). True if it was kept. */
export async function putSavedGame(game: SavedGame): Promise<boolean> {
  try {
    await run('readwrite', (store) => store.put(game));
    return true;
  } catch {
    return false; // not kept; the game carries on
  }
}

export async function deleteSavedGame(code: string): Promise<void> {
  try {
    await run('readwrite', (store) => store.delete(code));
  } catch {
    // Nothing to do.
  }
}
