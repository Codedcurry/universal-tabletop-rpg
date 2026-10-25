import { describe, expect, it } from 'vitest';
import { dieGeometry, faceNormal, rotate, upwardFace } from '@shared/dice';
import { TRAY, simulateThrow } from './simulate';

// The dice box's physics: a seeded throw into the tray, simulated ahead of
// time and recorded frame by frame, so it can be played back (and the
// faces relabelled to show the decided result).

const final = (recording: ReturnType<typeof simulateThrow>, piece: number) => {
  const frame = recording.frames[piece]!;
  const at = (recording.ticks - 1) * 7;
  return { position: [frame[at]!, frame[at + 1]!, frame[at + 2]!] as const, rotation: [frame[at + 3]!, frame[at + 4]!, frame[at + 5]!, frame[at + 6]!] as const };
};

describe('simulateThrow', () => {
  it('is the same every time for the same seed', () => {
    const a = simulateThrow([{ shape: 'd20' }, { shape: 'd6' }], 42);
    const b = simulateThrow([{ shape: 'd20' }, { shape: 'd6' }], 42);
    expect(a.ticks).toBe(b.ticks);
    expect(final(a, 0)).toEqual(final(b, 0));
    expect(final(a, 1)).toEqual(final(b, 1));
  });

  it('lands every die at rest on the floor, inside the tray', () => {
    const shapes = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'coin'] as const;
    const recording = simulateThrow(shapes.map((shape) => ({ shape })), 7);
    shapes.forEach((_, index) => {
      const { position } = final(recording, index);
      expect(Math.abs(position[0])).toBeLessThan(TRAY.width / 2);
      expect(Math.abs(position[2])).toBeLessThan(TRAY.depth / 2);
      expect(position[1]).toBeGreaterThan(0);
      expect(position[1]).toBeLessThan(1.5); // resting on the floor (or another die), not flying
    });
    expect(recording.ticks).toBeLessThan(6 * 60);
  });

  it('lands dice flat, so the face on top can be read', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const recording = simulateThrow([{ shape: 'd20' }, { shape: 'd6' }], seed);
      for (const [index, shape] of (['d20', 'd6'] as const).entries()) {
        const geometry = dieGeometry(shape);
        const { rotation } = final(recording, index);
        const up = rotate(rotation, faceNormal(geometry, upwardFace(geometry, rotation)))[1];
        expect(up, `${shape}, seed ${seed}`).toBeGreaterThan(0.9);
      }
    }
  });

  it('records the knocks, for the clacking sounds', () => {
    const recording = simulateThrow([{ shape: 'd6' }, { shape: 'd6' }, { shape: 'd6' }], 9);
    expect(recording.impacts.length).toBeGreaterThan(2);
    for (const impact of recording.impacts) {
      expect(impact.tick).toBeGreaterThanOrEqual(0);
      expect(impact.tick).toBeLessThan(recording.ticks);
      expect(impact.strength).toBeGreaterThan(0);
    }
  });

  it('handles a big handful of dice', () => {
    const recording = simulateThrow(Array.from({ length: 20 }, () => ({ shape: 'd6' as const })), 3);
    expect(recording.frames).toHaveLength(20);
    expect(recording.ticks).toBeLessThan(6 * 60);
  });
});
