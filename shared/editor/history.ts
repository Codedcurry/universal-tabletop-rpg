import type { MapData } from '../map';
import { type MapPatch, applyPatch, diffMaps, isEmptyPatch } from './patch';

/** Undo and redo stacks of patches. Plain data, never mutated. */
export interface EditHistory {
  readonly undo: readonly MapPatch[];
  readonly redo: readonly MapPatch[];
}

export const MAX_HISTORY = 100;

export const EMPTY_HISTORY: EditHistory = { undo: [], redo: [] };

export interface HistoryStep {
  readonly map: MapData;
  readonly history: EditHistory;
  /** What was applied, so it can be sent to players. */
  readonly patch: MapPatch;
}

/** Records a change (one click, one drag stroke, one generated map) so it can be undone. */
export function recordChange(history: EditHistory, before: MapData, after: MapData): EditHistory {
  const back = diffMaps(after, before);
  if (isEmptyPatch(back)) return history;
  return { undo: [...history.undo, back].slice(-MAX_HISTORY), redo: [] };
}

export function undo(history: EditHistory, map: MapData): HistoryStep | null {
  const patch = history.undo.at(-1);
  if (!patch) return null;
  const previous = applyPatch(map, patch);
  return {
    map: previous,
    history: { undo: history.undo.slice(0, -1), redo: [...history.redo, diffMaps(previous, map)] },
    patch,
  };
}

export function redo(history: EditHistory, map: MapData): HistoryStep | null {
  const patch = history.redo.at(-1);
  if (!patch) return null;
  const next = applyPatch(map, patch);
  return {
    map: next,
    history: { undo: [...history.undo, diffMaps(next, map)].slice(-MAX_HISTORY), redo: history.redo.slice(0, -1) },
    patch,
  };
}
