import { Body, ContactMaterial, ConvexPolyhedron, Material, Plane, Quaternion, Vec3, World } from 'cannon-es';
import { type DieShape, dieGeometry, faceNormal, rotate } from '@shared/dice';
import { seededRandom } from '@shared/random';

// The dice box's physics: dice thrown into a walled tray, simulated ahead
// of time (not live) and recorded frame by frame. Playing the recording back
// looks like a real throw; afterwards the faces are relabelled so the face
// that landed up shows the result already decided by the secure roll, so
// the physics never decides anything. The same seed gives the same throw.

/** The tray, in world units: across, front to back, and how high the walls are. */
export const TRAY = { width: 6, depth: 8.5, wall: 3, lid: 6 } as const;

/** How big each kind of die is (its farthest corner from the center). */
export const DIE_SIZE: Readonly<Record<DieShape | 'coin', number>> = {
  d4: 0.82,
  d6: 0.67,
  d8: 0.72,
  d10: 0.72,
  d12: 0.78,
  d20: 0.8,
  coin: 0.54,
};

export interface ThrowPiece {
  readonly shape: DieShape | 'coin';
}

export interface ThrowRecording {
  /** Seconds per tick. */
  readonly dt: number;
  readonly ticks: number;
  /** Per piece: x, y, z, then rotation x, y, z, w, for every tick. */
  readonly frames: readonly Float32Array[];
  /** Knocks loud enough to hear: when, and how hard. */
  readonly impacts: readonly { readonly tick: number; readonly strength: number }[];
}

const DT = 1 / 60;
const MAX_SECONDS = 4;
const AUDIBLE_KNOCK = 1.2;
/**
 * A piece this slow for this long stops for good, like a real die (physics
 * engines let dice resting on dice creep forever). The engine's own sleep
 * can miss a die that shivers by a hair, so this is checked here.
 */
const REST_SPEED = 0.3;
const REST_SPIN = 0.6;
const REST_TICKS = 15;
/**
 * A die left leaning (propped on another, or on the wall) gets a little nudge
 * to topple flat, like a jostled table; after a few it stops where it is.
 */
const NUDGE_AFTER_TICKS = 12;
const MAX_NUDGES = 5;

/** Lying flat: one face straight down, so the face on top reads cleanly. */
function lyingFlat(shape: DieShape | 'coin', body: Body): boolean {
  const geometry = dieGeometry(shape);
  const q = body.quaternion;
  // Faces that never count (a coin's rim) don't count as lying flat either.
  return geometry.faces.some(
    (_, face) => (geometry.readBy === 'corner' || geometry.faceValues[face] !== 0) && rotate([q.x, q.y, q.z, q.w], faceNormal(geometry, face))[1] < -0.97,
  );
}

function pieceBody(shape: DieShape | 'coin', material: Material): Body {
  const geometry = dieGeometry(shape);
  const size = DIE_SIZE[shape];
  const polyhedron = new ConvexPolyhedron({
    vertices: geometry.vertices.map(([x, y, z]) => new Vec3(x * size, y * size, z * size)),
    faces: geometry.faces.map((face) => [...face]),
  });
  const body = new Body({ mass: shape === 'coin' ? 0.6 : 1, shape: polyhedron, material });
  // A coin skids and settles rather than rolling about on its rim.
  body.linearDamping = shape === 'coin' ? 0.25 : 0.1;
  body.angularDamping = shape === 'coin' ? 0.45 : 0.1;
  body.allowSleep = true;
  body.sleepSpeedLimit = 0.15;
  body.sleepTimeLimit = 0.4;
  return body;
}

/** A static wall: a plane facing `normal`, through `point`. */
function wall(world: World, material: Material, point: [number, number, number], normal: [number, number, number]): void {
  const body = new Body({ mass: 0, shape: new Plane(), material });
  body.position.set(...point);
  // A plane faces +z; turn it to face `normal`.
  body.quaternion.setFromVectors(new Vec3(0, 0, 1), new Vec3(...normal));
  world.addBody(body);
}

export function simulateThrow(pieces: readonly ThrowPiece[], seed: number): ThrowRecording {
  const random = seededRandom(seed);
  const between = (low: number, high: number) => low + (random.nextInt(1_000_000) / 1_000_000) * (high - low);

  const world = new World({ gravity: new Vec3(0, -32, 0), allowSleep: true });
  // More solver passes keep piles of dice steady.
  (world.solver as unknown as { iterations: number }).iterations = 20;
  const felt = new Material('felt');
  const dice = new Material('dice');
  world.addContactMaterial(new ContactMaterial(felt, dice, { friction: 0.35, restitution: 0.35 }));
  world.addContactMaterial(new ContactMaterial(dice, dice, { friction: 0.2, restitution: 0.45 }));

  const { width, depth, lid } = TRAY;
  wall(world, felt, [0, 0, 0], [0, 1, 0]); // floor
  wall(world, felt, [0, lid, 0], [0, -1, 0]); // an invisible lid: nothing flies out
  wall(world, felt, [-width / 2, 0, 0], [1, 0, 0]);
  wall(world, felt, [width / 2, 0, 0], [-1, 0, 0]);
  wall(world, felt, [0, 0, -depth / 2], [0, 0, 1]);
  wall(world, felt, [0, 0, depth / 2], [0, 0, -1]);

  const ticks: number[] = [];
  const impacts: { tick: number; strength: number }[] = [];
  let tick = 0;
  const bodies = pieces.map((piece: ThrowPiece, index: number) => {
    const body = pieceBody(piece.shape, dice);
    // Thrown in from the near edge, spread out, spinning.
    const columns = Math.max(1, Math.min(5, pieces.length));
    const column = index % columns;
    const row = Math.floor(index / columns);
    body.position.set(
      -width / 2 + 0.9 + ((width - 1.8) * (column + 0.5)) / columns + between(-0.2, 0.2),
      1.2 + row * 0.9 + between(0, 0.5),
      depth / 2 - 1 - (row % 3) * 0.6,
    );
    body.quaternion.setFromEuler(between(0, Math.PI * 2), between(0, Math.PI * 2), between(0, Math.PI * 2));
    body.velocity.set(between(-3, 3), between(1, 4), between(-11, -7));
    // Coins flip end over end; dice tumble every way.
    const spin = piece.shape === 'coin' ? 9 : 18;
    body.angularVelocity.set(between(-spin, spin), between(-spin / 3, spin / 3), between(-spin, spin));
    body.addEventListener('collide', (event: { contact: { getImpactVelocityAlongNormal(): number } }) => {
      const strength = Math.abs(event.contact.getImpactVelocityAlongNormal());
      if (strength < AUDIBLE_KNOCK) return;
      const last = impacts[impacts.length - 1];
      if (last && last.tick === tick) last.strength = Math.max(last.strength, strength);
      else impacts.push({ tick, strength });
    });
    world.addBody(body);
    return body;
  });

  const frames: number[][] = bodies.map(() => []);
  const record = () => {
    bodies.forEach((body, index) => {
      const { position: p, quaternion: q } = body;
      frames[index]!.push(p.x, p.y, p.z, q.x, q.y, q.z, q.w);
    });
    ticks.push(tick);
  };

  record();
  const maxTicks = MAX_SECONDS / DT;
  const still = bodies.map(() => 0);
  const nudges = bodies.map(() => 0);
  while (tick < maxTicks - 1) {
    world.step(DT);
    tick++;
    // Once the lively part is over, damp what's left, so dice resting on dice stop creeping.
    if (tick === Math.round(2 / DT)) {
      for (const body of bodies) {
        body.linearDamping = 0.6;
        body.angularDamping = 0.6;
      }
    }
    record();
    bodies.forEach((body, index) => {
      if (body.type === Body.STATIC) return;
      const slow = body.velocity.length() < REST_SPEED && body.angularVelocity.length() < REST_SPIN;
      still[index] = slow ? still[index]! + 1 : 0;
      const flat = lyingFlat(pieces[index]!.shape, body);
      if (!flat && still[index]! >= NUDGE_AFTER_TICKS && nudges[index]! < MAX_NUDGES) {
        nudges[index]!++;
        still[index] = 0;
        // A hop toward the middle of the tray, away from the walls it may be leaning on.
        const toMiddle = Math.hypot(body.position.x, body.position.z) || 1;
        body.velocity.set((-body.position.x / toMiddle) * 2.5, between(3, 4.5), (-body.position.z / toMiddle) * 2.5);
        body.angularVelocity.set(between(-8, 8), between(-8, 8), between(-8, 8));
        return;
      }
      if (still[index]! >= REST_TICKS && (flat || nudges[index]! >= MAX_NUDGES)) {
        // Stopped: it stays put, but others still knock into it.
        body.velocity.setZero();
        body.angularVelocity.setZero();
        body.type = Body.STATIC;
        body.mass = 0;
        body.updateMassProperties();
      }
    });
    if (bodies.every((body) => body.type === Body.STATIC)) break;
  }

  settleLeaning(pieces, bodies, frames);
  const total = frames[0] ? frames[0].length / 7 : ticks.length;

  return {
    dt: DT,
    ticks: total,
    frames: frames.map((values) => Float32Array.from(values)),
    impacts: impacts.filter((impact) => impact.tick < ticks.length),
  };
}

/** Ticks for a leaning piece to tip down onto its nearest face at the end. */
const SETTLE_TICKS = 12;

/**
 * Physics can leave a die propped on another, or a coin on its rim. Such a
 * piece tips the rest of the way onto its nearest face in a short closing
 * step, keeping its lowest point where it is, so every result reads cleanly.
 */
function settleLeaning(pieces: readonly ThrowPiece[], bodies: readonly Body[], frames: number[][]): void {
  const targets = bodies.map((body, index) => {
    const shape = pieces[index]!.shape;
    if (lyingFlat(shape, body)) return null;
    const geometry = dieGeometry(shape);
    const size = DIE_SIZE[shape];
    const q = body.quaternion;
    const now: [number, number, number, number] = [q.x, q.y, q.z, q.w];
    // The face nearest to pointing down (only faces that count).
    let best = -1;
    let lowest = Number.POSITIVE_INFINITY;
    geometry.faces.forEach((_, face) => {
      if (geometry.readBy === 'face' && geometry.faceValues[face] === 0) return;
      const y = rotate(now, faceNormal(geometry, face))[1];
      if (y < lowest) {
        lowest = y;
        best = face;
      }
    });
    const down = rotate(now, faceNormal(geometry, best));
    const turn = new Quaternion().setFromVectors(new Vec3(...down), new Vec3(0, -1, 0));
    const flat = turn.mult(q);
    const after: [number, number, number, number] = [flat.x, flat.y, flat.z, flat.w];
    const bottom = (rotation: [number, number, number, number]) => Math.min(...geometry.vertices.map((vertex) => rotate(rotation, vertex)[1] * size));
    return { from: q.clone(), to: flat, lift: bottom(now) - bottom(after) };
  });
  if (targets.every((target) => target === null)) return;
  for (let step = 1; step <= SETTLE_TICKS; step++) {
    const t = step / SETTLE_TICKS;
    const eased = t * t * (3 - 2 * t);
    bodies.forEach((body, index) => {
      const target = targets[index];
      const p = body.position;
      if (!target) {
        frames[index]!.push(p.x, p.y, p.z, body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
        return;
      }
      const r = new Quaternion();
      target.from.slerp(target.to, eased, r);
      frames[index]!.push(p.x, p.y + target.lift * eased, p.z, r.x, r.y, r.z, r.w);
    });
  }
}

/** The rotation of a piece at the end of the throw. */
export function finalRotation(recording: ThrowRecording, piece: number): [number, number, number, number] {
  const frame = recording.frames[piece]!;
  const at = (recording.ticks - 1) * 7;
  return [frame[at + 3]!, frame[at + 4]!, frame[at + 5]!, frame[at + 6]!];
}

