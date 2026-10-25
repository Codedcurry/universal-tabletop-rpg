import { describe, expect, it } from 'vitest';
import { DIE_SHAPES, type Quat, dieGeometry, dieShapeFor, faceNormal, relabel, rotate, upwardFace } from './polyhedra';

// Real dice shapes for the dice box: their geometry, which face (or, for a
// d4, which corner) ends up on top, and relabelling so the face on top shows
// the result that was already decided.

/** The rotation that turns vector `from` onto vector `to` (both unit length). */
function rotationBetween(from: readonly [number, number, number], to: readonly [number, number, number]): Quat {
  const [ax, ay, az] = from;
  const [bx, by, bz] = to;
  const dot = ax * bx + ay * by + az * bz;
  if (dot < -0.999999) {
    // Opposite: turn half way round any axis at right angles to `from`.
    const axis = Math.abs(ax) < 0.9 ? [0, -az, ay] : [az, 0, -ax];
    const length = Math.hypot(axis[0]!, axis[1]!, axis[2]!);
    return [axis[0]! / length, axis[1]! / length, axis[2]! / length, 0];
  }
  const cx = ay * bz - az * by;
  const cy = az * bx - ax * bz;
  const cz = ax * by - ay * bx;
  const w = 1 + dot;
  const length = Math.hypot(cx, cy, cz, w);
  return [cx / length, cy / length, cz / length, w / length];
}

describe('dice shapes', () => {
  it.each(DIE_SHAPES)('%s has a face (or corner) for every value, once each', (shape) => {
    const geometry = dieGeometry(shape);
    const sides = Number(shape.slice(1));
    const values = geometry.readBy === 'corner' ? geometry.cornerValues! : geometry.faceValues;
    expect([...values].sort((a, b) => a - b)).toEqual(Array.from({ length: sides }, (_, i) => i + 1));
  });

  it.each(DIE_SHAPES)('%s is a closed, convex solid: every face flat, facing outward', (shape) => {
    const geometry = dieGeometry(shape);
    for (let face = 0; face < geometry.faces.length; face++) {
      const normal = faceNormal(geometry, face);
      expect(Math.hypot(...normal)).toBeCloseTo(1, 6);
      const corners = geometry.faces[face]!.map((index) => geometry.vertices[index]!);
      const center = corners.reduce((sum, v) => [sum[0] + v[0] / corners.length, sum[1] + v[1] / corners.length, sum[2] + v[2] / corners.length], [0, 0, 0]);
      expect(normal[0] * center[0] + normal[1] * center[1] + normal[2] * center[2]).toBeGreaterThan(0); // outward
      for (const corner of corners) {
        // Flat: every corner the same distance along the normal.
        const along = normal[0] * corner[0] + normal[1] * corner[1] + normal[2] * corner[2];
        expect(along).toBeCloseTo(normal[0] * center[0] + normal[1] * center[1] + normal[2] * center[2], 5);
      }
      // Every other vertex lies behind the face.
      for (const vertex of geometry.vertices) {
        const along = normal[0] * vertex[0] + normal[1] * vertex[1] + normal[2] * vertex[2];
        expect(along).toBeLessThanOrEqual(normal[0] * center[0] + normal[1] * center[1] + normal[2] * center[2] + 1e-6);
      }
    }
  });

  it.each(DIE_SHAPES.filter((shape) => shape !== 'd4'))('%s reads the face that points up', (shape) => {
    const geometry = dieGeometry(shape);
    for (let face = 0; face < geometry.faces.length; face++) {
      const turn = rotationBetween(faceNormal(geometry, face), [0, 1, 0]);
      expect(upwardFace(geometry, turn)).toBe(face);
    }
  });

  it('a d4 reads the corner that points up', () => {
    const geometry = dieGeometry('d4');
    geometry.vertices.forEach((vertex, corner) => {
      const length = Math.hypot(...vertex);
      const turn = rotationBetween([vertex[0] / length, vertex[1] / length, vertex[2] / length], [0, 1, 0]);
      expect(upwardFace(geometry, turn)).toBe(corner);
    });
  });

  it('rotates vectors by a rotation', () => {
    const quarterTurnAboutY: Quat = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
    const turned = rotate(quarterTurnAboutY, [1, 0, 0]);
    expect(turned[0]).toBeCloseTo(0, 6);
    expect(turned[2]).toBeCloseTo(-1, 6);
  });

  it('knows which shape to throw for each die', () => {
    expect(dieShapeFor(20)).toBe('d20');
    expect(dieShapeFor(10)).toBe('d10');
    expect(dieShapeFor(7)).toBeNull(); // no real die: drawn some other way
  });
});

describe('relabel', () => {
  it('makes the face that landed up show the result, by swapping two labels', () => {
    const labels = [1, 2, 3, 4, 5, 6];
    const relabelled = relabel(labels, 2, 6); // face 2 landed up; the result is 6
    expect(relabelled[2]).toBe(6);
    expect([...relabelled].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(relabelled.filter((value, index) => value !== labels[index])).toHaveLength(2);
  });

  it('leaves the labels alone when the right face already landed up', () => {
    expect(relabel([1, 2, 3, 4], 0, 1)).toEqual([1, 2, 3, 4]);
  });
});
