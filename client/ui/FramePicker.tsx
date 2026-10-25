import { useMemo, useState } from "react";
import { CLIPS, type Clip } from "@shared/anim";
import {
  type CharacterArt,
  type ImageAsset,
  MAX_IMAGE_CHARS,
  MAX_IMAGE_SIDE,
} from "@shared/style/art";
import {
  assembleLayout,
  clearBackground,
  findSprites,
  planCells,
} from "@shared/style/frames";
import type { SheetLayout } from "@shared/style/sheet";
import { Preview, type Sheet, makeToken } from "./spritePreview";

// Building a character from any sprite sheet (sprites of any size, anywhere,
// one view, like a classic battle sheet): every sprite on it is found and
// shown as a box to click; for each animation the DM clicks its frames in
// order. The frames are lined up by their feet in square cells and laid out
// as a standard sheet, the other side mirrored, and previewed before use.

interface Composed {
  readonly layout: SheetLayout;
  readonly image: ImageAsset;
  readonly canvas: HTMLCanvasElement;
  readonly token: ImageAsset;
}

/** Picked frames (indexes of found sprites) laid out as a standard sheet, or why they can't be. */
function compose(
  clean: HTMLCanvasElement,
  pixels: ImageData,
  sprites: ReturnType<typeof findSprites>,
  picks: Partial<Record<Clip, number[]>>,
  faces: "left" | "right",
): Composed | string {
  const idle = picks.idle ?? [];
  if (idle.length === 0) return "Pick at least one idle frame";
  const used = CLIPS.filter((clip) => (picks[clip]?.length ?? 0) > 0);
  const boxes = used.flatMap((clip) =>
    (picks[clip] ?? []).map((index) => sprites[index]!),
  );
  const { size, placements } = planCells(pixels, boxes);
  const columns = Math.max(...used.map((clip) => picks[clip]?.length ?? 0));
  if (size * columns > MAX_IMAGE_SIDE || size * used.length > MAX_IMAGE_SIDE) {
    return `Too many frames for sprites this big: at most ${Math.floor(MAX_IMAGE_SIDE / size)} per animation`;
  }

  const canvas = document.createElement("canvas");
  canvas.width = size * columns;
  canvas.height = size * used.length;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  let at = 0;
  used.forEach((clip, row) => {
    (picks[clip] ?? []).forEach((index, column) => {
      const box = sprites[index]!;
      const { dx, dy } = placements[at++]!;
      ctx.drawImage(
        clean,
        box.x,
        box.y,
        box.width,
        box.height,
        column * size + dx,
        row * size + dy,
        box.width,
        box.height,
      );
    });
  });

  // The standing pose's height is the body's, so weapons reaching out don't shrink the character.
  const body = Math.max(...idle.map((index) => sprites[index]!.height));
  const layout = assembleLayout(
    Object.fromEntries(used.map((clip) => [clip, picks[clip]?.length ?? 0])),
    size,
    faces,
    body < size ? body : undefined,
  );
  const dataUrl = canvas.toDataURL("image/png");
  if (dataUrl.length >= MAX_IMAGE_CHARS)
    return "Too many frames: the finished sheet would be over about 500 KB";
  return {
    layout,
    image: { dataUrl, width: canvas.width, height: canvas.height },
    canvas,
    token: makeToken(canvas, layout),
  };
}

export function FramePicker({
  sheet,
  name,
  onUse,
  onCancel,
}: {
  sheet: Sheet;
  name: string;
  onUse: (character: CharacterArt) => void;
  onCancel: () => void;
}) {
  // The sheet with any solid background cleared: to find the sprites on, show, and copy from.
  const { clean, cleanUrl, pixels, sprites } = useMemo(() => {
    const { width, height } = sheet.pixels;
    const cleared = clearBackground({ width, height, data: sheet.pixels.data });
    const pixels = new ImageData(
      new Uint8ClampedArray(cleared.data),
      width,
      height,
    );
    const clean = document.createElement("canvas");
    clean.width = width;
    clean.height = height;
    (clean.getContext("2d") as CanvasRenderingContext2D).putImageData(
      pixels,
      0,
      0,
    );
    return {
      clean,
      cleanUrl: clean.toDataURL("image/png"),
      pixels,
      sprites: findSprites(pixels),
    };
  }, [sheet]);
  const [picks, setPicks] = useState<Partial<Record<Clip, number[]>>>(() =>
    sprites.length > 0 ? { idle: [0] } : {},
  );
  const [clip, setClip] = useState<Clip>("idle");
  const [faces, setFaces] = useState<"left" | "right">("left");
  const composed = useMemo(
    () => compose(clean, pixels, sprites, picks, faces),
    [clean, pixels, sprites, picks, faces],
  );
  const current = picks[clip] ?? [];
  const used = CLIPS.filter((entry) => (picks[entry]?.length ?? 0) > 0);
  // Big enough to click on, scrolling if the sheet is wide.
  const scale = Math.max(1, Math.min(4, Math.floor(1024 / sheet.image.width)));

  const setCurrent = (frames: number[]) =>
    setPicks((all) => ({ ...all, [clip]: frames }));

  return (
    <fieldset className="panel sheet-import" aria-label="Pick frames">
      <legend>Pick frames for {name}</legend>
      <p className="muted">
        {sprites.length} sprites found. Choose an animation, then click its
        frames on the sheet, in order. Only idle is needed.
      </p>
      <div className="row">
        <label>
          <span>Animation</span>
          <select
            value={clip}
            onChange={(event) => setClip(event.target.value as Clip)}
          >
            {CLIPS.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
                {picks[entry]?.length ? ` (${picks[entry]?.length})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>The sprites face</span>
          <select
            value={faces}
            onChange={(event) =>
              setFaces(event.target.value as "left" | "right")
            }
          >
            <option value="left">left</option>
            <option value="right">right</option>
          </select>
        </label>
      </div>
      <div className="frame-strip">
        {current.length === 0 ? (
          <span className="muted">
            No {clip} frames yet: click sprites on the sheet.
          </span>
        ) : (
          current.map((index, at) => (
            <button
              key={at}
              type="button"
              className="small"
              aria-label={`Remove frame ${at + 1}`}
              title="Remove this frame"
              onClick={() =>
                setCurrent(current.filter((_, other) => other !== at))
              }
            >
              {at + 1}: #{index + 1} ×
            </button>
          ))
        )}
        {current.length > 0 && (
          <button
            type="button"
            className="small"
            onClick={() => setCurrent([])}
          >
            Clear
          </button>
        )}
      </div>
      <div className="sprite-sheet-view">
        <div
          style={{
            position: "relative",
            width: sheet.image.width * scale,
            height: sheet.image.height * scale,
          }}
        >
          <img
            src={cleanUrl}
            alt=""
            width={sheet.image.width * scale}
            height={sheet.image.height * scale}
          />
          {sprites.map((box, index) => (
            <button
              key={index}
              type="button"
              className="sprite-box"
              aria-label={`Sprite ${index + 1}`}
              aria-pressed={current.includes(index)}
              style={{
                left: box.x * scale,
                top: box.y * scale,
                width: box.width * scale,
                height: box.height * scale,
              }}
              onClick={() => setCurrent([...current, index])}
            />
          ))}
        </div>
      </div>
      {typeof composed === "string" ? (
        <p className="field-error">{composed}</p>
      ) : (
        <div className="row sheet-previews">
          <Preview
            source={composed.canvas}
            layout={composed.layout}
            clip={current.length > 0 ? clip : "idle"}
            direction={faces}
          />
          <img
            src={composed.token.dataUrl}
            alt="Round token"
            className="token-preview"
          />
          <p className="muted grow">
            {composed.layout.frameSize}-pixel frames · animations:{" "}
            {used.join(", ")}
          </p>
        </div>
      )}
      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={typeof composed === "string"}
          onClick={() =>
            typeof composed !== "string" &&
            onUse({
              image: composed.image,
              layout: composed.layout,
              token: composed.token,
            })
          }
        >
          Use for {name}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </fieldset>
  );
}
