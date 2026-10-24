import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  EMPTY_HISTORY,
  type EditHistory,
  type GeneratePreset,
  type MapEdit,
  type ShapeKind,
  applyEdit,
  blankMap,
  convertGrid,
  diffMaps,
  edgeNeighbor,
  fillCells,
  fillEmptyCells,
  frontierCells,
  generateMap,
  recordChange,
  redo,
  shapeCells,
  undo,
} from '@shared/editor';
import { type Cell, type GridKind, cellKey } from '@shared/grid';
import { MAX_TILES, type MapData, MapError, createWorldMap, validateMapData } from '@shared/map';
import type { HostSession } from '@shared/net';
import type { TilePointer } from '../render/WorldView';
import { TERRAINS, placeholderStyle } from '../style/stylePack';
import { WorldCanvas, mapSummary, tileDescription } from './WorldCanvas';

type Tool = 'raise' | 'lower' | 'flatten' | 'paint' | 'solid' | 'clear' | 'addTiles' | 'removeTiles' | 'wall' | 'unwall';

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'raise', label: 'Raise', hint: 'Raise tiles one level' },
  { id: 'lower', label: 'Lower', hint: 'Lower tiles one level' },
  { id: 'flatten', label: 'Flatten', hint: 'Set tiles to the chosen height' },
  { id: 'paint', label: 'Paint', hint: 'Paint terrain' },
  { id: 'solid', label: 'Solid', hint: 'Make tiles impassable (pillars, boulders)' },
  { id: 'clear', label: 'Clear solid', hint: 'Make tiles passable again' },
  { id: 'addTiles', label: 'Add tiles', hint: 'Click or drag over the glowing empty spaces to grow the world' },
  { id: 'removeTiles', label: 'Remove tiles', hint: 'Shrink the world' },
  { id: 'wall', label: 'Wall', hint: 'Click near a tile edge to build a wall' },
  { id: 'unwall', label: 'Remove wall', hint: 'Click near a wall to remove it' },
];

const SHAPES: { id: ShapeKind; label: string }[] = [
  { id: 'single', label: 'Brush' },
  { id: 'line', label: 'Line' },
  { id: 'rectangle', label: 'Rectangle' },
  { id: 'circle', label: 'Circle' },
  { id: 'ring', label: 'Ring' },
  { id: 'fill', label: 'Fill' },
];

const PRESETS: { id: GeneratePreset; label: string }[] = [
  { id: 'hills', label: 'Hills' },
  { id: 'islands', label: 'Islands' },
  { id: 'flat', label: 'Flat' },
];

const isWallTool = (tool: Tool) => tool === 'wall' || tool === 'unwall';

/** How many rings of empty cells "Add tiles" shows around the world. */
const GHOST_DEPTH = 3;

/** One pointer press-drag-release. A whole stroke is one undo step. */
interface Stroke {
  readonly before: MapData;
  readonly anchor: Cell;
  /** Where the brush was at the previous pointer event. */
  last: Cell | null;
  /** Cells (or wall edges) already changed in this stroke, so dragging doesn't repeat. */
  readonly touched: Set<string>;
}

export function MapEditor({ session }: { readonly session: HostSession }) {
  const map = session.snapshot().map;
  const [tool, setTool] = useState<Tool>('raise');
  const [shape, setShape] = useState<ShapeKind>('single');
  const [terrain, setTerrain] = useState<string>('stone');
  const [level, setLevel] = useState(0);
  const [history, setHistory] = useState<EditHistory>(EMPTY_HISTORY);
  const [preview, setPreview] = useState<Cell[]>([]);
  /** A drag is in progress (shows how to cancel it), and whether it was started by touch. */
  const [drawing, setDrawing] = useState<'mouse' | 'touch' | null>(null);
  const [hovered, setHovered] = useState<Cell | null>(null);
  const [touchEdits, setTouchEdits] = useState(true);
  const [panel, setPanel] = useState<'none' | 'new' | 'generate'>('none');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Bumped to re-frame the camera after a new map. */
  const [frameKey, setFrameKey] = useState(0);
  const stroke = useRef<Stroke | null>(null);
  const world = useMemo(() => (map ? createWorldMap(map) : null), [map]);
  // Where "Add tiles" can build: a few rings of empty cells around the world.
  const ghosts = useMemo(() => (world && tool === 'addTiles' ? frontierCells(world, GHOST_DEPTH) : []), [world, tool]);

  // --- applying changes ----------------------------------------------------

  /** Applies one edit to the live map and sends the patch to players. */
  function apply(edit: MapEdit): void {
    const current = session.snapshot().map;
    if (!current) return;
    try {
      session.editMap(diffMaps(current, applyEdit(current, edit)));
      setError(null);
      setNotice(null);
    } catch (caught) {
      if (caught instanceof MapError) setError(caught.message);
      else throw caught;
    }
  }

  function editFor(cells: Cell[]): MapEdit | null {
    switch (tool) {
      case 'raise':
        return { type: 'raise', cells, amount: 1 };
      case 'lower':
        return { type: 'raise', cells, amount: -1 };
      case 'flatten':
        return { type: 'setHeight', cells, height: level };
      case 'paint':
        return { type: 'setTerrain', cells, terrain };
      case 'solid':
        return { type: 'setBlocked', cells, blocked: true };
      case 'clear':
        return { type: 'setBlocked', cells, blocked: false };
      case 'addTiles':
        return { type: 'addTiles', cells, height: level, terrain };
      case 'removeTiles':
        return { type: 'removeTiles', cells };
      default:
        return null;
    }
  }

  /** Replaces the whole map (new, generated, imported) as one undoable change when possible. */
  function replaceMap(next: MapData): void {
    const current = session.snapshot().map;
    try {
      if (current && current.grid === next.grid) {
        session.editMap(diffMaps(current, next));
        setHistory((h) => recordChange(h, current, next));
      } else {
        // A different grid type can't be patched; start a fresh history.
        session.setMap(next);
        setHistory(EMPTY_HISTORY);
      }
      setPanel('none');
      setError(null);
      setFrameKey((key) => key + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  /** Re-lays the current map on the other grid type, keeping its layout. */
  function switchGrid(): void {
    const current = session.snapshot().map;
    if (!current) return;
    const result = convertGrid(current, current.grid === 'hex' ? 'square' : 'hex');
    session.setMap(result.map);
    setHistory(EMPTY_HISTORY);
    setError(null);
    setFrameKey((key) => key + 1);
    setNotice(
      result.droppedWalls > 0
        ? `Switched to a ${result.map.grid} grid. ${result.droppedWalls} wall${result.droppedWalls === 1 ? '' : 's'} no longer sat on a tile edge and ${result.droppedWalls === 1 ? 'was' : 'were'} removed.`
        : `Switched to a ${result.map.grid} grid.`,
    );
  }

  function step(direction: 'undo' | 'redo'): void {
    const current = session.snapshot().map;
    if (!current) return;
    const result = (direction === 'undo' ? undo : redo)(history, current);
    if (!result) return;
    session.editMap(result.patch);
    setHistory(result.history);
  }

  // --- pointer handling ----------------------------------------------------

  function onPointer(pointer: TilePointer): void {
    if (pointer.type === 'cancel') {
      cancelStroke();
      return;
    }
    setHovered(pointer.cell);
    if (!world || !map) return;
    if (pointer.isTouch && !touchEdits) return;

    if (pointer.type === 'down') {
      // Another finger touching down mid-stroke means "cancel" on a touch screen.
      if (stroke.current) {
        cancelStroke();
        return;
      }
      if (pointer.button !== 0 || !pointer.cell) return;
      stroke.current = { before: map, anchor: pointer.cell, last: null, touched: new Set() };
      setDrawing(pointer.isTouch ? 'touch' : 'mouse');
      if (shape === 'fill' && !isWallTool(tool)) {
        const cells = fillArea(pointer.cell);
        if (cells === null) {
          setError(
            "That empty area isn't enclosed. Fill with Add tiles fills gaps that are completely surrounded by tiles; draw a closed outline first (try the Ring shape).",
          );
        } else {
          const edit = editFor(cells);
          if (edit && cells.length > 0) apply(edit);
        }
        finishStroke();
        return;
      }
      if (shape === 'single' || isWallTool(tool)) brush(pointer);
      else setPreview([pointer.cell]);
      return;
    }

    const current = stroke.current;
    if (!current) {
      if (pointer.type === 'move' && !pointer.isTouch) previewBrush(pointer.cell);
      return;
    }
    if (pointer.type === 'move') {
      if (shape === 'single' || isWallTool(tool)) brush(pointer);
      else if (pointer.cell) setPreview(shapeCells(world.grid, shape as Exclude<ShapeKind, 'fill'>, current.anchor, pointer.cell));
      return;
    }

    // Pointer up: a dragged shape is applied all at once.
    if (shape !== 'single' && !isWallTool(tool) && pointer.cell) {
      const edit = editFor(shapeCells(world.grid, shape as Exclude<ShapeKind, 'fill'>, current.anchor, pointer.cell));
      if (edit) apply(edit);
    }
    finishStroke();
  }

  /**
   * The area Fill would change from a cell: matching tiles, or for Add tiles
   * the enclosed empty area. Null means an open (unenclosed) empty area.
   */
  function fillArea(cell: Cell): Cell[] | null {
    if (!world) return [];
    if (tool === 'addTiles') return world.inBounds(cell) ? [] : fillEmptyCells(world, cell);
    return fillCells(world, cell);
  }

  /** Before clicking, shows what the brush or Fill would change. Recomputed only when the hovered cell changes. */
  const lastPreview = useRef('');
  function previewBrush(cell: Cell | null): void {
    const mode = `${tool}:${shape}:${cell ? cellKey(cell) : '-'}`;
    if (mode === lastPreview.current) return;
    lastPreview.current = mode;
    if (!cell || isWallTool(tool)) setPreview([]);
    else if (shape === 'single') setPreview([cell]);
    else if (shape === 'fill') setPreview(fillArea(cell) ?? []);
    else setPreview([]);
  }

  /** Brush and wall tools act on each new cell (or edge) the pointer crosses. */
  function brush(pointer: TilePointer): void {
    const current = stroke.current;
    if (!current || !pointer.cell || !world) return;
    // A fast drag can jump several cells between pointer events: cover the path in between.
    const path = current.last ? world.grid.line(current.last, pointer.cell) : [pointer.cell];
    current.last = pointer.cell;
    if (isWallTool(tool)) {
      if (!pointer.point) return;
      const other = edgeNeighbor(world.grid, pointer.cell, pointer.point, placeholderStyle.cellSize);
      const key = [cellKey(pointer.cell), cellKey(other)].sort().join('|');
      if (current.touched.has(key)) return;
      current.touched.add(key);
      apply({ type: 'setWall', a: pointer.cell, b: other, present: tool === 'wall' });
      return;
    }
    const fresh = path.filter((cell) => !current.touched.has(cellKey(cell)));
    if (fresh.length === 0) return;
    for (const cell of fresh) current.touched.add(cellKey(cell));
    const edit = editFor(fresh);
    if (edit) apply(edit);
  }

  function finishStroke(): void {
    const current = stroke.current;
    stroke.current = null;
    setDrawing(null);
    setPreview([]);
    lastPreview.current = '';
    const after = session.snapshot().map;
    if (current && after) setHistory((h) => recordChange(h, current.before, after));
  }

  /**
   * Abandons the drag in progress: undoes whatever it already changed (brush
   * strokes apply live), never applies a dragged shape, and leaves no undo step.
   */
  function cancelStroke(): void {
    const current = stroke.current;
    if (!current) return;
    stroke.current = null;
    setDrawing(null);
    setPreview([]);
    lastPreview.current = '';
    const now = session.snapshot().map;
    if (now) session.editMap(diffMaps(now, current.before));
  }

  // Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z), and Esc to cancel a drag, except while typing in a field.
  const stepRef = useRef(step);
  stepRef.current = step;
  const cancelRef = useRef(cancelStroke);
  cancelRef.current = cancelStroke;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        cancelRef.current();
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || (event.target as HTMLElement).closest('input, select, textarea')) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) stepRef.current('undo');
      else if (key === 'y' || (key === 'z' && event.shiftKey)) stepRef.current('redo');
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // --- files -----------------------------------------------------------------

  function exportMap(): void {
    if (!map) return;
    const blob = new Blob([JSON.stringify(map)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `map-${map.grid}-${map.tiles.length}-tiles.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importMap(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      setError(`${file.name} isn't a map file (it isn't valid JSON)`);
      return;
    }
    const result = validateMapData(data);
    if (result.ok) replaceMap(result.map);
    else setError(`Can't use ${file.name} as a map: ${result.error}`);
  }

  // --- render ----------------------------------------------------------------

  const usesTerrain = tool === 'paint' || tool === 'addTiles';
  const usesLevel = tool === 'flatten' || tool === 'addTiles';

  return (
    <div className="map-editor">
      <div className="toolbar" role="toolbar" aria-label="Map tools">
        {TOOLS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={tool === entry.id}
            title={entry.hint}
            onClick={() => setTool(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="row">
        <label>
          <span>Shape</span>
          <select value={shape} disabled={isWallTool(tool)} onChange={(event) => setShape(event.target.value as ShapeKind)}>
            {SHAPES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        {usesTerrain && (
          <label>
            <span>Terrain</span>
            <select value={terrain} onChange={(event) => setTerrain(event.target.value)}>
              {TERRAINS.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
        )}
        {usesLevel && (
          <label>
            <span>Level</span>
            <input
              type="number"
              min={0}
              max={30}
              value={level}
              onChange={(event) => setLevel(Number(event.target.value))}
              inputMode="numeric"
            />
          </label>
        )}
        <button type="button" onClick={() => step('undo')} disabled={history.undo.length === 0} title="Ctrl+Z">
          Undo
        </button>
        <button type="button" onClick={() => step('redo')} disabled={history.redo.length === 0} title="Ctrl+Y">
          Redo
        </button>
        <button
          type="button"
          className="touch-only"
          aria-pressed={!touchEdits}
          onClick={() => setTouchEdits((value) => !value)}
        >
          {touchEdits ? 'Touch: editing' : 'Touch: moving view'}
        </button>
      </div>

      <div className="row">
        <button type="button" aria-expanded={panel === 'new'} onClick={() => setPanel(panel === 'new' ? 'none' : 'new')}>
          New map
        </button>
        <button
          type="button"
          aria-expanded={panel === 'generate'}
          onClick={() => setPanel(panel === 'generate' ? 'none' : 'generate')}
        >
          Generate
        </button>
        {map && (
          <button type="button" onClick={switchGrid} title="Converts this map, keeping its layout, heights, and terrain">
            Switch to {map.grid === 'hex' ? 'square' : 'hex'} grid
          </button>
        )}
        <button type="button" onClick={exportMap} disabled={!map}>
          Export
        </button>
        <label className="file-button">
          <span>Import map file</span>
          <input type="file" accept="application/json,.json" onChange={importMap} />
        </label>
      </div>

      {panel === 'new' && <NewMapPanel onCreate={replaceMap} />}
      {panel === 'generate' && <GeneratePanel onCreate={replaceMap} />}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}

      {map && world ? (
        <>
          <p className="map-summary" data-testid="map-summary">
            {mapSummary(map)}
          </p>
          <WorldCanvas
            map={map}
            editing={touchEdits}
            highlight={preview}
            ghosts={ghosts}
            frameKey={frameKey}
            overlay={
              drawing === 'touch' ? (
                <div className="stroke-hint" role="status">
                  <span>Tap with a second finger to cancel</span>
                  <button type="button" onClick={cancelStroke}>
                    Cancel
                  </button>
                </div>
              ) : drawing === 'mouse' ? (
                <div className="stroke-hint" role="status">
                  Right-click or Esc to cancel
                </div>
              ) : null
            }
            onFocusEveryone={(cell) => session.focusPlayers(cell)}
            onPointer={onPointer}
          />
          <p className="tile-info" data-testid="tile-info">
            {tileDescription(world, hovered)}
          </p>
          <p className="hint">
            Left-click or drag to use the tool · right-drag to pan · wheel to zoom · Q/E or middle-drag to turn ·{' '}
            {TOOLS.find((entry) => entry.id === tool)?.hint}
          </p>
        </>
      ) : (
        <p className="muted">No map yet: use <b>New map</b> or <b>Generate</b> above.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function SizeFields({ width, height, onWidth, onHeight }: {
  width: number;
  height: number;
  onWidth(value: number): void;
  onHeight(value: number): void;
}) {
  return (
    <>
      <label>
        <span>Width</span>
        <input type="number" min={1} max={100} value={width} onChange={(event) => onWidth(Number(event.target.value))} />
      </label>
      <label>
        <span>Height</span>
        <input type="number" min={1} max={100} value={height} onChange={(event) => onHeight(Number(event.target.value))} />
      </label>
    </>
  );
}

function sizeProblem(width: number, height: number): string | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return 'Width and height must be whole numbers of at least 1';
  }
  if (width * height > MAX_TILES) return `At most ${MAX_TILES} tiles (for example 100 × 100)`;
  return null;
}

function NewMapPanel({ onCreate }: { onCreate(map: MapData): void }) {
  const [grid, setGrid] = useState<GridKind>('hex');
  const [width, setWidth] = useState(12);
  const [height, setHeight] = useState(10);
  const problem = sizeProblem(width, height);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!problem) onCreate(blankMap(grid, width, height));
  }

  return (
    <form className="panel" onSubmit={submit}>
      <fieldset>
        <legend>New map</legend>
        <div className="row">
          <label>
            <span>Grid</span>
            <select value={grid} onChange={(event) => setGrid(event.target.value as GridKind)}>
              <option value="hex">Hex</option>
              <option value="square">Square</option>
            </select>
          </label>
          <SizeFields width={width} height={height} onWidth={setWidth} onHeight={setHeight} />
          <button type="submit" className="primary" disabled={problem !== null}>
            Create
          </button>
        </div>
        {problem && <p className="field-error">{problem}</p>}
      </fieldset>
    </form>
  );
}

function GeneratePanel({ onCreate }: { onCreate(map: MapData): void }) {
  const [grid, setGrid] = useState<GridKind>('hex');
  const [preset, setPreset] = useState<GeneratePreset>('hills');
  const [width, setWidth] = useState(24);
  const [height, setHeight] = useState(18);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 100_000));
  const [maxHeight, setMaxHeight] = useState(6);
  const problem = sizeProblem(width, height);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!problem) onCreate(generateMap({ grid, width, height, seed, preset, maxHeight }));
  }

  return (
    <form className="panel" onSubmit={submit}>
      <fieldset>
        <legend>Generate a map</legend>
        <div className="row">
          <label>
            <span>Grid</span>
            <select value={grid} onChange={(event) => setGrid(event.target.value as GridKind)}>
              <option value="hex">Hex</option>
              <option value="square">Square</option>
            </select>
          </label>
          <label>
            <span>Terrain</span>
            <select value={preset} onChange={(event) => setPreset(event.target.value as GeneratePreset)}>
              {PRESETS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <SizeFields width={width} height={height} onWidth={setWidth} onHeight={setHeight} />
          <label>
            <span>Tallest level</span>
            <input type="number" min={1} max={30} value={maxHeight} onChange={(event) => setMaxHeight(Number(event.target.value))} />
          </label>
          <label>
            <span>Seed</span>
            <input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value))} />
          </label>
          <button type="button" onClick={() => setSeed(Math.floor(Math.random() * 100_000))}>
            New seed
          </button>
          <button type="submit" className="primary" disabled={problem !== null}>
            Create
          </button>
        </div>
        {problem && <p className="field-error">{problem}</p>}
        <p className="hint">The same seed and settings always make the same map: share a seed to share a map.</p>
      </fieldset>
    </form>
  );
}
