import { type Cell, type GridKind, cell } from '../grid';
import { type CustomObject, MAP_FORMAT_VERSION, MAX_CUSTOM_OBJECTS, MAX_HEIGHT, MAX_OBJECT_PARTS, type MapData, type ObjectPart, type TileData, createWorldMap, objectInfo } from '../map';
import { idFrom } from '../system';
import type { AiProvider, StopSignal } from './provider';
import { readJsonReply } from './bookImport';

/**
 * A map from a book: the user's AI reads an encounter's pages (the text
 * describing the place, or a picture of its map) and writes a map plan in
 * rows and columns: the ground, areas of other terrain and height, walls
 * with doorways, and objects. The plan is built into a real map for the DM
 * to look over. When the pages don't say enough to make a map, the AI says
 * why and how the DM could set one up instead.
 */

/** The terrains a plan can use (the style pack draws each). */
export const PLAN_TERRAINS = ['grass', 'dirt', 'sand', 'stone', 'water', 'snow', 'wood'] as const;
/** Map size limits, in tiles each way. */
export const PLAN_MIN_SIZE = 4;
export const PLAN_MAX_SIZE = 60;
/** About how much text goes to the AI at once (an encounter is a few pages). */
export const MAP_TEXT_CHARS = 16000;

const objectList = 'tree, pine, dead_tree, bush, flowers, mushrooms, stump, rock, boulder, crystal, crate, barrel, chest, table, pillar, statue, campfire, well, signpost, tent';

const PLAN_FORMAT = `Reply with ONE JSON object and nothing else, one of these two:

1. When it describes or shows a place to fight in, a map plan. Write "layout" FIRST: plan it in words, then lay it out exactly as planned.
{"possible": true,
 "layout": "Chapel 40 by 25 feet = 8 by 5 tiles. Its walls are its edge tiles: x 3-10, y 2-6. Doorway in the middle of the south wall: x 6, y 6. Pond 10 feet across east of the chapel: centre x 13, y 9. A 1-tile margin all round: the map is 16 by 12.",
 "name": "Ruined Chapel", "grid": "square", "width": 16, "height": 12, "ground": "grass",
 "areas": [{"terrain": "stone", "x": 3, "y": 2, "w": 8, "h": 6}, {"shape": "circle", "terrain": "water", "x": 13, "y": 9, "r": 2}, {"terrain": "dirt", "x": 0, "y": 5, "w": 3, "h": 2, "height": 1}],
 "walls": [{"x1": 3, "y1": 2, "x2": 10, "y2": 2}, {"x1": 3, "y1": 2, "x2": 3, "y2": 7}],
 "doors": [{"x": 6, "y": 2}],
 "newObjects": [{"name": "Altar with crystal skull", "blocks": true, "blocksSight": false, "parts": [{"shape": "box", "size": [0.8, 0.45, 0.5], "color": "#7d7a85"}, {"shape": "sphere", "size": [0.3, 0.32, 0.28], "at": [0, 0.45, 0], "color": "#bfe9ff", "glow": true}]}],
 "objects": [{"kind": "pillar", "x": 5, "y": 4}, {"kind": "Altar with crystal skull", "x": 6, "y": 3}],
 "notes": "What you assumed, in a sentence or two."}
- Tiles are 5-foot squares: a 40-foot room is 8 tiles. x is the column (0 is the left edge), y the row (0 is the top); north is up. width and height are 4 to 60: make the map big enough for EVERY place described (rooms, yards, paths), side by side as the text says, plus a margin.
- "grid" is "square" (or "hex" if the book uses hexes).
- terrain is one of: grass, dirt, sand, stone, water, snow, wood (wood is a wooden floor). Areas are rectangles (x, y, w, h) or circles ("shape": "circle", centre x, y, radius r); later areas paint over earlier ones. "height" is in levels of about 5 feet (0 to 6), for raised ground, platforms, and stairs (step up one level at a time).
- walls are straight lines of solid wall tiles from (x1, y1) to (x2, y2), along a row or a column: a room's walls are its outermost tiles, its floor is inside them. Put a door (a gap) on the wall tile where the text says there is a doorway, gate, or opening, so the room can be entered.
- objects stand on single tiles, in the place the text puts them (inside a room is between its walls; outside is beyond them); kind is one of: ${objectList}, or the name of one of your newObjects.
- newObjects: things the encounter needs that aren't in that list (an altar, a sarcophagus, a crystal skull, a magic circle, a throne, a cage, a book on a stand), especially anything the players can take, use, or fight over. Build each from 1 to 8 simple parts: shape is box, cylinder, cone, or sphere; size is [width, height, depth] in tiles (1 = a whole tile; a person is about 0.4 wide and 1 tall); "at" is where the part's bottom middle sits, [across, up, along] from the tile's centre (stack parts by raising "at"); color is #rrggbb; "glow": true for magic, flames, and crystals. "blocks": whether it fills the tile so no one can stand there; "blocksSight": whether it's tall enough to hide what's behind it.
- Lay out what the text says (sizes, what's where), and fill in plain, sensible details only where it's silent. Keep every open area reachable.

2. When the pages don't describe or show a place clearly enough to map:
{"possible": false, "reason": "Why, in a sentence.", "guide": ["Step 1 for the DM to set this map up by hand, using what the pages do say.", "Step 2...", "..."]}`;

/** Instructions for reading an encounter's text. */
export const MAP_TEXT_INSTRUCTIONS = `You turn the description of a tabletop RPG encounter area, from a book the user owns, into a battle map plan.
${PLAN_FORMAT}`;

/** Instructions for reading a picture of a map. */
export const MAP_PICTURE_INSTRUCTIONS = `You look at a picture of a tabletop RPG battle map, from a book the user owns, and recreate it as a battle map plan: the same rooms, walls, doors, terrain, and features in the same places. If the map has a grid, use its squares as tiles; if it has a scale, use it.
${PLAN_FORMAT}`;

export interface MapPlanResult {
  readonly kind: 'map';
  readonly name: string;
  readonly map: MapData;
  /** What the AI assumed, and what the builder changed. */
  readonly notes: readonly string[];
}

export interface MapGuideResult {
  readonly kind: 'guide';
  readonly reason: string;
  readonly guide: readonly string[];
}

type Data = Record<string, unknown>;
const isObject = (value: unknown): value is Data => typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown): Data[] => (Array.isArray(value) ? value.filter(isObject) : []);
const whole = (value: unknown): number | undefined => {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? Math.round(number) : undefined;
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const terrainOf = (value: unknown): string | undefined => (PLAN_TERRAINS as readonly string[]).includes(value as string) ? (value as string) : undefined;

/** A plan's (column, row) as a cell on the grid (hex rows are offset, as the map editor lays them out). */
const at = (grid: GridKind, x: number, y: number): Cell => cell(grid === 'hex' ? x - Math.floor(y / 2) : x, y);

/** What the AI's reply says: a map plan built into a map (on `grid`, if given), or why there isn't one and how to set it up. Throws if it can't be read at all. */
export function buildFromReply(reply: string, grid?: GridKind): MapPlanResult | MapGuideResult {
  const plan = readJsonReply(reply);
  if (!plan) throw new Error("The AI's answer couldn't be read as a map plan. Try again, or try fewer pages.");
  if (plan.possible === false) {
    const guide = (Array.isArray(plan.guide) ? plan.guide : []).filter((step): step is string => typeof step === 'string' && step.trim() !== '');
    return { kind: 'guide', reason: typeof plan.reason === 'string' && plan.reason.trim() ? plan.reason.trim() : "These pages don't describe a place clearly enough to map.", guide };
  }
  return buildMapFromPlan(plan, grid);
}

/**
 * Builds a map plan into a map: sizes kept within limits, unknown terrain
 * and objects left out (and noted), walls and doors laid. On `gridKind` if
 * given (the current map's, so the change can be undone), else the plan's.
 */
export function buildMapFromPlan(plan: Data, gridKind?: GridKind): MapPlanResult {
  const notes: string[] = [];
  if (typeof plan.notes === 'string' && plan.notes.trim()) notes.push(plan.notes.trim());
  const grid: GridKind = gridKind ?? (plan.grid === 'hex' ? 'hex' : 'square');
  const width = clamp(whole(plan.width) ?? 16, PLAN_MIN_SIZE, PLAN_MAX_SIZE);
  const height = clamp(whole(plan.height) ?? 12, PLAN_MIN_SIZE, PLAN_MAX_SIZE);
  if (width !== whole(plan.width) || height !== whole(plan.height)) notes.push(`The map is ${width} by ${height} tiles (kept within ${PLAN_MIN_SIZE} to ${PLAN_MAX_SIZE}).`);
  const ground = terrainOf(plan.ground) ?? 'grass';

  const tiles = new Map<string, { x: number; y: number; terrain: string; height: number; blocked: boolean; object?: string }>();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) tiles.set(`${x},${y}`, { x, y, terrain: ground, height: 0, blocked: false });
  const tileAt = (x: number, y: number) => tiles.get(`${x},${y}`);

  // Objects made for this map: kept small and valid, named, given ids.
  const made = madeObjects(plan.newObjects);
  if (made.length > 0) notes.push(`Made for this map: ${made.map((object) => object.name).join(', ')}.`);
  const kindOf = (kind: string): CustomObject | ReturnType<typeof objectInfo> => {
    const named = kind.trim().toLowerCase();
    return objectInfo(kind) ?? made.find((object) => object.id === kind || object.name.toLowerCase() === named);
  };

  const unknown = new Set<string>();
  for (const area of list(plan.areas)) {
    const terrain = area.terrain === undefined ? undefined : terrainOf(area.terrain);
    if (area.terrain !== undefined && !terrain) unknown.add(String(area.terrain));
    const level = area.height === undefined ? undefined : clamp(whole(area.height) ?? 0, 0, MAX_HEIGHT);
    const x0 = whole(area.x) ?? 0;
    const y0 = whole(area.y) ?? 0;
    const inside: (x: number, y: number) => boolean =
      area.shape === 'circle'
        ? (x, y) => (x - x0) ** 2 + (y - y0) ** 2 <= (whole(area.r) ?? 1) ** 2 + 0.5
        : (x, y) => x >= x0 && y >= y0 && x < x0 + (whole(area.w) ?? 1) && y < y0 + (whole(area.h) ?? 1);
    for (const tile of tiles.values()) {
      if (!inside(tile.x, tile.y)) continue;
      if (terrain) tile.terrain = terrain;
      if (level !== undefined) tile.height = level;
    }
  }

  // Walls: solid stone tiles, two levels above the ground beside them; doors are gaps.
  const doors = new Set(list(plan.doors).map((door) => `${whole(door.x)},${whole(door.y)}`));
  let crooked = 0;
  for (const wall of list(plan.walls)) {
    const [x1, y1, x2, y2] = [whole(wall.x1), whole(wall.y1), whole(wall.x2), whole(wall.y2)];
    if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) continue;
    if (x1 !== x2 && y1 !== y2) crooked++;
    // Straight runs along a row or a column (a slanted one follows its longer side, then turns).
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x1 + ((x2 - x1) * i) / Math.max(1, steps));
      const y = Math.round(y1 + ((y2 - y1) * i) / Math.max(1, steps));
      const tile = tileAt(x, y);
      if (!tile || doors.has(`${x},${y}`)) continue;
      tile.blocked = true;
      tile.terrain = 'stone';
      tile.height += 2;
    }
  }
  if (crooked > 0) notes.push(`${crooked} slanted wall${crooked === 1 ? ' was' : 's were'} laid as a line of tiles: check ${crooked === 1 ? 'it' : 'them'}.`);

  for (const object of list(plan.objects)) {
    const tile = tileAt(whole(object.x) ?? -1, whole(object.y) ?? -1);
    const kind = typeof object.kind === 'string' ? object.kind : '';
    const info = kindOf(kind);
    if (!info) {
      if (kind) unknown.add(kind);
      continue;
    }
    if (!tile || tile.blocked) continue;
    tile.object = info.id;
    if (info.blocks) tile.blocked = true;
  }
  // Deep water is solid, as on the example maps.
  for (const tile of tiles.values()) if (tile.terrain === 'water' && !tile.object) tile.blocked = true;
  if (unknown.size > 0) notes.push(`Left out (not in this tool yet): ${[...unknown].join(', ')}.`);

  const data: TileData[] = [...tiles.values()].map((tile) => {
    const { q, r } = at(grid, tile.x, tile.y);
    return {
      q,
      r,
      height: tile.height,
      ...(tile.blocked ? { blocked: true } : {}),
      ...(tile.terrain !== 'grass' ? { terrain: tile.terrain } : {}),
      ...(tile.object ? { object: tile.object } : {}),
    };
  });
  // Only the made objects that were placed go with the map.
  const placed = made.filter((object) => data.some((tile) => tile.object === object.id));
  const map = createWorldMap({ formatVersion: MAP_FORMAT_VERSION, grid, tiles: data, walls: [], ...(placed.length > 0 ? { objects: placed } : {}) }).toData();
  const name = typeof plan.name === 'string' && plan.name.trim() ? plan.name.trim() : 'Map from the book';
  return { kind: 'map', name, map, notes };
}

const clampNumber = (value: unknown, min: number, max: number, fallback: number) => {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};
const SHAPES = new Set(['box', 'cylinder', 'cone', 'sphere']);

/** The objects a plan makes, tidied into valid ones: ids from names, sizes and places kept in range, colours checked. */
function madeObjects(value: unknown): CustomObject[] {
  const taken = new Set<string>();
  return list(value)
    .slice(0, MAX_CUSTOM_OBJECTS)
    .flatMap((raw): CustomObject[] => {
      const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 60) : '';
      if (!name) return [];
      const parts: ObjectPart[] = list(raw.parts)
        .slice(0, MAX_OBJECT_PARTS)
        .flatMap((part): ObjectPart[] => {
          const shape = SHAPES.has(part.shape as string) ? (part.shape as ObjectPart['shape']) : 'box';
          const size = Array.isArray(part.size) ? part.size : [];
          const at = Array.isArray(part.at) ? part.at : [];
          const color = typeof part.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(part.color) ? part.color : '#8a8790';
          return [
            {
              shape,
              size: [clampNumber(size[0], 0.02, 3, 0.5), clampNumber(size[1], 0.02, 3, 0.5), clampNumber(size[2], 0.02, 3, 0.5)],
              ...(at.length === 3 ? { at: [clampNumber(at[0], -2, 4, 0), clampNumber(at[1], -2, 4, 0), clampNumber(at[2], -2, 4, 0)] as const } : {}),
              color,
              ...(part.glow === true ? { glow: true } : {}),
              ...(shape !== 'box' ? { sides: 8 } : {}),
            },
          ];
        });
      if (parts.length === 0) return [];
      // Not the id of a built-in object, or of another made one.
      let id = idFrom(name, taken);
      while (objectInfo(id)) id = idFrom(`${id}_made`, taken);
      taken.add(id);
      return [{ id, name, blocks: raw.blocks === true, blocksSight: raw.blocksSight === true, parts }];
    });
}

/**
 * Asks the user's AI for a map: from the text of an encounter's pages, or
 * from pictures of its map (PNG images as base64, for an AI that can see).
 */
export async function planMap(
  provider: AiProvider,
  source: { readonly text: string } | { readonly pictures: readonly string[]; readonly text?: string },
  options: { signal?: StopSignal; grid?: GridKind } = {},
): Promise<MapPlanResult | MapGuideResult> {
  const signal = options.signal ? { signal: options.signal } : {};
  if ('pictures' in source) {
    const reply = await provider.complete({
      system: MAP_PICTURE_INSTRUCTIONS,
      prompt: `The map picture${source.pictures.length === 1 ? '' : 's'} from the book.${source.text ? ` The text around it:\n\n${source.text.slice(0, MAP_TEXT_CHARS)}` : ''}`,
      images: source.pictures,
      json: true,
      ...signal,
    });
    return buildFromReply(reply, options.grid);
  }
  const text = source.text.trim();
  if (text === '') return { kind: 'guide', reason: 'Those pages have no text to read.', guide: [] };
  const reply = await provider.complete({
    system: MAP_TEXT_INSTRUCTIONS,
    prompt: `The encounter, from the book:\n\n${text.slice(0, MAP_TEXT_CHARS)}`,
    json: true,
    ...signal,
  });
  return buildFromReply(reply, options.grid);
}

/** Every tile of a built map in plan order, for a small preview: column, row, and how it looks. */
export function previewTiles(map: MapData): { x: number; y: number; terrain: string; blocked: boolean; object: string | null; height: number }[] {
  return map.tiles.map((tile) => ({
    x: map.grid === 'hex' ? tile.q + Math.floor(tile.r / 2) : tile.q,
    y: tile.r,
    terrain: tile.terrain ?? 'grass',
    blocked: tile.blocked ?? false,
    object: tile.object ?? null,
    height: tile.height,
  }));
}

