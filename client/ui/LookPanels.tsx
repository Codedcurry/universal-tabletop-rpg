import { useEffect, useRef, useState } from 'react';
import type { HostSession } from '@shared/net';
import type { CustomArt } from '@shared/style/art';
import {
  DEFAULT_FLOAT_STYLE,
  FLOAT_FONTS,
  FLOAT_KINDS,
  FLOAT_MOTIONS,
  FLOAT_PRESETS,
  type FloatFont,
  type FloatKind,
  type FloatMotion,
  type FloatStyle,
  floatMotion,
} from '@shared/style/floats';
import { styleFloat } from '../style/floatLook';
import { STYLE_PACKS } from '../style/stylePacks';

// Two parts of the DM tools' Art tab. World look: the style pack the map is
// drawn in, for everyone. Numbers: how damage, healing, misses, conditions,
// and XP float over creatures, from a preset or the DM's own mix, with a live
// preview; it's used for everyone once the DM says so.

const KIND_NAMES: Readonly<Record<FloatKind, string>> = { damage: 'Damage', heal: 'Healing', miss: 'Miss', status: 'Condition', xp: 'XP' };
const SAMPLES: Readonly<Record<FloatKind, string>> = { damage: '-12', heal: '+8', miss: 'Miss', status: 'Poisoned', xp: '+50 XP' };
const FONT_NAMES: Readonly<Record<FloatFont, string>> = { bold: 'Bold', serif: 'Serif', pixel: 'Pixel', comic: 'Comic', mono: 'Arcade' };
const MOTION_NAMES: Readonly<Record<FloatMotion, string>> = { rise: 'Rise', pop: 'Pop', bounce: 'Bounce', shake: 'Shake' };
const PRESET_NAMES: Readonly<Record<string, string>> = { classic: 'Classic', comic: 'Comic', pixel: 'Pixel', elegant: 'Elegant', arcade: 'Arcade' };

/** The style pack the world is drawn in, for the whole table. */
export function WorldLook({ session, art }: { session: HostSession; art: CustomArt }) {
  const current = STYLE_PACKS.find((pack) => pack.id === art.look) ?? (STYLE_PACKS[0] as (typeof STYLE_PACKS)[number]);
  return (
    <div className="look-packs" role="radiogroup" aria-label="World look">
      {STYLE_PACKS.map((pack) => {
        const chips = [pack.terrain.grass, pack.terrain.dirt, pack.terrain.stone, pack.terrain.water, pack.solid.wood].map((look) => look?.color ?? pack.unknownTerrain.color);
        return (
          <button
            key={pack.id}
            type="button"
            role="radio"
            aria-checked={pack.id === current.id}
            className="look-pack"
            onClick={() => session.setLook(pack.id === 'placeholder' ? null : pack.id)}
          >
            <span className="look-chips" style={{ background: pack.background }} aria-hidden="true">
              {chips.map((chip, index) => (
                <span key={index} style={{ background: chip }} />
              ))}
            </span>
            <span>{pack.name}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Sample numbers looping in a box, styled and moving as they will over creatures. */
function NumbersPreview({ style }: { style: FloatStyle }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const items = [...(box.current?.querySelectorAll<HTMLElement>('[data-kind]') ?? [])];
    for (const item of items) styleFloat(item, style, item.dataset.kind as string);
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (still) return;
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      items.forEach((item, index) => {
        // Each number on its own beat, so they don't all move together.
        const age = ((now - start) / 1400 + index * 0.2) % 1.25;
        const move = floatMotion(style.motion, Math.min(age, 1));
        item.style.opacity = String(age > 1 ? 0 : move.opacity);
        item.style.transform = `translate(${move.dx}px, ${move.dy}px) scale(${move.scale})`;
      });
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [style]);
  return (
    <div ref={box} className="numbers-preview" data-testid="numbers-preview" aria-label="Preview">
      {FLOAT_KINDS.map((kind) => (
        <span key={kind} className="numbers-sample">
          <span data-kind={kind}>{SAMPLES[kind]}</span>
        </span>
      ))}
    </div>
  );
}

/** How the numbers that float over creatures look, for the whole table. */
export function NumberStyle({ session, art }: { session: HostSession; art: CustomArt }) {
  const used = art.floats ?? DEFAULT_FLOAT_STYLE;
  const [draft, setDraft] = useState<FloatStyle>(used);
  const [error, setError] = useState<string | null>(null);
  const changed = JSON.stringify(draft) !== JSON.stringify(used);
  const change = (patch: Partial<FloatStyle>) => setDraft((now) => ({ ...now, ...patch, preset: 'custom' }));

  function apply() {
    try {
      session.setFloatStyle(draft.preset === 'classic' && JSON.stringify(draft) === JSON.stringify(DEFAULT_FLOAT_STYLE) ? null : draft);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <div className="number-style">
      <p className="muted">How damage, healing, misses, conditions, and XP float over creatures. Everyone in the game sees your choice.</p>
      <div className="row wrap" role="group" aria-label="Presets">
        {Object.keys(FLOAT_PRESETS).map((id) => (
          <button key={id} type="button" aria-pressed={draft.preset === id} onClick={() => setDraft(FLOAT_PRESETS[id] as FloatStyle)}>
            {PRESET_NAMES[id] ?? id}
          </button>
        ))}
      </div>
      <NumbersPreview style={draft} />
      <fieldset className="number-colors">
        <legend>Colours</legend>
        {FLOAT_KINDS.map((kind) => (
          <label key={kind}>
            <span>{KIND_NAMES[kind]}</span>
            <input type="color" value={draft.colors[kind]} onChange={(event) => change({ colors: { ...draft.colors, [kind]: event.target.value } })} />
          </label>
        ))}
      </fieldset>
      <div className="row wrap">
        <label>
          <span>Size</span>
          <input type="range" min={0.6} max={2} step={0.05} value={draft.size} onChange={(event) => change({ size: Number(event.target.value) })} />
        </label>
        <label>
          <span>Lettering</span>
          <select value={draft.font} onChange={(event) => change({ font: event.target.value as FloatFont })}>
            {FLOAT_FONTS.map((font) => (
              <option key={font} value={font}>
                {FONT_NAMES[font]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Motion</span>
          <select value={draft.motion} onChange={(event) => change({ motion: event.target.value as FloatMotion })}>
            {FLOAT_MOTIONS.map((motion) => (
              <option key={motion} value={motion}>
                {MOTION_NAMES[motion]}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={draft.outline} onChange={(event) => change({ outline: event.target.checked })} />
          <span>Outline</span>
        </label>
      </div>
      {error && <p className="field-error">{error}</p>}
      <div className="row">
        <button type="button" className="primary" disabled={!changed} onClick={apply}>
          Use for everyone
        </button>
        <button type="button" disabled={!changed} onClick={() => setDraft(used)}>
          Undo changes
        </button>
      </div>
    </div>
  );
}
