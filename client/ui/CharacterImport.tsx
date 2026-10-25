import { type ChangeEvent, useMemo, useState } from 'react';
import { CLIPS, type Clip } from '@shared/anim';
import type { SpriteDirection } from '@shared/camera';
import type { HostSession } from '@shared/net';
import { type CharacterArt, type CharacterSource, MAX_IMAGE_CHARS, MAX_IMAGE_SIDE } from '@shared/style/art';
import { DEFAULT_FPS, SHEET_DIRECTIONS, type SheetLayout, guessFrameSize, portraitRect, sliceSheet } from '@shared/style/sheet';
import { FramePicker, type PickerStart } from './FramePicker';
import { OnePicture, type Picture, loadPicture } from './OnePicture';
import { type Crop, Preview, type Sheet, SpeedField, TokenEditor, loadSheet, loadSheetUrl, makeToken, withSpeeds } from './spritePreview';

// Importing a character's sprite sheet in the Art tab: choose who it's for
// (a kind of monster, or one creature), pick the PNG, and the sheet is
// sliced (frame size guessed, frames counted per row), previewed playing
// any animation in any direction at a speed of the DM's choosing, with
// friendly warnings and a round token (cut from the portrait, framed by
// dragging), before it's used. A sheet that isn't laid out that
// way (sprites of any size, anywhere) opens in the frame picker instead.
// Any character's art can be edited there again later.

interface Sliced {
  readonly layout: SheetLayout;
  readonly warnings: readonly string[];
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
  /** A sheet open in the frame picker: a new one for the chosen character, or one being edited. */
  const [picking, setPicking] = useState<{ sheet: Sheet; key: string; name: string; start?: PickerStart } | null>(null);
  /** A picture being made into a character. */
  const [making, setMaking] = useState<{ picture: Picture; key: string; name: string } | null>(null);
  const [frameSize, setFrameSize] = useState(32);
  const [clip, setClip] = useState<Clip>('idle');
  const [direction, setDirection] = useState<SpriteDirection>('down');
  const [speeds, setSpeeds] = useState<Partial<Record<Clip, number>>>({});
  /** The token's framing, once the DM moves it; until then, the portrait. */
  const [crop, setCrop] = useState<Crop | null>(null);
  const [error, setError] = useState<string | null>(null);
  const target = targets.find((entry) => entry.key === targetKey) ?? targets[0];

  // Slicing follows the frame size, which starts from a guess and can be changed.
  const { sliced, sliceError } = useMemo((): { sliced: Sliced | null; sliceError: string | null } => {
    if (!sheet) return { sliced: null, sliceError: null };
    try {
      const { layout, warnings } = sliceSheet(sheet.pixels, frameSize);
      return { sliced: { layout, warnings }, sliceError: null };
    } catch (caught) {
      return { sliced: null, sliceError: caught instanceof Error ? caught.message : String(caught) };
    }
  }, [sheet, frameSize]);
  const clips = sliced ? (CLIPS.filter((entry) => sliced?.layout.clips[entry]) as Clip[]) : [];
  const portrait = sliced ? portraitRect(sliced.layout) : null;
  const layout = sliced ? withSpeeds(sliced.layout, speeds) : null;
  const showing = clips.includes(clip) ? clip : 'idle';

  async function choose(event: ChangeEvent<HTMLInputElement>, mode: 'grid' | 'pick') {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const loaded = await loadSheet(file);
      if (loaded.image.dataUrl.length >= MAX_IMAGE_CHARS) throw new Error(`${file.name} is too big: keep sprite sheets under about 500 KB`);
      if (loaded.image.width > MAX_IMAGE_SIDE || loaded.image.height > MAX_IMAGE_SIDE) throw new Error(`${file.name} is too large: at most ${MAX_IMAGE_SIDE} pixels across`);
      setError(null);
      if (mode === 'pick') {
        setSheet(null);
        if (target) setPicking({ sheet: loaded, key: target.key, name: target.name });
        return;
      }
      setPicking(null);
      setFrameSize(guessFrameSize(loaded.image.width, loaded.image.height, loaded.pixels) ?? 32);
      setClip('idle');
      setDirection('down');
      setSpeeds({});
      setCrop(null);
      setSheet(loaded);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function apply(key: string, character: CharacterArt | null, source: CharacterSource | null = null) {
    try {
      session.setCharacterArt(key, character, source);
      setSheet(null);
      setPicking(null);
      setMaking(null);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function choosePicture(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !target) return;
    try {
      const picture = await loadPicture(file);
      setSheet(null);
      setPicking(null);
      setError(null);
      setMaking({ picture, key: target.key, name: target.name });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  /** Opens a character's art in the frame picker: as it was built there, or found on its finished sheet. */
  async function editArt(key: string, name: string) {
    const character = art.characters[key];
    if (!character) return;
    const source = session.artSource(key);
    try {
      const loaded = await loadSheetUrl((source ?? character).image.dataUrl);
      setSheet(null);
      setError(null);
      setPicking({ sheet: loaded, key, name, start: source ? { source, layout: character.layout } : { layout: character.layout } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  const withArt = Object.keys(art.characters);

  return (
    <div className="character-import">
      <p className="muted">
        A sprite sheet: square frames, 4 rows per animation (facing down, left, right, up), idle first. Only idle is needed: missing animations are acted out with simple
        motions. Any other sheet (sprites of any size, anywhere): pick its frames yourself. Or make one from any picture: it becomes pixel art.
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
          <input type="file" accept="image/png,image/gif,image/webp" aria-label="Import sprite sheet" disabled={!target} onChange={(event) => void choose(event, 'grid')} />
        </label>
        <label className="file-button">
          <span>Pick frames from any sheet</span>
          <input
            type="file"
            accept="image/png,image/gif,image/webp"
            aria-label="Pick frames from any sheet"
            disabled={!target}
            onChange={(event) => void choose(event, 'pick')}
          />
        </label>
        <label className="file-button">
          <span>Make from one picture</span>
          <input type="file" accept="image/*" aria-label="Make from one picture" disabled={!target} onChange={(event) => void choosePicture(event)} />
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
                onChange={(event) => {
                  setFrameSize(Number(event.target.value));
                  setCrop(null);
                }}
              />
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
                <SpeedField clip={showing} fps={speeds[showing] ?? DEFAULT_FPS} onChange={(fps) => setSpeeds((all) => ({ ...all, [showing]: fps }))} />
              </>
            )}
          </div>
          {sliceError && <p className="field-error">{sliceError}</p>}
          {sliced && layout && portrait && (
            <>
              <div className="row sheet-previews">
                <Preview source={sheet.element} layout={layout} clip={showing} direction={direction} />
                <TokenEditor source={sheet.element} crop={crop ?? portrait} base={portrait.size} onChange={setCrop} />
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
              disabled={!layout}
              onClick={() => layout && portrait && apply(target.key, { image: sheet.image, layout, token: makeToken(sheet.element, crop ?? portrait) })}
            >
              Use for {target.name}
            </button>
            <button type="button" onClick={() => setSheet(null)}>
              Cancel
            </button>
          </div>
        </fieldset>
      )}
      {picking && (
        <FramePicker
          key={`${picking.key}:${picking.sheet.image.dataUrl.length}`}
          sheet={picking.sheet}
          name={picking.name}
          {...(picking.start ? { start: picking.start } : {})}
          onUse={(character, source) => apply(picking.key, character, source)}
          onCancel={() => setPicking(null)}
        />
      )}
      {making && (
        <OnePicture
          key={`${making.key}:${making.picture.name}`}
          front={making.picture}
          name={making.name}
          onUse={(character) => apply(making.key, character)}
          onCancel={() => setMaking(null)}
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
              {art.characters[key]?.token ? <img src={art.characters[key]?.token?.dataUrl} alt="" className="tile-thumb" /> : null}
              <span className="grow">{targets.find((entry) => entry.key === key)?.label ?? key}</span>
              <button type="button" aria-label={`Edit ${key} art`} title="Change its frames, speeds, or token" onClick={() => void editArt(key, targets.find((entry) => entry.key === key)?.name ?? key)}>
                Edit
              </button>
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
