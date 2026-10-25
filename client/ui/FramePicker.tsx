import { type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CLIPS, type Clip } from '@shared/anim';
import { type CharacterArt, type ImageAsset, MAX_IMAGE_CHARS, MAX_IMAGE_SIDE } from '@shared/style/art';
import { type Box, type FrameCounts, VIEWS, type View, assembleLayout, clearBackground, findSprites, planCells, sheetRows } from '@shared/style/frames';
import { DEFAULT_FPS, type SheetLayout } from '@shared/style/sheet';
import { type Crop, Preview, type Sheet, SpeedField, TokenEditor, makeToken, withSpeeds } from './spritePreview';

// Building a character from any sprite sheet (sprites of any size, anywhere,
// one view, like a classic battle sheet), in a window that pops up when the
// sheet is chosen. Every sprite on it is found and boxed; for each animation
// in turn (and each view the sheet has: side, front, back) the DM drags a
// box around its frames (added left to right) or clicks them one at a time,
// and can set its speed. The frames are lined up by their feet in square
// cells and laid out as a standard sheet, the other side mirrored, and
// previewed before use. The token can be cut from any sprite, framed by
// dragging.

/** A drag shorter than this (in screen pixels) is a click. */
const DRAG_PX = 6;

interface Composed {
  readonly layout: SheetLayout;
  readonly image: ImageAsset;
  readonly canvas: HTMLCanvasElement;
}

/** Frames picked for each view and animation, as indexes of found sprites. */
type Picks = Partial<Record<View, Partial<Record<Clip, number[]>>>>;

const VIEW_LABELS: Record<View, string> = { side: 'side view', front: 'front view (facing you)', back: 'back view' };

/** Picked frames laid out as a standard sheet, or why they can't be. */
function compose(clean: HTMLCanvasElement, pixels: ImageData, sprites: readonly Box[], picks: Picks, faces: 'left' | 'right'): Composed | string {
  const counts: FrameCounts = Object.fromEntries(CLIPS.map((clip) => [clip, Object.fromEntries(VIEWS.map((view) => [view, picks[view]?.[clip]?.length ?? 0]))]));
  const rows = sheetRows(counts);
  const idle = rows.find((row) => row.clip === 'idle');
  if (!idle) return 'Pick at least one idle frame';
  const framesOf = (row: { clip: Clip; view: View }) => picks[row.view]?.[row.clip] ?? [];
  const boxes = rows.flatMap((row) => framesOf(row).map((index) => sprites[index]!));
  const { size, placements } = planCells(pixels, boxes);
  const columns = Math.max(...rows.map((row) => row.frames));
  if (size * columns > MAX_IMAGE_SIDE || size * rows.length > MAX_IMAGE_SIDE) {
    return `Too many frames for sprites this big: at most ${Math.floor(MAX_IMAGE_SIDE / size)} per animation, and ${Math.floor(MAX_IMAGE_SIDE / size)} animations and views in all`;
  }

  const canvas = document.createElement('canvas');
  canvas.width = size * columns;
  canvas.height = size * rows.length;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  let at = 0;
  rows.forEach((row, line) => {
    framesOf(row).forEach((index, column) => {
      const box = sprites[index]!;
      const { dx, dy } = placements[at++]!;
      ctx.drawImage(clean, box.x, box.y, box.width, box.height, column * size + dx, line * size + dy, box.width, box.height);
    });
  });

  // The standing pose's height is the body's, so weapons reaching out don't shrink the character.
  const body = Math.max(...framesOf(idle).map((index) => sprites[index]!.height));
  const layout = assembleLayout(counts, size, faces, body < size ? body : undefined);
  const dataUrl = canvas.toDataURL('image/png');
  if (dataUrl.length >= MAX_IMAGE_CHARS) return 'Too many frames: the finished sheet would be over about 500 KB';
  return { layout, image: { dataUrl, width: canvas.width, height: canvas.height }, canvas };
}

/** A token's starting framing for a sprite: the top of it, where the head usually is. */
function headCrop(box: Box): Crop {
  const size = Math.max(4, Math.round(Math.min(box.width, box.height) * 0.9));
  return { x: box.x + box.width / 2 - size / 2, y: box.y - size * 0.05, size };
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
  const [picks, setPicks] = useState<Picks>({});
  const [clip, setClip] = useState<Clip>('idle');
  const [view, setView] = useState<View>('side');
  const [faces, setFaces] = useState<'left' | 'right'>('left');
  const [speeds, setSpeeds] = useState<Partial<Record<Clip, number>>>({});
  /** The token's sprite and framing, once the DM chooses; until then, the first idle frame's head. */
  const [token, setToken] = useState<{ sprite: number; crop: Crop } | null>(null);
  /** Whether the next sprite clicked is for the token, not an animation. */
  const [choosingToken, setChoosingToken] = useState(false);
  const composed = useMemo(() => compose(clean, pixels, sprites, picks, faces), [clean, pixels, sprites, picks, faces]);
  const layout = useMemo(() => (typeof composed === 'string' ? null : withSpeeds(composed.layout, speeds)), [composed, speeds]);
  const current = picks[view]?.[clip] ?? [];
  const used = CLIPS.filter((entry) => VIEWS.some((other) => (picks[other]?.[entry]?.length ?? 0) > 0));
  const next = CLIPS[CLIPS.indexOf(clip) + 1];
  const count = (entry: Clip) => VIEWS.reduce((total, other) => total + (picks[other]?.[entry]?.length ?? 0), 0);
  // The token: the DM's choice, or the first idle frame (front view first, it shows the face).
  const tokenSprite = token?.sprite ?? picks.front?.idle?.[0] ?? picks.side?.idle?.[0] ?? picks.back?.idle?.[0] ?? (sprites.length > 0 ? 0 : null);
  const tokenCrop = token?.crop ?? (tokenSprite === null ? null : headCrop(sprites[tokenSprite]!));
  // The sheet as wide as the window allows, up to 4x.
  const scale = Math.min(4, Math.max(0.5, Math.min(window.innerWidth - 64, 1040) / sheet.image.width));

  const dialog = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [band, setBand] = useState<Box | null>(null);
  useEffect(() => dialog.current?.focus(), []);

  const setCurrent = (frames: number[]) => setPicks((all) => ({ ...all, [view]: { ...all[view], [clip]: frames } }));

  function pickSprite(index: number) {
    if (!choosingToken) {
      setCurrent([...current, index]);
      return;
    }
    setToken({ sprite: index, crop: headCrop(sprites[index]!) });
    setChoosingToken(false);
  }

  /** Where the pointer is on the sheet, in sheet pixels. */
  const sheetPoint = (event: PointerEvent) => {
    const rect = (area.current as HTMLDivElement).getBoundingClientRect();
    return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
  };

  function down(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || choosingToken) return;
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
        {choosingToken ? (
          <p className="picker-ask">
            Click the sprite to use for the <strong>token</strong>.
          </p>
        ) : (
          <p className="picker-ask">
            Drag a box around the <strong>{clip}</strong> frames ({VIEW_LABELS[view]}), left to right
            <span className="muted"> (or click them one at a time)</span>.
          </p>
        )}
        <p className="muted">
          {sprites.length} sprites found. Only idle is needed: skip any animation the sheet doesn&apos;t have. If it has front or back views too, pick those under View;
          without them, the side view stands in.
        </p>
        <div className="row">
          <label>
            <span>Animation</span>
            <select value={clip} onChange={(event) => setClip(event.target.value as Clip)}>
              {CLIPS.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                  {count(entry) > 0 ? ` (${count(entry)})` : ''}
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
            <span>View</span>
            <select value={view} onChange={(event) => setView(event.target.value as View)}>
              {VIEWS.map((entry) => (
                <option key={entry} value={entry}>
                  {VIEW_LABELS[entry]}
                  {picks[entry]?.[clip]?.length ? ` (${picks[entry]?.[clip]?.length})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>The side view faces</span>
            <select value={faces} onChange={(event) => setFaces(event.target.value as 'left' | 'right')}>
              <option value="left">left</option>
              <option value="right">right</option>
            </select>
          </label>
          <SpeedField clip={clip} fps={speeds[clip] ?? DEFAULT_FPS} onChange={(fps) => setSpeeds((all) => ({ ...all, [clip]: fps }))} />
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
            ref={area}
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
                aria-pressed={choosingToken ? index === tokenSprite : current.includes(index)}
                style={{ left: box.x * scale, top: box.y * scale, width: box.width * scale, height: box.height * scale }}
                onClick={() => pickSprite(index)}
              />
            ))}
            {band && (
              <div className="pick-band" style={{ left: band.x * scale, top: band.y * scale, width: band.width * scale, height: band.height * scale }} />
            )}
          </div>
        </div>
        {typeof composed === 'string' && <p className="field-error">{composed}</p>}
        <div className="row sheet-previews">
          {typeof composed !== 'string' && layout && (
            <Preview
              source={composed.canvas}
              layout={layout}
              clip={used.includes(clip) ? clip : 'idle'}
              direction={view === 'front' ? 'down' : view === 'back' ? 'up' : faces}
            />
          )}
          {tokenCrop && tokenSprite !== null && (
            <div className="token-choice">
              <TokenEditor source={clean} crop={tokenCrop} base={headCrop(sprites[tokenSprite]!).size} onChange={(crop) => setToken({ sprite: tokenSprite, crop })} />
              <button type="button" className="small" aria-pressed={choosingToken} onClick={() => setChoosingToken((on) => !on)}>
                {choosingToken ? 'Cancel choosing' : 'Choose token frame'}
              </button>
            </div>
          )}
          {layout && (
            <p className="muted grow">
              {layout.frameSize}-pixel frames · animations: {used.join(', ')}
            </p>
          )}
        </div>
        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={!layout || typeof composed === 'string'}
            onClick={() => layout && typeof composed !== 'string' && onUse({ image: composed.image, layout, token: tokenCrop ? makeToken(clean, tokenCrop) : null })}
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
