import { useEffect, useRef } from 'react';
import type { Clip } from '@shared/anim';
import type { SpriteDirection } from '@shared/camera';
import type { ImageAsset } from '@shared/style/art';
import { type SheetLayout, frameAt, portraitRect } from '@shared/style/sheet';

// What both character importers share: reading a sprite sheet image, cutting
// a round token from its portrait, and previewing an animation.

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
export function makeToken(source: CanvasImageSource, layout: SheetLayout): ImageAsset {
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
  ctx.drawImage(source, x, y, size, size, 0, 0, TOKEN_SIZE, TOKEN_SIZE);
  ctx.restore();
  ctx.strokeStyle = '#e0b44c';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(TOKEN_SIZE / 2, TOKEN_SIZE / 2, TOKEN_SIZE / 2 - 2, 0, Math.PI * 2);
  ctx.stroke();
  return { dataUrl: canvas.toDataURL('image/png'), width: TOKEN_SIZE, height: TOKEN_SIZE };
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
