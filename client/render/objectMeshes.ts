import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import type { ObjectModel, ObjectPart } from '../style/stylePack';

// Objects on tiles (trees, barrels, campfires), drawn from the style pack's
// models. Each part of each kind of object is one mesh with a thin instance
// per tile it stands on, so a whole forest is a handful of draw calls.

export interface ObjectPlacement {
  readonly object: string;
  /** The tile's center on the ground, and the height of its top. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** A number fixed per tile, for a natural object's turn and size. */
  readonly seed: number;
}

export interface ObjectMeshes {
  readonly meshes: Mesh[];
  /** Parts that should get a glow halo. */
  readonly glowing: Mesh[];
}

/** A part's shape, sized and placed on the tile (its bottom middle at `at`). */
function partMesh(scene: Scene, name: string, part: ObjectPart, cellSize: number): Mesh {
  const [width, height, depth] = part.size.map((value) => value * cellSize) as [number, number, number];
  const sides = part.sides ?? 12;
  let mesh: Mesh;
  switch (part.shape) {
    case 'box':
      mesh = CreateBox(name, { width, height, depth }, scene);
      break;
    case 'cylinder':
      mesh = CreateCylinder(name, { height, diameter: 1, tessellation: sides }, scene);
      mesh.scaling.set(width, 1, depth);
      break;
    case 'cone':
      mesh = CreateCylinder(name, { height, diameterTop: 0, diameterBottom: 1, tessellation: sides }, scene);
      mesh.scaling.set(width, 1, depth);
      break;
    case 'sphere':
      mesh = CreateSphere(name, { diameter: 1, segments: Math.max(2, Math.round(sides / 2)) }, scene);
      mesh.scaling.set(width, height, depth);
      break;
  }
  const [x, y, z] = (part.at ?? [0, 0, 0]).map((value) => value * cellSize) as [number, number, number];
  mesh.rotation.set(0, part.turn ?? 0, part.tilt ?? 0);
  mesh.position.set(x, y + height / 2, z);
  mesh.bakeCurrentTransformIntoVertices();
  return mesh;
}

/** A turn and size for one placement: natural things vary, built ones stand square. */
function placementMatrix(placement: ObjectPlacement, natural: boolean): Matrix {
  const seed = placement.seed;
  const turn = natural ? ((seed % 360) * Math.PI) / 180 : 0;
  const scale = natural ? 0.85 + ((seed >>> 9) % 31) / 100 : 1;
  return Matrix.Compose(
    new Vector3(scale, scale, scale),
    Quaternion.RotationAxis(Vector3.Up(), turn),
    new Vector3(placement.x, placement.y, placement.z),
  );
}

export function buildObjectMeshes(
  scene: Scene,
  placements: readonly ObjectPlacement[],
  models: Readonly<Record<string, ObjectModel>>,
  unknown: ObjectModel,
  cellSize: number,
  material: (color: string, glow: boolean) => StandardMaterial,
): ObjectMeshes {
  const byObject = new Map<string, ObjectPlacement[]>();
  for (const placement of placements) byObject.set(placement.object, [...(byObject.get(placement.object) ?? []), placement]);

  const meshes: Mesh[] = [];
  const glowing: Mesh[] = [];
  for (const [object, group] of byObject) {
    const model = models[object] ?? unknown;
    const buffer = new Float32Array(group.length * 16);
    group.forEach((placement, index) => placementMatrix(placement, model.natural === true).copyToArray(buffer, index * 16));
    model.parts.forEach((part, index) => {
      const mesh = partMesh(scene, `object-${object}-${index}`, part, cellSize);
      mesh.material = material(part.color, part.glow === true);
      mesh.isPickable = false;
      mesh.thinInstanceSetBuffer('matrix', buffer.slice(), 16);
      mesh.thinInstanceRefreshBoundingInfo(false);
      meshes.push(mesh);
      if (part.glow) glowing.push(mesh);
    });
  }
  return { meshes, glowing };
}

/** A number fixed per cell (for natural variety that is the same for everyone). */
export function cellSeed(q: number, r: number): number {
  return (Math.imul(q, 73856093) ^ Math.imul(r, 19349663)) >>> 0;
}
