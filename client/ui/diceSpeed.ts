import { useSyncExternalStore } from 'react';
import type { RollSpeed } from '@shared/dice';
import { prefersReducedMotion } from './displaySettings';

// The dice animation speed is a per-device preference: remembered in this
// browser, shared by the dice panel (which sets it) and the animation.

const KEY = 'ttrpg.diceSpeed';
const SPEEDS: readonly RollSpeed[] = ['fast', 'normal', 'dramatic', 'off'];

function load(): RollSpeed {
  try {
    const stored = localStorage.getItem(KEY) as RollSpeed | null;
    if (stored && SPEEDS.includes(stored)) return stored;
  } catch {
    // storage blocked: use the default
  }
  // People who ask their device for reduced motion start with dice animations off.
  return prefersReducedMotion() ? 'off' : 'normal';
}

let speed = load();
const listeners = new Set<() => void>();

export function setDiceSpeed(next: RollSpeed): void {
  speed = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Not fatal: it just won't be remembered.
  }
  for (const listener of listeners) listener();
}

export function useDiceSpeed(): RollSpeed {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => speed,
  );
}
