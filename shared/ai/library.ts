/**
 * What's in a DM's books, found in their text without AI: an adventure's
 * keyed areas ("25 THE BLACK TOMB" heading a description) and its map pages
 * (pages of little text whose labels name those areas: "Black Tomb 25").
 * The Books tab lists the maps found, to make one in a click.
 */

export interface BookArea {
  /** The area's key: "25". */
  readonly key: string;
  /** Its name as the book writes it, tidied: "The Black Tomb". */
  readonly name: string;
  /** The page its description starts on (from 1). */
  readonly page: number;
}

export interface BookMap {
  /** The page the map is drawn on (from 1). */
  readonly page: number;
  /** The areas it shows, in key order. */
  readonly areas: readonly BookArea[];
}

/** Map pages are mostly picture: less text than this. */
const MAP_PAGE_TEXT = 600;

const titleCase = (caps: string) =>
  caps
    .toLowerCase()
    .replace(/(^|[\s\-–—])([a-z])/g, (_, space: string, letter: string) => space + letter.toUpperCase())
    .replace(/\bOf\b|\bThe\b(?!^)|\bAnd\b/g, (word, offset: number) => (offset === 0 ? word : word.toLowerCase()));

/** Words of a name, for matching a map label to a heading ("The Black Tomb" and "Black Tomb" match). */
const words = (name: string) =>
  name
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^a-z]+/)
    .filter((word) => word.length > 1 && word !== 'the' && word !== 'of');

/** The same name, in any order ("Family Crypts—Upper" and "Upper Family Crypts"). */
const sameName = (a: string, b: string) => {
  const x = words(a).sort();
  const y = words(b).sort();
  return x.length > 0 && x.length === y.length && x.every((word, index) => word === y[index]);
};

/**
 * Keyed areas: a number, then a name in capitals (two or more letters a
 * word), at the start of a description. The first page each appears on.
 */
export function findAreas(pages: readonly string[]): BookArea[] {
  const found = new Map<string, BookArea>();
  // A key, then capitalised words (THE BLACK TOMB, ALCHEMIST’S LABORATORY), ending before a word in lower case.
  const heading = /(?:^|\s)(\d{1,3})\s+((?:[A-Z][A-Z’'\-]+)(?:(?:\s+|\s*[—–]\s*)[A-Z][A-Z’'\-]+){0,5})(?=\s+[A-Z]?[a-z(]|\s*$)/g;
  pages.forEach((text, index) => {
    if (text.length < MAP_PAGE_TEXT) return;
    for (const match of text.matchAll(heading)) {
      const key = match[1]!;
      const caps = match[2]!.trim();
      const letters = caps.replace(/[^A-Z]/g, '');
      // Not an abbreviation or stat (HP, AC), and a sensible key.
      if (letters.length < 4 || Number(key) < 1 || Number(key) > 199) continue;
      const id = `${key}:${caps}`;
      if (![...found.values()].some((area) => `${area.key}:${area.name.toUpperCase()}` === id.toUpperCase() || (area.key === key && sameName(area.name, caps)))) {
        found.set(id, { key, name: titleCase(caps), page: index + 1 });
      }
    }
  });
  return [...found.values()].sort((a, b) => Number(a.key) - Number(b.key) || a.page - b.page);
}

/** Map pages: little text, with labels naming the book's areas ("Black Tomb 25"). */
export function findMaps(pages: readonly string[], areas: readonly BookArea[]): BookMap[] {
  const maps: BookMap[] = [];
  pages.forEach((text, index) => {
    if (text.length >= MAP_PAGE_TEXT) return;
    const flat = text.replace(/\s+/g, ' ');
    const shown = areas.filter((area) => {
      // A label: the area's key, after a word or two of its name ("Tunnel Mouth 3" for Lankshorn Tunnel Mouth).
      const named = new Set(words(area.name));
      for (const match of flat.matchAll(new RegExp(`(?:^|[^0-9])(${area.key})(?![0-9])`, 'g'))) {
        const before = words(flat.slice(Math.max(0, (match.index ?? 0) - 40), (match.index ?? 0) + 1)).slice(-4);
        if (before.some((word) => named.has(word))) return true;
      }
      return false;
    });
    if (shown.length > 0) maps.push({ page: index + 1, areas: shown });
  });
  return maps;
}

/** The text of the areas a map shows: from each area's heading to the next area's (for the AI to furnish the map). */
export function areaText(pages: readonly string[], areas: readonly BookArea[], wanted: readonly BookArea[], limit: number): string {
  const ordered = [...areas].sort((a, b) => a.page - b.page || Number(a.key) - Number(b.key));
  const parts: string[] = [];
  for (const area of wanted) {
    const next = ordered.find((other) => other.page > area.page || (other.page === area.page && Number(other.key) > Number(area.key)));
    const from = area.page - 1;
    const to = Math.min(pages.length, (next?.page ?? area.page + 1) + 0);
    const text = pages.slice(from, Math.max(from + 1, to)).join('\n');
    const start = text.search(new RegExp(`(?:^|\\s)${area.key}\\s+${words(area.name)[0] ?? ''}`, 'i'));
    const end = next ? text.search(new RegExp(`(?:^|\\s)${next.key}\\s+${(words(next.name)[0] ?? '').toUpperCase()}`)) : -1;
    parts.push(text.slice(Math.max(0, start), end > start ? end : undefined).trim());
  }
  return parts.join('\n\n').slice(0, limit);
}
