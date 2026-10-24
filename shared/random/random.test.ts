import { describe, expect, it } from 'vitest';
import { createCryptoRandom, recordDraws, scriptedRandom } from './index';

const UINT32_RANGE = 2 ** 32;

/** A fake crypto.getRandomValues that hands out the given uint32 values one at a time. */
function fakeFill(values: number[]) {
  let index = 0;
  const fill = <T extends Uint32Array>(array: T): T => {
    for (let i = 0; i < array.length; i++) {
      const value = values[index++];
      if (value === undefined) throw new Error('fake fill ran out of values');
      array[i] = value;
    }
    return array;
  };
  return { fill, used: () => index };
}

describe('createCryptoRandom', () => {
  it('maps a random uint32 into [0, max)', () => {
    const { fill } = fakeFill([10, 3, 5]);
    const random = createCryptoRandom(fill);
    expect(random.nextInt(6)).toBe(4);
    expect(random.nextInt(6)).toBe(3);
    expect(random.nextInt(2)).toBe(1);
  });

  it('rejects values from the uneven top of the range to stay unbiased', () => {
    // 2^32 is not a multiple of 6, so the top (2^32 mod 6) = 4 values must be rerolled.
    const firstRejected = UINT32_RANGE - (UINT32_RANGE % 6);
    const { fill, used } = fakeFill([firstRejected, UINT32_RANGE - 1, 7]);
    const random = createCryptoRandom(fill);
    expect(random.nextInt(6)).toBe(1);
    expect(used()).toBe(3);
  });

  it('accepts the largest unbiased value', () => {
    const largestAccepted = UINT32_RANGE - (UINT32_RANGE % 6) - 1;
    const { fill, used } = fakeFill([largestAccepted]);
    expect(createCryptoRandom(fill).nextInt(6)).toBe(largestAccepted % 6);
    expect(used()).toBe(1);
  });

  it('always returns 0 for max 1', () => {
    const { fill } = fakeFill([UINT32_RANGE - 1, 12345]);
    const random = createCryptoRandom(fill);
    expect(random.nextInt(1)).toBe(0);
  });

  it.each([0, -1, 1.5, Number.NaN, UINT32_RANGE + 1])('rejects max %d', (max) => {
    const random = createCryptoRandom(fakeFill([]).fill);
    expect(() => random.nextInt(max)).toThrow(RangeError);
  });
});

describe('scriptedRandom', () => {
  it('returns the scripted values in order and counts what is left', () => {
    const random = scriptedRandom([2, 0, 5]);
    expect(random.remaining()).toBe(3);
    expect(random.nextInt(6)).toBe(2);
    expect(random.nextInt(6)).toBe(0);
    expect(random.remaining()).toBe(1);
  });

  it('throws when it runs out', () => {
    const random = scriptedRandom([1]);
    random.nextInt(2);
    expect(() => random.nextInt(2)).toThrow(/ran out/);
  });

  it('throws when a scripted value does not fit the requested range', () => {
    expect(() => scriptedRandom([6]).nextInt(6)).toThrow(RangeError);
    expect(() => scriptedRandom([-1]).nextInt(6)).toThrow(RangeError);
  });
});

describe('recordDraws', () => {
  it('passes values through and remembers every draw in order', () => {
    const recorder = recordDraws(scriptedRandom([3, 0, 1]));
    expect(recorder.random.nextInt(6)).toBe(3);
    expect(recorder.random.nextInt(20)).toBe(0);
    expect(recorder.random.nextInt(2)).toBe(1);
    expect(recorder.draws()).toEqual([3, 0, 1]);
  });

  it('returns a copy, so callers cannot change the record', () => {
    const recorder = recordDraws(scriptedRandom([2]));
    recorder.random.nextInt(4);
    recorder.draws().push(99);
    expect(recorder.draws()).toEqual([2]);
  });
});
