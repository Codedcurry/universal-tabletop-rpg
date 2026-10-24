import { describe, expect, it } from 'vitest';
import { scriptedRandom } from '../random';
import { FormulaError, evaluateFormula, formulaHasDice, formulaReferences, parseFormula } from './index';

// Formulas are how game system files describe numbers: derived stats, max HP,
// attack rolls, damage. They are arithmetic with dice and @variables.

const noDice = scriptedRandom([]);

function value(text: string, vars: Record<string, number> = {}): number {
  return evaluateFormula(parseFormula(text), vars, noDice).value;
}

function errorFor(text: string): FormulaError {
  try {
    parseFormula(text);
  } catch (error) {
    if (error instanceof FormulaError) return error;
    throw error;
  }
  throw new Error(`expected "${text}" to be rejected`);
}

describe('formulas', () => {
  describe('arithmetic', () => {
    it.each([
      ['7', 7],
      ['2 + 3 * 4', 14],
      ['(2 + 3) * 4', 20],
      ['10 - 4 - 3', 3],
      ['20 / 4 / 5', 1],
      ['7 / 2', 3.5],
      ['-3 + 5', 2],
      ['--3', 3],
      ['2 * -3', -6],
      ['-(2 + 3)', -5],
      ['((4))', 4],
    ])('%s = %d', (text, expected) => {
      expect(value(text)).toBe(expected);
    });
  });

  describe('functions', () => {
    it.each([
      ['floor(7 / 2)', 3],
      ['floor(-1 / 2)', -1],
      ['ceil(7 / 2)', 4],
      ['round(5 / 2)', 3],
      ['min(3, 1, 2)', 1],
      ['max(3, 1, 2)', 3],
      ['max(4)', 4],
      ['abs(0 - 4)', 4],
      ['FLOOR(9 / 2)', 4],
      ['max(1, floor(7 / 2) * 2)', 6],
    ])('%s = %d', (text, expected) => {
      expect(value(text)).toBe(expected);
    });
  });

  describe('variables', () => {
    it('reads @variables', () => {
      expect(value('@str + 1', { str: 15 })).toBe(16);
    });

    it('computes an ability modifier', () => {
      const modifier = 'floor((@str - 10) / 2)';
      expect(value(modifier, { str: 15 })).toBe(2);
      expect(value(modifier, { str: 10 })).toBe(0);
      expect(value(modifier, { str: 7 })).toBe(-2);
    });

    it('allows underscores and digits in names', () => {
      expect(value('@str_mod + @rank2', { str_mod: 3, rank2: 4 })).toBe(7);
    });

    it('rejects an unknown variable at evaluation time', () => {
      expect(() => value('@str + 1', { dex: 3 })).toThrow(FormulaError);
      expect(() => value('@str + 1', { dex: 3 })).toThrow(/str/);
    });

    it('lists the variables it references, once each, in order', () => {
      expect(formulaReferences(parseFormula('@a + floor(@b * 2) + @a + 1d6'))).toEqual(['a', 'b']);
      expect(formulaReferences(parseFormula('3'))).toEqual([]);
    });
  });

  describe('dice', () => {
    it('rolls dice inside a formula and records them', () => {
      const result = evaluateFormula(parseFormula('1d20 + @mod'), { mod: 3 }, scriptedRandom([9]));
      expect(result.value).toBe(13);
      expect(result.dice).toHaveLength(1);
      expect(result.dice[0]).toMatchObject({ sides: 20, dice: [{ value: 10, kept: true }], subtotal: 10 });
    });

    it('rolls dice left to right', () => {
      const result = evaluateFormula(parseFormula('1d4 + 2d6'), {}, scriptedRandom([3, 0, 5]));
      expect(result.value).toBe(4 + 1 + 6);
      expect(result.dice.map((d) => d.sides)).toEqual([4, 6]);
    });

    it('supports d%, implicit count, keep/drop, and uppercase D', () => {
      expect(evaluateFormula(parseFormula('d%'), {}, scriptedRandom([41])).value).toBe(42);
      expect(evaluateFormula(parseFormula('2d20kh1'), {}, scriptedRandom([4, 16])).value).toBe(17);
      expect(evaluateFormula(parseFormula('4d6dl1'), {}, scriptedRandom([0, 5, 2, 3])).value).toBe(13);
      expect(evaluateFormula(parseFormula('1D8'), {}, scriptedRandom([7])).value).toBe(8);
    });

    it('lets arithmetic act on dice', () => {
      expect(evaluateFormula(parseFormula('(1d4 + 1) * 2'), {}, scriptedRandom([3])).value).toBe(10);
      expect(evaluateFormula(parseFormula('-1d6'), {}, scriptedRandom([2])).value).toBe(-3);
    });

    it('reports whether a formula rolls dice', () => {
      expect(formulaHasDice(parseFormula('1d20 + 2'))).toBe(true);
      expect(formulaHasDice(parseFormula('max(1, 2d4)'))).toBe(true);
      expect(formulaHasDice(parseFormula('10 + @dex'))).toBe(false);
    });

    it('returns no dice for a formula without them', () => {
      expect(evaluateFormula(parseFormula('2 + 2'), {}, noDice).dice).toEqual([]);
    });
  });

  describe('invalid formulas', () => {
    it.each([
      '',
      '   ',
      '2 +',
      '(2',
      '2)',
      '@',
      '@1x',
      '@str @dex',
      '2 3',
      'foo(1)',
      'floor()',
      'floor(1, 2)',
      'abs(1, 2)',
      'min()',
      'max(1,)',
      'floor',
      'str',
      '$',
      '1.5',
      '2d',
      '2d6x',
      '0d6',
      '2d0',
      '4d6kh5',
      '1001d6',
      '* 2',
    ])('rejects %j', (text) => {
      expect(() => parseFormula(text)).toThrow(FormulaError);
    });

    it('reports the position of the problem', () => {
      expect(errorFor('2 + $').position).toBe(4);
      expect(errorFor('2 +').position).toBe(3);
      expect(errorFor('foo(1)').position).toBe(0);
    });

    it('names an unknown function', () => {
      expect(errorFor('foo(1)').message).toMatch(/foo/);
    });

    it('rejects division by zero at evaluation time', () => {
      expect(() => value('1 / (2 - 2)')).toThrow(FormulaError);
    });
  });
});
