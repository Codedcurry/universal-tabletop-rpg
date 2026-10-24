import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import {
  type Bounds,
  type CameraCommand,
  type CameraView,
  type GroundPoint,
  TILT_2_5D,
  approach,
  approachAngle,
  cameraGoal,
  clampTarget,
  headingFromOrbit,
  orbitFor,
  reduceCamera,
  twistAngle,
  wheelZoom,
} from '@shared/camera';

// Drives Babylon's orbit camera from the rules in shared/camera: snapping
// N/E/S/W turns, top-down, free camera, world bounds, focus, and gestures.

/** Seconds for the camera to cover half the remaining turn or tilt. */
const TURN_HALF_LIFE = 0.07;
const FOCUS_HALF_LIFE = 0.12;
/** Twist this far (radians, about 35 degrees) for one quarter turn. */
const TWIST_STEP = 0.6;
/** Middle-drag this many pixels for one quarter turn in the snapping view. */
const DRAG_TURN_PIXELS = 140;
const MIN_DISTANCE = 3;
const ZOOM_HALF_LIFE = 0.05;
/** Browsers report wheel scrolling in pixels, lines, or pages. */
const WHEEL_UNIT_PIXELS = [1, 33, 400];

type InputEntry = ArcRotateCamera['movement']['input']['inputMap'][number];

export class CameraRig {
  readonly camera: ArcRotateCamera;
  private view: CameraView = { mode: '2.5d', free: false, cardinal: 'north' };
  private editing = false;
  private bounds: Bounds | null = null;
  private focusGoal: GroundPoint | null = null;
  /** The distance a wheel scroll is gliding toward. */
  private zoomGoal: number | null = null;
  /** Height of the ground surface: the camera orbits a point on it, so turning keeps the same tile in the middle. */
  private groundY = 0;
  private readonly touches = new Map<number, { x: number; y: number }>();
  private twisted = 0;
  private middleDrag: { x: number; turned: number } | null = null;
  private readonly listeners = new Set<(view: CameraView) => void>();

  constructor(
    scene: Scene,
    private readonly canvas: HTMLCanvasElement,
  ) {
    this.camera = new ArcRotateCamera('camera', orbitFor({ heading: 0, tilt: TILT_2_5D, distance: 20, target: { x: 0, z: 0 } }).alpha, TILT_2_5D, 20, Vector3.Zero(), scene);
    // Let the camera block the browser's own handling (page scrolling) of its input.
    this.camera.attachControl(false);
    this.camera.mapPanning = true; // pan across the ground, never up into the sky
    this.camera.lowerBetaLimit = 0.0005;
    this.camera.upperBetaLimit = 1.35; // never below the ground
    this.camera.lowerRadiusLimit = MIN_DISTANCE;
    this.camera.wheelPrecision = 30;
    this.camera.panningSensibility = 60;
    // Babylon keeps gliding after a drag, multiplying its effect; a shorter glide keeps orbiting controllable.
    this.camera.inertia = 0.6;
    this.camera.panningInertia = 0.6;
    this.camera.angularSensibilityX = 500;
    this.camera.angularSensibilityY = 500;
    this.configureInput();

    canvas.addEventListener('wheel', this.onWheel, { passive: true });
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
  }

  get cameraView(): CameraView {
    return this.view;
  }

  /** Where the camera currently points (changes continuously in free camera). */
  get heading(): number {
    return headingFromOrbit(this.camera.alpha);
  }

  get target(): GroundPoint {
    return { x: this.camera.target.x, z: this.camera.target.z };
  }

  onViewChange(listener: (view: CameraView) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  command(command: CameraCommand): void {
    const next = reduceCamera(this.view, command, this.heading);
    if (next === this.view) return;
    this.view = next;
    this.configureInput();
    for (const listener of this.listeners) listener(next);
  }

  /** In the map editor the left button belongs to the tools. */
  setEditing(editing: boolean): void {
    this.editing = editing;
    this.configureInput();
  }

  setBounds(bounds: Bounds | null): void {
    this.bounds = bounds;
  }

  setGroundLevel(y: number): void {
    this.groundY = y;
  }

  /** Glides the camera to look at a point, keeping its direction and zoom. */
  focusOn(point: GroundPoint): void {
    this.focusGoal = this.bounds ? clampTarget(point, this.bounds) : point;
  }

  /** Jumps to a framing: look at `target` from `distance`, with the current direction and tilt. */
  place(target: GroundPoint, distance: number): void {
    this.stopGliding();
    this.focusGoal = null;
    this.zoomGoal = null;
    const goal = cameraGoal(this.view);
    const orbit = orbitFor({
      heading: goal.heading ?? this.heading,
      tilt: goal.tilt ?? this.camera.beta,
      distance,
      target,
    });
    this.camera.alpha = orbit.alpha;
    this.camera.beta = orbit.beta;
    this.camera.radius = distance;
    this.camera.target = new Vector3(target.x, this.groundY, target.z);
  }

  setMaxDistance(distance: number): void {
    this.camera.upperRadiusLimit = Math.max(MIN_DISTANCE, distance);
  }

  /**
   * Advances one frame: glides toward the snapped direction and tilt and any
   * focus point, and keeps the camera over the map. Returns true while still moving.
   */
  update(dt: number): boolean {
    const camera = this.camera;
    const goal = cameraGoal(this.view);
    let moving = false;

    if (goal.heading !== null) {
      const heading = approachAngle(this.heading, goal.heading, dt, TURN_HALF_LIFE);
      camera.alpha = orbitFor({ heading, tilt: camera.beta, distance: camera.radius, target: this.target }).alpha;
      moving ||= heading !== goal.heading;
    }
    if (goal.tilt !== null) {
      camera.beta = approach(camera.beta, goal.tilt, dt, TURN_HALF_LIFE);
      moving ||= camera.beta !== goal.tilt;
    }

    if (this.zoomGoal !== null) {
      camera.radius = approach(camera.radius, this.zoomGoal, dt, ZOOM_HALF_LIFE);
      if (camera.radius === this.zoomGoal) this.zoomGoal = null;
      else moving = true;
    }

    let target = this.target;
    if (this.focusGoal) {
      target = {
        x: approach(target.x, this.focusGoal.x, dt, FOCUS_HALF_LIFE),
        z: approach(target.z, this.focusGoal.z, dt, FOCUS_HALF_LIFE),
      };
      if (target.x === this.focusGoal.x && target.z === this.focusGoal.z) this.focusGoal = null;
      else moving = true;
    }
    if (this.bounds) target = clampTarget(target, this.bounds);
    if (target.x !== camera.target.x || target.z !== camera.target.z || camera.target.y !== this.groundY) {
      camera.target = new Vector3(target.x, this.groundY, target.z);
    }
    return moving;
  }

  dispose(): void {
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
  }

  // -------------------------------------------------------------------------

  private stopGliding(): void {
    this.camera.movement.resetRotationVelocity();
    this.camera.movement.resetPanVelocity();
    this.camera.movement.resetZoomVelocity();
  }

  /**
   * Which drag does what. The snapping view only pans and zooms by hand
   * (turning is Q/E, the buttons, middle-drag, or a twist); free camera also
   * orbits. In the editor the left button is the tool, so orbiting moves to
   * the middle button. Touch: one finger acts as the left button.
   */
  private configureInput(): void {
    const { free } = this.view;
    const entries: InputEntry[] = [
      { source: 'pointer', button: 2, interaction: 'pan' },
      { source: 'pointer', button: 0, modifiers: { ctrl: true }, interaction: 'pan' },
    ];
    if (this.editing) {
      if (free) entries.push({ source: 'pointer', button: 1, interaction: 'rotate' });
    } else {
      entries.push({ source: 'pointer', button: 0, interaction: free ? 'rotate' : 'pan' });
      if (free) entries.push({ source: 'pointer', button: 1, interaction: 'rotate' });
    }
    this.camera.movement.input.inputMap = entries;
    // In the editor, one finger paints, so the camera ignores it (see the touch toggle).
    const pointers = this.camera.inputs.attached.pointers as unknown as { buttons: number[] } | undefined;
    if (pointers) pointers.buttons = this.editing ? [1, 2] : [0, 1, 2];
  }

  /** Wheel zoom is handled here (not by Babylon): a fixed share of the distance per notch, glided smoothly. */
  private readonly onWheel = (event: WheelEvent) => {
    const pixels = event.deltaY * (WHEEL_UNIT_PIXELS[event.deltaMode] ?? 1);
    const max = this.camera.upperRadiusLimit ?? 1000;
    this.zoomGoal = wheelZoom(this.zoomGoal ?? this.camera.radius, pixels, MIN_DISTANCE, max);
  };

  // --- gestures Babylon doesn't have: twist to turn, middle-drag to turn ---

  private readonly onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'touch') {
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.twisted = 0;
    } else if (event.button === 1 && !this.view.free) {
      this.middleDrag = { x: event.clientX, turned: 0 };
    }
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === 'touch' && this.touches.has(event.pointerId)) {
      const before = [...this.touches.values()];
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const after = [...this.touches.values()];
      if (before.length === 2 && after.length === 2) this.twist(twistAngle(before[0]!, before[1]!, after[0]!, after[1]!));
      return;
    }
    if (this.middleDrag) {
      // Dragging right swings the view to the left, as if pulling the map around.
      const steps = Math.trunc((event.clientX - this.middleDrag.x) / DRAG_TURN_PIXELS);
      while (this.middleDrag.turned < steps) {
        this.middleDrag.turned++;
        this.command({ type: 'turn', direction: 'left' });
      }
      while (this.middleDrag.turned > steps) {
        this.middleDrag.turned--;
        this.command({ type: 'turn', direction: 'right' });
      }
    }
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    this.touches.delete(event.pointerId);
    if (event.button === 1) this.middleDrag = null;
  };

  private twist(angle: number): void {
    if (this.view.free) {
      // Free camera follows the fingers smoothly.
      this.camera.alpha -= angle;
      return;
    }
    this.twisted += angle;
    if (Math.abs(this.twisted) >= TWIST_STEP) {
      // Twisting clockwise turns the map clockwise, so the camera turns the other way.
      this.command({ type: 'turn', direction: this.twisted > 0 ? 'left' : 'right' });
      this.twisted = 0;
    }
  }
}
