import { Engine } from '@babylonjs/core/Engines/engine';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Culling/ray';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { type Cell, type Grid, type WorldPoint, createGrid } from '@shared/grid';
import { DEFAULT_TERRAIN, type MapData, rayPick } from '@shared/map';
import type { CameraCommand, CameraView } from '@shared/camera';
import type { StylePack } from '../style/stylePack';
import { CameraRig } from './CameraRig';

// Draws a map in 3D and reports what the pointer is over. No game logic:
// it only turns map data into meshes and pointer positions into cells.
// Each terrain is one mesh with a "thin instance" per tile, so even a
// 100 x 100 map is a handful of draw calls.

export interface TilePointer {
  /**
   * `cancel`: abandon the drag in progress: the right button pressed while the
   * left is held, or a second finger touching down on a touch screen.
   */
  readonly type: 'down' | 'move' | 'up' | 'cancel';
  /** The tile under the pointer, or null over empty space. */
  readonly cell: Cell | null;
  /** Where the pointer meets the tile's top surface. */
  readonly point: WorldPoint | null;
  /** 0 = left / touch, 1 = middle, 2 = right. */
  readonly button: number;
  readonly isTouch: boolean;
}

const HEX_ROTATION = Quaternion.RotationAxis(Vector3.Up(), Math.PI / 6); // pointy-top
const WALL_THICKNESS = 0.12;
const WALL_RISE = 2; // levels above the higher of the two tiles
/** Keep drawing this long after any input on the canvas. */
const ACTIVE_MS = 600;
/** ...and this long after the camera last moved, so it can glide to a stop. */
const GLIDE_MS = 250;

function color(hex: string): Color3 {
  return Color3.FromHexString(hex);
}

export class WorldView {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly rig: CameraRig;
  private readonly materials = new Map<string, StandardMaterial>();
  private readonly resizeObserver: ResizeObserver;
  /** Meshes made for the current map; rebuilt when the map changes. */
  private meshes: Mesh[] = [];
  /** Top of the tallest tile, where the pointer's line of sight starts checking. */
  private ceiling = 0;
  private highlightMesh: Mesh | null = null;
  private ghostMesh: Mesh | null = null;
  private grid: Grid | null = null;
  private heights = new Map<string, number>();
  /** The grid type the camera was last framed for. */
  private framedFor: string | null = null;
  private map: MapData | null = null;
  private dirty = true;
  private lastView = '';
  private activeUntil = 0;
  private lastFrame = 0;
  /** Frame the camera on the map at the next drawn frame. */
  private needsFraming = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly style: StylePack,
    private readonly onPointer: (pointer: TilePointer) => void,
  ) {
    // Babylon focuses the canvas on every press, and the browser then scrolls
    // the page to show all of it: the map jumps under the pointer mid-edit.
    // Keep the focus (it routes keyboard input) but never scroll for it.
    const focus = canvas.focus.bind(canvas);
    canvas.focus = (options?: FocusOptions) => focus({ ...options, preventScroll: true });
    this.engine = new Engine(canvas, true, { stencil: true });
    this.scene = new Scene(this.engine);
    // Right-handed, like the grid math: facing north, east (+x) is on the right.
    // Babylon's default left-handed space showed every map mirrored.
    this.scene.useRightHandedSystem = true;
    this.scene.clearColor = Color4.FromHexString(`${style.background}ff`);

    this.rig = new CameraRig(this.scene, canvas);
    this.rig.setGroundLevel(style.levelHeight); // the top of a level-0 tile
    this.rig.onViewChange(() => this.markActive());

    const sky = new HemisphericLight('sky', new Vector3(0.2, 1, -0.3), this.scene);
    sky.intensity = 0.75;
    sky.groundColor = new Color3(0.35, 0.33, 0.4);
    const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, 0.6), this.scene);
    sun.intensity = 0.55;

    canvas.addEventListener('contextmenu', preventDefault);
    // The wheel zooms the map, never the page; middle-click mustn't start the browser's autoscroll.
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('pointerdown', this.onTouchDown);
    canvas.addEventListener('pointerup', this.onTouchUp);
    canvas.addEventListener('pointercancel', this.onTouchUp);
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel'] as const) {
      canvas.addEventListener(type, this.markActive, { passive: true });
    }
    this.scene.onPointerObservable.add((info) => {
      const type =
        info.type === PointerEventTypes.POINTERDOWN
          ? 'down'
          : info.type === PointerEventTypes.POINTERMOVE
            ? 'move'
            : info.type === PointerEventTypes.POINTERUP
              ? 'up'
              : null;
      if (!type) return;
      const event = info.event as PointerEvent;
      this.onPointer({ type, ...this.pick(), button: event.button, isTouch: event.pointerType === 'touch' });
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.engine.resize();
      this.invalidate();
    });
    this.resizeObserver.observe(canvas);
    // Draw only when something may have changed: an idle map costs no battery.
    // Babylon applies drags and scrolls to the camera only while drawing a
    // frame, so any input on the canvas keeps frames coming for a moment, and
    // they continue while the camera is still gliding to a stop.
    this.engine.runRenderLoop(() => {
      const now = performance.now();
      // Seconds since the last drawn frame, capped so a long idle pause isn't one giant step.
      const dt = Math.min(0.1, (now - (this.lastFrame || now)) / 1000);
      this.lastFrame = now;
      // Framing waits for a real frame: right after the view is created its
      // camera projection isn't ready, and every fit test would fail.
      if (this.needsFraming && this.map && this.grid && this.canvas.clientWidth > 0) {
        this.needsFraming = false;
        this.frame(this.map, this.grid, this.style.cellSize);
        this.dirty = true;
      }
      if (this.rig.update(dt)) this.activeUntil = Math.max(this.activeUntil, now + GLIDE_MS);
      if (!this.dirty && now > this.activeUntil) return;
      this.scene.render();
      const view = this.cameraState();
      if (view !== this.lastView) this.activeUntil = Math.max(this.activeUntil, now + GLIDE_MS);
      this.lastView = view;
      // Shaders compile in the background; keep drawing until everything is ready.
      this.dirty = !this.scene.isReady();
    });
  }

  /** Asks for a redraw on the next frame. */
  private invalidate(): void {
    this.dirty = true;
  }

  private readonly markActive = () => {
    this.activeUntil = performance.now() + ACTIVE_MS;
  };

  private readonly onWheel = (event: WheelEvent) => event.preventDefault();

  /** Fingers currently on the canvas. */
  private readonly touchesDown = new Set<number>();

  private readonly onTouchDown = (event: PointerEvent) => {
    if (event.pointerType !== 'touch') return;
    if (this.touchesDown.size > 0) {
      this.onPointer({ type: 'cancel', cell: null, point: null, button: 0, isTouch: true });
    }
    this.touchesDown.add(event.pointerId);
  };

  private readonly onTouchUp = (event: PointerEvent) => {
    this.touchesDown.delete(event.pointerId);
  };

  private readonly onMouseDown = (event: MouseEvent) => {
    if (event.button === 1) event.preventDefault();
    // A right-click while the left button is held (a chord: no pointerdown event fires for it).
    if (event.button === 2 && (event.buttons & 1) !== 0) {
      this.onPointer({ type: 'cancel', cell: null, point: null, button: 2, isTouch: false });
    }
  };

  /** Changes whenever the camera moves (including while it glides to a stop). */
  private cameraState(): string {
    const { alpha, beta, radius, target } = this.rig.camera;
    return `${alpha.toFixed(5)},${beta.toFixed(5)},${radius.toFixed(4)},${target.x.toFixed(4)},${target.y.toFixed(4)},${target.z.toFixed(4)}`;
  }

  /** Edit mode gives the left mouse button (and one finger) to the editing tools. */
  setEditing(editing: boolean): void {
    this.rig.setEditing(editing);
  }

  get cameraView(): CameraView {
    return this.rig.cameraView;
  }

  onCameraChange(listener: (view: CameraView) => void): () => void {
    return this.rig.onViewChange(listener);
  }

  /** Turn, switch top-down, or toggle free camera. */
  cameraCommand(command: CameraCommand): void {
    this.rig.command(command);
    this.markActive();
  }

  /** Glides the camera to look at a cell (the DM's "focus everyone here"). */
  focusCell(cell: Cell): void {
    if (!this.grid) return;
    this.rig.focusOn(this.grid.toWorld(cell, this.style.cellSize));
    this.markActive();
  }

  /** The cell in the middle of the view. */
  centerCell(): Cell | null {
    return this.grid ? this.grid.fromWorld(this.rig.target, this.style.cellSize) : null;
  }

  setMap(map: MapData | null): void {
    for (const mesh of this.meshes) mesh.dispose();
    this.meshes = [];
    this.setHighlight([]);
    this.setGhosts([]);
    if (!map) {
      this.grid = null;
      this.map = null;
      this.framedFor = null;
      return;
    }

    const grid = createGrid(map.grid);
    this.grid = grid;
    this.heights = new Map(map.tiles.map((tile) => [`${tile.q},${tile.r}`, tile.height]));
    this.ceiling = (Math.max(0, ...map.tiles.map((tile) => tile.height)) + 1) * this.style.levelHeight;
    // The camera always looks at a point over the map.
    const centers = map.tiles.map((tile) => grid.toWorld(tile, this.style.cellSize));
    this.rig.setBounds(
      centers.length === 0
        ? null
        : {
            minX: Math.min(...centers.map((p) => p.x)),
            maxX: Math.max(...centers.map((p) => p.x)),
            minZ: Math.min(...centers.map((p) => p.z)),
            maxZ: Math.max(...centers.map((p) => p.z)),
          },
    );
    const { levelHeight } = this.style;

    // One mesh per terrain, one thin instance per tile.
    const byTerrain = new Map<string, Cell[]>();
    for (const tile of map.tiles) {
      const terrain = tile.terrain ?? DEFAULT_TERRAIN;
      byTerrain.set(terrain, [...(byTerrain.get(terrain) ?? []), tile]);
    }
    for (const [terrain, cells] of byTerrain) {
      const look = this.style.terrain[terrain] ?? this.style.unknownTerrain;
      const mesh = this.tileMesh(`terrain-${terrain}`, grid, this.style.tileFill);
      mesh.material = this.material(look.color);
      mesh.thinInstanceSetBuffer(
        'matrix',
        this.matrices(cells, (cell) => ({ base: 0, top: this.tileTop(cell) })),
        16,
      );
    mesh.thinInstanceRefreshBoundingInfo(false);
      mesh.isPickable = false;
      this.meshes.push(mesh);
    }

    // Solid tiles get a dark block on top.
    const blocked = map.tiles.filter((tile) => tile.blocked);
    if (blocked.length > 0) {
      const mesh = this.tileMesh('blocked', grid, this.style.tileFill * 0.55);
      mesh.material = this.material(this.style.blockedColor);
      mesh.isPickable = false;
      mesh.thinInstanceSetBuffer(
        'matrix',
        this.matrices(blocked, (cell) => ({ base: this.tileTop(cell), top: this.tileTop(cell) + levelHeight * 1.5 })),
        16,
      );
    mesh.thinInstanceRefreshBoundingInfo(false);
      this.meshes.push(mesh);
    }

    if (map.walls.length > 0) this.meshes.push(this.wallMesh(grid, map));

    this.map = map;
    // Edits never move the camera. It frames the map only when one first
    // appears or the grid type changes; otherwise only when asked (frameMap).
    if (map.grid !== this.framedFor) {
      this.framedFor = map.grid;
      this.needsFraming = true;
    }
    this.invalidate();
  }

  /** Points the camera at the whole map again (a new map, or "Re-center view"). */
  frameMap(): void {
    this.needsFraming = true;
    this.invalidate();
  }

  /** Marks cells (the brush, or a shape being dragged) with a bright translucent overlay. */
  setHighlight(cells: readonly Cell[]): void {
    this.highlightMesh?.dispose();
    this.highlightMesh = this.overlay('highlight', cells, 0.45, 0.6);
  }

  /** Faint outlines of empty cells, e.g. where "Add tiles" can build. */
  setGhosts(cells: readonly Cell[]): void {
    this.ghostMesh?.dispose();
    this.ghostMesh = this.overlay('ghost', cells, 0.14, 0.25);
  }

  /** A thin translucent layer over cells: on top of tiles, or on the ground outside the world. */
  private overlay(name: string, cells: readonly Cell[], alpha: number, glow: number): Mesh | null {
    this.invalidate();
    if (cells.length === 0 || !this.grid) return null;
    const mesh = this.tileMesh(name, this.grid, this.style.tileFill);
    const material = this.material(this.style.highlightColor, name);
    material.alpha = alpha;
    material.emissiveColor = color(this.style.highlightColor).scale(glow);
    mesh.material = material;
    mesh.isPickable = false;
    const thickness = this.style.levelHeight * 0.3;
    mesh.thinInstanceSetBuffer(
      'matrix',
      this.matrices(cells, (cell) => {
        const top = this.heights.has(`${cell.q},${cell.r}`) ? this.tileTop(cell) : 0;
        return { base: top, top: top + thickness };
      }),
      16,
    );
    mesh.thinInstanceRefreshBoundingInfo(false);
    return mesh;
  }

  dispose(): void {
    this.canvas.removeEventListener('contextmenu', preventDefault);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('pointerdown', this.onTouchDown);
    this.canvas.removeEventListener('pointerup', this.onTouchUp);
    this.canvas.removeEventListener('pointercancel', this.onTouchUp);
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel'] as const) {
      this.canvas.removeEventListener(type, this.markActive);
    }
    this.resizeObserver.disconnect();
    this.rig.dispose();
    this.engine.dispose();
  }

  // -------------------------------------------------------------------------

  /**
   * The cell under the pointer, found by walking the line of sight over the
   * grid (see rayPick) rather than hit-testing meshes, which gave wrong
   * answers through holes. Empty space counts as ground at the top of a
   * level-0 tile, so the pointer can reach cells outside the world.
   */
  private pick(): { cell: Cell | null; point: WorldPoint | null } {
    const grid = this.grid;
    if (!grid) return { cell: null, point: null };
    const ray = this.scene.createPickingRay(this.scene.pointerX, this.scene.pointerY, Matrix.Identity(), this.rig.camera);
    const hit = rayPick(
      grid,
      (cell) => (this.heights.has(`${cell.q},${cell.r}`) ? this.tileTop(cell) : undefined),
      ray.origin,
      ray.direction,
      this.style.cellSize,
      this.style.levelHeight,
      this.ceiling,
    );
    return hit ?? { cell: null, point: null };
  }

  /** World height of a tile's top surface. Every tile has some thickness, even at height 0. */
  private tileTop(cell: Cell): number {
    return ((this.heights.get(`${cell.q},${cell.r}`) ?? 0) + 1) * this.style.levelHeight;
  }

  /** A unit-tall tile shape with its base at y = 0. */
  private tileMesh(name: string, grid: Grid, fill: number): Mesh {
    const size = this.style.cellSize * fill;
    const mesh =
      grid.kind === 'hex'
        ? CreateCylinder(name, { height: 1, diameter: size * 2, tessellation: 6 }, this.scene)
        : CreateBox(name, { width: size, depth: size, height: 1 }, this.scene);
    mesh.bakeTransformIntoVertices(
      Matrix.Compose(Vector3.One(), grid.kind === 'hex' ? HEX_ROTATION : Quaternion.Identity(), new Vector3(0, 0.5, 0)),
    );
    return mesh;
  }

  /** Instance matrices stretching a unit-tall tile between `base` and `top`. */
  private matrices(cells: readonly Cell[], span: (cell: Cell) => { base: number; top: number }): Float32Array {
    const grid = this.grid as Grid;
    const buffer = new Float32Array(cells.length * 16);
    cells.forEach((cell, index) => {
      const { x, z } = grid.toWorld(cell, this.style.cellSize);
      const { base, top } = span(cell);
      Matrix.Compose(new Vector3(1, Math.max(0.001, top - base), 1), Quaternion.Identity(), new Vector3(x, base, z)).copyToArray(
        buffer,
        index * 16,
      );
    });
    return buffer;
  }

  private wallMesh(grid: Grid, map: MapData): Mesh {
    const mesh = CreateBox('walls', { width: 1, depth: 1, height: 1 }, this.scene);
    mesh.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
    mesh.material = this.material(this.style.wallColor);
    mesh.isPickable = false;
    const { cellSize, levelHeight } = this.style;
    const buffer = new Float32Array(map.walls.length * 16);
    map.walls.forEach(([a, b], index) => {
      const pa = grid.toWorld(a, cellSize);
      const pb = grid.toWorld(b, cellSize);
      // The wall stands on the shared edge: halfway between centers, across the line joining them.
      const top = Math.max(this.tileTop(a), this.tileTop(b)) + WALL_RISE * levelHeight;
      const angle = Math.atan2(pb.x - pa.x, pb.z - pa.z);
      Matrix.Compose(
        new Vector3(cellSize, top, WALL_THICKNESS),
        Quaternion.RotationAxis(Vector3.Up(), angle),
        new Vector3((pa.x + pb.x) / 2, 0, (pa.z + pb.z) / 2),
      ).copyToArray(buffer, index * 16);
    });
    mesh.thinInstanceSetBuffer('matrix', buffer, 16);
    mesh.thinInstanceRefreshBoundingInfo(false);
    return mesh;
  }

  private material(hex: string, key = hex): StandardMaterial {
    let material = this.materials.get(key);
    if (!material) {
      material = new StandardMaterial(`material-${key}`, this.scene);
      material.diffuseColor = color(hex);
      material.specularColor = Color3.Black();
      this.materials.set(key, material);
    }
    return material;
  }

  /** Points the camera at the middle of the map from a distance that fits it. */
  private frame(map: MapData, grid: Grid, cellSize: number): void {
    if (map.tiles.length === 0) return;
    // Fit to the canvas's real size, which may not have been measured yet.
    this.engine.resize();
    const points = map.tiles.map((tile) => grid.toWorld(tile, cellSize));
    const xs = points.map((p) => p.x);
    const zs = points.map((p) => p.z);
    const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const top = (Math.max(...map.tiles.map((tile) => tile.height)) + 1) * this.style.levelHeight;
    const margin = cellSize;
    const corners = [minX - margin, maxX + margin].flatMap((x) =>
      [minZ - margin, maxZ + margin].flatMap((z) => [new Vector3(x, 0, z), new Vector3(x, top, z)]),
    );
    const target = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
    // Find the closest distance where every corner of the map is on screen,
    // whatever the view's shape (a tall phone needs the camera further back).
    let near = 1;
    let far = 1000;
    for (let i = 0; i < 30; i++) {
      const radius = (near + far) / 2;
      if (this.fits(corners, target, radius)) far = radius;
      else near = radius;
    }
    this.rig.place(target, far);
    this.rig.setMaxDistance(far * 2.5);
  }

  /** Whether all points land inside the view (with a small border) at this camera distance. */
  private fits(points: readonly Vector3[], target: { x: number; z: number }, radius: number): boolean {
    // Measured with the direction and tilt the camera is settling on, not mid-turn.
    // The matrices are built here from those angles: asking Babylon's camera
    // for them right after moving it can return a stale position.
    this.rig.place(target, radius);
    const camera = this.rig.camera;
    const center = new Vector3(target.x, camera.target.y, target.z);
    const position = center.add(
      new Vector3(
        radius * Math.cos(camera.alpha) * Math.sin(camera.beta),
        radius * Math.cos(camera.beta),
        radius * Math.sin(camera.alpha) * Math.sin(camera.beta),
      ),
    );
    const view = Matrix.LookAtRH(position, center, Vector3.Up());
    const projection = Matrix.PerspectiveFovRH(
      camera.fov,
      this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight()),
      camera.minZ,
      camera.maxZ,
    );
    const transform = view.multiply(projection);
    return points.every((point) => {
      const projected = Vector3.TransformCoordinates(point, transform);
      return Math.abs(projected.x) <= 0.95 && Math.abs(projected.y) <= 0.95 && projected.z > 0 && projected.z < 1;
    });
  }
}

function preventDefault(event: Event): void {
  event.preventDefault();
}
