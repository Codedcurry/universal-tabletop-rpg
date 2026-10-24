/**
 * Source of random integers. shared/ never touches crypto or Math.random
 * directly; the caller injects one of these so results are fair in play and
 * scripted in tests.
 */
export interface RandomSource {
  /** Returns a uniformly random integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number;
}

/** Fills the array with random uint32 values, like crypto.getRandomValues. */
export type FillRandomUint32 = (array: Uint32Array<ArrayBuffer>) => unknown;

const UINT32_RANGE = 2 ** 32;

function assertValidMax(maxExclusive: number): void {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > UINT32_RANGE) {
    throw new RangeError(`maxExclusive must be an integer from 1 to 2^32, got ${maxExclusive}`);
  }
}

/**
 * Secure, unbiased random source. In the client, pass
 * `(array) => crypto.getRandomValues(array)`.
 *
 * Uses rejection sampling: values in the uneven top slice of the uint32 range
 * are discarded, so every result in [0, max) is equally likely.
 */
export function createCryptoRandom(fill: FillRandomUint32): RandomSource {
  const buffer = new Uint32Array(1);
  return {
    nextInt(maxExclusive) {
      assertValidMax(maxExclusive);
      if (maxExclusive === 1) return 0;
      const limit = UINT32_RANGE - (UINT32_RANGE % maxExclusive);
      for (;;) {
        fill(buffer);
        const value = buffer[0] as number;
        if (value < limit) return value % maxExclusive;
      }
    },
  };
}

export interface ScriptedRandom extends RandomSource {
  /** How many scripted values have not been used yet. */
  remaining(): number;
}

/**
 * Returns the given values in order. For tests and replays; throws if it runs
 * out or a value does not fit the range being asked for.
 */
export function scriptedRandom(values: readonly number[]): ScriptedRandom {
  let index = 0;
  return {
    nextInt(maxExclusive) {
      assertValidMax(maxExclusive);
      const value = values[index];
      if (value === undefined) throw new Error(`scriptedRandom ran out after ${values.length} values`);
      if (!Number.isInteger(value) || value < 0 || value >= maxExclusive) {
        throw new RangeError(`scripted value ${value} (index ${index}) is not in [0, ${maxExclusive})`);
      }
      index++;
      return value;
    },
    remaining: () => values.length - index,
  };
}

/**
 * Wraps a random source and remembers every value it hands out. A player's
 * device sends these draws with a roll so the DM can replay and verify it.
 */
export function recordDraws(source: RandomSource): { random: RandomSource; draws(): number[] } {
  const draws: number[] = [];
  return {
    random: {
      nextInt(maxExclusive) {
        const value = source.nextInt(maxExclusive);
        draws.push(value);
        return value;
      },
    },
    draws: () => [...draws],
  };
}
