import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import type { HostSession } from '@shared/net';
import { type ImageAsset, MAX_IMAGE_CHARS, MAX_IMAGE_SIDE, tileWarnings } from '@shared/style/art';
import { PIXEL_TILE_SIZE, pixelTile } from '@shared/style/pixelTiles';
import { TERRAINS } from '../style/stylePack';
import { type ArtTarget, CharacterImport } from './CharacterImport';

// The DM tools' Art tab: the game's own art. Each terrain shows its tile
// (the DM's image, or the pack's pixel art); importing an image shows a
// crisp preview and any size warnings before it's used. The art goes to
// every player with the game, and is saved with it; it's never uploaded.

interface Pending {
  readonly terrain: string;
  readonly image: ImageAsset;
  readonly warnings: readonly string[];
}

/** The pack's own pixel art tile for a terrain, drawn small. */
function PackTile({ terrain }: { terrain: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (ctx) ctx.putImageData(new ImageData(pixelTile(terrain, 0), PIXEL_TILE_SIZE, PIXEL_TILE_SIZE), 0, 0);
  }, [terrain]);
  return <canvas ref={canvas} className="tile-thumb" width={PIXEL_TILE_SIZE} height={PIXEL_TILE_SIZE} aria-hidden="true" />;
}

/** Reads an image file as a data URL and measures it. */
function readImage(file: File): Promise<ImageAsset> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Couldn't read ${file.name}`));
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const image = new Image();
      image.onload = () => resolve({ dataUrl, width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error(`${file.name} isn't an image this browser can show`));
      image.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export function ArtPanel({ session }: { session: HostSession }) {
  const { art, system, combat } = session.snapshot();
  // Who can get a sprite sheet: every kind of monster, and each creature on the map.
  const targets: ArtTarget[] = [
    ...(system?.monsters ?? []).map((monster) => ({ key: monster.id, label: `${monster.name} (every ${monster.name.toLowerCase()})`, name: monster.name })),
    ...Object.entries(combat?.combatants ?? {}).map(([id, combatant]) => ({ key: id, label: `${combatant.sheet.name} (only this one)`, name: combatant.sheet.name })),
  ];
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(terrain: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const image = await readImage(file);
      if (image.dataUrl.length >= MAX_IMAGE_CHARS) throw new Error(`${file.name} is too big: keep tile images under about 500 KB`);
      if (image.width > MAX_IMAGE_SIDE || image.height > MAX_IMAGE_SIDE) throw new Error(`${file.name} is too large: at most ${MAX_IMAGE_SIDE} pixels across`);
      setError(null);
      setPending({ terrain, image, warnings: tileWarnings(image.width, image.height) });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function apply(terrain: string, image: ImageAsset | null) {
    try {
      session.setTileArt(terrain, image);
      setPending(null);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <div className="art-panel">
      <h3>Tiles</h3>
      <p className="muted">Use your own image for a terrain&apos;s tiles: square pixel art, 16, 32, or 64 pixels, looks best. Everyone in the game sees it.</p>
      {pending && (
        <fieldset className="panel tile-preview" aria-label={`New ${pending.terrain} tile`}>
          <legend>New {pending.terrain} tile</legend>
          <div className="row">
            <img src={pending.image.dataUrl} alt={`The new ${pending.terrain} tile`} className="tile-preview-image" />
            <div className="grow">
              <p className="muted">
                {pending.image.width} x {pending.image.height} pixels
              </p>
              {pending.warnings.map((warning) => (
                <p key={warning} className="field-error">
                  {warning}
                </p>
              ))}
            </div>
          </div>
          <div className="row">
            <button type="button" className="primary" onClick={() => apply(pending.terrain, pending.image)}>
              Use for {pending.terrain}
            </button>
            <button type="button" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </fieldset>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ul className="tile-list">
        {TERRAINS.map((terrain) => {
          const custom = art.tiles[terrain];
          return (
            <li key={terrain}>
              {custom ? <img src={custom.dataUrl} alt="" className="tile-thumb" /> : <PackTile terrain={terrain} />}
              <span className="grow">
                {terrain}
                {custom && <span className="muted"> · your image</span>}
              </span>
              <label className="file-button small">
                <span>Import</span>
                <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" aria-label={`Import ${terrain} tile`} onChange={(event) => void choose(terrain, event)} />
              </label>
              {custom && (
                <button type="button" aria-label={`Reset ${terrain} tile`} title="Back to the pack's tile" onClick={() => apply(terrain, null)}>
                  Reset
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <CharacterImport session={session} targets={targets} />
    </div>
  );
}
