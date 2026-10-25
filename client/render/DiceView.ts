import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Engine } from '@babylonjs/core/Engines/engine';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Scene } from '@babylonjs/core/scene';
import { type DieGeometry, type DieShape, type Vec3, dieGeometry } from '@shared/dice';
import { DIE_SIZE, TRAY, type ThrowRecording } from '../dice/simulate';

// The dice box's 3D view: a felt tray with a wooden rim, seen from above,
// and the dice playing back a recorded throw. Each die is built from its
// shape's faces, flat shaded, with the numbers drawn on a texture (one cell
// per face) after relabelling, so the face on top shows the decided result.

export interface DieLook {
  readonly shape: DieShape | 'coin';
  /** The text on each face (for a d4, on each corner), after relabelling. */
  readonly labels: readonly string[];
  /** Dimmed: a die that was rolled but not kept (e.g. the low die of 2d20 keep highest). */
  readonly dropped: boolean;
  /** A natural max or 1: the die glows. */
  readonly crit: 'max' | 'min' | null;
}

const BODY = '#2f7f99';
const BODY_CRIT_MAX = '#d6a531';
const BODY_CRIT_MIN = '#9b3a3a';
const INK = '#f2f6f8';
const ATLAS = 1024;

/** Flat 2D coordinates of a face's corners, in the face's own plane (centered, longest reach 1). */
function faceLayout(geometry: DieGeometry, face: number): [number, number][] {
  const corners = geometry.faces[face]!.map((index) => geometry.vertices[index]!);
  const center = corners.reduce<Vec3>((sum, v) => [sum[0] + v[0] / corners.length, sum[1] + v[1] / corners.length, sum[2] + v[2] / corners.length], [0, 0, 0]);
  const a = corners[0]!;
  const b = corners[1]!;
  const c = corners[2]!;
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
  const toFirst = [a[0] - center[0], a[1] - center[1], a[2] - center[2]];
  const ul = Math.hypot(...toFirst);
  const u = toFirst.map((value) => value / ul);
  const nl = Math.hypot(...n);
  const nu = n.map((value) => value / nl);
  const v = [nu[1]! * u[2]! - nu[2]! * u[1]!, nu[2]! * u[0]! - nu[0]! * u[2]!, nu[0]! * u[1]! - nu[1]! * u[0]!];
  const points = corners.map((corner): [number, number] => {
    const d = [corner[0] - center[0], corner[1] - center[1], corner[2] - center[2]];
    return [d[0]! * u[0]! + d[1]! * u[1]! + d[2]! * u[2]!, d[0]! * v[0]! + d[1]! * v[1]! + d[2]! * v[2]!];
  });
  const reach = Math.max(...points.map(([x, y]) => Math.hypot(x, y)));
  // Turn so a corner points up the texture (numbers read upright on most faces), unmirrored.
  return points.map(([x, y]) => [y / reach, x / reach]);
}

/** A die's texture: one cell per face, the face's number in the middle (a d4's at its corners). */
function drawAtlas(texture: DynamicTexture, geometry: DieGeometry, look: DieLook, cells: number): void {
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
  const cell = ATLAS / cells;
  const body = look.crit === 'max' ? BODY_CRIT_MAX : look.crit === 'min' ? BODY_CRIT_MIN : BODY;
  ctx.fillStyle = body;
  ctx.fillRect(0, 0, ATLAS, ATLAS);
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  geometry.faces.forEach((_, face) => {
    const cx = (face % cells) * cell + cell / 2;
    const cy = Math.floor(face / cells) * cell + cell / 2;
    const draw = (text: string, x: number, y: number, size: number) => {
      ctx.font = `bold ${Math.round(size)}px system-ui, sans-serif`;
      ctx.fillText(text, x, y);
      // 6 and 9 get an underline, as on real dice.
      if (text === '6' || text === '9') ctx.fillRect(x - size * 0.22, y + size * 0.42, size * 0.44, size * 0.07);
    };
    if (geometry.readBy === 'corner') {
      // A d4: each corner's number near that corner of every face it touches.
      const layout = faceLayout(geometry, face);
      geometry.faces[face]!.forEach((vertex, index) => {
        const [x, y] = layout[index]!;
        draw(look.labels[vertex] ?? '', cx + x * cell * 0.27, cy - y * cell * 0.27, cell * 0.2);
      });
    } else {
      const text = look.labels[face] ?? '';
      const size = geometry.faces[face]!.length >= 5 ? 0.34 : geometry.faces.length > 12 ? 0.3 : 0.38;
      draw(text, cx, cy, cell * size * (text.length > 2 ? 0.75 : 1));
    }
  });
  texture.update();
}

/** A flat-shaded die mesh with each face mapped to its cell of the texture. */
function dieMesh(scene: Scene, name: string, look: DieLook): Mesh {
  const geometry = dieGeometry(look.shape);
  const size = DIE_SIZE[look.shape];
  const cells = Math.ceil(Math.sqrt(geometry.faces.length));
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  geometry.faces.forEach((faceCorners, face) => {
    const layout = faceLayout(geometry, face);
    const corners = faceCorners.map((index) => geometry.vertices[index]!);
    const [a, b, c] = corners as [Vec3, Vec3, Vec3];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const nl = Math.hypot(...n);
    const base = positions.length / 3;
    const u0 = (face % cells) / cells;
    const v0 = Math.floor(face / cells) / cells;
    corners.forEach((corner, index) => {
      positions.push(corner[0] * size, corner[1] * size, corner[2] * size);
      normals.push(n[0]! / nl, n[1]! / nl, n[2]! / nl);
      const [x, y] = layout[index]!;
      // Into this face's cell (a small margin keeps neighbors from bleeding in).
      uvs.push(u0 + (0.5 + x * 0.46) / cells, 1 - (v0 + (0.5 - y * 0.46) / cells));
    });
    for (let i = 1; i < corners.length - 1; i++) indices.push(base, base + i, base + i + 1);
  });
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.uvs = uvs;
  data.indices = indices;
  data.applyToMesh(mesh);

  const texture = new DynamicTexture(`${name}-faces`, { width: ATLAS, height: ATLAS }, scene, true);
  drawAtlas(texture, geometry, look, cells);
  const material = new StandardMaterial(`${name}-material`, scene);
  material.diffuseTexture = texture;
  material.specularColor = new Color3(0.35, 0.35, 0.35);
  material.specularPower = 40;
  if (look.crit) material.emissiveColor = Color3.FromHexString(look.crit === 'max' ? BODY_CRIT_MAX : BODY_CRIT_MIN).scale(0.25);
  // Closed and convex, with normals given: drawing both sides avoids any winding mix-up.
  material.backFaceCulling = false;
  mesh.material = material;
  mesh.rotationQuaternion = new Quaternion();
  return mesh;
}

export class DiceView {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly dice: Mesh[] = [];
  private recording: ThrowRecording | null = null;
  private looks: readonly DieLook[] = [];
  private started = 0;
  private rate = 1;
  private settledAt: number | null = null;
  private onSettled: (() => void) | null = null;
  private readonly camera: ArcRotateCamera;
  private readonly resizer: ResizeObserver;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false });
    this.engine.setHardwareScalingLevel(1 / Math.min(2, window.devicePixelRatio || 1));
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0, 0, 0, 0);
    this.scene.useRightHandedSystem = true;

    // Looking down into the tray, tilted a little toward the near edge, framed to fit (see fit).
    const camera = new ArcRotateCamera('dice-camera', Math.PI / 2, 0.32, 13.5, Vector3.Zero(), this.scene);
    camera.fov = 0.62;
    this.camera = camera;
    // The canvas gets its real size once the box is laid out, and again whenever it changes.
    this.resizer = new ResizeObserver(() => {
      this.engine.resize();
      this.fit();
    });
    this.resizer.observe(canvas);
    const sky = new HemisphericLight('dice-sky', new Vector3(0, 1, 0.3), this.scene);
    sky.intensity = 0.75;
    const sun = new DirectionalLight('dice-sun', new Vector3(-0.4, -1, -0.5), this.scene);
    sun.intensity = 0.65;

    // The tray: dark felt inside a wooden rim.
    const felt = CreateBox('felt', { width: TRAY.width, depth: TRAY.depth, height: 0.1 }, this.scene);
    felt.position.y = -0.05;
    const feltMaterial = new StandardMaterial('felt', this.scene);
    feltMaterial.diffuseColor = Color3.FromHexString('#2a2522');
    feltMaterial.specularColor = Color3.Black();
    felt.material = feltMaterial;
    const wood = new StandardMaterial('rim', this.scene);
    wood.diffuseColor = Color3.FromHexString('#5a3a22');
    wood.specularColor = new Color3(0.1, 0.08, 0.05);
    const rim = 0.35;
    const walls: [number, number, number, number][] = [
      [TRAY.width + rim * 2, rim, 0, -(TRAY.depth + rim) / 2],
      [TRAY.width + rim * 2, rim, 0, (TRAY.depth + rim) / 2],
      [rim, TRAY.depth, -(TRAY.width + rim) / 2, 0],
      [rim, TRAY.depth, (TRAY.width + rim) / 2, 0],
    ];
    walls.forEach(([width, depth, x, z], index) => {
      const wall = CreateBox(`rim-${index}`, { width, depth, height: 0.9 }, this.scene);
      wall.position.set(x, 0.4, z);
      wall.material = wood;
    });

    this.engine.runRenderLoop(() => this.frame());
  }

  /**
   * Plays a recorded throw. `rate` speeds it up or slows it down; 0 shows
   * the dice where they came to rest straight away.
   */
  play(recording: ThrowRecording, looks: readonly DieLook[], rate: number, onSettled: () => void): void {
    this.clear();
    this.recording = recording;
    this.looks = looks;
    this.rate = rate;
    this.started = performance.now();
    this.settledAt = null;
    this.onSettled = onSettled;
    looks.forEach((look, index) => this.dice.push(dieMesh(this.scene, `die-${index}`, look)));
  }

  /** Moves the camera back just far enough to see the whole tray, rim and all, at this box's shape. */
  private fit(): void {
    const aspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
    const half = Math.tan(this.camera.fov / 2);
    const width = TRAY.width + 1.2;
    const depth = TRAY.depth + 1.2;
    // Distance to fit the depth (vertical) and the width (horizontal), whichever is farther, plus room for the tilt.
    this.camera.radius = Math.max(depth / 2 / half, width / 2 / (half * aspect)) * 1.08 + 1.5;
  }

  private frame(): void {
    const recording = this.recording;
    if (recording) {
      const elapsed = ((performance.now() - this.started) / 1000) * this.rate;
      const exact = this.rate === 0 ? recording.ticks - 1 : Math.min(recording.ticks - 1, elapsed / recording.dt);
      const tick = Math.floor(exact);
      const blend = exact - tick;
      const next = Math.min(recording.ticks - 1, tick + 1);
      this.dice.forEach((mesh, index) => {
        const frames = recording.frames[index]!;
        const a = tick * 7;
        const b = next * 7;
        mesh.position.set(
          frames[a]! + (frames[b]! - frames[a]!) * blend,
          frames[a + 1]! + (frames[b + 1]! - frames[a + 1]!) * blend,
          frames[a + 2]! + (frames[b + 2]! - frames[a + 2]!) * blend,
        );
        const from = new Quaternion(frames[a + 3]!, frames[a + 4]!, frames[a + 5]!, frames[a + 6]!);
        const to = new Quaternion(frames[b + 3]!, frames[b + 4]!, frames[b + 5]!, frames[b + 6]!);
        Quaternion.SlerpToRef(from, to, blend, mesh.rotationQuaternion as Quaternion);
        if (this.looks[index]?.dropped && exact >= recording.ticks - 1) mesh.visibility = 0.35;
      });
      if (exact >= recording.ticks - 1 && this.settledAt === null) {
        this.settledAt = performance.now();
        this.onSettled?.();
      }
    }
    this.scene.render();
  }

  private clear(): void {
    for (const mesh of this.dice) {
      mesh.material?.dispose(true, true);
      mesh.dispose();
    }
    this.dice.length = 0;
  }

  dispose(): void {
    this.resizer.disconnect();
    this.clear();
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }
}
