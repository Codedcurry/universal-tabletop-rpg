import { describe, expect, it } from 'vitest';
import { scriptedRandom } from '../random';
import { DiceNotationError, type DiceTermResult, RollReplayError, parseDice, replayRoll, roll, rollDice } from './index';

// scriptedRandom returns the given 0-based values in order and throws if a
// value is out of range for the requested maximum, so these tests also check
// that every die asks for the right number of sides.

function diceTerm(result: ReturnType<typeof roll>, index: number): DiceTermResult {
  const term = result.terms[index];
  if (term?.kind !== 'dice') throw new Error(`term ${index} is not a dice term`);
  return term;
}

describe('rollDice', () => {
  it('rolls dice and adds a constant', () => {
    const result = roll('2d6+3', scriptedRandom([3, 5]));
    expect(diceTerm(result, 0).dice.map((d) => d.value)).toEqual([4, 6]);
    expect(diceTerm(result, 0).subtotal).toBe(10);
    expect(result.terms[1]).toEqual({ kind: 'constant', sign: 1, value: 3, subtotal: 3 });
    expect(result.total).toBe(13);
  });

  it('keeps the original notation', () => {
    expect(roll('d20 + 5', scriptedRandom([0])).notation).toBe('d20 + 5');
  });

  it('rolls exactly the right sides for each term, left to right', () => {
    const rng = scriptedRandom([19, 3, 7]);
    const result = roll('1d20+1d4+1d8', rng);
    expect(result.total).toBe(20 + 4 + 8);
    expect(rng.remaining()).toBe(0);
  });

  it('subtracts a constant', () => {
    expect(roll('1d20-1', scriptedRandom([19])).total).toBe(19);
  });

  it('subtracts a dice term', () => {
    const result = roll('1d20-1d4', scriptedRandom([9, 2]));
    expect(diceTerm(result, 1).subtotal).toBe(-3);
    expect(result.total).toBe(7);
  });

  it('rolls d% from 1 to 100', () => {
    expect(roll('d%', scriptedRandom([99])).total).toBe(100);
    expect(roll('d%', scriptedRandom([0])).total).toBe(1);
  });

  it('marks every die as kept when there is no modifier', () => {
    const result = roll('3d6', scriptedRandom([0, 1, 2]));
    expect(diceTerm(result, 0).dice.every((d) => d.kept)).toBe(true);
  });

  describe('keep and drop', () => {
    it('keeps the highest', () => {
      const result = roll('4d6kh3', scriptedRandom([0, 5, 2, 3]));
      expect(diceTerm(result, 0).dice).toEqual([
        { value: 1, kept: false },
        { value: 6, kept: true },
        { value: 3, kept: true },
        { value: 4, kept: true },
      ]);
      expect(result.total).toBe(13);
    });

    it('keeps the lowest', () => {
      const result = roll('2d20kl1', scriptedRandom([14, 2]));
      expect(diceTerm(result, 0).dice.map((d) => d.kept)).toEqual([false, true]);
      expect(result.total).toBe(3);
    });

    it('drops the lowest', () => {
      expect(roll('4d6dl1', scriptedRandom([0, 5, 2, 3])).total).toBe(13);
    });

    it('drops the highest', () => {
      expect(roll('3d6dh1', scriptedRandom([5, 0, 2])).total).toBe(4);
    });

    it('breaks ties by dropping the later die', () => {
      const result = roll('4d6kh3', scriptedRandom([1, 1, 4, 1]));
      expect(diceTerm(result, 0).dice.map((d) => d.kept)).toEqual([true, true, true, false]);
      expect(result.total).toBe(9);
    });

    it('breaks ties the same way when keeping the lowest', () => {
      const result = roll('3d6kl2', scriptedRandom([2, 2, 2]));
      expect(diceTerm(result, 0).dice.map((d) => d.kept)).toEqual([true, true, false]);
    });

    it('applies keep to a subtracted term before negating', () => {
      expect(roll('10-2d6kh1', scriptedRandom([1, 4])).total).toBe(5);
    });
  });

  describe('coins', () => {
    it('flips coins and counts heads (1 = heads, 0 = tails)', () => {
      const rng = scriptedRandom([1, 0, 1]);
      const result = roll('3 coins', rng);
      expect(result.terms[0]).toEqual({ kind: 'coin', sign: 1, flips: ['heads', 'tails', 'heads'], subtotal: 2 });
      expect(result.total).toBe(2);
      expect(rng.remaining()).toBe(0);
    });

    it('combines with dice in one tray', () => {
      expect(roll('1d6 + 2 coins', scriptedRandom([3, 1, 1])).total).toBe(6);
    });
  });

  it('rollDice works on an already-parsed expression', () => {
    const expression = parseDice('2d8+1');
    expect(rollDice(expression, scriptedRandom([7, 0])).total).toBe(10);
    // The same parsed expression can be rolled again.
    expect(rollDice(expression, scriptedRandom([0, 0])).total).toBe(3);
  });

  it('rolls within range on every die over many rolls', () => {
    let state = 12345;
    const lcg = {
      nextInt(max: number) {
        state = (state * 1103515245 + 12345) % 2 ** 31;
        return state % max;
      },
    };
    for (let i = 0; i < 200; i++) {
      const result = roll('3d7+d%', lcg);
      const values = result.terms.flatMap((t) => (t.kind === 'dice' ? t.dice.map((d) => d.value) : []));
      expect(values.slice(0, 3).every((v) => v >= 1 && v <= 7)).toBe(true);
      expect(values[3]).toBeGreaterThanOrEqual(1);
      expect(values[3]).toBeLessThanOrEqual(100);
    }
  });
});

describe('replayRoll', () => {
  // A player's device sends its raw random draws; the DM replays them through
  // the real roller, so the result can't be faked, only the draws chosen.

  it('rebuilds the same result from the draws', () => {
    const original = roll('4d6kh3 + 2 coins - 1', scriptedRandom([0, 5, 2, 3, 1, 0]));
    expect(replayRoll('4d6kh3 + 2 coins - 1', [0, 5, 2, 3, 1, 0])).toEqual(original);
  });

  it.each<[string, string, number[]]>([
    ['too few draws', '2d6', [3]],
    ['too many draws', '2d6', [3, 4, 5]],
    ['a draw outside the die', '1d6', [6]],
    ['a negative draw', '1d6', [-1]],
    ['a fractional draw', '1d6', [2.5]],
  ])('rejects %s', (_name, notation, draws) => {
    expect(() => replayRoll(notation, draws)).toThrow(RollReplayError);
  });

  it('rejects bad notation', () => {
    expect(() => replayRoll('2d', [])).toThrow(DiceNotationError);
  });
});
