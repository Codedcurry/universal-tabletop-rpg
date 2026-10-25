/**
 * Real dice shapes for the dice box (d4, d6, d8, d10, d12, d20, and a
 * coin): their corners and faces, the value on each face, which face ends
 * up on top after a throw, and relabelling so that face shows the result
 * that was already decided (the throw is physics; the result stays fair).
 */

export type Vec3 = readonly [number, number, number];
/** A rotation as a unit quaternion [x, y, z, w]. */
export type Quat = readonly [number, number, number, number];

export const DIE_SHAPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'] as const;
export type DieShape = (typeof DIE_SHAPES)[number];

export interface DieGeometry {
  /** Corners, scaled so the farthest is 1 from the center. */
  readonly vertices: readonly Vec3[];
  /** Each face's corners, in order counter-clockwise seen from outside. */
  readonly faces: readonly (readonly number[])[];
  /** The value on each face (0: a face that never counts, like a coin's rim). */
  readonly faceValues: readonly number[];
  /** A d4 is read by the corner pointing up; everything else by the face. */
  readonly readBy: 'face' | 'corner';
  /** For a d4: the value of each corner. */
  readonly cornerValues?: readonly number[];
}

const PHI = (1 + Math.sqrt(5)) / 2;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(...v);
  return [v[0] / length, v[1] / length, v[2] / length];
};

/** Every sign combination of a point, e.g. (±1, ±1, ±1). */
function signs(x: number, y: number, z: number): Vec3[] {
  const points: Vec3[] = [];
  for (const sx of x === 0 ? [1] : [1, -1]) for (const sy of y === 0 ? [1] : [1, -1]) for (const sz of z === 0 ? [1] : [1, -1]) points.push([sx * x, sy * y, sz * z]);
  return points;
}

/** The three cyclic orders of a point: (x, y, z), (z, x, y), (y, z, x). */
const cyclic = (points: Vec3[]): Vec3[] => points.flatMap(([x, y, z]) => [[x, y, z] as Vec3, [z, x, y] as Vec3, [y, z, x] as Vec3]);

function corners(shape: DieShape | 'coin'): Vec3[] {
  switch (shape) {
    case 'd4':
      return [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
    case 'd6':
      return signs(1, 1, 1);
    case 'd8':
      return [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    case 'd12':
      return [...signs(1, 1, 1), ...cyclic(signs(0, 1 / PHI, PHI))];
    case 'd20':
      return cyclic(signs(0, 1, PHI));
    case 'd10': {
      // A pentagonal trapezohedron: two apexes and a zig-zag ring. The apex
      // height that makes each kite-shaped face flat follows from the ring.
      const ring = 0.1;
      const c72 = Math.cos((2 * Math.PI) / 5);
      const s72 = Math.sin((2 * Math.PI) / 5);
      const c36 = Math.cos(Math.PI / 5);
      const s36 = Math.sin(Math.PI / 5);
      const k = s72 * c36 + (1 - c72) * s36;
      const apex = ring + (2 * ring * s72) / (k - s72);
      const points: Vec3[] = [[0, apex, 0], [0, -apex, 0]];
      for (let i = 0; i < 10; i++) {
        const angle = (i * Math.PI) / 5;
        points.push([Math.cos(angle), i % 2 === 0 ? ring : -ring, Math.sin(angle)]);
      }
      return points;
    }
    case 'coin': {
      const points: Vec3[] = [];
      for (let i = 0; i < 12; i++) {
        const angle = (i * Math.PI) / 6;
        for (const y of [0.12, -0.12]) points.push([Math.cos(angle), y, Math.sin(angle)]);
      }
      return points;
    }
  }
}

/**
 * The faces of the convex solid around `points`: every plane through three
 * points with all the others behind it, the points on it ordered around
 * its center. Brute force, which is fine for dice-sized point sets.
 */
function hull(points: readonly Vec3[]): number[][] {
  const faces: { normal: Vec3; offset: number; members: number[] }[] = [];
  const n = points.length;
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      for (let c = b + 1; c < n; c++) {
        const normalRaw = cross(sub(points[b]!, points[a]!), sub(points[c]!, points[a]!));
        if (Math.hypot(...normalRaw) < 1e-9) continue;
        let normal = unit(normalRaw);
        let offset = dot(normal, points[a]!);
        const sides = points.map((point) => dot(normal, point) - offset);
        if (sides.every((side) => side <= 1e-7)) {
          // already outward
        } else if (sides.every((side) => side >= -1e-7)) {
          normal = [-normal[0], -normal[1], -normal[2]];
          offset = -offset;
        } else {
          continue;
        }
        if (faces.some((face) => dot(face.normal, normal) > 1 - 1e-7)) continue;
        const members = points.map((point, index) => (Math.abs(dot(normal, point) - offset) < 1e-6 ? index : -1)).filter((index) => index >= 0);
        faces.push({ normal, offset, members });
      }
    }
  }
  return faces.map(({ normal, members }) => {
    // Order the corners counter-clockwise seen from outside.
    const center = members.reduce<Vec3>((sum, index) => [sum[0] + points[index]![0], sum[1] + points[index]![1], sum[2] + points[index]![2]], [0, 0, 0]);
    const middle: Vec3 = [center[0] / members.length, center[1] / members.length, center[2] / members.length];
    const u = unit(sub(points[members[0]!]!, middle));
    const v = cross(normal, u);
    return [...members].sort((i, j) => {
      const pi = sub(points[i]!, middle);
      const pj = sub(points[j]!, middle);
      return Math.atan2(dot(pi, v), dot(pi, u)) - Math.atan2(dot(pj, v), dot(pj, u));
    });
  });
}

/** Values so opposite faces add up to sides + 1, like real dice. */
function faceValues(vertices: readonly Vec3[], faces: readonly (readonly number[])[], shape: DieShape | 'coin'): number[] {
  const normals = faces.map((_, index) => faceNormalOf(vertices, faces[index]!));
  if (shape === 'coin') return normals.map((normal) => (normal[1] > 0.99 ? 1 : normal[1] < -0.99 ? 2 : 0));
  if (shape === 'd4') return faces.map(() => 0); // read by corner
  const values = new Array<number>(faces.length).fill(0);
  let next = 1;
  for (let face = 0; face < faces.length; face++) {
    if (values[face] !== 0) continue;
    const opposite = normals.findIndex((normal, index) => index !== face && dot(normal, normals[face]!) < -1 + 1e-6);
    values[face] = next;
    if (opposite >= 0) values[opposite] = faces.length + 1 - next;
    next++;
  }
  return values;
}

function faceNormalOf(vertices: readonly Vec3[], face: readonly number[]): Vec3 {
  const [a, b, c] = face.map((index) => vertices[index]!) as [Vec3, Vec3, Vec3];
  return unit(cross(sub(b, a), sub(c, a)));
}

const cache = new Map<string, DieGeometry>();

export function dieGeometry(shape: DieShape | 'coin'): DieGeometry {
  const cached = cache.get(shape);
  if (cached) return cached;
  const raw = corners(shape);
  const radius = Math.max(...raw.map((point) => Math.hypot(...point)));
  const vertices = raw.map((point): Vec3 => [point[0] / radius, point[1] / radius, point[2] / radius]);
  const faces = hull(vertices);
  const geometry: DieGeometry = {
    vertices,
    faces,
    faceValues: faceValues(vertices, faces, shape),
    readBy: shape === 'd4' ? 'corner' : 'face',
    ...(shape === 'd4' ? { cornerValues: [1, 2, 3, 4] } : {}),
  };
  cache.set(shape, geometry);
  return geometry;
}

export function faceNormal(geometry: DieGeometry, face: number): Vec3 {
  return faceNormalOf(geometry.vertices, geometry.faces[face]!);
}

/** A vector turned by a rotation. */
export function rotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  // v' = v + 2w(q × v) + 2 q × (q × v)
  const t: Vec3 = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
  return [v[0] + w * t[0] + (y * t[2] - z * t[1]), v[1] + w * t[1] + (z * t[0] - x * t[2]), v[2] + w * t[2] + (x * t[1] - y * t[0])];
}

/**
 * Which face (or, for a d4, which corner) points up when the die is turned
 * by `rotation`. Faces that never count (a coin's rim) are skipped.
 */
export function upwardFace(geometry: DieGeometry, rotation: Quat): number {
  let best = -1;
  let bestHeight = Number.NEGATIVE_INFINITY;
  const candidates = geometry.readBy === 'corner' ? geometry.vertices.map((vertex) => unit(vertex)) : geometry.faces.map((_, face) => faceNormal(geometry, face));
  candidates.forEach((direction, index) => {
    if (geometry.readBy === 'face' && geometry.faceValues[index] === 0) return;
    const height = rotate(rotation, direction)[1];
    if (height > bestHeight) {
      bestHeight = height;
      best = index;
    }
  });
  return best;
}

/** The labels with the one that landed up (`landed`) swapped to show `wanted`. */
export function relabel(labels: readonly number[], landed: number, wanted: number): number[] {
  const result = [...labels];
  const from = result.indexOf(wanted);
  if (from < 0 || from === landed) return result;
  [result[landed], result[from]] = [result[from]!, result[landed]!];
  return result;
}

/** The die to throw for a number of sides, or null if there is no real die for it. */
export function dieShapeFor(sides: number): DieShape | null {
  return DIE_SHAPES.find((shape) => shape === `d${sides}`) ?? null;
}
