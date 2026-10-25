import { useEffect, useId, useRef, useState } from 'react';
import { ANIMATION_SPEEDS, type AnimationSpeed } from '@shared/anim';
import { GRAPHICS_QUALITIES, type GraphicsQuality } from '@shared/graphics';
import { setDisplaySetting, useDisplaySettings } from './displaySettings';

// The ⚙ button on the map and its small panel: this device's graphics
// quality, combat animation speed, and keeping the screen awake.

const QUALITY_LABELS: Record<GraphicsQuality, string> = { low: 'Low', medium: 'Medium', high: 'High' };
const SPEED_LABELS: Record<AnimationSpeed, string> = { fast: 'Fast', normal: 'Normal', off: 'Off' };

export function DisplaySettingsMenu({ onGraphicsPicked }: { onGraphicsPicked(quality: GraphicsQuality): void }) {
  const settings = useDisplaySettings();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  // Escape closes the panel and puts focus back on ⚙ (so keys like Q/E reach the map again);
  // a press anywhere else closes it too.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      if (root.current?.contains(document.activeElement)) button.current?.focus();
    };
    const onPress = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPress);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPress);
    };
  }, [open]);

  return (
    <div className="display-settings" ref={root}>
      <button
        ref={button}
        type="button"
        aria-label="Display settings"
        title="Graphics, animations, sound, screen"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        ⚙
      </button>
      <fieldset id={panelId} className="display-settings-panel" aria-label="Display settings" hidden={!open}>
        <label>
          <span>Graphics</span>
          <select
            aria-label="Graphics quality"
            title="Bloom, depth of field, shadows, and glows. Lower is smoother on phones."
            value={settings.graphics}
            onChange={(event) => {
              const quality = event.target.value as GraphicsQuality;
              setDisplaySetting('graphics', quality);
              onGraphicsPicked(quality);
            }}
          >
            {GRAPHICS_QUALITIES.map((quality) => (
              <option key={quality} value={quality}>
                {QUALITY_LABELS[quality]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Art style</span>
          <select value={settings.artStyle} onChange={(event) => setDisplaySetting('artStyle', event.target.value as 'pixel' | 'simple')}>
            <option value="pixel">Pixel (HD-2D)</option>
            <option value="simple">Simple colors</option>
          </select>
        </label>
        <label>
          <span>Combat animations</span>
          <select
            value={settings.combatSpeed}
            onChange={(event) => setDisplaySetting('combatSpeed', event.target.value as AnimationSpeed)}
          >
            {ANIMATION_SPEEDS.map((speed) => (
              <option key={speed} value={speed}>
                {SPEED_LABELS[speed]}
              </option>
            ))}
          </select>
        </label>
        <label className="volume">
          <span>Sound effects</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={settings.effectsVolume}
            onChange={(event) => setDisplaySetting('effectsVolume', Number(event.target.value))}
          />
        </label>
        <label className="volume" title="Calm background music; 0 turns it off">
          <span>Music</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={settings.musicVolume}
            onChange={(event) => setDisplaySetting('musicVolume', Number(event.target.value))}
          />
        </label>
        <label className="check" title="Stops the screen dimming and locking while you're in a game">
          <input
            type="checkbox"
            checked={settings.keepAwake}
            onChange={(event) => setDisplaySetting('keepAwake', event.target.checked)}
          />
          Keep mobile screens awake
        </label>
      </fieldset>
    </div>
  );
}
