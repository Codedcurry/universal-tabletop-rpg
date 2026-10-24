import { useSyncExternalStore } from 'react';
import type { RollSpeed } from '@shared/dice';

// The dice animation speed is a per-device preference: remembered in this
// browser, shared by the dice panel (which sets it) and the animation.

const KEY = 'ttrpg.diceSpeed';
const SPEEDS: readonly RollSpeed[] = ['fast', 'normal', 'dramatic', 'off'];

function load(): RollSpeed {
  try {
    const stored = localStorage.getItem(KEY) as RollSpeed | null;
    return stored && SPEEDS.includes(stored) ? stored : 'normal';
  } catch {
    return 'normal';
  }
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
