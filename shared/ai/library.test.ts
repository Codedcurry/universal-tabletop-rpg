import { describe, expect, it } from 'vitest';
import { areaText, findAreas, findMaps } from './library';

// Finding an adventure's keyed areas and map pages in its text, without AI.

const filler = 'Some text about the place that goes on for a while. '.repeat(14);
const pages = [
  'The Tomb of Mirrors An adventure for brave fools.',
  // A map page: little text, labels naming areas.
  'Silver Hall 1 Mirror Maze 2 Vault 3 5′ Scale',
  `${filler} 1 SILVER HALL Polished floors (gleaming). Four pillars. ${filler}`,
  `${filler} 2 MIRROR MAZE Tall mirrors (cracked). HP 12 AC 4 ${filler}`,
  `${filler} 3 VAULT—INNER Iron door (locked). A chest. ${filler}`,
];

describe('findAreas', () => {
  it('finds keyed areas: a number, then a name in capitals', () => {
    expect(findAreas(pages)).toEqual([
      { key: '1', name: 'Silver Hall', page: 3 },
      { key: '2', name: 'Mirror Maze', page: 4 },
      { key: '3', name: 'Vault—Inner', page: 5 },
    ]);
  });

  it('ignores stats and short capitals', () => {
    expect(findAreas([`${filler} HP 12 AC 4 is tough. 7 HD of it. ${filler}`])).toEqual([]);
  });
});

describe('findMaps', () => {
  it('finds map pages by their labels, a name\'s words then its key, in any order', () => {
    expect(findMaps(pages, findAreas(pages))).toEqual([{ page: 2, areas: findAreas(pages) }]);
  });
});

describe('areaText', () => {
  it('takes each area\'s description, up to the next area', () => {
    const areas = findAreas(pages);
    const text = areaText(pages, areas, [areas[0]!], 10_000);
    expect(text).toMatch(/^1 SILVER HALL Polished floors/);
    expect(text).not.toContain('MIRROR MAZE');
  });
});
