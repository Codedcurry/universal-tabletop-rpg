import { useMemo, useState } from 'react';
import type { Cell } from '@shared/grid';
import { type MapData, createWorldMap } from '@shared/map';
import { WorldCanvas, mapSummary, tileDescription } from './WorldCanvas';

/** Players' read-only view of the map, updated live as the DM edits. */
interface Props {
  readonly map: MapData | null;
  /** Where the DM last asked everyone to look. */
  readonly focus?: { readonly cell: Cell; readonly key: number } | null;
}

export function MapViewer({ map, focus = null }: Props) {
  const [hovered, setHovered] = useState<Cell | null>(null);
  const world = useMemo(() => (map ? createWorldMap(map) : null), [map]);
  if (!map || !world) return <p className="muted">The DM hasn't made a map yet.</p>;
  return (
    <div className="map-view">
      <p className="map-summary" data-testid="map-summary">
        {mapSummary(map)}
      </p>
      <WorldCanvas map={map} editing={false} focus={focus} onPointer={(pointer) => setHovered(pointer.cell)} />
      <p className="hint">Drag to move · wheel or pinch to zoom · Q/E, the turn buttons, or a two-finger twist to turn</p>
      <p className="tile-info" data-testid="tile-info">
        {tileDescription(world, hovered)}
      </p>
    </div>
  );
}
