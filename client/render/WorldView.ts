import { Engine } from '@babylonjs/core/Engines/engine';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Culling/ray';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { type Cell, type Grid, type WorldPoint, createGrid } from '@shared/grid';
import { DEFAULT_TERRAIN, type MapData, rayPick } from '@shared/map';
import type { CameraCommand, CameraView } from '@shared/camera';
import type { StylePack } from '../style/stylePack';
import type { CombatEvent, CombatState } from '@shared/combat';
import type { GameSystem } from '@shared/system';
import { type AnimationSpeed, type Timeline, timingFor } from '@shared/anim';
import { type GraphicsQuality, SlowFrameDetector, effectsFor } from '@shared/graphics';
import { PIXEL_TILE_SIZE, PIXEL_TILE_VARIANTS, pixelTile, tileSideColor } from '@shared/style/pixelTiles';
import { CameraRig } from './CameraRig';
import { SceneEffects } from './SceneEffects';
import { buildObjectMeshes, cellSeed } from './objectMeshes';
import { TokenLayer } from './TokenLayer';

// Draws a map in 3D and reports what the pointer is over. No game logic:
// it only turns map data into meshes and pointer positions into cells.
// Each terrain is one mesh with a "thin instance" per tile, so even a
// 100 x 100 map is a handful of draw calls.

/** What a highlight means, which decides its color: a map-editing brush, or in a fight where you can move and who you can hurt or help. */
export type HighlightKind = 'brush' | 'move' | 'harm' | 'help';

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
  /** Pointer position on the canvas, in pixels (to tell a click from a drag). */
  readonly x: number;
  readonly y: number;
}

/** How tiles are drawn: pixel art textures (the HD-2D pack) or plain colors. */
export type ArtStyle = 'pixel' | 'simple';

const toHex = ([r, g, b]: readonly [number, number, number], shade = 1) =>
  `#${[r, g, b].map((value) => Math.round(value * shade).toString(16).padStart(2, '0')).join('')}`;

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
  private readonly tokens: TokenLayer;
  private readonly effects: SceneEffects;
  private artStyle: ArtStyle = 'simple';
  private customTiles: Readonly<Record<string, string>> = {};
  private quality: GraphicsQuality = 'low';
  private readonly slowFrames = new SlowFrameDetector();
  private onSlow: (() => void) | null = null;
  /** Whether the previous tick of the render loop drew a frame (no idle pause in between). */
  private drewLastTick = false;
  private readonly labelLayer: HTMLDivElement;
  private onTokenClick: (id: string) => void = () => undefined;
  private readonly materials = new Map<string, StandardMaterial>();
  private readonly resizeObserver: ResizeObserver;
  /** Meshes made for the current map; rebuilt when the map changes. */
  private meshes: Mesh[] = [];
  /** Top of the tallest tile, where the pointer's line of sight starts checking. */
  private ceiling = 0;
  private highlightMesh: Mesh | null = null;
  private reachMesh: Mesh | null = null;
  private fogDark: Mesh | null = null;
  private fogDim: Mesh | null = null;
  private notesMesh: Mesh | null = null;
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
    this.rig.onViewChange((view) => {
      this.tokens.setTopDown(view.mode === 'topDown');
      this.effects.setTopDown(view.mode === 'topDown');
      this.markActive();
    });
    // Name tags, HP bars, and floating numbers are HTML laid over the canvas.
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'token-overlay';
    canvas.parentElement?.append(this.labelLayer);
    const sky = new HemisphericLight('sky', new Vector3(0.2, 1, -0.3), this.scene);
    sky.intensity = 0.75;
    sky.groundColor = new Color3(0.35, 0.33, 0.4);
    // A warm, low sun: it casts the shadows (on medium and high graphics).
    const sunDirection = new Vector3(-0.5, -1, 0.6).normalize();
    const sun = new DirectionalLight('sun', sunDirection, this.scene);
    sun.position = sunDirection.scale(-150);
    sun.intensity = 0.6;
    sun.diffuse = new Color3(1, 0.95, 0.86);
    this.effects = new SceneEffects(this.scene, this.engine, this.rig.camera, sun);
    this.tokens = new TokenLayer(this.scene, style, this.labelLayer, (id) => this.onTokenClick(id), this.effects);

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
      this.onPointer({
        type,
        ...this.pick(),
        button: event.button,
        isTouch: event.pointerType === 'touch',
        x: this.scene.pointerX,
        y: this.scene.pointerY,
      });
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
      if (!this.dirty && now > this.activeUntil) {
        this.drewLastTick = false;
        return;
      }
      const continued = this.drewLastTick;
      this.drewLastTick = true;
      this.effects.setFocus(this.rig.camera.radius); // depth of field stays sharp where the camera looks
      this.scene.render();
      // After drawing, so name tags follow the camera exactly as just drawn.
      // In CSS pixels, like the name tags: the canvas may draw more pixels than that on high-DPI screens.
      const size = { width: this.canvas.clientWidth, height: this.canvas.clientHeight };
      const animating = this.tokens.update(now, this.rig.heading, size);
      if (animating) this.activeUntil = Math.max(this.activeUntil, now + GLIDE_MS);
      this.canvas.dataset.animating = String(animating);
      // Too slow for the effects? Ask to lower them (nothing to lower on Low).
      if (this.quality !== 'low' && this.slowFrames.frame(now, continued)) this.onSlow?.();
      const view = this.cameraState();
      if (view !== this.lastView) this.activeUntil = Math.max(this.activeUntil, now + GLIDE_MS);
      this.lastView = view;
      // Shaders compile in the background; keep drawing until everything is ready.
      this.dirty = !this.scene.isReady();
    });
  }

  /** Sets how much 2.5D polish to draw (bloom, depth of field, shadows, glows). */
  setGraphics(quality: GraphicsQuality): void {
    this.quality = quality;
    this.slowFrames.reset();
    this.effects.apply(effectsFor(quality));
    this.engine.resize();
    this.invalidate();
  }

  /** Called when frames stay too slow for the current graphics setting. */
  onSlowFrames(listener: () => void): void {
    this.onSlow = listener;
  }

  /** How fast combat actions play out. */
  setAnimationSpeed(speed: AnimationSpeed): void {
    this.tokens.setTiming(timingFor(speed));
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
      this.onPointer({ type: 'cancel', cell: null, point: null, button: 0, isTouch: true, x: 0, y: 0 });
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
      this.onPointer({ type: 'cancel', cell: null, point: null, button: 2, isTouch: false, x: 0, y: 0 });
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

  /** Shows the fight; with `events`, creatures act out the action that produced it. */
  setCombat(combat: CombatState | null, system: GameSystem | null, events: readonly CombatEvent[] | null): Timeline | null {
    const timeline = this.tokens.setCombat(combat, system, events, performance.now());
    this.markActive();
    this.invalidate();
    return timeline;
  }

  /** Creatures the current ability can target: their name tags become buttons. */
  setTargets(ids: readonly string[], intent: 'harm' | 'help' = 'harm'): void {
    this.tokens.setTargets(ids, intent);
  }

  setTokenClickHandler(handler: (id: string) => void): void {
    this.onTokenClick = handler;
  }

  /** The cell in the middle of the view. */
  centerCell(): Cell | null {
    return this.grid ? this.grid.fromWorld(this.rig.target, this.style.cellSize) : null;
  }

  setMap(map: MapData | null): void {
    for (const mesh of this.meshes) mesh.dispose();
    this.meshes = [];
    this.setHighlight([]);
    this.setReach([]);
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
    this.tokens.setMap(grid, this.heights);
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

    const solidLook = (terrain: string) => this.style.solid[terrain] ?? this.style.unknownSolid;
    // One mesh per tile color, one thin instance per tile. Solid tiles whose look has no
    // block (deep water) are the tile itself in the solid color.
    const byColor = new Map<string, Cell[]>();
    for (const tile of map.tiles) {
      const terrain = tile.terrain ?? DEFAULT_TERRAIN;
      const solid = tile.blocked ? solidLook(terrain) : null;
      const deep = solid !== null && solid.height === 0;
      // Pixel art: the column is the terrain's side color (its textured top is a cap, below).
      const color = this.artStyle === 'pixel'
        ? toHex(tileSideColor(terrain), deep ? 0.75 : 1)
        : deep
          ? (solid as { color: string }).color
          : (this.style.terrain[terrain] ?? this.style.unknownTerrain).color;
      byColor.set(color, [...(byColor.get(color) ?? []), tile]);
    }
    for (const [color, cells] of byColor) {
      const mesh = this.tileMesh(`terrain-${color}`, grid, this.style.tileFill);
      mesh.material = this.material(color);
      mesh.thinInstanceSetBuffer(
        'matrix',
        this.matrices(cells, (cell) => ({ base: 0, top: this.tileTop(cell) })),
        16,
      );
      mesh.thinInstanceRefreshBoundingInfo(false);
      mesh.isPickable = false;
      this.effects.addShadowCaster(mesh);
      this.meshes.push(mesh);
    }
    // Textured tile tops: every terrain in the Pixel style, and the DM's own tiles in either style.
    if (this.artStyle === 'pixel' || Object.keys(this.customTiles).length > 0) this.buildTileCaps(map, grid, solidLook);

    // Other solid tiles get a block on top in their terrain's solid look: a canopy, a boulder, a crag.
    const blocks = new Map<string, Cell[]>();
    for (const tile of map.tiles) {
      const terrain = tile.terrain ?? DEFAULT_TERRAIN;
      // (A tile with an object shows the object instead.)
      if (tile.blocked && !tile.object && solidLook(terrain).height > 0) blocks.set(terrain, [...(blocks.get(terrain) ?? []), tile]);
    }
    for (const [terrain, cells] of blocks) {
      const look = solidLook(terrain);
      const mesh = this.tileMesh(`solid-${terrain}`, grid, this.style.tileFill * look.fill);
      mesh.material = this.material(look.color);
      mesh.isPickable = false;
      mesh.thinInstanceSetBuffer(
        'matrix',
        this.matrices(cells, (cell) => ({ base: this.tileTop(cell), top: this.tileTop(cell) + levelHeight * look.height })),
        16,
      );
      mesh.thinInstanceRefreshBoundingInfo(false);
      this.effects.addShadowCaster(mesh);
      this.meshes.push(mesh);
    }

    // Objects on tiles: trees, rocks, barrels, campfires.
    const placements = map.tiles
      .filter((tile) => tile.object)
      .map((tile) => {
        const { x, z } = grid.toWorld(tile, this.style.cellSize);
        return { object: tile.object as string, x, y: this.tileTop(tile), z, seed: cellSeed(tile.q, tile.r) };
      });
    const objects = buildObjectMeshes(
      this.scene,
      placements,
      this.style.objects,
      this.style.unknownObject,
      this.style.cellSize,
      (color, glow) => {
        if (!glow) return this.material(color);
        const material = this.material(color, `${color}-glow`);
        material.emissiveColor = Color3.FromHexString(color).scale(0.8);
        return material;
      },
    );
    for (const mesh of objects.meshes) {
      this.effects.addShadowCaster(mesh, false);
      this.meshes.push(mesh);
    }
    for (const mesh of objects.glowing) this.effects.addGlow(mesh);

    if (map.walls.length > 0) {
      const walls = this.wallMesh(grid, map);
      this.effects.addShadowCaster(walls);
      this.meshes.push(walls);
    }

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

  /**
   * Marks cells with a bright translucent overlay: the brush or a shape being
   * dragged, or in a fight, where you can move and who you can hurt or help.
   */
  setHighlight(cells: readonly Cell[], kind: HighlightKind = 'brush'): void {
    this.highlightMesh?.dispose();
    const tint = kind === 'brush' ? this.style.highlightColor : this.style.actionColors[kind];
    // Red and blue are drawn unlit and nearly solid: lit and see-through, they wash out to salmon and teal over grass.
    const strong = kind === 'harm' || kind === 'help';
    this.highlightMesh = this.overlay('highlight', cells, strong ? 0.85 : 0.5, strong ? 1 : 0.75, tint, strong);
  }

  /** An ability's range: a faint tint under the targets (thinner than the highlight, so the two never fight). */
  /**
   * Fog of war for this viewer: tiles never seen are hidden under dark fog,
   * tiles seen before but not now are dimmed, and creatures out of sight
   * aren't drawn. Null shows everything (no fog, or the DM).
   */
  setFog(fog: { readonly visible: ReadonlySet<string>; readonly explored: ReadonlySet<string> } | null, hiddenTokens: ReadonlySet<string>): void {
    this.fogDark?.dispose();
    this.fogDim?.dispose();
    this.fogDark = null;
    this.fogDim = null;
    this.tokens.setHidden(hiddenTokens);
    this.canvas.dataset.fog = fog ? 'on' : 'off';
    this.canvas.dataset.visibleTiles = fog ? String(fog.visible.size) : '';
    this.invalidate();
    if (!fog || !this.map) return;
    const unseen: Cell[] = [];
    const remembered: Cell[] = [];
    for (const tile of this.map.tiles) {
      const key = `${tile.q},${tile.r}`;
      if (fog.visible.has(key)) continue;
      (fog.explored.has(key) ? remembered : unseen).push(tile);
    }
    // Tall enough to cover what stands on the tiles (trees, crates) too.
    this.fogDark = this.overlay('fog-dark', unseen, 0.94, 0, this.style.background, true, 3.5);
    this.fogDim = this.overlay('fog-dim', remembered, 0.5, 0, this.style.background, true, 3.5);
  }

  /** The DM's notes: a violet tint on each tile that has one (the DM's view only). */
  setNotes(cells: readonly Cell[]): void {
    this.notesMesh?.dispose();
    this.notesMesh = this.overlay('notes', cells, 0.45, 0.8, '#a070ff', true, 0.1);
  }

  setReach(cells: readonly Cell[], kind: 'harm' | 'help' = 'harm'): void {
    this.reachMesh?.dispose();
    // Red blended thinly over green turns brown: red needs more cover than blue to read as red.
    this.reachMesh = this.overlay('reach', cells, kind === 'harm' ? 0.62 : 0.5, 0.85, this.style.actionColors[kind], true, 0.15);
  }

  /** Faint outlines of empty cells, e.g. where "Add tiles" can build. */
  setGhosts(cells: readonly Cell[]): void {
    this.ghostMesh?.dispose();
    this.ghostMesh = this.overlay('ghost', cells, 0.14, 0.25);
  }

  /** A thin translucent layer over cells: on top of tiles, or on the ground outside the world. */
  private overlay(
    name: string,
    cells: readonly Cell[],
    alpha: number,
    glow: number,
    tint = this.style.highlightColor,
    unlit = false,
    thicknessLevels = 0.3,
  ): Mesh | null {
    this.invalidate();
    if (cells.length === 0 || !this.grid) return null;
    const mesh = this.tileMesh(name, this.grid, this.style.tileFill);
    const material = this.material(tint, `${name}-${tint}${unlit ? '-unlit' : ''}`);
    material.disableLighting = unlit;
    material.alpha = alpha;
    material.emissiveColor = color(tint).scale(glow);
    mesh.material = material;
    mesh.isPickable = false;
    const thickness = this.style.levelHeight * thicknessLevels;
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
    this.tokens.dispose();
    this.effects.dispose();
    this.labelLayer.remove();
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

  /**
   * Pixel art tile tops: a flat cap on each tile with its terrain's texture (one
   * of a few variants, fixed per tile), grouped so a big map stays a few draw calls.
   */
  private buildTileCaps(map: MapData, grid: Grid, solidLook: (terrain: string) => { height: number }): void {
    const groups = new Map<string, { terrain: string; variant: number; deep: boolean; cells: Cell[] }>();
    for (const tile of map.tiles) {
      const terrain = tile.terrain ?? DEFAULT_TERRAIN;
      const custom = this.customTiles[terrain] !== undefined;
      if (!custom && this.artStyle !== 'pixel') continue;
      const deep = tile.blocked === true && !tile.object && solidLook(terrain).height === 0;
      // The DM's own tile is one image; the pack's come in variants.
      const variant = custom ? 0 : cellSeed(tile.q, tile.r) % PIXEL_TILE_VARIANTS;
      const key = `${terrain}:${variant}:${deep}`;
      const group = groups.get(key) ?? { terrain, variant, deep, cells: [] };
      group.cells.push(tile);
      groups.set(key, group);
    }
    const radius = this.style.cellSize * this.style.tileFill;
    for (const [key, group] of groups) {
      const cap = grid.kind === 'hex' ? CreateDisc(`cap-${key}`, { radius, tessellation: 6 }, this.scene) : CreatePlane(`cap-${key}`, { size: radius }, this.scene);
      // Lie flat, facing up (and turned to match the hex columns).
      cap.bakeTransformIntoVertices(
        Matrix.RotationX(Math.PI / 2).multiply(grid.kind === 'hex' ? Matrix.FromQuaternionToRef(HEX_ROTATION, new Matrix()) : Matrix.Identity()),
      );
      cap.material = this.capMaterial(group.terrain, group.variant, group.deep);
      cap.isPickable = false;
      const buffer = new Float32Array(group.cells.length * 16);
      group.cells.forEach((cell, index) => {
        const { x, z } = grid.toWorld(cell, this.style.cellSize);
        Matrix.Translation(x, this.tileTop(cell) + 0.004, z).copyToArray(buffer, index * 16);
      });
      cap.thinInstanceSetBuffer('matrix', buffer, 16);
      cap.thinInstanceRefreshBoundingInfo(false);
      this.effects.addShadowCaster(cap);
      this.meshes.push(cap);
    }
  }

  /** A crisp (unsmoothed) pixel art texture for one terrain variant; deep water a shade darker. */
  private capMaterial(terrain: string, variant: number, deep: boolean): StandardMaterial {
    const custom = this.customTiles[terrain];
    const key = custom ? `cap-custom-${terrain}-${deep}-${custom}` : `cap-${terrain}-${variant}-${deep}`;
    let material = this.materials.get(key);
    if (!material) {
      let texture: Texture;
      if (custom) {
        // The DM's own image: crisp, like the pack's, and drawn once it has loaded.
        texture = new Texture(custom, this.scene, true, true, Texture.NEAREST_SAMPLINGMODE);
        texture.onLoadObservable.addOnce(() => this.invalidate());
      } else {
        const drawn = new DynamicTexture(key, { width: PIXEL_TILE_SIZE, height: PIXEL_TILE_SIZE }, this.scene, false, Texture.NEAREST_SAMPLINGMODE);
        const ctx = drawn.getContext() as unknown as CanvasRenderingContext2D;
        ctx.putImageData(new ImageData(pixelTile(terrain, variant), PIXEL_TILE_SIZE, PIXEL_TILE_SIZE), 0, 0);
        drawn.update();
        texture = drawn;
      }
      texture.wrapU = Texture.CLAMP_ADDRESSMODE;
      texture.wrapV = Texture.CLAMP_ADDRESSMODE;
      material = new StandardMaterial(key, this.scene);
      material.diffuseTexture = texture;
      material.specularColor = Color3.Black();
      material.backFaceCulling = false; // a flat cap: whichever way it was built, seen from above
      if (deep) material.diffuseColor = new Color3(0.62, 0.68, 0.8);
      this.materials.set(key, material);
    }
    return material;
  }

  /** The DM's own tile textures (data URLs by terrain); they show in either art style. */
  setCustomTiles(tiles: Readonly<Record<string, string>>): void {
    const same = Object.keys(tiles).length === Object.keys(this.customTiles).length && Object.entries(tiles).every(([terrain, url]) => this.customTiles[terrain] === url);
    if (same) return;
    this.customTiles = { ...tiles };
    this.canvas.dataset.customTiles = Object.keys(tiles).sort().join(',');
    this.rebuildMap();
  }

  /** Builds the map again (a different look), keeping the camera where it is. */
  private rebuildMap(): void {
    const map = this.map;
    const framed = this.framedFor;
    if (map) {
      this.setMap(map);
      this.framedFor = framed;
      this.needsFraming = false;
    }
  }

  /** Pixel art tiles or plain colors (the viewer's Art style setting). */
  setArtStyle(style: ArtStyle): void {
    if (style === this.artStyle) return;
    this.artStyle = style;
    this.canvas.dataset.art = style;
    this.rebuildMap();
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
