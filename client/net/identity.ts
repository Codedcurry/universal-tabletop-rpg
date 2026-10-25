// Small per-device memory. Storage can be unavailable (private mode, blocked
// site data), so every access is guarded and the app still works without it.

const TOKEN_KEY = 'ttrpg.token';
const NAME_KEY = 'ttrpg.name';
const JOINED_KEY = 'ttrpg.joinedRoom';

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: string): void {
  try {
    storage().setItem(key, value);
  } catch {
    // Not fatal: the value just won't survive a reload.
  }
}

const local = () => localStorage;
const session = () => sessionStorage;

function randomToken(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

let memoryToken: string | null = null;

/**
 * Secret player identity. Kept per browser tab (sessionStorage), so a reload
 * keeps your seat, and two tabs on one PC count as two players when testing.
 */
export function playerToken(): string {
  const stored = read(session, TOKEN_KEY);
  if (stored) return stored;
  memoryToken ??= randomToken();
  write(session, TOKEN_KEY, memoryToken);
  return memoryToken;
}

export const savedName = (): string => read(local, NAME_KEY) ?? '';
export const saveName = (name: string): void => write(local, NAME_KEY, name);

/** The room this tab last joined, so a reload rejoins it automatically. */
export const joinedRoom = (): string | null => read(session, JOINED_KEY);
export const rememberJoinedRoom = (code: string): void => write(session, JOINED_KEY, code);

const HOSTED_KEY = 'ttrpg.hostedRoom';
/** The room this tab is hosting, so a reload carries the game on automatically. */
export const hostedRoom = (): string | null => read(session, HOSTED_KEY);
export const rememberHostedRoom = (code: string): void => write(session, HOSTED_KEY, code);
