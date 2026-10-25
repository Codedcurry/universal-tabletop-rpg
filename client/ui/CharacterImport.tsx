import { type ChangeEvent, useMemo, useState } from "react";
import { CLIPS, type Clip } from "@shared/anim";
import type { SpriteDirection } from "@shared/camera";
import type { HostSession } from "@shared/net";
import {
  type ImageAsset,
  MAX_IMAGE_CHARS,
  MAX_IMAGE_SIDE,
} from "@shared/style/art";
import {
  SHEET_DIRECTIONS,
  type SheetLayout,
  guessFrameSize,
  sliceSheet,
} from "@shared/style/sheet";
import { FramePicker } from "./FramePicker";
import { Preview, type Sheet, loadSheet, makeToken } from "./spritePreview";

// Importing a character's sprite sheet in the Art tab: choose who it's for
// (a kind of monster, or one creature), pick the PNG, and the sheet is
// sliced (frame size guessed, frames counted per row), previewed playing
// any animation in any direction, with friendly warnings and a round token
// cut from the portrait, before it's used. A sheet that isn't laid out that
// way (sprites of any size, anywhere) goes to the frame picker instead.

interface Sliced {
  readonly layout: SheetLayout;
  readonly warnings: readonly string[];
  readonly token: ImageAsset;
}
export interface ArtTarget {
  /** The art key: a monster kind ("goblin") or one creature's id. */
  readonly key: string;
  readonly label: string;
  /** The short name for the button ("Use for Goblin"). */
  readonly name: string;
}

export function CharacterImport({
  session,
  targets,
}: {
  session: HostSession;
  targets: readonly ArtTarget[];
}) {
  const art = session.snapshot().art;
  const [targetKey, setTargetKey] = useState(targets[0]?.key ?? "");
  const [sheet, setSheet] = useState<Sheet | null>(null);
  /** A free-form sheet, open in the frame picker. */
  const [picking, setPicking] = useState<Sheet | null>(null);
  const [frameSize, setFrameSize] = useState(32);
  const [clip, setClip] = useState<Clip>("idle");
  const [direction, setDirection] = useState<SpriteDirection>("down");
  const [error, setError] = useState<string | null>(null);
  const target = targets.find((entry) => entry.key === targetKey) ?? targets[0];

  // Slicing follows the frame size, which starts from a guess and can be changed.
  const { sliced, sliceError } = useMemo((): {
    sliced: Sliced | null;
    sliceError: string | null;
  } => {
    if (!sheet) return { sliced: null, sliceError: null };
    try {
      const { layout, warnings } = sliceSheet(sheet.pixels, frameSize);
      return {
        sliced: { layout, warnings, token: makeToken(sheet.element, layout) },
        sliceError: null,
      };
    } catch (caught) {
      return {
        sliced: null,
        sliceError: caught instanceof Error ? caught.message : String(caught),
      };
    }
  }, [sheet, frameSize]);
  const clips = sliced
    ? (CLIPS.filter((entry) => sliced?.layout.clips[entry]) as Clip[])
    : [];

  async function choose(
    event: ChangeEvent<HTMLInputElement>,
    mode: "grid" | "pick",
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const loaded = await loadSheet(file);
      if (loaded.image.dataUrl.length >= MAX_IMAGE_CHARS)
        throw new Error(
          `${file.name} is too big: keep sprite sheets under about 500 KB`,
        );
      if (
        loaded.image.width > MAX_IMAGE_SIDE ||
        loaded.image.height > MAX_IMAGE_SIDE
      )
        throw new Error(
          `${file.name} is too large: at most ${MAX_IMAGE_SIDE} pixels across`,
        );
      setError(null);
      if (mode === "pick") {
        setSheet(null);
        setPicking(loaded);
        return;
      }
      setPicking(null);
      setFrameSize(
        guessFrameSize(
          loaded.image.width,
          loaded.image.height,
          loaded.pixels,
        ) ?? 32,
      );
      setClip("idle");
      setDirection("down");
      setSheet(loaded);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function apply(
    key: string,
    character: Parameters<HostSession["setCharacterArt"]>[1],
  ) {
    try {
      session.setCharacterArt(key, character);
      setSheet(null);
      setPicking(null);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  const withArt = Object.keys(art.characters);

  return (
    <div className="character-import">
      <p className="muted">
        A sprite sheet: square frames, 4 rows per animation (facing down, left,
        right, up), idle first. Only idle is needed: missing animations are
        acted out with simple motions. Any other sheet (sprites of any size,
        anywhere): pick its frames yourself.
      </p>
      <div className="row">
        <label className="grow">
          <span>Character</span>
          <select
            value={target?.key ?? ""}
            onChange={(event) => setTargetKey(event.target.value)}
          >
            {targets.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label className="file-button">
          <span>Import sprite sheet</span>
          <input
            type="file"
            accept="image/png,image/gif,image/webp"
            aria-label="Import sprite sheet"
            disabled={!target}
            onChange={(event) => void choose(event, "grid")}
          />
        </label>
        <label className="file-button">
          <span>Pick frames from any sheet</span>
          <input
            type="file"
            accept="image/png,image/gif,image/webp"
            aria-label="Pick frames from any sheet"
            disabled={!target}
            onChange={(event) => void choose(event, "pick")}
          />
        </label>
      </div>

      {sheet && target && (
        <fieldset className="panel sheet-import" aria-label="New sprite sheet">
          <legend>New sprite sheet for {target.name}</legend>
          <div className="row">
            <label>
              <span>Frame size</span>
              <input
                type="number"
                min={4}
                max={256}
                value={frameSize}
                onChange={(event) => setFrameSize(Number(event.target.value))}
              />
            </label>
            {sliced && (
              <>
                <label>
                  <span>Animation</span>
                  <select
                    value={clip}
                    onChange={(event) => setClip(event.target.value as Clip)}
                  >
                    {clips.map((entry) => (
                      <option key={entry} value={entry}>
                        {entry}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Facing</span>
                  <select
                    value={direction}
                    onChange={(event) =>
                      setDirection(event.target.value as SpriteDirection)
                    }
                  >
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
                <Preview
                  source={sheet.element}
                  layout={sliced.layout}
                  clip={clips.includes(clip) ? clip : "idle"}
                  direction={direction}
                />
                <img
                  src={sliced.token.dataUrl}
                  alt="Round token"
                  className="token-preview"
                />
                <div className="grow">
                  <p className="muted">
                    {sliced.layout.frameSize}-pixel frames · animations:{" "}
                    {clips.join(", ")}
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
              onClick={() =>
                sliced &&
                apply(target.key, {
                  image: sheet.image,
                  layout: sliced.layout,
                  token: sliced.token,
                })
              }
            >
              Use for {target.name}
            </button>
            <button type="button" onClick={() => setSheet(null)}>
              Cancel
            </button>
          </div>
        </fieldset>
      )}
      {picking && target && (
        <FramePicker
          key={picking.image.dataUrl}
          sheet={picking}
          name={target.name}
          onUse={(character) => apply(target.key, character)}
          onCancel={() => setPicking(null)}
        />
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
              {art.characters[key]?.token ? (
                <img
                  src={art.characters[key]?.token?.dataUrl}
                  alt=""
                  className="tile-thumb"
                />
              ) : null}
              <span className="grow">
                {targets.find((entry) => entry.key === key)?.label ?? key}
              </span>
              <button
                type="button"
                aria-label={`Reset ${key} art`}
                title="Back to the pack's figure"
                onClick={() => apply(key, null)}
              >
                Reset
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
