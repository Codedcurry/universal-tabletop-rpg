import { describe, expect, it } from 'vitest';
import {
  CARDINALS,
  type CameraView,
  TILT_2_5D,
  TILT_TOP_DOWN,
  approach,
  approachAngle,
  cameraGoal,
  clampTarget,
  headingFromOrbit,
  headingOf,
  nearestCardinal,
  normalizeAngle,
  orbitFor,
  reduceCamera,
  shortestTurn,
  spriteFacing,
  turnCardinal,
  twistAngle,
  ZOOM_PER_NOTCH,
  wheelZoom,
} from './index';

// Compass convention: heading is where the camera LOOKS. 0 = north (toward
// row 0, world -z), PI/2 = east (+x), PI = south, -PI/2 = west.

const { PI } = Math;

describe('angles', () => {
  it.each([
    [0, 0],
    [PI, PI],
    [-PI, PI],
    [3 * PI, PI],
    [2 * PI + 0.5, 0.5],
    [-PI / 2, -PI / 2],
    [1.5 * PI, -PI / 2],
  ])('normalizes %f to %f', (input, expected) => {
    expect(normalizeAngle(input)).toBeCloseTo(expected);
  });

  it('turns the short way round', () => {
    expect(shortestTurn(0.1, -0.1)).toBeCloseTo(-0.2);
    expect(shortestTurn(PI - 0.1, -PI + 0.1)).toBeCloseTo(0.2);
    expect(shortestTurn(-PI / 2, PI)).toBeCloseTo(-PI / 2);
  });
});

describe('cardinal directions', () => {
  it('have compass headings', () => {
    expect(CARDINALS).toEqual(['north', 'east', 'south', 'west']);
    expect(headingOf('north')).toBeCloseTo(0);
    expect(headingOf('east')).toBeCloseTo(PI / 2);
    expect(Math.abs(headingOf('south'))).toBeCloseTo(PI);
    expect(headingOf('west')).toBeCloseTo(-PI / 2);
  });

  it.each([
    [0.3, 'north'],
    [-0.7, 'north'],
    [0.9, 'east'],
    [PI / 2 + 0.7, 'east'],
    [PI - 0.2, 'south'],
    [-PI + 0.2, 'south'],
    [-PI / 2 - 0.5, 'west'],
  ] as const)('snaps heading %f to %s', (heading, cardinal) => {
    expect(nearestCardinal(heading)).toBe(cardinal);
  });

  it('turns a quarter at a time: right is clockwise (E), left counter-clockwise (Q)', () => {
    expect(turnCardinal('north', 'right')).toBe('east');
    expect(turnCardinal('east', 'right')).toBe('south');
    expect(turnCardinal('west', 'right')).toBe('north');
    expect(turnCardinal('north', 'left')).toBe('west');
    expect(turnCardinal('south', 'left')).toBe('east');
  });
});

describe('smooth movement', () => {
  it('moves part of the way each frame and settles exactly', () => {
    let value = 0;
    value = approach(value, 10, 0.05, 0.1);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(10);
    for (let i = 0; i < 200; i++) value = approach(value, 10, 0.05, 0.1);
    expect(value).toBe(10);
  });

  it('is independent of frame rate: two short steps equal one long step', () => {
    const twoShort = approach(approach(0, 10, 0.02, 0.1), 10, 0.02, 0.1);
    const oneLong = approach(0, 10, 0.04, 0.1);
    expect(twoShort).toBeCloseTo(oneLong);
  });

  it('turns angles the short way and lands on the goal', () => {
    let angle = PI - 0.1;
    const goal = -PI + 0.1;
    angle = approachAngle(angle, goal, 0.016, 0.1);
    // It went up past PI (wrapping), not all the way back down.
    expect(Math.abs(shortestTurn(angle, goal))).toBeLessThan(0.2);
    for (let i = 0; i < 300; i++) angle = approachAngle(angle, goal, 0.016, 0.1);
    expect(normalizeAngle(angle)).toBeCloseTo(goal);
  });
});

describe('orbit conversion (Babylon ArcRotateCamera angles)', () => {
  it('round-trips heading through the orbit angle', () => {
    for (const heading of [0, 0.3, PI / 2, -PI / 2, PI - 0.01, -2]) {
      const orbit = orbitFor({ heading, tilt: TILT_2_5D, distance: 12, target: { x: 3, z: 4 } });
      expect(normalizeAngle(headingFromOrbit(orbit.alpha))).toBeCloseTo(normalizeAngle(heading));
    }
  });

  it('places the camera behind the target, opposite where it looks', () => {
    const orbit = orbitFor({ heading: 0, tilt: TILT_2_5D, distance: 10, target: { x: 0, z: 0 } });
    // Looking north (-z) means sitting to the south (+z) of the target.
    const cameraZ = orbit.radius * Math.sin(orbit.beta) * Math.sin(orbit.alpha);
    const cameraX = orbit.radius * Math.sin(orbit.beta) * Math.cos(orbit.alpha);
    expect(cameraZ).toBeGreaterThan(0);
    expect(cameraX).toBeCloseTo(0);
    const east = orbitFor({ heading: PI / 2, tilt: TILT_2_5D, distance: 10, target: { x: 0, z: 0 } });
    expect(east.radius * Math.sin(east.beta) * Math.cos(east.alpha)).toBeLessThan(0); // west of the target
  });

  it('looks straight down in top-down mode, without hitting the pole', () => {
    expect(TILT_TOP_DOWN).toBeGreaterThan(0);
    expect(TILT_TOP_DOWN).toBeLessThan(0.01);
    expect(TILT_2_5D).toBeGreaterThan(0.6);
    expect(TILT_2_5D).toBeLessThan(1.2);
  });
});

describe('world bounds', () => {
  const bounds = { minX: 0, maxX: 10, minZ: -2, maxZ: 8 };

  it('keeps the camera target inside the map', () => {
    expect(clampTarget({ x: 5, z: 3 }, bounds)).toEqual({ x: 5, z: 3 });
    expect(clampTarget({ x: -4, z: 20 }, bounds)).toEqual({ x: 0, z: 8 });
    expect(clampTarget({ x: 99, z: -99 }, bounds)).toEqual({ x: 10, z: -2 });
  });
});

describe('camera modes', () => {
  const start: CameraView = { mode: '2.5d', free: false, cardinal: 'north' };

  it('turns with Q/E in 2.5D', () => {
    expect(reduceCamera(start, { type: 'turn', direction: 'right' }, 0)).toEqual({ ...start, cardinal: 'east' });
  });

  it('snaps to the nearest direction when free camera is turned off in 2.5D', () => {
    const free = reduceCamera(start, { type: 'setFree', free: true }, 0);
    expect(free.free).toBe(true);
    // The player orbited to just past south-east, then turned free camera off.
    const snapped = reduceCamera(free, { type: 'setFree', free: false }, PI * 0.8);
    expect(snapped).toEqual({ mode: '2.5d', free: false, cardinal: 'south' });
  });

  it('snaps back to north-up when free camera is turned off in top-down', () => {
    const top = reduceCamera(start, { type: 'setMode', mode: 'topDown' }, 0);
    const free = reduceCamera(top, { type: 'setFree', free: true }, 0);
    expect(reduceCamera(free, { type: 'setFree', free: false }, 2.1)).toEqual({
      mode: 'topDown',
      free: false,
      cardinal: 'north',
    });
  });

  it('top-down without free camera is north-up and ignores turning', () => {
    const top = reduceCamera({ ...start, cardinal: 'west' }, { type: 'setMode', mode: 'topDown' }, -PI / 2);
    expect(top.cardinal).toBe('north');
    expect(reduceCamera(top, { type: 'turn', direction: 'left' }, 0)).toEqual(top);
  });

  it('turning in free camera snaps a quarter from the current heading and stays free', () => {
    const free: CameraView = { ...start, free: true };
    expect(reduceCamera(free, { type: 'turn', direction: 'right' }, 0.2)).toEqual({ ...free, cardinal: 'east' });
  });

  it('gives the angles to glide toward: none for heading in free camera', () => {
    expect(cameraGoal(start)).toEqual({ heading: 0, tilt: TILT_2_5D });
    expect(cameraGoal({ mode: 'topDown', free: false, cardinal: 'north' })).toEqual({ heading: 0, tilt: TILT_TOP_DOWN });
    expect(cameraGoal({ mode: '2.5d', free: true, cardinal: 'east' })).toEqual({ heading: null, tilt: null });
    // Free top-down still stays overhead.
    expect(cameraGoal({ mode: 'topDown', free: true, cardinal: 'north' })).toEqual({ heading: null, tilt: TILT_TOP_DOWN });
  });

  it('switching back to 2.5D from top-down keeps the north-up direction', () => {
    const top = reduceCamera(start, { type: 'setMode', mode: 'topDown' }, 0);
    expect(reduceCamera(top, { type: 'setMode', mode: '2.5d' }, 0)).toEqual(start);
  });
});

describe('twist gesture (two fingers)', () => {
  it('measures how far the line between two fingers turned', () => {
    const a = { x: 0, y: 0 };
    expect(twistAngle(a, { x: 10, y: 0 }, a, { x: 0, y: 10 })).toBeCloseTo(PI / 2);
    expect(twistAngle(a, { x: 10, y: 0 }, a, { x: 0, y: -10 })).toBeCloseTo(-PI / 2);
  });

  it('ignores the fingers moving together or apart (pinch)', () => {
    expect(twistAngle({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: -5, y: 0 }, { x: 15, y: 0 })).toBeCloseTo(0);
  });

  it('handles the turn crossing the back of the circle', () => {
    // The angle passes through PI: a small turn of +0.2, not a near-full circle.
    expect(twistAngle({ x: 0, y: 0 }, { x: -10, y: 1 }, { x: 0, y: 0 }, { x: -10, y: -1 })).toBeCloseTo(0.2, 1);
  });
});

describe('sprite facing', () => {
  // Sprites are drawn facing down (toward the viewer), up (away), left, or right on screen.
  it.each([
    ['north', 'north', 'up'], // facing the way the camera looks: we see their back
    ['south', 'north', 'down'], // facing the camera
    ['east', 'north', 'right'],
    ['west', 'north', 'left'],
    ['north', 'east', 'left'], // camera turned to look east: a north-facing character now faces screen-left
    ['north', 'south', 'down'],
    ['east', 'south', 'left'],
    ['west', 'west', 'up'],
  ] as const)('a character facing %s, seen by a camera looking %s, shows its %s sprite', (facing, camera, sprite) => {
    expect(spriteFacing(headingOf(facing), headingOf(camera))).toBe(sprite);
  });

  it('picks the nearest sprite for in-between angles (free camera)', () => {
    expect(spriteFacing(0, 0.6)).toBe('up');
    expect(spriteFacing(0, 1.0)).toBe('left');
    expect(spriteFacing(PI / 2, -0.3)).toBe('right');
  });
});

describe('wheelZoom', () => {
  // One mouse-wheel notch is about 100 pixels of scroll. Zoom is a percentage
  // of the current distance, so it feels equally quick close up and far away.
  it('moves a good chunk per notch: in when scrolling up, out when scrolling down', () => {
    expect(wheelZoom(20, -100, 1, 100)).toBeCloseTo(20 / (1 + ZOOM_PER_NOTCH));
    expect(wheelZoom(20, 100, 1, 100)).toBeCloseTo(20 * (1 + ZOOM_PER_NOTCH));
    expect(ZOOM_PER_NOTCH).toBeGreaterThanOrEqual(0.15);
  });

  it('three notches cover a lot of ground', () => {
    let distance = 30;
    for (let i = 0; i < 3; i++) distance = wheelZoom(distance, -100, 1, 100);
    expect(distance).toBeLessThan(30 * 0.66);
  });

  it('comes back exactly when scrolled in and out by the same amount', () => {
    expect(wheelZoom(wheelZoom(17, -250, 1, 100), 250, 1, 100)).toBeCloseTo(17);
  });

  it('scales smooth trackpad scrolling in proportion', () => {
    const tenSmallSteps = Array.from({ length: 10 }).reduce<number>((d) => wheelZoom(d, -10, 1, 100), 20);
    expect(tenSmallSteps).toBeCloseTo(wheelZoom(20, -100, 1, 100));
  });

  it('stays within the zoom limits', () => {
    expect(wheelZoom(3.2, -1000, 3, 50)).toBe(3);
    expect(wheelZoom(48, 1000, 3, 50)).toBe(50);
  });
});
