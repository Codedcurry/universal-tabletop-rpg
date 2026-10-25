import { useEffect, useRef } from 'react';
import type { Clip } from '@shared/anim';
import type { SpriteDirection } from '@shared/camera';
import type { ImageAsset } from '@shared/style/art';
import { DEFAULT_FPS, MAX_FPS, MIN_FPS, type SheetLayout, frameAt } from '@shared/style/sheet';

// What both character importers share: reading a sprite sheet image,
// framing and cutting a round token, setting animation speeds, and
// previewing an animation.

const PREVIEW_SIZE = 128;
const TOKEN_SIZE = 64;

export interface Sheet {
  readonly image: ImageAsset;
  readonly element: HTMLImageElement;
  readonly pixels: ImageData;
}

export function loadSheet(file: File): Promise<Sheet> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Couldn't read ${file.name}`));
    reader.onload = () => loadSheetUrl(String(reader.result), file.name).then(resolve, reject);
    reader.readAsDataURL(file);
  });
}

/** A sheet from an image's data URL (one already in the game, to edit). */
export function loadSheetUrl(dataUrl: string, name = 'The sheet'): Promise<Sheet> {
  return new Promise((resolve, reject) => {
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
    element.onerror = () => reject(new Error(`${name} isn't an image this browser can show`));
    element.src = dataUrl;
  });
}

/** The square of the sheet a round token shows, in sheet pixels. */
export interface Crop {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

/** A round token: the crop drawn into a circle with a gold rim. */
function drawToken(ctx: CanvasRenderingContext2D, source: CanvasImageSource, crop: Crop, px: number) {
  ctx.clearRect(0, 0, px, px);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#2a2539';
  ctx.beginPath();
  ctx.arc(px / 2, px / 2, px / 2 - 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.drawImage(source, crop.x, crop.y, crop.size, crop.size, 0, 0, px, px);
  ctx.restore();
  ctx.strokeStyle = '#e0b44c';
  ctx.lineWidth = (3 * px) / TOKEN_SIZE;
  ctx.beginPath();
  ctx.arc(px / 2, px / 2, px / 2 - (2 * px) / TOKEN_SIZE, 0, Math.PI * 2);
  ctx.stroke();
}

/** A round token image cut from a sheet. */
export function makeToken(source: CanvasImageSource, crop: Crop): ImageAsset {
  const canvas = document.createElement('canvas');
  canvas.width = TOKEN_SIZE;
  canvas.height = TOKEN_SIZE;
  drawToken(canvas.getContext('2d') as CanvasRenderingContext2D, source, crop, TOKEN_SIZE);
  return { dataUrl: canvas.toDataURL('image/png'), width: TOKEN_SIZE, height: TOKEN_SIZE };
}

/** The same crop, zoomed to a new size around its middle. */
function zoomed(crop: Crop, size: number): Crop {
  return { x: crop.x + (crop.size - size) / 2, y: crop.y + (crop.size - size) / 2, size };
}

/**
 * The round token, to frame by hand: drag to move the face, and zoom with
 * the slider or the mouse wheel. `base` is the starting size (100% zoom).
 */
export function TokenEditor({ source, crop, base, onChange }: { source: CanvasImageSource; crop: Crop; base: number; onChange: (crop: Crop) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; crop: Crop } | null>(null);
  // The wheel listener is attached once, so it reads the latest crop from here.
  const latest = useRef({ crop, onChange });
  latest.current = { crop, onChange };

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (ctx) drawToken(ctx, source, crop, PREVIEW_SIZE);
  }, [source, crop]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    // Not passive, so zooming the token doesn't scroll the page.
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const { crop: now, onChange: change } = latest.current;
      change(zoomed(now, Math.max(2, now.size * (event.deltaY > 0 ? 1.1 : 1 / 1.1))));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);

  return (
    <div className="token-editor">
      <canvas
        ref={canvas}
        width={PREVIEW_SIZE}
        height={PREVIEW_SIZE}
        role="img"
        aria-label="Round token"
        title="Drag to move the face; scroll to zoom"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, crop };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start) return;
          // Screen pixels to sheet pixels: the canvas shows crop.size sheet pixels across.
          const per = start.crop.size / event.currentTarget.getBoundingClientRect().width;
          onChange({ ...start.crop, x: start.crop.x - (event.clientX - start.x) * per, y: start.crop.y - (event.clientY - start.y) * per });
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      />
      <label>
        <span>Token zoom</span>
        <input type="range" min={25} max={400} step={5} value={Math.round((100 * base) / crop.size)} onChange={(event) => onChange(zoomed(crop, (base * 100) / Number(event.target.value)))} />
      </label>
    </div>
  );
}

/** How fast one animation plays, in frames a second. */
export function SpeedField({ clip, fps, onChange }: { clip: Clip; fps: number; onChange: (fps: number) => void }) {
  return (
    <label>
      <span>{clip} speed (frames a second)</span>
      <input type="number" min={MIN_FPS} max={MAX_FPS} value={fps} onChange={(event) => onChange(Math.min(MAX_FPS, Math.max(MIN_FPS, Number(event.target.value) || DEFAULT_FPS)))} />
    </label>
  );
}

/** A layout with the speeds set for its animations (left out where none are). */
export function withSpeeds(layout: SheetLayout, speeds: Readonly<Partial<Record<Clip, number>>>): SheetLayout {
  const fps = Object.fromEntries(Object.entries(speeds).filter(([clip, value]) => layout.clips[clip as Clip] && value !== DEFAULT_FPS));
  return Object.keys(fps).length > 0 ? { ...layout, fps } : layout;
}

/** The sheet playing one animation in one direction, frame by frame, scaled up crisply. */
export function Preview({ source, layout, clip, direction }: { source: CanvasImageSource; layout: SheetLayout; clip: Clip; direction: SpriteDirection }) {
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
        ctx.drawImage(source, at.column * size, at.row * size, size, size, 0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
        ctx.restore();
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [source, layout, clip, direction]);
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
