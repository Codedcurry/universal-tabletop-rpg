import { describe, expect, it } from 'vitest';
import { type AiProvider, type AiRequest, readSuggestions, suggestNext } from './index';

// "What next?": the log, the creatures, and the adventure's text to the DM's
// AI, back as a few suggestions with reasons.

describe('readSuggestions', () => {
  it('reads the suggestions, leaving out broken ones', () => {
    const reply = '```json\n{"suggestions": [{"idea": "The skeletons rise.", "why": "Area 23 says noise wakes them."}, {"why": "no idea"}, {"idea": "Eliza bargains."}]}\n```';
    expect(readSuggestions(reply)).toEqual([
      { idea: 'The skeletons rise.', why: 'Area 23 says noise wakes them.' },
      { idea: 'Eliza bargains.', why: '' },
    ]);
    expect(readSuggestions('No idea, sorry.')).toEqual([]);
  });
});

describe('suggestNext', () => {
  const recorder = (reply: string): AiProvider & { requests: AiRequest[] } => {
    const requests: AiRequest[] = [];
    return { label: 'Fake', requests, complete: async (request) => (requests.push(request), reply) };
  };

  it('sends the adventure, the creatures, and the log', async () => {
    const ai = recorder('{"suggestions": [{"idea": "The doors glow brighter.", "why": "The tomb is waking."}]}');
    const suggestions = await suggestNext(ai, { recent: ['Ana moves 3 tiles'], creatures: ['Ana: 9 of 9 HP'], scene: '25 THE BLACK TOMB Polished obsidian.' });
    expect(suggestions).toEqual([{ idea: 'The doors glow brighter.', why: 'The tomb is waking.' }]);
    const prompt = ai.requests[0]?.prompt ?? '';
    expect(prompt).toContain('25 THE BLACK TOMB');
    expect(prompt).toContain('- Ana: 9 of 9 HP');
    expect(prompt).toContain('- Ana moves 3 tiles');
  });

  it('works without an adventure, and says so when the answer can\'t be read', async () => {
    const ai = recorder('{"suggestions": [{"idea": "A storm rolls in.", "why": "Pacing."}]}');
    await suggestNext(ai, { recent: [] });
    expect(ai.requests[0]?.prompt).toContain('running their own');
    await expect(suggestNext(recorder('hmm'), { recent: [] })).rejects.toThrow(/try again/);
  });
});
