import { type Cell, type GridKind, cell, cellKey, createGrid } from '../grid';
import { MAP_FORMAT_VERSION, type MapData, MapError, type TileData, type WallData, createWorldMap, objectInfo, sharesEdge } from '../map';
import { seededRandom } from '../random';

/**
 * Ready-made example maps, one per size, that show what a map can hold:
 * terrain, height, solid tiles, walls, and water, on both grid types. Built
 * from code (not stored files) so they stay small and exact.
 *
 * Design rules that keep every open tile reachable: walkable neighbors differ
 * by at most a level or two, cliffs have ramps, trees never touch each other
 * or the map's edge (so they can't close off a pocket), and water deeper than
 * the shallows is solid.
 */

export type ExampleSize = 'small' | 'medium' | 'large';

export interface ExampleMapInfo {
  readonly id: string;
  readonly name: string;
  readonly size: ExampleSize;
  readonly description: string;
}

export const EXAMPLE_MAPS: readonly ExampleMapInfo[] = [
  {
    id: 'forest-glade',
    name: 'Forest Glade',
    size: 'small',
    description: 'A clearing among the trees: a dirt path, a pond, a rocky knoll, and a ruined woodcutter\'s cabin.',
  },
  {
    id: 'snowy-pass',
    name: 'Snowy Pass',
    size: 'medium',
    description: 'A trail climbing between stone ridges and snowy peaks, past a frozen lake to a ruined watchtower.',
  },
  {
    id: 'smugglers-cove',
    name: "Smuggler's Cove",
    size: 'large',
    description: 'A hidden bay: beach and dock, a smugglers\' hut, a sea cave, and ramps up the cliffs to a wooded plateau.',
  },
];

export function exampleMap(id: string): MapData {
  switch (id) {
    case 'forest-glade':
      return forestGlade();
    case 'snowy-pass':
      return snowyPass();
    case 'smugglers-cove':
      return smugglersCove();
    default:
      throw new MapError(`There is no example map "${id}"`);
  }
}

// ---------------------------------------------------------------------------
// A small builder: tiles laid out in rows and columns (hex rows offset, like
// rectangleTiles), painted by rules over their position on the ground.

interface Spot {
  readonly col: number;
  readonly row: number;
  readonly cell: Cell;
  /** Position on the ground, in tiles. */
  readonly x: number;
  readonly z: number;
}

interface Paint {
  height: number;
  terrain: string;
  blocked: boolean;
  object: string | null;
}

class MapBuilder {
  readonly grid;
  private readonly spots = new Map<string, Spot>();
  private readonly paint = new Map<string, Paint>();
  private readonly walls = new Map<string, WallData>();

  constructor(
    readonly kind: GridKind,
    readonly cols: number,
    readonly rows: number,
  ) {
    this.grid = createGrid(kind);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const at = cell(kind === 'hex' ? col - Math.floor(row / 2) : col, row);
        const { x, z } = this.grid.toWorld(at, 1);
        this.spots.set(cellKey(at), { col, row, cell: at, x, z });
        this.paint.set(cellKey(at), { height: 0, terrain: 'grass', blocked: false, object: null });
      }
    }
  }

  /** Every tile's spot, row by row. */
  all(): Spot[] {
    return [...this.spots.values()];
  }

  /** The tile at a column and row (hex rows are offset). */
  spot(col: number, row: number): Spot {
    const found = this.all().find((spot) => spot.col === col && spot.row === row);
    if (!found) throw new MapError(`No tile at column ${col}, row ${row}`);
    return found;
  }

  get(at: Cell): Paint | undefined {
    return this.paint.get(cellKey(at));
  }

  set(at: Cell, change: Partial<Paint>): void {
    const current = this.paint.get(cellKey(at));
    if (current) Object.assign(current, change);
  }

  /** Neighbors on the map that share an edge. */
  edgeNeighbors(at: Cell): Cell[] {
    return this.grid.neighbors(at).filter((other) => this.spots.has(cellKey(other)) && sharesEdge(this.grid, at, other));
  }

  isBorder(at: Cell): boolean {
    return this.grid.neighbors(at).some((other) => !this.spots.has(cellKey(other)));
  }

  /** Walls all around a room, except on the edges listed as openings (doors, collapsed gaps). */
  enclose(room: readonly Cell[], openings: readonly (readonly [Cell, Cell])[] = []): void {
    const inside = new Set(room.map(cellKey));
    const open = new Set(openings.map(([a, b]) => edgeKey(a, b)));
    for (const at of room) {
      for (const other of this.edgeNeighbors(at)) {
        if (inside.has(cellKey(other)) || open.has(edgeKey(at, other))) continue;
        this.walls.set(edgeKey(at, other), [at, other]);
      }
    }
  }

  /** Stands an object on a tile; the tile is solid if the object blocks the way. */
  place(at: Cell, object: string): void {
    this.set(at, { object, blocked: objectInfo(object)?.blocks ?? true });
  }

  /** A single wall segment between two neighboring tiles. */
  wall(a: Cell, b: Cell): void {
    this.walls.set(edgeKey(a, b), [a, b]);
  }

  /**
   * Scatters objects (picked from `objects`) on free tiles where `allowed`.
   * Ones that block the way never touch each other, the map's edge, or a
   * wall, so they can't close off any ground.
   */
  scatter(count: number, seed: number, allowed: (spot: Spot) => boolean, objects: readonly string[]): void {
    const random = seededRandom(seed);
    const spots = this.all();
    const walled = new Set([...this.walls.values()].flatMap(([a, b]) => [cellKey(a), cellKey(b)]));
    let placed = 0;
    for (let attempt = 0; attempt < count * 40 && placed < count; attempt++) {
      const spot = spots[random.nextInt(spots.length)] as Spot;
      const here = this.get(spot.cell) as Paint;
      if (here.blocked || here.object || !allowed(spot)) continue;
      const object = objects[random.nextInt(objects.length)] as string;
      if (objectInfo(object)?.blocks !== false) {
        if (this.isBorder(spot.cell) || walled.has(cellKey(spot.cell))) continue;
        if (this.grid.neighbors(spot.cell).some((other) => this.get(other)?.blocked)) continue;
      }
      this.place(spot.cell, object);
      placed++;
    }
  }

  build(): MapData {
    const tiles: TileData[] = this.all().map((spot) => {
      const { height, terrain, blocked, object } = this.paint.get(cellKey(spot.cell)) as Paint;
      return { q: spot.cell.q, r: spot.cell.r, height, terrain, ...(blocked ? { blocked: true } : {}), ...(object ? { object } : {}) };
    });
    // Through the world map for canonical order, so equal maps give equal data.
    return createWorldMap({ formatVersion: MAP_FORMAT_VERSION, grid: this.kind, tiles, walls: [...this.walls.values()] }).toData();
  }
}

function edgeKey(a: Cell, b: Cell): string {
  const [first, second] = [cellKey(a), cellKey(b)].sort();
  return `${first}|${second}`;
}

const smoothstep = (t: number) => {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
};

// ---------------------------------------------------------------------------
// Forest Glade: small, hex

function forestGlade(): MapData {
  const map = new MapBuilder('hex', 13, 10);
  const pond = { x: 5, z: 10.5 };
  const knoll = { x: 18, z: 3 };
  // The path winds from the west edge to the east edge.
  const pathZ = (x: number) => 7 + 1.6 * Math.sin(x / 3.2);
  const cabin = [map.spot(3, 1), map.spot(4, 1), map.spot(5, 1), map.spot(3, 2), map.spot(4, 2), map.spot(5, 2)];
  const inCabin = new Set(cabin.map((spot) => cellKey(spot.cell)));

  for (const spot of map.all()) {
    const toPond = Math.hypot(spot.x - pond.x, spot.z - pond.z);
    const toKnoll = Math.hypot(spot.x - knoll.x, spot.z - knoll.z);
    // The knoll rises a level at a time to 3, topped with bare stone.
    const height = Math.max(0, Math.round(3 * (1 - toKnoll / 7)));
    const paint: Partial<Paint> = { height, terrain: height >= 3 ? 'stone' : height >= 2 ? 'dirt' : 'grass' };
    if (Math.abs(spot.z - pathZ(spot.x)) < 0.9 && height <= 1) paint.terrain = 'dirt';
    if (toPond < 3.1) paint.terrain = 'water';
    if (toPond < 1.6) paint.blocked = true; // deep water in the middle
    if (inCabin.has(cellKey(spot.cell))) Object.assign(paint, { terrain: 'wood', height: 0 });
    map.set(spot.cell, paint);
  }
  // Boulders and loose rocks on the knoll.
  map.place(map.spot(10, 1).cell, 'boulder');
  map.place(map.spot(11, 3).cell, 'boulder');
  map.place(map.spot(9, 2).cell, 'rock');

  // The ruined cabin: walls with a door on the south side and a collapsed gap to the east.
  map.enclose(
    cabin.map((spot) => spot.cell),
    [
      [map.spot(4, 2).cell, map.spot(4, 3).cell],
      [map.spot(5, 1).cell, map.spot(6, 1).cell],
    ],
  );
  // A fallen fence by the path.
  for (const col of [8, 9]) map.wall(map.spot(col, 5).cell, map.spot(col, 6).cell);

  // Inside the cabin: a table and the woodcutter's chest.
  map.place(map.spot(3, 1).cell, 'table');
  map.place(map.spot(5, 2).cell, 'chest');
  // A campfire in the clearing with stumps for seats, and a signpost where the path comes in.
  map.place(map.spot(7, 4).cell, 'campfire');
  map.place(map.spot(6, 4).cell, 'stump');
  map.place(map.spot(8, 4).cell, 'stump');
  map.place(map.spot(1, 4).cell, 'signpost');

  const wild = (spot: Spot) => {
    const here = map.get(spot.cell) as Paint;
    return here.terrain === 'grass' && Math.abs(spot.z - pathZ(spot.x)) > 2 && Math.hypot(spot.x - 7, spot.z - 3) > 4;
  };
  map.scatter(12, 7, wild, ['tree', 'tree', 'pine']);
  map.scatter(1, 9, (spot) => wild(spot) && Math.hypot(spot.x - pond.x, spot.z - pond.z) < 5, ['dead_tree']);
  map.scatter(10, 8, wild, ['bush', 'flowers', 'flowers', 'mushrooms']);
  return map.build();
}

// ---------------------------------------------------------------------------
// Snowy Pass: medium, square

function snowyPass(): MapData {
  const cols = 26;
  const rows = 15;
  const map = new MapBuilder('square', cols, rows);
  // The trail winds west to east and climbs to the pass in the middle.
  const trailZ = (x: number) => 7 + 2.2 * Math.sin(x / 4.2);
  const trailHeight = (x: number) => Math.round(1 + 3 * smoothstep(1 - Math.abs(x - 15) / 11));
  const lake = { x: 4.5, z: 3 };

  for (const spot of map.all()) {
    const offTrail = Math.abs(spot.z - trailZ(spot.x));
    const base = trailHeight(spot.x);
    if (offTrail <= 2.5) {
      // The valley floor: trodden dirt on the trail, snow beside it.
      map.set(spot.cell, { height: base, terrain: offTrail <= 0.8 ? 'dirt' : 'snow' });
      continue;
    }
    // The ridges: rising a level a tile, bare stone low down and snow up high. The far
    // (north) ridge ends in solid snowy crags; the near one stays low, so the camera,
    // looking north, sees over it.
    const north = spot.z < trailZ(spot.x);
    const climb = Math.min(north ? 4 : 2, Math.ceil(offTrail - 2.5));
    map.set(spot.cell, { height: base + climb, terrain: climb >= 3 ? 'snow' : 'stone', blocked: climb >= 4 });
  }
  // The frozen lake, in a hollow by the trail: walkable ice, with a rock in it.
  for (const spot of map.all()) {
    const toLake = Math.hypot((spot.x - lake.x) / 1.6, spot.z - lake.z);
    if (toLake < 2.2) map.set(spot.cell, { terrain: 'water', height: 1, blocked: false });
  }
  // An ice crystal on a rock in the middle of the lake.
  map.set(map.spot(4, 3).cell, { terrain: 'stone', height: 2 });
  map.place(map.spot(4, 3).cell, 'crystal');

  // The ruined watchtower beside the pass: stone floor, a doorway to the trail, a broken wall.
  const towerFloor: Cell[] = [];
  for (let col = 14; col <= 17; col++) {
    for (let row = 9; row <= 11; row++) towerFloor.push(map.spot(col, row).cell);
  }
  const floorHeight = trailHeight(15.5);
  for (const at of towerFloor) map.set(at, { terrain: 'stone', height: floorHeight, blocked: false });
  map.enclose(towerFloor, [
    [map.spot(15, 9).cell, map.spot(15, 8).cell],
    [map.spot(17, 11).cell, map.spot(18, 11).cell],
  ]);
  // Ground around the tower, levelled to it, so the doorways can be reached.
  for (const spot of map.all()) {
    const near = spot.col >= 13 && spot.col <= 18 && spot.row >= 8 && spot.row <= 12;
    if (near && !towerFloor.some((at) => cellKey(at) === cellKey(spot.cell))) {
      map.set(spot.cell, { height: floorHeight, terrain: 'snow', blocked: false });
    }
  }

  // Supplies left in the tower, a camp by the lake, a signpost at the top of the pass.
  map.place(map.spot(14, 11).cell, 'crate');
  map.place(map.spot(14, 10).cell, 'barrel');
  map.place(map.spot(17, 9).cell, 'chest');
  map.place(map.spot(8, 6).cell, 'tent');
  map.place(map.spot(7, 7).cell, 'campfire');
  map.place(map.spot(15, 5).cell, 'signpost');

  const slope = (spot: Spot) => {
    const here = map.get(spot.cell) as Paint;
    return here.terrain === 'stone' && !here.blocked;
  };
  map.scatter(16, 11, slope, ['pine', 'pine', 'pine', 'dead_tree']);
  map.scatter(8, 12, (spot) => slope(spot) || map.get(spot.cell)?.terrain === 'snow', ['rock', 'rock', 'boulder']);
  return map.build();
}

// ---------------------------------------------------------------------------
// Smuggler's Cove: large, hex

function smugglersCove(): MapData {
  const map = new MapBuilder('hex', 40, 30);
  const spots = map.all();
  const width = Math.max(...spots.map((spot) => spot.x));
  // The cliff line runs west to east across the upper third; the sea fills
  // the south and west, with a bay cutting into the beach.
  const cliffZ = (x: number) => 15 + 2.5 * Math.sin(x / 9);
  const coastZ = (x: number) => 36 + 2 * Math.sin(x / 6);
  const westCoast = (z: number) => 6 + 2 * Math.cos(z / 7);
  const bay = { x: width * 0.55, z: 42, radius: 8 };
  const ramps = [width * 0.25, width * 0.78];
  const nearRamp = (x: number) => ramps.some((rampX) => Math.abs(x - rampX) < 1.8);

  const isSea = (spot: Spot) =>
    spot.z > coastZ(spot.x) || spot.x < westCoast(spot.z) || Math.hypot(spot.x - bay.x, spot.z - bay.z) < bay.radius;
  // How far each sea tile is from land (in steps), for shallows and deep water.
  const distanceFromLand = new Map<string, number>();
  let frontier = spots.filter((spot) => !isSea(spot)).map((spot) => spot.cell);
  for (const at of frontier) distanceFromLand.set(cellKey(at), 0);
  for (let step = 1; frontier.length > 0; step++) {
    const next: Cell[] = [];
    for (const at of frontier) {
      for (const other of map.edgeNeighbors(at)) {
        if (distanceFromLand.has(cellKey(other))) continue;
        distanceFromLand.set(cellKey(other), step);
        next.push(other);
      }
    }
    frontier = next;
  }

  for (const spot of spots) {
    if (isSea(spot)) {
      const depth = distanceFromLand.get(cellKey(spot.cell)) ?? 99;
      map.set(spot.cell, { terrain: 'water', height: 0, blocked: depth > 2 });
      continue;
    }
    const t = cliffZ(spot.x) - spot.z; // positive: up on the plateau
    if (t > 3) {
      map.set(spot.cell, { terrain: 'grass', height: 5 });
    } else if (t >= -3) {
      // The cliff face: solid rock, except where a ramp climbs it a level at a time.
      if (nearRamp(spot.x)) {
        map.set(spot.cell, { terrain: 'dirt', height: 1 + Math.round(((t + 3) / 6) * 4) });
      } else {
        map.set(spot.cell, { terrain: 'stone', height: 4, blocked: true });
      }
    } else {
      // The beach: sand sloping down to the water.
      const height = t > -7 ? 1 : 0;
      map.set(spot.cell, { terrain: 'sand', height });
    }
  }

  // A sea cave cut into the cliff, its mouth on the beach.
  const caveCenter = map.spot(14, 16);
  for (const spot of spots) {
    const toCave = Math.hypot(spot.x - caveCenter.x, spot.z - caveCenter.z);
    if (toCave < 2.2 && map.get(spot.cell)?.blocked && map.get(spot.cell)?.terrain === 'stone') {
      map.set(spot.cell, { blocked: false, terrain: 'dirt', height: 1 });
    }
  }
  // Any rock between the cave and the beach is opened up as the cave mouth.
  for (let row = 16; row <= 19; row++) {
    const mouth = map.spot(14, row).cell;
    if (map.get(mouth)?.terrain === 'stone') map.set(mouth, { blocked: false, terrain: 'dirt', height: 1 });
  }

  // The dock: planks from the beach out over the bay.
  const dockCol = Math.round((bay.x / width) * 39);
  let dockStart = 0;
  for (let row = 0; row < 30; row++) {
    if (map.get(map.spot(dockCol, row).cell)?.terrain === 'water') {
      dockStart = row;
      break;
    }
  }
  for (let row = dockStart - 1; row < Math.min(30, dockStart + 6); row++) {
    for (const col of [dockCol, dockCol + 1]) map.set(map.spot(col, row).cell, { terrain: 'wood', height: 0, blocked: false });
  }

  // The smugglers' hut on the beach, door facing the dock.
  const hut: Cell[] = [];
  for (let col = dockCol - 7; col <= dockCol - 4; col++) {
    for (let row = 21; row <= 23; row++) hut.push(map.spot(col, row).cell);
  }
  for (const at of hut) map.set(at, { terrain: 'wood', height: 1, blocked: false });
  map.enclose(hut, [[map.spot(dockCol - 4, 22).cell, map.spot(dockCol - 3, 22).cell]]);

  // A low stone wall along the plateau's edge by the eastern ramp, with a gate.
  const gateCol = Math.round((ramps[1]! / width) * 39);
  for (let col = gateCol - 5; col <= gateCol + 5; col++) {
    if (Math.abs(col - gateCol) <= 1) continue;
    const z = cliffZ(map.spot(col, 0).x);
    const row = Math.max(1, Math.floor((z - 4.5) / 1.5));
    map.wall(map.spot(col, row).cell, map.spot(col, row + 1).cell);
  }

  // Barrels and crates on the dock.
  map.place(map.spot(dockCol, dockStart + 1).cell, 'crate');
  map.place(map.spot(dockCol + 1, dockStart + 3).cell, 'barrel');
  map.place(map.spot(dockCol, dockStart + 5).cell, 'barrel');
  // In the hut: a table, the smugglers' chest, and a barrel.
  map.place(map.spot(dockCol - 6, 22).cell, 'table');
  map.place(map.spot(dockCol - 7, 21).cell, 'chest');
  map.place(map.spot(dockCol - 7, 23).cell, 'barrel');
  // The hidden stash in the sea cave, lit by a crystal.
  map.place(caveCenter.cell, 'chest');
  map.place(map.spot(13, 15).cell, 'crystal');
  // A campfire on the beach with stumps around it.
  map.place(map.spot(dockCol - 2, 26).cell, 'campfire');
  map.place(map.spot(dockCol - 3, 26).cell, 'stump');
  map.place(map.spot(dockCol - 1, 26).cell, 'stump');

  // Woods on the plateau, rocks on the beach, a road from the western ramp north.
  const roadCol = Math.round((ramps[0]! / width) * 39);
  for (let row = 0; row <= 12; row++) {
    const at = map.spot(roadCol, row).cell;
    if (map.get(at)?.terrain === 'grass') map.set(at, { terrain: 'dirt' });
  }
  // A camp on the plateau: a well and a tent by the road, a signpost at the top of the
  // west ramp, a statue watching the eastern gate.
  map.place(map.spot(roadCol + 3, 4).cell, 'well');
  map.place(map.spot(roadCol + 6, 7).cell, 'tent');
  map.place(map.spot(roadCol + 1, 12).cell, 'signpost');
  map.place(map.spot(gateCol, 6).cell, 'statue');

  const grass = (spot: Spot) => map.get(spot.cell)?.terrain === 'grass';
  map.scatter(60, 21, grass, ['tree', 'tree', 'pine']);
  map.scatter(25, 23, grass, ['bush', 'flowers', 'mushrooms', 'stump']);
  map.scatter(12, 22, (spot) => map.get(spot.cell)?.terrain === 'sand', ['rock', 'rock', 'boulder']);
  return map.build();
}
