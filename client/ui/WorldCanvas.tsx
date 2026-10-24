import { useEffect, useRef } from 'react';
import type { Cell } from '@shared/grid';
import type { MapData, WorldMap } from '@shared/map';
import { type TilePointer, WorldView } from '../render/WorldView';
import { placeholderStyle } from '../style/stylePack';

interface Props {
  readonly map: MapData | null;
  readonly editing: boolean;
  readonly highlight?: readonly Cell[];
  readonly ghosts?: readonly Cell[];
  /** Changing this re-frames the camera on the whole map (new map, "Re-center view"). */
  readonly frameKey?: number;
  onPointer(pointer: TilePointer): void;
}

/** Hosts a WorldView in React. The view is created once; props are pushed into it. */
const NONE: readonly Cell[] = [];

export function WorldCanvas({ map, editing, highlight = NONE, ghosts = NONE, frameKey = 0, onPointer }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<WorldView | null>(null);
  // The view calls the latest handler without being rebuilt when it changes.
  const handlerRef = useRef(onPointer);
  handlerRef.current = onPointer;

  useEffect(() => {
    const view = new WorldView(canvasRef.current as HTMLCanvasElement, placeholderStyle, (pointer) =>
      handlerRef.current(pointer),
    );
    viewRef.current = view;
    return () => {
      view.dispose();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => viewRef.current?.setMap(map), [map]);
  useEffect(() => viewRef.current?.setEditing(editing), [editing]);
  // After setMap, which clears overlays when the map changes.
  useEffect(() => viewRef.current?.setHighlight(highlight), [highlight, map]);
  useEffect(() => viewRef.current?.setGhosts(ghosts), [ghosts, map]);
  useEffect(() => {
    if (frameKey > 0) viewRef.current?.frameMap();
  }, [frameKey]);

  return <canvas ref={canvasRef} className="world-canvas" data-testid="world-canvas" />;
}

/** One-line description of a map, shown above the view. */
export function mapSummary(map: MapData): string {
  const heights = map.tiles.map((tile) => tile.height);
  const walls = map.walls.length;
  const range = heights.length > 0 ? `${Math.min(...heights)}–${Math.max(...heights)}` : 'none';
  return `${map.grid} map · ${map.tiles.length} tiles · ${walls} ${walls === 1 ? 'wall' : 'walls'} · heights ${range}`;
}

/** Describes the tile under the pointer. */
export function tileDescription(world: WorldMap, cell: Cell | null): string {
  if (!cell) return 'Point at a tile to inspect it';
  const tile = world.tile(cell);
  if (!tile) return `(${cell.q}, ${cell.r}) is outside the map`;
  return `Tile (${cell.q}, ${cell.r}) · height ${tile.height} · ${tile.terrain}${tile.blocked ? ' · solid' : ''}`;
}
