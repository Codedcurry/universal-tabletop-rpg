import { describe, expect, it } from 'vitest';
import { scriptedRandom } from '../random';
import { ROOM_CODE_ALPHABET, createRoomCode, normalizeRoomCode, reconnectDelay, roomPeerId } from './index';

describe('room codes', () => {
  it('are 6 characters from an alphabet without look-alikes (no I, O, 0, 1)', () => {
    expect(ROOM_CODE_ALPHABET).toHaveLength(32);
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[IO01]/);
    const code = createRoomCode(scriptedRandom([0, 1, 2, 29, 30, 31]));
    expect(code).toBe('ABC789');
  });

  it('normalize what people type: case, spaces, and dashes', () => {
    expect(normalizeRoomCode(' abc-789 ')).toBe('ABC789');
    expect(normalizeRoomCode('ab c78 9')).toBe('ABC789');
  });

  it('reject anything that cannot be a room code', () => {
    expect(normalizeRoomCode('ABC78')).toBeNull();
    expect(normalizeRoomCode('ABC7890')).toBeNull();
    expect(normalizeRoomCode('ABCO89')).toBeNull();
    expect(normalizeRoomCode('')).toBeNull();
  });

  it('map to a namespaced peer id for the DM', () => {
    expect(roomPeerId('ABC789')).toBe('ttrpg-room-ABC789');
  });
});

describe('reconnectDelay', () => {
  it('backs off exponentially from half a second, capped at 8 seconds', () => {
    expect([0, 1, 2, 3, 4, 5, 20].map(reconnectDelay)).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000]);
  });
});
