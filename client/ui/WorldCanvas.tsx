import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import type { CameraCommand, CameraView } from '@shared/camera';
import type { CombatEvent, CombatState } from '@shared/combat';
import { lowerQuality } from '@shared/graphics';
import type { GameSystem } from '@shared/system';
import type { Cell } from '@shared/grid';
import { type MapData, type WorldMap, objectInfo } from '@shared/map';
import { type HighlightKind, type TilePointer, WorldView } from '../render/WorldView';
import { placeholderStyle } from '../style/stylePack';
import { combatSounds } from '@shared/audio';
import { sounds } from '../audio/soundEngine';
import { DisplaySettingsMenu } from './DisplaySettingsMenu';
import type { Fog } from './useFog';
import { setDisplaySetting, useDisplaySettings } from './displaySettings';

interface Props {
  readonly map: MapData | null;
  readonly editing: boolean;
  readonly highlight?: readonly Cell[];
  /** Decides the highlight color (default: the editing brush). */
  readonly highlightKind?: HighlightKind;
  /** An ability's range, tinted faintly under the highlight. */
  readonly reach?: readonly Cell[];
  readonly reachKind?: 'harm' | 'help';
  readonly ghosts?: readonly Cell[];
  /** Changing this re-frames the camera on the whole map (e.g. after a new map). */
  readonly frameKey?: number;
  /** A cell the DM asked everyone to look at; `key` changes with each request. */
  readonly focus?: { readonly cell: Cell; readonly key: number } | null;
  /** DM only: shows "Focus everyone here", sending the cell in the middle of the view. */
  onFocusEveryone?(cell: Cell): void;
  /** The fight to show on the map. */
  readonly combat?: CombatState | null;
  readonly system?: GameSystem | null;
  /** The events of the latest combat action, played as animations; `key` changes with each action. */
  readonly combatEvents?: { readonly events: readonly CombatEvent[]; readonly key: number } | null;
  /** Fog of war for this viewer (null: see everything), and creatures out of their sight. */
  readonly fog?: Fog | null;
  readonly hiddenTokens?: ReadonlySet<string>;
  /** Tiles with DM notes (the DM's view only). */
  readonly notes?: readonly Cell[];
  /** Creatures the chosen ability can target. */
  readonly targets?: readonly string[];
  onTokenClick?(combatantId: string): void;
  /** Extra content floating over the bottom of the map (e.g. how to cancel a drag). */
  readonly overlay?: ReactNode;
  onPointer(pointer: TilePointer): void;
}

const QUALITY_NAMES = { low: 'Low', medium: 'Medium', high: 'High' } as const;

const NONE: readonly Cell[] = [];
const NO_TARGETS: readonly string[] = [];
const NO_ONE: ReadonlySet<string> = new Set();

/** The style pack's action colors, for the HTML over the map (target buttons). */
const actionColors = {
  '--harm': placeholderStyle.actionColors.harm,
  '--help': placeholderStyle.actionColors.help,
} as CSSProperties;

function headingLabel(view: CameraView): string {
  if (view.free) return 'Free camera';
  if (view.mode === 'topDown') return 'Top-down · north up';
  return `Facing ${view.cardinal}`;
}

/** Hosts a WorldView in React, with camera controls over it. The view is created once; props are pushed into it. */
export function WorldCanvas(props: Props) {
  const { map, editing, highlight = NONE, highlightKind = 'brush', ghosts = NONE, frameKey = 0, focus = null, onFocusEveryone, overlay, onPointer } =
    props;
  const { combat = null, system = null, combatEvents = null, targets = NO_TARGETS, onTokenClick, reach = NONE, reachKind = 'harm' } = props;
  const { fog = null, hiddenTokens = NO_ONE, notes = NONE } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<WorldView | null>(null);
  const [camera, setCamera] = useState<CameraView>({ mode: '2.5d', free: false, cardinal: 'north' });
  // The view calls the latest handler without being rebuilt when it changes.
  const handlerRef = useRef(onPointer);
  handlerRef.current = onPointer;
  const tokenClickRef = useRef(onTokenClick);
  tokenClickRef.current = onTokenClick;
  /** The last combat action already acted out, so each one plays once. */
  const playedKey = useRef<number | null>(null);

  useEffect(() => {
    const view = new WorldView(canvasRef.current as HTMLCanvasElement, placeholderStyle, (pointer) =>
      handlerRef.current(pointer),
    );
    viewRef.current = view;
    const stopListening = view.onCameraChange(setCamera);
    view.setTokenClickHandler((id) => tokenClickRef.current?.(id));
    return () => {
      stopListening();
      view.dispose();
      viewRef.current = null;
    };
  }, []);

  // How much 2.5D polish to draw: this viewer's choice, kept on this device.
  const { graphics: quality, combatSpeed } = useDisplaySettings();
  useEffect(() => viewRef.current?.setGraphics(quality), [quality]);
  useEffect(() => viewRef.current?.setAnimationSpeed(combatSpeed), [combatSpeed]);

  // When frames stay slow, step the graphics down and say so. Once someone raises
  // them again by hand after that, they know best: no more automatic changes.
  const [lowered, setLowered] = useState<string | null>(null);
  const autoAllowed = useRef(true);
  const autoLowered = useRef(false);
  const qualityRef = useRef(quality);
  qualityRef.current = quality;
  useEffect(() => {
    viewRef.current?.onSlowFrames(() => {
      const next = autoAllowed.current ? lowerQuality(qualityRef.current) : null;
      if (!next) return;
      autoLowered.current = true;
      setDisplaySetting('graphics', next);
      setLowered(`Graphics lowered to ${QUALITY_NAMES[next]} to keep things smooth. Change it under ⚙.`);
    });
  }, []);
  useEffect(() => {
    if (!lowered) return;
    const timer = setTimeout(() => setLowered(null), 8000);
    return () => clearTimeout(timer);
  }, [lowered]);

  useEffect(() => viewRef.current?.setMap(map), [map]);
  useEffect(() => viewRef.current?.setEditing(editing), [editing]);
  // After setMap, which clears overlays when the map changes.
  useEffect(() => viewRef.current?.setHighlight(highlight, highlightKind), [highlight, highlightKind, map]);
  useEffect(() => viewRef.current?.setReach(reach, reachKind), [reach, reachKind, map]);
  useEffect(() => viewRef.current?.setGhosts(ghosts), [ghosts, map]);
  useEffect(() => viewRef.current?.setNotes(notes), [notes, map]);
  useEffect(() => {
    if (frameKey > 0) viewRef.current?.frameMap();
  }, [frameKey]);
  useEffect(() => {
    if (focus) viewRef.current?.focusCell(focus.cell);
  }, [focus]);
  // After setMap, which the tokens stand on.
  useEffect(() => {
    const fresh = combatEvents && combatEvents.key !== playedKey.current ? combatEvents : null;
    if (fresh) playedKey.current = fresh.key;
    const timeline = viewRef.current?.setCombat(combat, system, fresh?.events ?? null);
    // The action's sounds, timed to its animation.
    if (timeline) sounds.playAll(combatSounds(timeline));
  }, [combat, system, combatEvents, map]);
  // After setCombat, so new creatures are hidden too.
  useEffect(() => viewRef.current?.setFog(fog, hiddenTokens), [fog, hiddenTokens, map, combat]);
  useEffect(() => viewRef.current?.setTargets(targets, highlightKind === 'help' ? 'help' : 'harm'), [targets, highlightKind]);

  const command = (next: CameraCommand) => viewRef.current?.cameraCommand(next);

  // Q / E turn the view, except while typing in a field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if ((event.target as HTMLElement).closest('input, select, textarea')) return;
      const key = event.key.toLowerCase();
      if (key === 'q') viewRef.current?.cameraCommand({ type: 'turn', direction: 'left' });
      else if (key === 'e') viewRef.current?.cameraCommand({ type: 'turn', direction: 'right' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const canTurn = camera.mode === '2.5d' || camera.free;

  return (
    <div className="world" style={actionColors}>
      <canvas
        ref={canvasRef}
        className="world-canvas"
        data-testid="world-canvas"
        data-highlight={highlight.length > 0 ? highlightKind : undefined}
        data-reach={reach.length > 0 ? reach.length : undefined}
      />
      {overlay}
      <span className="compass" data-testid="camera-heading">
        {headingLabel(camera)}
      </span>
      <div className="camera-controls" role="toolbar" aria-label="Camera">
        <button
          type="button"
          aria-label="Turn left"
          title="Turn left (Q)"
          disabled={!canTurn}
          onClick={() => command({ type: 'turn', direction: 'left' })}
        >
          ⟲
        </button>
        <button
          type="button"
          aria-label="Turn right"
          title="Turn right (E)"
          disabled={!canTurn}
          onClick={() => command({ type: 'turn', direction: 'right' })}
        >
          ⟳
        </button>
        <button
          type="button"
          aria-label="Top-down view"
          aria-pressed={camera.mode === 'topDown'}
          onClick={() => command({ type: 'setMode', mode: camera.mode === 'topDown' ? '2.5d' : 'topDown' })}
        >
          Top-down<span className="long"> view</span>
        </button>
        <button
          type="button"
          aria-label="Free camera"
          aria-pressed={camera.free}
          onClick={() => command({ type: 'setFree', free: !camera.free })}
        >
          Free<span className="long"> camera</span>
        </button>
        <button type="button" aria-label="Re-center view" onClick={() => viewRef.current?.frameMap()}>
          <span className="long">Re-c</span><span className="short">C</span>enter<span className="long"> view</span>
        </button>
        {onFocusEveryone && (
          <button
            type="button"
            aria-label="Focus everyone here"
            title="Moves every player's camera to look where you're looking"
            onClick={() => {
              const cell = viewRef.current?.centerCell();
              if (cell) onFocusEveryone(cell);
            }}
          >
            Focus<span className="long"> everyone here</span>
            <span className="short"> all</span>
          </button>
        )}
        <DisplaySettingsMenu
          onGraphicsPicked={() => {
            if (autoLowered.current) autoAllowed.current = false;
            setLowered(null);
          }}
        />
      </div>
      {lowered && (
        <p className="graphics-note" role="status">
          {lowered}
        </p>
      )}
    </div>
  );
}

/** One-line description of a map, shown above the view. */
export function mapSummary(map: MapData): string {
  const heights = map.tiles.map((tile) => tile.height);
  const walls = map.walls.length;
  const range = heights.length > 0 ? `${Math.min(...heights)}–${Math.max(...heights)}` : 'none';
  return `${map.grid} map · ${map.tiles.length} tiles · ${walls} ${walls === 1 ? 'wall' : 'walls'} · heights ${range}`;
}

/** Describes the tile under the pointer. */
/**
 * What the pointer is over. Under fog of war, tiles never seen tell nothing;
 * the DM's view adds the tile's note, if any.
 */
export function tileDescription(world: WorldMap, cell: Cell | null, extra: { fog?: Fog | null; note?: string | null } = {}): string {
  if (!cell) return 'Point at a tile to inspect it';
  const tile = world.tile(cell);
  if (!tile) return `(${cell.q}, ${cell.r}) is outside the map`;
  if (extra.fog && !extra.fog.explored.has(`${cell.q},${cell.r}`)) return `Tile (${cell.q}, ${cell.r}) · unexplored`;
  const note = extra.note ? ` · Note: ${extra.note}` : '';
  const object = tile.object ? ` · ${objectInfo(tile.object)?.name ?? tile.object}` : '';
  return `Tile (${cell.q}, ${cell.r}) · height ${tile.height} · ${tile.terrain}${object}${tile.blocked ? ' · solid' : ''}${note}`;
}
