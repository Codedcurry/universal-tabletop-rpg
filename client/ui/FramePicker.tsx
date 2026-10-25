import { type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CLIPS, type Clip } from '@shared/anim';
import { type CharacterArt, type ImageAsset, MAX_IMAGE_CHARS, MAX_IMAGE_SIDE } from '@shared/style/art';
import { type Box, assembleLayout, clearBackground, findSprites, planCells } from '@shared/style/frames';
import type { SheetLayout } from '@shared/style/sheet';
import { Preview, type Sheet, makeToken } from './spritePreview';

// Building a character from any sprite sheet (sprites of any size, anywhere,
// one view, like a classic battle sheet), in a window that pops up when the
// sheet is chosen. Every sprite on it is found and boxed; for each animation
// in turn the DM drags a box around its frames (added left to right) or
// clicks them one at a time. The frames are lined up by their feet in square
// cells and laid out as a standard sheet, the other side mirrored, and
// previewed before use.

/** A drag shorter than this (in screen pixels) is a click. */
const DRAG_PX = 6;

interface Composed {
  readonly layout: SheetLayout;
  readonly image: ImageAsset;
  readonly canvas: HTMLCanvasElement;
  readonly token: ImageAsset;
}

/** Picked frames (indexes of found sprites) laid out as a standard sheet, or why they can't be. */
function compose(clean: HTMLCanvasElement, pixels: ImageData, sprites: readonly Box[], picks: Partial<Record<Clip, number[]>>, faces: 'left' | 'right'): Composed | string {
  const idle = picks.idle ?? [];
  if (idle.length === 0) return 'Pick at least one idle frame';
  const used = CLIPS.filter((clip) => (picks[clip]?.length ?? 0) > 0);
  const boxes = used.flatMap((clip) => (picks[clip] ?? []).map((index) => sprites[index]!));
  const { size, placements } = planCells(pixels, boxes);
  const columns = Math.max(...used.map((clip) => picks[clip]?.length ?? 0));
  if (size * columns > MAX_IMAGE_SIDE || size * used.length > MAX_IMAGE_SIDE) {
    return `Too many frames for sprites this big: at most ${Math.floor(MAX_IMAGE_SIDE / size)} per animation`;
  }

  const canvas = document.createElement('canvas');
  canvas.width = size * columns;
  canvas.height = size * used.length;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  let at = 0;
  used.forEach((clip, row) => {
    (picks[clip] ?? []).forEach((index, column) => {
      const box = sprites[index]!;
      const { dx, dy } = placements[at++]!;
      ctx.drawImage(clean, box.x, box.y, box.width, box.height, column * size + dx, row * size + dy, box.width, box.height);
    });
  });

  // The standing pose's height is the body's, so weapons reaching out don't shrink the character.
  const body = Math.max(...idle.map((index) => sprites[index]!.height));
  const layout = assembleLayout(Object.fromEntries(used.map((clip) => [clip, picks[clip]?.length ?? 0])), size, faces, body < size ? body : undefined);
  const dataUrl = canvas.toDataURL('image/png');
  if (dataUrl.length >= MAX_IMAGE_CHARS) return 'Too many frames: the finished sheet would be over about 500 KB';
  return { layout, image: { dataUrl, width: canvas.width, height: canvas.height }, canvas, token: makeToken(canvas, layout) };
}

/** The box between two corners. */
function between(a: { x: number; y: number }, b: { x: number; y: number }): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export function FramePicker({ sheet, name, onUse, onCancel }: { sheet: Sheet; name: string; onUse: (character: CharacterArt) => void; onCancel: () => void }) {
  // The sheet with any solid background cleared: to find the sprites on, show, and copy from.
  const { clean, cleanUrl, pixels, sprites } = useMemo(() => {
    const { width, height } = sheet.pixels;
    const cleared = clearBackground({ width, height, data: sheet.pixels.data });
    const pixels = new ImageData(new Uint8ClampedArray(cleared.data), width, height);
    const clean = document.createElement('canvas');
    clean.width = width;
    clean.height = height;
    (clean.getContext('2d') as CanvasRenderingContext2D).putImageData(pixels, 0, 0);
    return { clean, cleanUrl: clean.toDataURL('image/png'), pixels, sprites: findSprites(pixels) };
  }, [sheet]);
  const [picks, setPicks] = useState<Partial<Record<Clip, number[]>>>({});
  const [clip, setClip] = useState<Clip>('idle');
  const [faces, setFaces] = useState<'left' | 'right'>('left');
  const composed = useMemo(() => compose(clean, pixels, sprites, picks, faces), [clean, pixels, sprites, picks, faces]);
  const current = picks[clip] ?? [];
  const used = CLIPS.filter((entry) => (picks[entry]?.length ?? 0) > 0);
  const next = CLIPS[CLIPS.indexOf(clip) + 1];
  // The sheet as wide as the window allows, up to 4x.
  const scale = Math.min(4, Math.max(0.5, Math.min(window.innerWidth - 64, 1040) / sheet.image.width));

  const dialog = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [band, setBand] = useState<Box | null>(null);
  useEffect(() => dialog.current?.focus(), []);

  const setCurrent = (frames: number[]) => setPicks((all) => ({ ...all, [clip]: frames }));

  /** Where the pointer is on the sheet, in sheet pixels. */
  const sheetPoint = (event: PointerEvent) => {
    const rect = (view.current as HTMLDivElement).getBoundingClientRect();
    return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
  };

  function down(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    drag.current = { ...sheetPoint(event), moved: false };
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start) return;
    const point = sheetPoint(event);
    if (!start.moved) {
      if (Math.hypot(point.x - start.x, point.y - start.y) * scale < DRAG_PX) return;
      // A drag, not a click: keep following it past the sheet's edge.
      start.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setBand(between(start, point));
  }

  function up(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    drag.current = null;
    setBand(null);
    if (!start?.moved) return;
    // Every sprite whose middle is in the box, in reading order: left to right (row by row).
    const box = between(start, sheetPoint(event));
    const inside = sprites.flatMap((sprite, index) => {
      const x = sprite.x + sprite.width / 2;
      const y = sprite.y + sprite.height / 2;
      return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height ? [index] : [];
    });
    if (inside.length > 0) setCurrent([...current, ...inside]);
  }

  return createPortal(
    <div className="picker-backdrop">
      <div
        ref={dialog}
        className="panel picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Pick frames"
        tabIndex={-1}
        onKeyDown={(event) => event.key === 'Escape' && onCancel()}
      >
        <div className="picker-head">
          <h3>Pick frames for {name}</h3>
          <button type="button" aria-label="Close" title="Cancel" onClick={onCancel}>
            ×
          </button>
        </div>
        <p className="picker-ask">
          Drag a box around the <strong>{clip}</strong> frames, left to right
          <span className="muted"> (or click them one at a time)</span>.
        </p>
        <p className="muted">{sprites.length} sprites found. Only idle is needed: skip any animation the sheet doesn&apos;t have.</p>
        <div className="row">
          <label>
            <span>Animation</span>
            <select value={clip} onChange={(event) => setClip(event.target.value as Clip)}>
              {CLIPS.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                  {picks[entry]?.length ? ` (${picks[entry]?.length})` : ''}
                </option>
              ))}
            </select>
          </label>
          {next && (
            <button type="button" onClick={() => setClip(next)}>
              Next: {next}
            </button>
          )}
          <label>
            <span>The sprites face</span>
            <select value={faces} onChange={(event) => setFaces(event.target.value as 'left' | 'right')}>
              <option value="left">left</option>
              <option value="right">right</option>
            </select>
          </label>
        </div>
        <div className="frame-strip">
          {current.length === 0 ? (
            <span className="muted">No {clip} frames yet.</span>
          ) : (
            current.map((index, at) => (
              <button
                key={at}
                type="button"
                className="small"
                aria-label={`Remove frame ${at + 1}`}
                title="Remove this frame"
                onClick={() => setCurrent(current.filter((_, other) => other !== at))}
              >
                {at + 1}: #{index + 1} ×
              </button>
            ))
          )}
          {current.length > 0 && (
            <button type="button" className="small" onClick={() => setCurrent([])}>
              Clear
            </button>
          )}
        </div>
        <div className="sprite-sheet-view">
          <div
            ref={view}
            className="sprite-sheet-area"
            style={{ width: sheet.image.width * scale, height: sheet.image.height * scale }}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={() => {
              drag.current = null;
              setBand(null);
            }}
          >
            <img src={cleanUrl} alt="" width={sheet.image.width * scale} height={sheet.image.height * scale} draggable={false} />
            {sprites.map((box, index) => (
              <button
                key={index}
                type="button"
                className="sprite-box"
                aria-label={`Sprite ${index + 1}`}
                aria-pressed={current.includes(index)}
                style={{ left: box.x * scale, top: box.y * scale, width: box.width * scale, height: box.height * scale }}
                onClick={() => setCurrent([...current, index])}
              />
            ))}
            {band && (
              <div className="pick-band" style={{ left: band.x * scale, top: band.y * scale, width: band.width * scale, height: band.height * scale }} />
            )}
          </div>
        </div>
        {typeof composed === 'string' ? (
          <p className="field-error">{composed}</p>
        ) : (
          <div className="row sheet-previews">
            <Preview source={composed.canvas} layout={composed.layout} clip={current.length > 0 ? clip : 'idle'} direction={faces} />
            <img src={composed.token.dataUrl} alt="Round token" className="token-preview" />
            <p className="muted grow">
              {composed.layout.frameSize}-pixel frames · animations: {used.join(', ')}
            </p>
          </div>
        )}
        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={typeof composed === 'string'}
            onClick={() => typeof composed !== 'string' && onUse({ image: composed.image, layout: composed.layout, token: composed.token })}
          >
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
