import { useMemo, useState } from 'react';
import type { Cell } from '@shared/grid';
import { type MapData, createWorldMap } from '@shared/map';
import { WorldCanvas, mapSummary, tileDescription } from './WorldCanvas';

/** Players' read-only view of the map, updated live as the DM edits. */
export function MapViewer({ map }: { readonly map: MapData | null }) {
  const [hovered, setHovered] = useState<Cell | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const world = useMemo(() => (map ? createWorldMap(map) : null), [map]);
  if (!map || !world) return <p className="muted">The DM hasn't made a map yet.</p>;
  return (
    <div className="map-view">
      <p className="map-summary" data-testid="map-summary">
        {mapSummary(map)}
      </p>
      <WorldCanvas map={map} editing={false} frameKey={frameKey} onPointer={(pointer) => setHovered(pointer.cell)} />
      <button type="button" className="recenter" onClick={() => setFrameKey((key) => key + 1)}>
        Re-center view
      </button>
      <p className="tile-info" data-testid="tile-info">
        {tileDescription(world, hovered)}
      </p>
    </div>
  );
}
