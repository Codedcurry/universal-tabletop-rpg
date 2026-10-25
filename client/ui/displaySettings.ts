import { useSyncExternalStore } from 'react';
import { ANIMATION_SPEEDS, type AnimationSpeed, defaultAnimationSpeed } from '@shared/anim';
import type { GraphicsQuality } from '@shared/graphics';
import { loadGraphicsQuality, saveGraphicsQuality } from '../style/graphicsSetting';

// This device's display settings, behind the ⚙ button on the map: how much
// 2.5D polish to draw, how fast combat plays out, and whether to keep the
// screen awake during a game. Remembered in this browser.

export interface DisplaySettings {
  readonly graphics: GraphicsQuality;
  readonly combatSpeed: AnimationSpeed;
  readonly keepAwake: boolean;
  /** Sound effects and background music volumes, 0 (off) to 100. */
  readonly effectsVolume: number;
  readonly musicVolume: number;
  /** Tiles as pixel art (the HD-2D pack) or plain colors. */
  readonly artStyle: 'pixel' | 'simple';
}

const SPEED_KEY = 'ttrpg.combatSpeed';
const AWAKE_KEY = 'ttrpg.keepAwake';
const EFFECTS_KEY = 'ttrpg.effectsVolume';
const MUSIC_KEY = 'ttrpg.musicVolume';
const ART_KEY = 'ttrpg.artStyle';

/** A saved volume (0 to 100), or the default. */
function volume(saved: string | null, fallback: number): number {
  const value = saved === null ? Number.NaN : Number(saved);
  return Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : fallback;
}

/** Whether this device asks for reduced motion (an accessibility setting). */
export function prefersReducedMotion(): boolean {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage blocked: use the defaults
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered; it still applies until the page closes.
  }
}

function load(): DisplaySettings {
  const speed = read(SPEED_KEY);
  return {
    graphics: loadGraphicsQuality(),
    combatSpeed: ANIMATION_SPEEDS.find((entry) => entry === speed) ?? defaultAnimationSpeed(prefersReducedMotion()),
    keepAwake: read(AWAKE_KEY) !== 'false',
    // Effects on, music off until someone turns it up.
    effectsVolume: volume(read(EFFECTS_KEY), 60),
    musicVolume: volume(read(MUSIC_KEY), 0),
    artStyle: read(ART_KEY) === 'simple' ? 'simple' : 'pixel',
  };
}

let current = load();
const listeners = new Set<() => void>();

export function setDisplaySetting<K extends keyof DisplaySettings>(key: K, value: DisplaySettings[K]): void {
  current = { ...current, [key]: value };
  if (key === 'graphics') saveGraphicsQuality(value as GraphicsQuality);
  if (key === 'combatSpeed') write(SPEED_KEY, value as AnimationSpeed);
  if (key === 'keepAwake') write(AWAKE_KEY, String(value));
  if (key === 'effectsVolume') write(EFFECTS_KEY, String(value));
  if (key === 'musicVolume') write(MUSIC_KEY, String(value));
  if (key === 'artStyle') write(ART_KEY, String(value));
  for (const listener of listeners) listener();
}

/** The settings now, for code outside React (the sound engine). */
export function displaySettings(): DisplaySettings {
  return current;
}

/** Calls `listener` whenever a setting changes; returns a function that stops it. */
export function onDisplaySettingsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDisplaySettings(): DisplaySettings {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
