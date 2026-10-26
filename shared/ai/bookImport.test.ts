import { describe, expect, it } from 'vitest';
import { validateGameSystem } from '../system';
import { type AiProvider, type AiRequest, draftToSystem, emptyDraft, importRulebook, mergeExtract, readJsonReply, sectionsOf } from './index';

// Importing a rulebook: its pages in sections, each read by the user's AI
// into pieces of the game system format, merged and tidied into a draft for
// the DM to review.

describe('sectionsOf', () => {
  it('groups whole pages into sections of about the size asked, skipping blank pages', () => {
    const pages = ['a'.repeat(40), '', 'b'.repeat(40), 'c'.repeat(40)];
    expect(sectionsOf(pages, 100).map(({ from, to, text }) => [from, to, text.length])).toEqual([
      [1, 3, 82],
      [4, 4, 40],
    ]);
  });

  it('cuts a page longer than a section into pieces', () => {
    expect(sectionsOf(['x'.repeat(250)], 100).map(({ from, to, text }) => [from, to, text.length])).toEqual([
      [1, 1, 100],
      [1, 1, 100],
      [1, 1, 50],
    ]);
  });
});

describe('readJsonReply', () => {
  it('finds the JSON in a reply, fenced or not, with chatter around it', () => {
    expect(readJsonReply('Here you go:\n```json\n{"name": "Moonfall"}\n```\nEnjoy!')).toEqual({ name: 'Moonfall' });
    expect(readJsonReply('Sure! {"stats": [{"name": "Might"}]} Hope that helps.')).toEqual({ stats: [{ name: 'Might' }] });
  });

  it('forgives trailing commas, and gives up on anything else', () => {
    expect(readJsonReply('{"stats": [{"name": "Might",},],}')).toEqual({ stats: [{ name: 'Might' }] });
    expect(readJsonReply('I could not find any rules here.')).toBeNull();
    expect(readJsonReply('[1, 2]')).toBeNull();
  });
});

describe('merging and tidying', () => {
  it('keeps the first good value of each thing, and drops formulas that don\'t read', () => {
    const draft = emptyDraft();
    mergeExtract(draft, { defense: '10 + @dex_mod +', stats: [{ name: 'Strength', short: 'str' }] });
    mergeExtract(draft, { defense: '10 + @dex_mod', stats: [{ name: 'strength', short: 'STR', default: 12 }, { name: 'Dexterity', short: 'dex' }] });
    expect(draft.defense).toBe('10 + @dex_mod');
    expect([...draft.stats.values()]).toEqual([{ name: 'Strength', short: 'str' }, { name: 'Dexterity', short: 'dex' }]);
  });

  it('makes a working system: short names, names in formulas set right, monsters\' attacks matched by name', () => {
    const draft = emptyDraft();
    mergeExtract(draft, {
      name: 'Moonfall',
      stats: [
        { name: 'Strength', short: 'str', default: 10 },
        { name: 'Agility', short: 'agi', default: 10 },
      ],
      derived: [{ name: 'Strength bonus', short: 'str_bonus', formula: 'floor((@Strength - 10) / 2)' }],
      xpForLevel: [0, 100, 300],
      maxHp: '10 + @level * 3',
      defense: '10 + @agi',
      initiative: '1d20 + @agi',
      speed: '6',
      conditions: [{ name: 'Dazed', preventsActions: true }],
      abilities: [
        { name: 'Claw', range: 1, target: 'enemy', attackRoll: '1d20 + @str_bonus', effects: [{ damage: '1d6 + @str_bonus' }] },
        { name: 'Roar', range: 3, effects: [{ condition: 'Dazed', rounds: 2 }] },
        { name: 'Lick wounds', target: 'self', range: 0, effects: [{ heal: '1d4' }] },
      ],
      monsters: [{ name: 'Moon Wolf', level: 2, stats: { Strength: 14, agi: 12 }, abilities: ['claw', 'Roar', 'Fly'], xp: 120 }],
    });
    const { system, notes } = draftToSystem(draft);
    expect(validateGameSystem(system)).toMatchObject({ ok: true });
    expect(notes).toEqual([]);
    expect(system.derived[0]).toEqual({ id: 'str_bonus', name: 'Strength bonus', formula: 'floor((@str - 10) / 2)' });
    expect(system.abilities.map((ability) => [ability.id, ability.animation])).toEqual([
      ['claw', 'melee'],
      ['roar', 'ranged'],
      ['lick_wounds', 'spell'],
    ]);
    expect(system.abilities[1]?.effects).toEqual([{ type: 'applyCondition', condition: 'dazed', rounds: 2 }]);
    expect(system.monsters).toEqual([{ id: 'moon_wolf', name: 'Moon Wolf', level: 2, stats: { str: 14, agi: 12 }, abilities: ['claw', 'roar'], xpValue: 120 }]);
  });

  it('stands in for what the book didn\'t say, and says so', () => {
    const { system, notes } = draftToSystem(emptyDraft());
    expect(validateGameSystem(system).ok).toBe(true);
    expect(notes).toEqual(
      expect.arrayContaining(['No stats were found: "Might" stands in for them.', 'No XP table was found: a starter one stands in for it.', 'No defense formula was found: "10" stands in for it.']),
    );
  });

  it('takes abilities written out inside a monster, and drops attack rolls on allies', () => {
    const draft = emptyDraft();
    mergeExtract(draft, {
      abilities: [{ name: 'Mend', target: 'ally', attackRoll: '1d20', effects: [{ heal: '1d8' }] }],
      monsters: [{ name: 'Ash Golem', abilities: [{ name: 'Slam', range: 1, attackRoll: '1d20 + 4', effects: [{ damage: '2d8' }] }, 'Mend'] }],
    });
    const { system } = draftToSystem(draft);
    expect(system.abilities.find((ability) => ability.id === 'mend')).not.toHaveProperty('attack');
    expect(system.abilities.find((ability) => ability.id === 'slam')?.attack).toEqual({ roll: '1d20 + 4' });
    expect(system.monsters[0]?.abilities).toEqual(['slam', 'mend']);
  });

  it('leaves what it can\'t fix for the DM: the rules editor points at it', () => {
    const draft = emptyDraft();
    mergeExtract(draft, { stats: [{ name: 'Might', short: 'might' }], defense: '10 + @luck' });
    expect(validateGameSystem(draftToSystem(draft).system)).toMatchObject({ ok: false, errors: [{ path: 'defense', message: 'Unknown variable(s): @luck' }] });
  });
});

/** A fake AI: answers each section from a table keyed by a word in it. */
function fakeAi(answers: Record<string, string>): AiProvider & { requests: AiRequest[] } {
  const requests: AiRequest[] = [];
  return {
    label: 'Fake AI',
    requests,
    complete: async (request) => {
      requests.push(request);
      const word = Object.keys(answers).find((entry) => request.prompt.includes(entry));
      return word ? (answers[word] as string) : '{}';
    },
  };
}

describe('importRulebook', () => {
  const pages = ['CORE RULES: Might is the only stat. Defense is 10.', 'BESTIARY: The Gloom Bat bites.', 'APPENDIX: nothing useful'];

  it('reads the book section by section, reporting progress, into a draft system', async () => {
    const ai = fakeAi({
      CORE: '{"name": "Gloomhaven Lite", "stats": [{"name": "Might", "short": "might"}], "defense": "10"}',
      BESTIARY: '```json\n{"abilities": [{"name": "Bite", "attackRoll": "1d20", "effects": [{"damage": "1d4"}]}], "monsters": [{"name": "Gloom Bat", "abilities": ["Bite"]}]}\n```',
    });
    const progress: string[] = [];
    const result = await importRulebook(pages, ai, { maxChars: 52, onProgress: ({ done, total, section }) => progress.push(`${done}/${total}${section ? ` p${section.from}` : ''}`) });
    expect(progress).toEqual(['0/3 p1', '1/3 p2', '2/3 p3', '3/3']);
    expect(ai.requests[1]?.prompt).toMatch(/^Pages 2 of the book:/);
    expect(ai.requests[1]?.system).toMatch(/Never invent rules/);
    expect(result.system.name).toBe('Gloomhaven Lite');
    expect(result.system.monsters.map((monster) => monster.abilities)).toEqual([['bite']]);
    expect(result.problems).toBe(0);
  });

  it('skips a section whose answer can\'t be read, and says which', async () => {
    const result = await importRulebook(pages, fakeAi({ BESTIARY: 'Sorry, I cannot help with that.' }), { maxChars: 52 });
    expect(result.skipped.map((section) => section.from)).toEqual([2]);
    expect(result.notes).toContain("The AI's answer for page 2 couldn't be read, so it was skipped.");
  });

  it('stops when asked', async () => {
    const stop = { aborted: false, throwIfAborted() {
      if (this.aborted) throw new Error('Stopped');
    } };
    const ai = fakeAi({});
    const slow: AiProvider = {
      label: 'Slow',
      complete: async (request) => {
        stop.aborted = true;
        return ai.complete(request);
      },
    };
    await expect(importRulebook(pages, slow, { maxChars: 52, signal: stop })).rejects.toThrow('Stopped');
  });
});
