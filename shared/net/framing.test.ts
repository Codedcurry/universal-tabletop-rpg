import { describe, expect, it } from 'vitest';
import { FRAME_BYTE_LIMIT, FrameAssembler, splitIntoFrames, utf8Length } from './index';

// PeerJS refuses messages over ~16 KB, but a big map or a long log is far
// larger. Big messages are split into frames that each fit, then reassembled.

const big = (size: number) => ({ type: 'snapshot', text: 'x'.repeat(size), list: Array.from({ length: 50 }, (_, i) => i) });

function deliver(frames: unknown[], assembler = new FrameAssembler({ maxMessageChars: 10_000_000 })): unknown[] {
  // Each frame goes over the wire as JSON, like the real transport.
  return frames.map((frame) => assembler.receive(JSON.parse(JSON.stringify(frame)))).filter((m) => m !== null);
}

describe('utf8Length', () => {
  it('counts bytes, not characters', () => {
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('é')).toBe(2);
    expect(utf8Length('€')).toBe(3);
    expect(utf8Length('🎲')).toBe(4);
  });
});

describe('splitIntoFrames', () => {
  it('passes small messages through untouched', () => {
    const message = { type: 'chat', text: 'hi' };
    expect(splitIntoFrames(message, 1)).toEqual([message]);
  });

  it('splits big messages into frames that each fit the limit', () => {
    const frames = splitIntoFrames(big(200_000), 7);
    expect(frames.length).toBeGreaterThan(10);
    for (const frame of frames) expect(utf8Length(JSON.stringify(frame))).toBeLessThan(FRAME_BYTE_LIMIT);
  });

  it('keeps frames under the limit even for text that escapes or encodes large', () => {
    const awkward = { text: '"\\\n🎲€é\u0001'.repeat(20_000) };
    for (const frame of splitIntoFrames(awkward, 1)) {
      expect(utf8Length(JSON.stringify(frame))).toBeLessThan(FRAME_BYTE_LIMIT);
    }
    expect(deliver(splitIntoFrames(awkward, 1))).toEqual([awkward]);
  });
});

describe('FrameAssembler', () => {
  it('rebuilds a big message exactly', () => {
    const message = big(200_000);
    expect(deliver(splitIntoFrames(message, 3))).toEqual([message]);
  });

  it('passes ordinary messages straight through', () => {
    expect(new FrameAssembler({ maxMessageChars: 100 }).receive({ type: 'ping' })).toEqual({ type: 'ping' });
  });

  it('rebuilds messages whose frames are interleaved or out of order', () => {
    const a = big(50_000);
    const b = { ...big(60_000), type: 'other' };
    const framesA = splitIntoFrames(a, 1);
    const framesB = splitIntoFrames(b, 2);
    const interleaved: unknown[] = [];
    for (let i = 0; i < Math.max(framesA.length, framesB.length); i++) {
      if (framesA[i]) interleaved.push(framesA[i]);
      if (framesB[framesB.length - 1 - i]) interleaved.push(framesB[framesB.length - 1 - i]);
    }
    expect(deliver(interleaved)).toEqual([a, b]);
  });

  it('holds back a message until every frame has arrived', () => {
    const frames = splitIntoFrames(big(100_000), 1);
    const assembler = new FrameAssembler({ maxMessageChars: 10_000_000 });
    for (const frame of frames.slice(0, -1)) expect(assembler.receive(frame)).toBeNull();
    expect(assembler.receive(frames.at(-1))).toEqual(big(100_000));
  });

  it('refuses messages bigger than its limit, so a hostile peer cannot fill memory', () => {
    const assembler = new FrameAssembler({ maxMessageChars: 50_000 });
    expect(deliver(splitIntoFrames(big(200_000), 1), assembler)).toEqual([]);
    // It still works for messages within the limit afterwards.
    expect(deliver(splitIntoFrames(big(30_000), 2), assembler)).toEqual([big(30_000)]);
  });

  it('keeps only a few unfinished messages at a time', () => {
    const assembler = new FrameAssembler({ maxMessageChars: 10_000_000, maxPending: 2 });
    const firsts = [1, 2, 3].map((id) => splitIntoFrames(big(40_000), id));
    for (const frames of firsts) assembler.receive(frames[0]);
    // Message 1 was dropped to make room for message 3.
    expect(deliver(firsts[0]!.slice(1), assembler)).toEqual([]);
    expect(deliver(firsts[2]!.slice(1), assembler)).toEqual([big(40_000)]);
  });

  it.each<[string, unknown]>([
    ['a frame with a negative index', { __frame: 1, id: 1, index: -1, count: 2, data: 'x' }],
    ['a frame with an index past its count', { __frame: 1, id: 1, index: 5, count: 2, data: 'x' }],
    ['a frame with a huge count', { __frame: 1, id: 1, index: 0, count: 1e9, data: 'x' }],
    ['a frame without data', { __frame: 1, id: 1, index: 0, count: 2 }],
    ['a frame that reassembles into invalid JSON', { __frame: 1, id: 1, index: 0, count: 1, data: '{oops' }],
  ])('ignores %s', (_name, frame) => {
    expect(new FrameAssembler({ maxMessageChars: 1000 }).receive(frame)).toBeNull();
  });
});
