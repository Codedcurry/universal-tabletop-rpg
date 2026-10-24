/**
 * Camera rules, as pure math. The renderer feeds in time and input and gets
 * back where the camera should be; nothing here touches Babylon.
 *
 * Compass convention: a heading is the direction the camera LOOKS.
 * 0 = north (toward row 0, world -z), PI/2 = east (+x), PI = south, -PI/2 = west.
 */

const { PI } = Math;
const TAU = 2 * PI;

export type Cardinal = 'north' | 'east' | 'south' | 'west';
export const CARDINALS: readonly Cardinal[] = ['north', 'east', 'south', 'west'];

/** Angle from straight down to the camera: the fixed HD-2D tilt, and top-down. */
export const TILT_2_5D = 0.95;
/** Not exactly 0: an orbit camera can't look exactly along its axis. */
export const TILT_TOP_DOWN = 0.001;

/** Wraps an angle into (-PI, PI]. */
export function normalizeAngle(angle: number): number {
  let a = ((angle % TAU) + TAU) % TAU; // [0, TAU)
  if (a > PI) a -= TAU;
  return a === -PI ? PI : a;
}

/** The signed turn from `from` to `to` that goes the short way round. */
export function shortestTurn(from: number, to: number): number {
  return normalizeAngle(to - from);
}

export function headingOf(cardinal: Cardinal): number {
  return normalizeAngle(CARDINALS.indexOf(cardinal) * (PI / 2));
}

export function nearestCardinal(heading: number): Cardinal {
  const quarter = Math.round(normalizeAngle(heading) / (PI / 2));
  return CARDINALS[((quarter % 4) + 4) % 4] as Cardinal;
}

/** Right = clockwise (the E key), left = counter-clockwise (Q). */
export function turnCardinal(cardinal: Cardinal, direction: 'left' | 'right'): Cardinal {
  const index = CARDINALS.indexOf(cardinal) + (direction === 'right' ? 1 : -1);
  return CARDINALS[(index + 4) % 4] as Cardinal;
}

// ---------------------------------------------------------------------------
// Smooth movement

const SETTLE = 1e-4;

/**
 * Moves `current` toward `goal`, halving the remaining distance every
 * `halfLife` seconds, so it looks the same at any frame rate. Snaps exactly
 * onto the goal once close enough.
 */
export function approach(current: number, goal: number, dt: number, halfLife: number): number {
  const next = goal + (current - goal) * 0.5 ** (dt / halfLife);
  return Math.abs(next - goal) < SETTLE ? goal : next;
}

/** Like approach, for angles: always turns the short way round. */
export function approachAngle(current: number, goal: number, dt: number, halfLife: number): number {
  const remaining = shortestTurn(current, goal);
  const next = remaining * 0.5 ** (dt / halfLife);
  return Math.abs(next) < SETTLE ? goal : goal - next;
}

// ---------------------------------------------------------------------------
// Orbit camera conversion

export interface GroundPoint {
  readonly x: number;
  readonly z: number;
}

export interface CameraPose {
  readonly heading: number;
  readonly tilt: number;
  readonly distance: number;
  readonly target: GroundPoint;
}

/** Babylon ArcRotateCamera angles: camera at target + radius * (cos a sin b, cos b, sin a sin b). */
export interface Orbit {
  readonly alpha: number;
  readonly beta: number;
  readonly radius: number;
  readonly target: GroundPoint;
}

/** The camera sits opposite the way it looks, so heading h means alpha = h + PI/2. */
export function orbitFor(pose: CameraPose): Orbit {
  return { alpha: pose.heading + PI / 2, beta: pose.tilt, radius: pose.distance, target: pose.target };
}

export function headingFromOrbit(alpha: number): number {
  return normalizeAngle(alpha - PI / 2);
}

// ---------------------------------------------------------------------------
// World bounds

export interface Bounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Keeps the point the camera looks at inside the map. */
export function clampTarget(target: GroundPoint, bounds: Bounds): GroundPoint {
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, target.x)),
    z: Math.min(bounds.maxZ, Math.max(bounds.minZ, target.z)),
  };
}

// ---------------------------------------------------------------------------
// Modes

export type CameraMode = '2.5d' | 'topDown';

/** The discrete camera settings a player chooses; continuous angles live in the renderer. */
export interface CameraView {
  readonly mode: CameraMode;
  /** Free camera: orbit and tilt by hand instead of snapping. */
  readonly free: boolean;
  /** Which way the camera snaps to when not free. */
  readonly cardinal: Cardinal;
}

export type CameraCommand =
  | { readonly type: 'turn'; readonly direction: 'left' | 'right' }
  | { readonly type: 'setMode'; readonly mode: CameraMode }
  | { readonly type: 'setFree'; readonly free: boolean };

/**
 * Applies a camera command. `currentHeading` is where the camera is pointing
 * right now, which matters when leaving free camera (snap to the nearest
 * direction in 2.5D; back to north-up in top-down).
 */
export function reduceCamera(view: CameraView, command: CameraCommand, currentHeading: number): CameraView {
  switch (command.type) {
    case 'turn':
      if (view.mode === 'topDown' && !view.free) return view; // top-down stays north-up
      return {
        ...view,
        cardinal: turnCardinal(view.free ? nearestCardinal(currentHeading) : view.cardinal, command.direction),
      };
    case 'setMode':
      // Top-down starts north-up; going back to 2.5D keeps that direction.
      return command.mode === 'topDown' ? { ...view, mode: 'topDown', cardinal: 'north' } : { ...view, mode: '2.5d' };
    case 'setFree':
      if (command.free) return { ...view, free: true };
      return {
        ...view,
        free: false,
        cardinal: view.mode === 'topDown' ? 'north' : nearestCardinal(currentHeading),
      };
  }
}

/** What the camera should glide toward; null where the player steers by hand. */
export function cameraGoal(view: CameraView): { heading: number | null; tilt: number | null } {
  const tilt = view.mode === 'topDown' ? TILT_TOP_DOWN : view.free ? null : TILT_2_5D;
  return { heading: view.free ? null : headingOf(view.cardinal), tilt };
}

// ---------------------------------------------------------------------------
// Gestures and sprites

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** How far the line between two fingers turned (radians), ignoring pinch and drag. */
export function twistAngle(a0: ScreenPoint, b0: ScreenPoint, a1: ScreenPoint, b1: ScreenPoint): number {
  const before = Math.atan2(b0.y - a0.y, b0.x - a0.x);
  const after = Math.atan2(b1.y - a1.y, b1.x - a1.x);
  return shortestTurn(before, after);
}

/** The four ways a character sprite can be drawn on screen. */
export type SpriteDirection = 'up' | 'right' | 'down' | 'left';
const SPRITE_DIRECTIONS: readonly SpriteDirection[] = ['up', 'right', 'down', 'left'];

/**
 * Which sprite to show for a character facing `facing` (a compass heading),
 * seen by a camera looking along `cameraHeading`. Facing the same way as the
 * camera shows their back ("up"); facing the camera shows "down".
 */
export function spriteFacing(facing: number, cameraHeading: number): SpriteDirection {
  const quarter = Math.round(normalizeAngle(facing - cameraHeading) / (PI / 2));
  return SPRITE_DIRECTIONS[((quarter % 4) + 4) % 4] as SpriteDirection;
}
