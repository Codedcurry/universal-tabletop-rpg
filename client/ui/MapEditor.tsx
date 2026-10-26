import { type ChangeEvent, type FormEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  EXAMPLE_MAPS,
  exampleMap,
  generateMap,
  recordChange,
  redo,
  shapeCells,
  undo,
} from '@shared/editor';
import { type Cell, type GridKind, cellKey } from '@shared/grid';
import { MAP_OBJECTS, MAX_TILES, type MapData, MapError, createWorldMap, validateMapData } from '@shared/map';
import type { HostSession } from '@shared/net';
import type { CombatEvent } from '@shared/combat';
import type { TilePointer } from '../render/WorldView';
import { CombatHud } from './CombatHud';
import { ReactionPrompt } from './ReactionPrompt';
import { useCombatPlay } from './useCombatPlay';
import { TERRAINS, placeholderStyle } from '../style/stylePack';
import { WorldCanvas, mapSummary, tileDescription } from './WorldCanvas';

type Tool =
  | 'raise'
  | 'lower'
  | 'flatten'
  | 'paint'
  | 'object'
  | 'removeObject'
  | 'solid'
  | 'clear'
  | 'addTiles'
  | 'removeTiles'
  | 'wall'
  | 'unwall'
  | 'note';

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'raise', label: 'Raise', hint: 'Raise tiles one level' },
  { id: 'lower', label: 'Lower', hint: 'Lower tiles one level' },
  { id: 'flatten', label: 'Flatten', hint: 'Set tiles to the chosen height' },
  { id: 'paint', label: 'Paint', hint: 'Paint terrain' },
  { id: 'object', label: 'Objects', hint: 'Place trees, rocks, crates, campfires, and more' },
  { id: 'removeObject', label: 'Remove objects', hint: 'Take objects off tiles' },
  { id: 'solid', label: 'Solid', hint: 'Make tiles impassable (pillars, boulders)' },
  { id: 'clear', label: 'Clear solid', hint: 'Make tiles passable again' },
  { id: 'addTiles', label: 'Add tiles', hint: 'Click or drag over the glowing empty spaces to grow the world' },
  { id: 'removeTiles', label: 'Remove tiles', hint: 'Shrink the world' },
  { id: 'wall', label: 'Wall', hint: 'Click near a tile edge to build a wall' },
  { id: 'unwall', label: 'Remove wall', hint: 'Click near a wall to remove it' },
  { id: 'note', label: 'Notes', hint: 'Click a tile to write a note only you can see' },
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

/** The tools in labelled groups, as the Map tab shows them. */
const TOOL_GROUPS: { label: string; tools: Tool[] }[] = [
  { label: 'Land', tools: ['raise', 'lower', 'flatten'] },
  { label: 'Paint', tools: ['paint', 'object', 'removeObject'] },
  { label: 'Blocking', tools: ['solid', 'clear', 'wall', 'unwall'] },
  { label: 'World', tools: ['addTiles', 'removeTiles'] },
  { label: 'DM', tools: ['note'] },
];

const isWallTool = (tool: Tool) => tool === 'wall' || tool === 'unwall';
const NO_CELLS: readonly Cell[] = [];
const NO_IDS: readonly string[] = [];

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

interface Props {
  readonly session: HostSession;
  /** The latest combat action, for the creatures to act out. */
  readonly combatEvents: { readonly events: readonly CombatEvent[]; readonly key: number } | null;
  /** Map tools are in use (the Map tab): clicks edit the map. Otherwise clicks run the fight. */
  readonly editing: boolean;
  /** Where the map tools render (the Map tab), so they can be hidden without losing their state. */
  readonly toolsSlot: HTMLElement | null;
  /** Outside editing: a click on a map cell, offered to the encounter tools first. Return true if handled. */
  onMapClick?(cell: Cell): boolean;
  /** Shown over the map (e.g. "Click a tile to place Goblin"). */
  readonly mapOverlay?: ReactNode;
  /** A map made elsewhere (the Books tab), to put in place as one undoable change; `key` changes for each new one. */
  readonly incomingMap?: { readonly map: MapData; readonly key: number } | null;
  /** Opens the Books tab (maps from the DM's books are made there). */
  onOpenBooks?(): void;
}

/** A press that moves less than this (pixels) is a click, not a drag. */
const CLICK_SLOP = 8;

export function MapEditor({ session, combatEvents, editing, toolsSlot, onMapClick, mapOverlay, incomingMap = null, onOpenBooks }: Props) {
  const snapshot = session.snapshot();
  const map = snapshot.map;
  const [tool, setTool] = useState<Tool>('raise');
  const [shape, setShape] = useState<ShapeKind>('single');
  const [terrain, setTerrain] = useState<string>('stone');
  const [objectId, setObjectId] = useState<string>('tree');
  const [confirmingClear, setConfirmingClear] = useState(false);
  /** The DM's private notes on tiles (kept by the session, never sent to players). */
  const [notes, setNotes] = useState(() => session.notes());
  const [noteCell, setNoteCell] = useState<Cell | null>(null);
  const noteCells = useMemo(() => notes.map((note) => note.cell), [notes]);
  const noteAt = (cell: Cell | null) => (cell ? (notes.find((note) => cellKey(note.cell) === cellKey(cell))?.text ?? null) : null);
  const [level, setLevel] = useState(0);
  const [history, setHistory] = useState<EditHistory>(EMPTY_HISTORY);
  const [preview, setPreview] = useState<Cell[]>([]);
  /** A drag is in progress (shows how to cancel it), and whether it was started by touch. */
  const [drawing, setDrawing] = useState<'mouse' | 'touch' | null>(null);
  const [hovered, setHovered] = useState<Cell | null>(null);
  const [touchEdits, setTouchEdits] = useState(true);
  const [panel, setPanel] = useState<'none' | 'new' | 'generate' | 'examples'>('none');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Bumped to re-frame the camera after a new map. */
  const [frameKey, setFrameKey] = useState(0);
  const stroke = useRef<Stroke | null>(null);
  const world = useMemo(() => (map ? createWorldMap(map) : null), [map]);
  const play = useCombatPlay({
    combat: snapshot.combat,
    system: snapshot.system,
    map,
    houseRules: snapshot.houseRules,
    canControl: () => true, // the DM may act for any creature
    act: (action) => {
      const result = session.act(action);
      setPlayError(result.ok ? null : result.reason);
    },
  });
  const [playError, setPlayError] = useState<string | null>(null);
  const pressedAt = useRef<{ x: number; y: number } | null>(null);
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
      case 'object':
        return { type: 'setObject', cells, object: objectId };
      case 'removeObject':
        return { type: 'setObject', cells, object: null };
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

  // A map from the Books tab: put in place like any other, so Undo brings the old one back.
  const lastIncoming = useRef(0);
  useEffect(() => {
    if (!incomingMap || incomingMap.key === lastIncoming.current) return;
    lastIncoming.current = incomingMap.key;
    replaceMap(incomingMap.map);
  }, [incomingMap]);

  /** Replaces the whole map (new, generated, imported) as one undoable change when possible. */
  function replaceMap(next: MapData): void {
    const current = session.snapshot().map;
    try {
      if (current) {
        // One undoable change (a change of grid swaps the whole map).
        session.editMap(diffMaps(current, next));
        setHistory((h) => recordChange(h, current, next));
      } else {
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
    if (!editing) {
      if (pointer.type !== 'cancel') setHovered(pointer.cell);
      else pressedAt.current = null; // a second finger: a gesture, so lifting the first isn't a click
      // A click goes to the encounter tools first (placing, selecting), then to the fight.
      if (pointer.type === 'down' && pointer.button === 0) pressedAt.current = { x: pointer.x, y: pointer.y };
      if (pointer.type === 'up' && pointer.button === 0 && pressedAt.current && pointer.cell && onMapClick) {
        const moved = Math.hypot(pointer.x - pressedAt.current.x, pointer.y - pressedAt.current.y);
        pressedAt.current = null;
        if (moved <= CLICK_SLOP && onMapClick(pointer.cell)) return;
      }
      play.onPointer(pointer);
      return;
    }
    if (pointer.type === 'cancel') {
      cancelStroke();
      return;
    }
    setHovered(pointer.cell);
    if (!world || !map) return;
    if (pointer.isTouch && !touchEdits) return;

    // Notes: a click opens the note for that tile.
    if (tool === 'note') {
      if (pointer.type === 'up' && pointer.button === 0 && pointer.cell && world.inBounds(pointer.cell)) setNoteCell(pointer.cell);
      return;
    }

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

  const toolInfo = TOOLS.find((entry) => entry.id === tool);
  const toolButton = (id: Tool) => {
    const entry = TOOLS.find((candidate) => candidate.id === id) as (typeof TOOLS)[number];
    return (
      <button key={id} type="button" aria-pressed={tool === id} title={entry.hint} onClick={() => setTool(id)}>
        {entry.label}
      </button>
    );
  };

  const tools = (
    <div className="map-tools">
      {/* What to do: the tools, in labelled groups. */}
      <section className="tool-section" aria-label="Tools">
        <div className="toolbar tool-groups" role="toolbar" aria-label="Map tools">
          {TOOL_GROUPS.map((group) => (
            <div key={group.label} className="tool-group" role="group" aria-label={group.label}>
              <span className="tool-group-label" aria-hidden="true">
                {group.label}
              </span>
              <div className="segmented">{group.tools.map(toolButton)}</div>
            </div>
          ))}
        </div>

        {/* How: only the options the chosen tool uses, then undo and redo. */}
        <div className="tool-options">
          <p className="tool-hint">{toolInfo?.hint}</p>
          <div className="row">
            {!isWallTool(tool) && tool !== 'note' && (
              <label>
                <span>Shape</span>
                <select value={shape} onChange={(event) => setShape(event.target.value as ShapeKind)}>
                  {SHAPES.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
            {tool === 'object' && (
              <label>
                <span>Object</span>
                <select value={objectId} onChange={(event) => setObjectId(event.target.value)}>
                  {(['nature', 'built'] as const).map((category) => (
                    <optgroup key={category} label={category === 'nature' ? 'Nature' : 'Built'}>
                      {MAP_OBJECTS.filter((entry) => entry.category === category).map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                  {/* Objects made for this map, by the AI for an encounter. */}
                  {(map?.objects ?? []).length > 0 && (
                    <optgroup label="This map's own">
                      {(map?.objects ?? []).map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
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
            <div className="history">
              <button type="button" aria-label="Undo" title="Undo (Ctrl+Z)" onClick={() => step('undo')} disabled={history.undo.length === 0}>
                ↶
              </button>
              <button type="button" aria-label="Redo" title="Redo (Ctrl+Y)" onClick={() => step('redo')} disabled={history.redo.length === 0}>
                ↷
              </button>
            </div>
          </div>
          <button type="button" className="touch-only" aria-pressed={!touchEdits} onClick={() => setTouchEdits((value) => !value)}>
            {touchEdits ? 'Touch: editing' : 'Touch: moving view'}
          </button>
        </div>
      </section>

      {/* The map as a whole: start one, load or save it, or clear it. */}
      <section className="tool-section map-actions" aria-label="Map">
        <div className="tool-group" role="group" aria-label="Start">
          <span className="tool-group-label" aria-hidden="true">
            Start
          </span>
          <div className="segmented">
            <button type="button" aria-expanded={panel === 'new'} onClick={() => setPanel(panel === 'new' ? 'none' : 'new')}>
              New map
            </button>
            <button type="button" aria-expanded={panel === 'generate'} onClick={() => setPanel(panel === 'generate' ? 'none' : 'generate')}>
              Generate
            </button>
            <button type="button" aria-expanded={panel === 'examples'} onClick={() => setPanel(panel === 'examples' ? 'none' : 'examples')}>
              Examples
            </button>
            <button type="button" onClick={() => onOpenBooks?.()}>
              From a book (AI)
            </button>
          </div>
        </div>
        <div className="tool-group" role="group" aria-label="File">
          <span className="tool-group-label" aria-hidden="true">
            File
          </span>
          <div className="segmented">
            <label className="file-button">
              <span>Import map file</span>
              <input type="file" accept="application/json,.json" onChange={importMap} />
            </label>
            <button type="button" onClick={exportMap} disabled={!map}>
              Export
            </button>
          </div>
        </div>
        {map && (
          <div className="map-actions-end">
            <button type="button" onClick={switchGrid} title="Converts this map, keeping its layout, heights, and terrain">
              Switch to {map.grid === 'hex' ? 'square' : 'hex'} grid
            </button>
            <button type="button" className="danger" onClick={() => setConfirmingClear(true)}>
              Clear map
            </button>
          </div>
        )}
      </section>

      {panel === 'new' && <NewMapPanel onCreate={replaceMap} />}
      {panel === 'generate' && <GeneratePanel onCreate={replaceMap} />}
      {panel === 'examples' && <ExamplesPanel onLoad={replaceMap} />}
      {noteCell && (
        <NoteEditor
          key={cellKey(noteCell)}
          cell={noteCell}
          text={noteAt(noteCell) ?? ''}
          onSave={(text) => {
            try {
              session.setNote(noteCell, text);
              setNotes(session.notes());
              setNoteCell(null);
              setError(null);
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : String(caught));
            }
          }}
          onClose={() => setNoteCell(null)}
        />
      )}
      {confirmingClear && map && (
        <ConfirmClear
          onCancel={() => setConfirmingClear(false)}
          onConfirm={() => {
            setConfirmingClear(false);
            replaceMap(applyEdit(map, { type: 'clearMap' }));
          }}
        />
      )}

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

    </div>
  );

  return (
    <div className="map-editor">
      {toolsSlot ? createPortal(tools, toolsSlot) : tools}

      {map && world ? (
        <>
          <p className="map-summary" data-testid="map-summary">
            {mapSummary(map)}
          </p>
          <WorldCanvas
            map={map}
            notes={noteCells}
            art={snapshot.art}
            editing={editing && touchEdits}
            highlight={editing ? preview : play.highlight}
            highlightKind={editing ? 'brush' : play.highlightKind}
            reach={editing ? NO_CELLS : play.reach}
            reachKind={play.reachKind}
            ghosts={editing ? ghosts : NO_CELLS}
            combat={snapshot.combat}
            system={snapshot.system}
            combatEvents={combatEvents}
            targets={editing ? NO_IDS : play.targets}
            onTokenClick={play.onTokenClick}
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
              ) : (
                (mapOverlay ?? null)
              )
            }
            onFocusEveryone={(cell) => session.focusPlayers(cell)}
            onPointer={onPointer}
          />
          {!editing && snapshot.combat && snapshot.system && (
            <ReactionPrompt
              combat={snapshot.combat}
              system={snapshot.system}
              canControl={() => true} // the DM may answer for any creature
              act={(action) => {
                const result = session.act(action);
                setPlayError(result.ok ? null : result.reason);
              }}
            />
          )}
          {!editing && snapshot.combat && snapshot.system && (
            <CombatHud
              combat={snapshot.combat}
              system={snapshot.system}
              play={play}
              ruling={{
                overrule: (action, always) => {
                  const result = session.overrule(action, always);
                  setPlayError(result.ok ? null : result.reason);
                  play.dismissRefusal();
                },
              }}
            />
          )}
          {!editing && playError && (
            <p className="error" role="alert">
              {playError}
            </p>
          )}
          <p className="tile-info" data-testid="tile-info">
            {tileDescription(world, hovered, { note: noteAt(hovered) })}
          </p>
          <p className="hint">
            {editing
              ? `Left-click or drag to use the tool · right-drag to pan · wheel to zoom · Q/E or middle-drag to turn · ${TOOLS.find((entry) => entry.id === tool)?.hint ?? ''}`
              : 'Click a creature to select it · on a turn, click a lit tile to move · right-drag to pan · wheel to zoom · Q/E to turn'}
          </p>
        </>
      ) : (
        <p className="muted">
          No map yet: open the <b>Map</b> tab and use <b>New map</b> or <b>Generate</b>.
        </p>
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

/** Writes (or deletes) the DM's private note on one tile. */
function NoteEditor({ cell, text, onSave, onClose }: { cell: Cell; text: string; onSave(text: string): void; onClose(): void }) {
  const [draft, setDraft] = useState(text);
  return (
    <form
      className="panel"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
    >
      <fieldset aria-label={`Note on tile (${cell.q}, ${cell.r})`}>
        <legend>
          Note on tile ({cell.q}, {cell.r}) · only you can see it
        </legend>
        <label>
          <span>Note</span>
          <textarea value={draft} rows={3} maxLength={2000} onChange={(event) => setDraft(event.target.value)} autoFocus />
        </label>
        <div className="row">
          <button type="submit" className="primary">
            Save note
          </button>
          {text && (
            <button type="button" className="danger" onClick={() => onSave('')}>
              Delete note
            </button>
          )}
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </fieldset>
    </form>
  );
}

/** Asks before wiping the map (Undo can still bring it back). */
function ConfirmClear({ onConfirm, onCancel }: { onConfirm(): void; onCancel(): void }) {
  const titleId = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  return (
    <div
      className="panel confirm"
      role="alertdialog"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    >
      <p id={titleId}>
        <strong>Are you sure about clearing the whole map?</strong>
      </p>
      <p className="muted">Every height, terrain, object, and wall goes; the map becomes flat grass of the same size.</p>
      <div className="row">
        <button type="button" className="danger" onClick={onConfirm}>
          Clear map
        </button>
        <button type="button" ref={cancel} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Ready-made maps that show what a map can hold; loading one replaces the current map (Undo brings it back). */
function ExamplesPanel({ onLoad }: { onLoad(map: MapData): void }) {
  return (
    <fieldset className="panel examples">
      <legend>Example maps</legend>
      <ul>
        {EXAMPLE_MAPS.map((example) => {
          const map = exampleMap(example.id);
          return (
            <li key={example.id}>
              <div>
                <strong>{example.name}</strong>
                <span className="muted">
                  {' '}
                  · {example.size} · {map.grid} · {map.tiles.length} tiles
                </span>
                <p>{example.description}</p>
              </div>
              <button type="button" aria-label={`Load ${example.name}`} onClick={() => onLoad(map)}>
                Load
              </button>
            </li>
          );
        })}
      </ul>
    </fieldset>
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
