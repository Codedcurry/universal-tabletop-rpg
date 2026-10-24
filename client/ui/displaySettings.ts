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
}

const SPEED_KEY = 'ttrpg.combatSpeed';
const AWAKE_KEY = 'ttrpg.keepAwake';

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
  };
}

let current = load();
const listeners = new Set<() => void>();

export function setDisplaySetting<K extends keyof DisplaySettings>(key: K, value: DisplaySettings[K]): void {
  current = { ...current, [key]: value };
  if (key === 'graphics') saveGraphicsQuality(value as GraphicsQuality);
  if (key === 'combatSpeed') write(SPEED_KEY, value as AnimationSpeed);
  if (key === 'keepAwake') write(AWAKE_KEY, String(value));
  for (const listener of listeners) listener();
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
