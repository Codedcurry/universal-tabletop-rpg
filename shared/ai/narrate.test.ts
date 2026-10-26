import { describe, expect, it } from 'vitest';
import { type AiProvider, type AiRequest, suggestNarration, tidyNarration } from './index';

// Narration suggestions: the latest log lines (and the scene) to the DM's AI,
// back as a line or two of plain narration.

describe('tidyNarration', () => {
  it('keeps just the narration', () => {
    expect(tidyNarration('Narration: "The goblin\'s blade **glances** off your shield."')).toBe("The goblin's blade glances off your shield.");
    expect(tidyNarration('  The torch\n gutters.  ')).toBe('The torch gutters.');
  });
});

describe('suggestNarration', () => {
  const recorder = (reply: string): AiProvider & { requests: AiRequest[] } => {
    const requests: AiRequest[] = [];
    return { label: 'Fake', requests, complete: async (request) => (requests.push(request), reply) };
  };

  it('sends the latest lines, the scene, and the tone', async () => {
    const ai = recorder('"Steel rings on stone as the goblin staggers back."');
    const lines = Array.from({ length: 14 }, (_, i) => `line ${i + 1}`);
    const text = await suggestNarration(ai, { recent: lines, scene: 'A crypt of black stone.', tone: 'grim' });
    expect(text).toBe('Steel rings on stone as the goblin staggers back.');
    const prompt = ai.requests[0]?.prompt ?? '';
    expect(prompt).toContain('A crypt of black stone.');
    expect(prompt).toContain('- line 14');
    expect(prompt).not.toContain('- line 4\n');
    expect(prompt).toContain('Tone: grim.');
    expect(ai.requests[0]?.system).toMatch(/Never invent new events/);
  });

  it('needs something to narrate, and an answer', async () => {
    await expect(suggestNarration(recorder('x'), { recent: [] })).rejects.toThrow(/Nothing has happened/);
    await expect(suggestNarration(recorder('  '), { recent: ['a'] })).rejects.toThrow(/try again/);
  });
});
