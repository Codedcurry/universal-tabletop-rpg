import { type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CharacterArt, ImageAsset } from '@shared/style/art';
import {
  type PaintScope,
  type Rgba,
  colorAt,
  fill,
  frameLabel,
  framesInScope,
  fromHex,
  paint,
  replaceColor,
  sheetColors,
  sheetFrames,
  toHex,
} from '@shared/style/paint';
import type { Image } from '@shared/style/pixelate';
import { Preview, type Sheet } from './spritePreview';

// The mini pixel editor: touch-ups on a character's finished sheet, one
// frame at a time, zoomed. Pencil, eraser, fill, colour picker, and colour
// replace (a quick recolour); a stroke can land on just this frame, every
// frame of its animation, or every frame (they're lined up by the feet, so
// fixing an eye fixes it everywhere). Undo and redo; previewed as it plays.

type Tool = 'pencil' | 'eraser' | 'fill' | 'pick' | 'replace';

const TOOLS: readonly { id: Tool; label: string }[] = [
  { id: 'pencil', label: 'Pencil' },
  { id: 'eraser', label: 'Eraser' },
  { id: 'fill', label: 'Fill' },
  { id: 'pick', label: 'Pick colour' },
  { id: 'replace', label: 'Replace colour' },
];

const CLEAR: Rgba = [0, 0, 0, 0];
/** How many undo steps are kept. */
const HISTORY = 50;
/** How big the frame being painted is shown, at most. */
const CANVAS_PX = 384;

function toCanvas(image: Image): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  (canvas.getContext('2d') as CanvasRenderingContext2D).putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  return canvas;
}

export function PixelEditor({
  sheet,
  character,
  name,
  note,
  onSave,
  onCancel,
}: {
  sheet: Sheet;
  character: CharacterArt;
  name: string;
  /** Anything the DM should know first (shown under the title). */
  note?: string;
  onSave: (image: ImageAsset) => void;
  onCancel: () => void;
}) {
  const { layout } = character;
  const size = layout.frameSize;
  const frames = useMemo(() => sheetFrames(layout), [layout]);
  const [image, setImage] = useState<Image>(() => ({ width: sheet.pixels.width, height: sheet.pixels.height, data: new Uint8ClampedArray(sheet.pixels.data) }));
  const [undo, setUndo] = useState<Image[]>([]);
  const [redo, setRedo] = useState<Image[]>([]);
  const [frameAt, setFrameAt] = useState(0);
  const [tool, setTool] = useState<Tool>('pencil');
  const [color, setColor] = useState<Rgba>(() => sheetColors(sheet.pixels, 1)[0] ?? [0, 0, 0, 255]);
  const [scope, setScope] = useState<PaintScope>('frame');
  const frame = frames[frameAt] ?? frames[0]!;
  const zoom = Math.max(2, Math.min(24, Math.floor(CANVAS_PX / size)));
  const colors = useMemo(() => sheetColors(image), [image]);
  const source = useMemo(() => toCanvas(image), [image]);

  const canvas = useRef<HTMLCanvasElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  /** The pixel last painted in this stroke (so dragging over it doesn't paint it again). */
  const stroke = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => dialog.current?.focus(), []);

  // The frame, zoomed, with a grid when the pixels are big enough to see it.
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size * zoom, size * zoom);
    ctx.drawImage(source, frame.column * size, frame.row * size, size, size, 0, 0, size * zoom, size * zoom);
    if (zoom >= 8) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let at = 0; at <= size; at++) {
        ctx.moveTo(at * zoom + 0.5, 0);
        ctx.lineTo(at * zoom + 0.5, size * zoom);
        ctx.moveTo(0, at * zoom + 0.5);
        ctx.lineTo(size * zoom, at * zoom + 0.5);
      }
      ctx.stroke();
    }
  }, [source, frame, size, zoom]);

  /** Keeps the current image for undo, and starts a new future. */
  function change(next: Image) {
    setUndo((past) => [...past.slice(-(HISTORY - 1)), image]);
    setRedo([]);
    setImage(next);
  }

  function step(back: boolean) {
    const from = back ? undo : redo;
    const last = from[from.length - 1];
    if (!last) return;
    (back ? setUndo : setRedo)(from.slice(0, -1));
    (back ? setRedo : setUndo)((other) => [...other, image]);
    setImage(last);
  }

  /** The pixel under the pointer, within the frame. */
  function pixelAt(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.floor(((event.clientX - rect.left) / rect.width) * size),
      y: Math.floor(((event.clientY - rect.top) / rect.height) * size),
    };
  }

  function down(event: PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0) return;
    const { x, y } = pixelAt(event);
    const targets = framesInScope(frames, frame, scope);
    const here = colorAt(image, frame.column * size + x, frame.row * size + y);
    if (tool === 'pick') {
      if (here[3] > 0) setColor(here);
      return;
    }
    if (tool === 'fill') return change(fill(image, size, targets, x, y, color));
    if (tool === 'replace') return change(replaceColor(image, size, targets, here, color));
    event.currentTarget.setPointerCapture(event.pointerId);
    stroke.current = { x, y };
    change(paint(image, size, targets, x, y, tool === 'eraser' ? CLEAR : color));
  }

  function move(event: PointerEvent<HTMLCanvasElement>) {
    const last = stroke.current;
    if (!last) return;
    const { x, y } = pixelAt(event);
    if (x === last.x && y === last.y) return;
    stroke.current = { x, y };
    // The rest of a stroke is one undo step: it paints over the image without saving it again.
    setImage((now) => paint(now, size, framesInScope(frames, frame, scope), x, y, tool === 'eraser' ? CLEAR : color));
  }

  function save() {
    onSave({ dataUrl: source.toDataURL('image/png'), width: image.width, height: image.height });
  }

  return createPortal(
    <div className="picker-backdrop">
      <div
        ref={dialog}
        className="panel picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Paint"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
          const mod = event.ctrlKey || event.metaKey;
          if (mod && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            step(!event.shiftKey);
          }
          if (mod && event.key.toLowerCase() === 'y') {
            event.preventDefault();
            step(false);
          }
        }}
      >
        <div className="picker-head">
          <h3>Paint {name}</h3>
          <button type="button" aria-label="Close" title="Cancel" onClick={onCancel}>
            ×
          </button>
        </div>
        {note && <p className="muted">{note}</p>}

        <div className="frame-strip" role="group" aria-label="Frames">
          {frames.map((entry, index) => (
            <button key={`${entry.row}:${entry.column}`} type="button" className="small" aria-pressed={index === frameAt} onClick={() => setFrameAt(index)}>
              {frameLabel(entry, frames)}
            </button>
          ))}
        </div>

        <div className="row">
          <div className="segmented" role="group" aria-label="Tool">
            {TOOLS.map((entry) => (
              <button key={entry.id} type="button" aria-pressed={tool === entry.id} onClick={() => setTool(entry.id)}>
                {entry.label}
              </button>
            ))}
          </div>
          <label>
            <span>Colour</span>
            <input type="color" value={toHex(color)} onChange={(event) => setColor(fromHex(event.target.value))} />
          </label>
          <label>
            <span>Paint on</span>
            <select value={scope} onChange={(event) => setScope(event.target.value as PaintScope)}>
              <option value="frame">this frame only</option>
              <option value="animation">every {frame.clip} frame</option>
              <option value="all">every frame</option>
            </select>
          </label>
          <button type="button" disabled={undo.length === 0} onClick={() => step(true)} title="Ctrl+Z">
            Undo
          </button>
          <button type="button" disabled={redo.length === 0} onClick={() => step(false)} title="Ctrl+Y">
            Redo
          </button>
        </div>

        <div className="swatches" role="group" aria-label="Colours on the sheet">
          {colors.map((entry) => (
            <button
              key={toHex(entry)}
              type="button"
              className="swatch"
              aria-label={`Colour ${toHex(entry)}`}
              aria-pressed={toHex(entry) === toHex(color)}
              style={{ background: toHex(entry) }}
              onClick={() => setColor(entry)}
            />
          ))}
        </div>

        <div className="row sheet-previews">
          <canvas
            ref={canvas}
            className="paint-canvas"
            width={size * zoom}
            height={size * zoom}
            role="img"
            aria-label={`${frameLabel(frame, frames)}, to paint`}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={() => (stroke.current = null)}
            onPointerCancel={() => (stroke.current = null)}
          />
          <Preview source={source} layout={layout} clip={frame.clip} direction="down" />
        </div>

        <div className="row">
          <button type="button" className="primary" onClick={save}>
            Save
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
