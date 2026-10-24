import type { RandomSource } from '../random';

/** Letters and digits that can't be confused with each other (no I/1, O/0). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

export function createRoomCode(random: RandomSource): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[random.nextInt(ROOM_CODE_ALPHABET.length)];
  return code;
}

/** Cleans up a typed or pasted code; returns null if it can't be a room code. */
export function normalizeRoomCode(text: string): string | null {
  const code = text.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/** The PeerJS id the DM's browser registers, so players can find it from the code. */
export function roomPeerId(code: string): string {
  return `ttrpg-room-${code}`;
}

/** Milliseconds to wait before reconnect attempt number `attempt` (0-based). */
export function reconnectDelay(attempt: number): number {
  return Math.min(8000, 500 * 2 ** attempt);
}
