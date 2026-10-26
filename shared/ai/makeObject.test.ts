import { describe, expect, it } from 'vitest';
import { customObjectProblem } from '../map';
import { type AiProvider, type AiRequest, makeObject } from './index';

// An object from the DM's own description, made by their AI: no book needed.

const recorder = (reply: string): AiProvider & { requests: AiRequest[] } => {
  const requests: AiRequest[] = [];
  return { label: 'Fake', requests, complete: async (request) => (requests.push(request), reply) };
};

describe('makeObject', () => {
  it('makes a valid object from the description', async () => {
    const ai = recorder('{"name": "Makeshift bed", "blocks": false, "blocksSight": false, "parts": [{"shape": "box", "size": [0.7, 0.03, 0.9], "color": "#8b5a3c"}]}');
    const object = await makeObject(ai, '  a makeshift bed: a rug on the floor ');
    expect(object).toMatchObject({ id: 'makeshift_bed', name: 'Makeshift bed', blocks: false, blocksSight: false });
    expect(customObjectProblem(object)).toBeNull();
    expect(ai.requests[0]?.prompt).toBe('Make this: a makeshift bed: a rug on the floor');
  });

  it('gives it an id the map doesn\'t have yet', async () => {
    const ai = recorder('{"name": "Rug", "parts": [{"shape": "box", "size": [1, 0.03, 1], "color": "#aa3322"}]}');
    expect((await makeObject(ai, 'a rug', { taken: ['rug', 'rug_2'] })).id).toBe('rug_3');
  });

  it('needs a description, and an answer it can read', async () => {
    await expect(makeObject(recorder('{}'), ' ')).rejects.toThrow(/Describe/);
    await expect(makeObject(recorder('no'), 'a rug')).rejects.toThrow(/couldn't be read/);
  });
});
