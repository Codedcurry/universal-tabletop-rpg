import type { BookArea } from './library';
import type { MapLabel } from './mapPlan';
import type { TracedMap } from './trace';

/**
 * Where each area's label is on a traced map: the map page's words (with
 * their positions in the picture) matched to the areas, by the area's key
 * printed beside a word of its name, then turned into the map's squares.
 */
export function placeLabels(words: readonly { readonly text: string; readonly x: number; readonly y: number }[], areas: readonly BookArea[], traced: TracedMap): MapLabel[] {
  const squareOf = (x: number, y: number) => ({ x: Math.floor((x - traced.origin.x) / traced.square), y: Math.floor((y - traced.origin.y) / traced.square) });
  const nameWords = (name: string) => name.toLowerCase().split(/[^a-z]+/).filter((word) => word.length > 2 && word !== 'the');
  return areas.flatMap((area): MapLabel[] => {
    const named = new Set(nameWords(area.name));
    // The key printed on its own, nearest a word of the area's name.
    const keys = words.filter((word) => word.text === area.key);
    const names = words.filter((word) => nameWords(word.text).some((part) => named.has(part)));
    let best: { x: number; y: number; distance: number } | null = null;
    for (const key of keys.length > 0 ? keys : names) {
      for (const name of names.length > 0 ? names : [key]) {
        const distance = Math.hypot(key.x - name.x, key.y - name.y);
        if (!best || distance < best.distance) best = { x: (key.x + name.x) / 2, y: (key.y + name.y) / 2, distance };
      }
    }
    if (!best || best.distance > traced.square * 8) return [];
    const at = squareOf(best.x, best.y);
    if (at.x < 0 || at.y < 0 || at.x >= traced.width || at.y >= traced.height) return [];
    return [{ key: area.key, name: area.name, ...at }];
  });
}
