import { useEffect, useMemo, useRef } from 'react';
import { previewTiles } from '@shared/ai';
import type { MapData } from '@shared/map';
import { placeholderStyle } from '../style/stylePack';

// A map made from a book, shown small from above before it's used.

/** A small top-down picture of a map plan: terrain colours, solid tiles darker, objects as dots, higher ground lighter. */
export function MapPreview({ map }: { map: MapData }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const tiles = useMemo(() => previewTiles(map), [map]);
  const width = Math.max(...tiles.map((tile) => tile.x)) + 1;
  const height = Math.max(...tiles.map((tile) => tile.y)) + 1;
  const size = Math.max(4, Math.floor(320 / Math.max(width, height)));
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    for (const tile of tiles) {
      ctx.fillStyle = placeholderStyle.terrain[tile.terrain]?.color ?? '#5f9e4a';
      ctx.fillRect(tile.x * size, tile.y * size, size, size);
      const shade = tile.blocked ? 'rgba(0, 0, 0, 0.45)' : tile.height > 0 ? `rgba(255, 255, 255, ${Math.min(0.4, tile.height * 0.12)})` : null;
      if (shade) {
        ctx.fillStyle = shade;
        ctx.fillRect(tile.x * size, tile.y * size, size, size);
      }
      if (tile.object) {
        ctx.fillStyle = '#1a1420';
        ctx.beginPath();
        ctx.arc((tile.x + 0.5) * size, (tile.y + 0.5) * size, size * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [tiles, size]);
  return (
    <canvas
      ref={canvas}
      className="map-preview"
      width={width * size}
      height={height * size}
      role="img"
      aria-label={`Preview: a ${width} by ${height} ${map.grid} map`}
    />
  );
}
