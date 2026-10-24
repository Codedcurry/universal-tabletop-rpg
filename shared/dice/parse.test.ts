import { describe, expect, it } from 'vitest';
import { DiceNotationError, MAX_DICE_PER_TERM, MAX_SIDES, parseDice, rollSlots } from './index';

const dice = (count: number, sides: number, sign: 1 | -1 = 1) => ({ kind: 'dice', sign, count, sides });
const constant = (value: number, sign: 1 | -1 = 1) => ({ kind: 'constant', sign, value });
const coins = (count: number, sign: 1 | -1 = 1) => ({ kind: 'coin', sign, count });

function errorFor(notation: string): DiceNotationError {
  try {
    parseDice(notation);
  } catch (error) {
    if (error instanceof DiceNotationError) return error;
    throw error;
  }
  throw new Error(`expected "${notation}" to be rejected`);
}

describe('parseDice', () => {
  describe('basic dice and constants', () => {
    it('parses NdS plus a constant', () => {
      expect(parseDice('2d6+3').terms).toEqual([dice(2, 6), constant(3)]);
    });

    it('defaults the count to 1', () => {
      expect(parseDice('d20').terms).toEqual([dice(1, 20)]);
    });

    it('parses a subtracted constant', () => {
      expect(parseDice('1d20-1').terms).toEqual([dice(1, 20), constant(1, -1)]);
    });

    it('parses several dice terms', () => {
      expect(parseDice('3d8+1d6').terms).toEqual([dice(3, 8), dice(1, 6)]);
    });

    it('parses a subtracted dice term', () => {
      expect(parseDice('1d20-1d4').terms).toEqual([dice(1, 20), dice(1, 4, -1)]);
    });

    it('accepts a leading sign', () => {
      expect(parseDice('-1d4+2').terms).toEqual([dice(1, 4, -1), constant(2)]);
      expect(parseDice('+d6').terms).toEqual([dice(1, 6)]);
    });

    it('accepts a plain number', () => {
      expect(parseDice('7').terms).toEqual([constant(7)]);
    });

    it('accepts custom side counts', () => {
      expect(parseDice('d7').terms).toEqual([dice(1, 7)]);
      expect(parseDice('2d1').terms).toEqual([dice(2, 1)]);
      expect(parseDice('1d3').terms).toEqual([dice(1, 3)]);
    });

    it('treats d% as d100', () => {
      expect(parseDice('d%').terms).toEqual([dice(1, 100)]);
      expect(parseDice('2d%').terms).toEqual([dice(2, 100)]);
    });

    it('ignores whitespace and case', () => {
      expect(parseDice('  2 D 6 +  3 ').terms).toEqual([dice(2, 6), constant(3)]);
    });

    it('keeps the original text as the source', () => {
      expect(parseDice(' 2d6 + 3 ').source).toBe(' 2d6 + 3 ');
    });
  });

  describe('keep and drop modifiers', () => {
    it.each([
      ['4d6kh3', 'kh', 3],
      ['2d20kl1', 'kl', 1],
      ['4d6dl1', 'dl', 1],
      ['3d6dh1', 'dh', 1],
      ['4D6KH3', 'kh', 3],
    ] as const)('parses %s', (notation, mode, n) => {
      const [term] = parseDice(notation).terms;
      expect(term).toMatchObject({ kind: 'dice', keep: { mode, count: n } });
    });

    it('defaults the modifier count to 1', () => {
      expect(parseDice('2d20kh').terms[0]).toMatchObject({ keep: { mode: 'kh', count: 1 } });
      expect(parseDice('2d20kl').terms[0]).toMatchObject({ keep: { mode: 'kl', count: 1 } });
    });

    it('leaves keep undefined when there is no modifier', () => {
      const [term] = parseDice('2d6').terms;
      expect(term).not.toHaveProperty('keep');
    });

    it('works on a later term', () => {
      expect(parseDice('1d4+4d6kh3+2').terms[1]).toMatchObject({ count: 4, sides: 6, keep: { mode: 'kh', count: 3 } });
    });
  });

  describe('coins', () => {
    it.each([
      ['coin', 1],
      ['coins', 1],
      ['1 coin', 1],
      ['5 coins', 5],
      ['5coins', 5],
      ['3 COINS', 3],
    ])('parses %j', (notation, count) => {
      expect(parseDice(notation).terms).toEqual([coins(count)]);
    });

    it('mixes with dice in a tray', () => {
      expect(parseDice('2d6 + 3 coins').terms).toEqual([dice(2, 6), coins(3)]);
    });
  });

  describe('invalid input', () => {
    it.each([
      '',
      '   ',
      'd',
      '2d',
      '2d6+',
      '2d6++3',
      '++2',
      '2d6 3',
      'abc',
      '2d6x',
      '2.5d6',
      '2d6kh1kh1',
      'kh3',
      '2d6kh1d6',
      'd%%',
      '2 3 coins',
      'coin coin',
    ])('rejects %j', (notation) => {
      expect(() => parseDice(notation)).toThrow(DiceNotationError);
    });

    it('rejects zero dice and zero sides', () => {
      expect(() => parseDice('0d6')).toThrow(DiceNotationError);
      expect(() => parseDice('2d0')).toThrow(DiceNotationError);
      expect(() => parseDice('0 coins')).toThrow(DiceNotationError);
    });

    it('rejects keeping or dropping that leaves no dice or more dice than rolled', () => {
      expect(() => parseDice('4d6kh5')).toThrow(DiceNotationError);
      expect(() => parseDice('4d6kh0')).toThrow(DiceNotationError);
      expect(() => parseDice('4d6kl0')).toThrow(DiceNotationError);
      expect(() => parseDice('4d6dl4')).toThrow(DiceNotationError);
      expect(() => parseDice('4d6dh0')).toThrow(DiceNotationError);
      expect(parseDice('4d6kh4').terms[0]).toMatchObject({ keep: { mode: 'kh', count: 4 } });
      expect(parseDice('4d6dl3').terms[0]).toMatchObject({ keep: { mode: 'dl', count: 3 } });
    });

    it('enforces size limits to protect phones', () => {
      expect(MAX_DICE_PER_TERM).toBe(1000);
      expect(MAX_SIDES).toBe(1_000_000);
      expect(() => parseDice('1000d6')).not.toThrow();
      expect(() => parseDice('1001d6')).toThrow(DiceNotationError);
      expect(() => parseDice('1d1000000')).not.toThrow();
      expect(() => parseDice('1d1000001')).toThrow(DiceNotationError);
      expect(() => parseDice('1001 coins')).toThrow(DiceNotationError);
      expect(() => parseDice('99999999999999999999d6')).toThrow(DiceNotationError);
    });

    it('reports the position of the problem', () => {
      expect(errorFor('2d6+x').position).toBe(4);
      expect(errorFor('2d6+').position).toBe(4);
      expect(errorFor('  2d').position).toBe(4);
      expect(errorFor('').position).toBe(0);
    });

    it('gives a readable message', () => {
      expect(errorFor('2d6+x').message).toMatch(/x/);
      expect(errorFor('4d6kh5').message).toMatch(/keep/i);
      expect(errorFor('1001d6').message).toMatch(/1000/);
    });
  });
});

describe('rollSlots', () => {
  // One slot per physical die or coin, in roll order: what a player must
  // read off their real dice.
  it('lists each die and coin to read, skipping constants', () => {
    expect(rollSlots(parseDice('2d6 + 1d4 + 2 coins + 3'))).toEqual([
      { kind: 'die', sides: 6 },
      { kind: 'die', sides: 6 },
      { kind: 'die', sides: 4 },
      { kind: 'coin' },
      { kind: 'coin' },
    ]);
  });

  it('includes dice that a keep/drop modifier will discard (you still roll them)', () => {
    expect(rollSlots(parseDice('4d6kh3'))).toHaveLength(4);
  });

  it('is empty for a plain number', () => {
    expect(rollSlots(parseDice('5'))).toEqual([]);
  });
});
