import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CharacterArt } from '@shared/style/art';
import { type Image, pixelArt, removeBackground, stillSheet } from '@shared/style/pixelate';
import type { Pixels } from '@shared/style/sheet';
import { type Crop, Preview, TokenEditor, headCrop, makeToken } from './spritePreview';

// Making a character from one picture (and a back view, if there is one),
// in a window like the frame picker's: the background is taken away, the
// picture turned into pixel art (height, colours, and outline on sliders),
// and given a breathing idle; the procedural motions act out the rest.
// Previewed, with a token to frame, before it's used.

/** Pictures bigger than this are shrunk on loading: the pixel art is far smaller anyway. */
const MAX_PICTURE_SIDE = 512;
/** How much bigger the pixel art is shown. */
const ZOOM = 4;

export interface Picture {
  readonly name: string;
  readonly pixels: Pixels;
}

/** Reads any image file, shrunk to at most MAX_PICTURE_SIDE across. */
export function loadPicture(file: File): Promise<Picture> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const element = new Image();
    element.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_PICTURE_SIDE / Math.max(element.naturalWidth, element.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(element.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(element.naturalHeight * scale));
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      ctx.drawImage(element, 0, 0, canvas.width, canvas.height);
      resolve({ name: file.name, pixels: ctx.getImageData(0, 0, canvas.width, canvas.height) });
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`${file.name} isn't an image this browser can show`));
    };
    element.src = url;
  });
}

function toCanvas(image: Image): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  (canvas.getContext('2d') as CanvasRenderingContext2D).putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  return canvas;
}

const hasPixels = (image: Image) => image.data.some((value, index) => index % 4 === 3 && value > 0);

/** Pixel art shown big and crisp. */
function PixelImage({ image, label }: { image: Image; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    canvas.current?.getContext('2d')?.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  }, [image]);
  return (
    <canvas
      ref={canvas}
      className="pixel-art"
      width={image.width}
      height={image.height}
      style={{ width: image.width * ZOOM }}
      role="img"
      aria-label={label}
    />
  );
}

export function OnePicture({ front, name, onUse, onCancel }: { front: Picture; name: string; onUse: (character: CharacterArt) => void; onCancel: () => void }) {
  const [back, setBack] = useState<Picture | null>(null);
  const [height, setHeight] = useState(48);
  const [colors, setColors] = useState(16);
  const [tolerance, setTolerance] = useState(24);
  const [outlined, setOutlined] = useState(true);
  const [facing, setFacing] = useState<'down' | 'up'>('down');
  const [error, setError] = useState<string | null>(null);
  const settings = `${height}:${colors}:${tolerance}:${outlined}`;
  /** The token's framing, if the DM moved it, for the art as it was then. */
  const [crop, setCrop] = useState<{ settings: string; crop: Crop } | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => dialog.current?.focus(), []);

  const made = useMemo(() => {
    const options = { height, colors, outline: outlined };
    const frontArt = pixelArt(removeBackground(front.pixels, tolerance), options);
    const backArt = back ? pixelArt(removeBackground(back.pixels, tolerance), options) : null;
    if (!hasPixels(frontArt) || (backArt && !hasPixels(backArt))) return null;
    const sheet = stillSheet(frontArt, backArt ?? undefined);
    const size = sheet.layout.frameSize;
    // Where the front stands in its frame: the token's starting framing is its head.
    const box = { x: Math.floor((size - frontArt.width) / 2), y: size - frontArt.height, width: frontArt.width, height: frontArt.height };
    return { frontArt, backArt, sheet, canvas: toCanvas(sheet.image), head: headCrop(box) };
  }, [front, back, height, colors, tolerance, outlined]);
  const tokenCrop = made ? (crop?.settings === settings ? crop.crop : made.head) : null;

  async function chooseBack(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      setBack(await loadPicture(file));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function use() {
    if (!made || !tokenCrop) return;
    const { image, layout } = made.sheet;
    onUse({ image: { dataUrl: made.canvas.toDataURL('image/png'), width: image.width, height: image.height }, layout, token: makeToken(made.canvas, tokenCrop) });
  }

  return createPortal(
    <div className="picker-backdrop">
      <div
        ref={dialog}
        className="panel picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Make a character"
        tabIndex={-1}
        onKeyDown={(event) => event.key === 'Escape' && onCancel()}
      >
        <div className="picker-head">
          <h3>Make {name} from a picture</h3>
          <button type="button" aria-label="Close" title="Cancel" onClick={onCancel}>
            ×
          </button>
        </div>
        <p className="muted">
          The picture becomes pixel art with a breathing idle; walking, attacks, and the rest are acted out with simple motions. It faces you; add a back view for
          when it walks away.
        </p>
        <div className="row">
          <label>
            <span>Height: {height} pixels</span>
            <input type="range" min={16} max={128} step={4} value={height} onChange={(event) => setHeight(Number(event.target.value))} />
          </label>
          <label>
            <span>Colours: {colors}</span>
            <input type="range" min={2} max={32} value={colors} onChange={(event) => setColors(Number(event.target.value))} />
          </label>
          <label>
            <span>Background removal: {tolerance}</span>
            <input type="range" min={0} max={120} value={tolerance} onChange={(event) => setTolerance(Number(event.target.value))} />
          </label>
          <label className="check">
            <input type="checkbox" checked={outlined} onChange={(event) => setOutlined(event.target.checked)} />
            <span>Outline</span>
          </label>
        </div>
        <div className="row">
          <label className="file-button">
            <span>{back ? 'Change back view' : 'Add a back view'}</span>
            <input type="file" accept="image/*" aria-label="Back view picture" onChange={(event) => void chooseBack(event)} />
          </label>
          {back && (
            <button type="button" onClick={() => setBack(null)}>
              Remove back view
            </button>
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {made ? (
          <div className="row sheet-previews one-picture">
            <PixelImage image={made.frontArt} label="Pixel art, front" />
            {made.backArt && <PixelImage image={made.backArt} label="Pixel art, back" />}
            <div className="token-choice">
              <Preview source={made.canvas} layout={made.sheet.layout} clip="idle" direction={facing} />
              {made.backArt && (
                <label>
                  <span>Facing</span>
                  <select value={facing} onChange={(event) => setFacing(event.target.value as 'down' | 'up')}>
                    <option value="down">toward you</option>
                    <option value="up">away</option>
                  </select>
                </label>
              )}
            </div>
            {tokenCrop && (
              <TokenEditor source={made.canvas} crop={tokenCrop} base={made.head.size} onChange={(next) => setCrop({ settings, crop: next })} />
            )}
          </div>
        ) : (
          <p className="field-error">Nothing is left once the background is taken away: turn background removal down.</p>
        )}
        <div className="row">
          <button type="button" className="primary" disabled={!made} onClick={use}>
            Use for {name}
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
