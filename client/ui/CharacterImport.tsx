import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { CLIPS, type Clip } from '@shared/anim';
import type { SpriteDirection } from '@shared/camera';
import type { HostSession } from '@shared/net';
import { type ImageAsset, MAX_IMAGE_CHARS, MAX_IMAGE_SIDE } from '@shared/style/art';
import { SHEET_DIRECTIONS, type SheetLayout, frameAt, guessFrameSize, portraitRect, sliceSheet } from '@shared/style/sheet';

// Importing a character's sprite sheet in the Art tab: choose who it's for
// (a kind of monster, or one creature), pick the PNG, and the sheet is
// sliced (frame size guessed, frames counted per row), previewed playing
// any animation in any direction, with friendly warnings and a round token
// cut from the portrait, before it's used.

const PREVIEW_SIZE = 128;
const TOKEN_SIZE = 64;

interface Sheet {
  readonly image: ImageAsset;
  readonly element: HTMLImageElement;
  readonly pixels: ImageData;
}

interface Sliced {
  readonly layout: SheetLayout;
  readonly warnings: readonly string[];
  readonly token: ImageAsset;
}

function loadSheet(file: File): Promise<Sheet> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Couldn't read ${file.name}`));
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const element = new Image();
      element.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = element.naturalWidth;
        canvas.height = element.naturalHeight;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        ctx.drawImage(element, 0, 0);
        resolve({
          image: { dataUrl, width: element.naturalWidth, height: element.naturalHeight },
          element,
          pixels: ctx.getImageData(0, 0, canvas.width, canvas.height),
        });
      };
      element.onerror = () => reject(new Error(`${file.name} isn't an image this browser can show`));
      element.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

/** A round token cut from the top of the first facing-down idle frame. */
function makeToken(sheet: Sheet, layout: SheetLayout): ImageAsset {
  const { x, y, size } = portraitRect(layout);
  const canvas = document.createElement('canvas');
  canvas.width = TOKEN_SIZE;
  canvas.height = TOKEN_SIZE;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#2a2539';
  ctx.beginPath();
  ctx.arc(TOKEN_SIZE / 2, TOKEN_SIZE / 2, TOKEN_SIZE / 2 - 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.drawImage(sheet.element, x, y, size, size, 0, 0, TOKEN_SIZE, TOKEN_SIZE);
  ctx.restore();
  ctx.strokeStyle = '#e0b44c';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(TOKEN_SIZE / 2, TOKEN_SIZE / 2, TOKEN_SIZE / 2 - 2, 0, Math.PI * 2);
  ctx.stroke();
  return { dataUrl: canvas.toDataURL('image/png'), width: TOKEN_SIZE, height: TOKEN_SIZE };
}

/** The sheet playing one animation in one direction, frame by frame, scaled up crisply. */
function Preview({ sheet, layout, clip, direction }: { sheet: Sheet; layout: SheetLayout; clip: Clip; direction: SpriteDirection }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    const started = performance.now();
    let frame = 0;
    const draw = () => {
      const at = frameAt(layout, clip, direction, performance.now() - started);
      ctx.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
      if (at) {
        const size = layout.frameSize;
        ctx.save();
        if (at.mirror) {
          ctx.translate(PREVIEW_SIZE, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(sheet.element, at.column * size, at.row * size, size, size, 0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
        ctx.restore();
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [sheet, layout, clip, direction]);
  return (
    <canvas
      ref={canvas}
      className="sheet-preview"
      width={PREVIEW_SIZE}
      height={PREVIEW_SIZE}
      role="img"
      aria-label={`Preview of the ${clip} animation facing ${direction}`}
    />
  );
}

export interface ArtTarget {
  /** The art key: a monster kind ("goblin") or one creature's id. */
  readonly key: string;
  readonly label: string;
  /** The short name for the button ("Use for Goblin"). */
  readonly name: string;
}

export function CharacterImport({ session, targets }: { session: HostSession; targets: readonly ArtTarget[] }) {
  const art = session.snapshot().art;
  const [targetKey, setTargetKey] = useState(targets[0]?.key ?? '');
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [frameSize, setFrameSize] = useState(32);
  const [clip, setClip] = useState<Clip>('idle');
  const [direction, setDirection] = useState<SpriteDirection>('down');
  const [error, setError] = useState<string | null>(null);
  const target = targets.find((entry) => entry.key === targetKey) ?? targets[0];

  // Slicing follows the frame size, which starts from a guess and can be changed.
  const { sliced, sliceError } = useMemo((): { sliced: Sliced | null; sliceError: string | null } => {
    if (!sheet) return { sliced: null, sliceError: null };
    try {
      const { layout, warnings } = sliceSheet(sheet.pixels, frameSize);
      return { sliced: { layout, warnings, token: makeToken(sheet, layout) }, sliceError: null };
    } catch (caught) {
      return { sliced: null, sliceError: caught instanceof Error ? caught.message : String(caught) };
    }
  }, [sheet, frameSize]);
  const clips = sliced ? (CLIPS.filter((entry) => sliced?.layout.clips[entry]) as Clip[]) : [];

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const loaded = await loadSheet(file);
      if (loaded.image.dataUrl.length >= MAX_IMAGE_CHARS) throw new Error(`${file.name} is too big: keep sprite sheets under about 500 KB`);
      if (loaded.image.width > MAX_IMAGE_SIDE || loaded.image.height > MAX_IMAGE_SIDE) throw new Error(`${file.name} is too large: at most ${MAX_IMAGE_SIDE} pixels across`);
      setError(null);
      setFrameSize(guessFrameSize(loaded.image.width, loaded.image.height, loaded.pixels) ?? 32);
      setClip('idle');
      setDirection('down');
      setSheet(loaded);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function apply(key: string, character: Parameters<HostSession['setCharacterArt']>[1]) {
    try {
      session.setCharacterArt(key, character);
      setSheet(null);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  const withArt = Object.keys(art.characters);

  return (
    <div className="character-import">
      <h3>Characters</h3>
      <p className="muted">
        A sprite sheet: square frames, 4 rows per animation (facing down, left, right, up), idle first. Only idle is needed: missing animations are acted out with simple motions.
      </p>
      <div className="row">
        <label className="grow">
          <span>Character</span>
          <select value={target?.key ?? ''} onChange={(event) => setTargetKey(event.target.value)}>
            {targets.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label className="file-button">
          <span>Import sprite sheet</span>
          <input type="file" accept="image/png,image/gif,image/webp" aria-label="Import sprite sheet" disabled={!target} onChange={(event) => void choose(event)} />
        </label>
      </div>

      {sheet && target && (
        <fieldset className="panel sheet-import" aria-label="New sprite sheet">
          <legend>New sprite sheet for {target.name}</legend>
          <div className="row">
            <label>
              <span>Frame size</span>
              <input type="number" min={4} max={256} value={frameSize} onChange={(event) => setFrameSize(Number(event.target.value))} />
            </label>
            {sliced && (
              <>
                <label>
                  <span>Animation</span>
                  <select value={clip} onChange={(event) => setClip(event.target.value as Clip)}>
                    {clips.map((entry) => (
                      <option key={entry} value={entry}>
                        {entry}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Facing</span>
                  <select value={direction} onChange={(event) => setDirection(event.target.value as SpriteDirection)}>
                    {SHEET_DIRECTIONS.map((entry) => (
                      <option key={entry} value={entry}>
                        {entry}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>
          {sliceError && <p className="field-error">{sliceError}</p>}
          {sliced && (
            <>
              <div className="row sheet-previews">
                <Preview sheet={sheet} layout={sliced.layout} clip={clips.includes(clip) ? clip : 'idle'} direction={direction} />
                <img src={sliced.token.dataUrl} alt="Round token" className="token-preview" />
                <div className="grow">
                  <p className="muted">
                    {sliced.layout.frameSize}-pixel frames · animations: {clips.join(', ')}
                  </p>
                  {sliced.warnings.map((warning) => (
                    <p key={warning} className="field-error">
                      {warning}
                    </p>
                  ))}
                </div>
              </div>
            </>
          )}
          <div className="row">
            <button
              type="button"
              className="primary"
              disabled={!sliced}
              onClick={() => sliced && apply(target.key, { image: sheet.image, layout: sliced.layout, token: sliced.token })}
            >
              Use for {target.name}
            </button>
            <button type="button" onClick={() => setSheet(null)}>
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

      {withArt.length > 0 && (
        <ul className="tile-list">
          {withArt.map((key) => (
            <li key={key}>
              {art.characters[key]?.token ? <img src={art.characters[key]?.token?.dataUrl} alt="" className="tile-thumb" /> : null}
              <span className="grow">{targets.find((entry) => entry.key === key)?.label ?? key}</span>
              <button type="button" aria-label={`Reset ${key} art`} title="Back to the pack's figure" onClick={() => apply(key, null)}>
                Reset
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
