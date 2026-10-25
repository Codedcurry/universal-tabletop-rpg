import { describe, expect, it } from 'vitest';
import { scriptedRandom } from '../random';
import { BOX_LIMIT, boxPieces, faceLabels } from './box';
import { planRollAnimation } from './animation';
import { dieGeometry, upwardFace } from './polyhedra';
import { roll } from './roll';

// Turning a roll into dice for the dice box: which shape to throw for each
// die, what the face on top must show, and every face's label after
// relabelling (so the result shown is always the decided one).

const plan = (notation: string, draws: number[]) => planRollAnimation(roll(notation, scriptedRandom(draws)), 'normal');

describe('boxPieces', () => {
  it('throws a real die for each die rolled', () => {
    const { pieces, extra } = boxPieces(plan('2d6 + 1d20', [2, 4, 16]));
    expect(pieces.map((piece) => [piece.shape, piece.wanted])).toEqual([
      ['d6', 3],
      ['d6', 5],
      ['d20', 17],
    ]);
    expect(extra).toBe(0);
  });

  it('throws two d10s for a d100: tens and ones', () => {
    const [tens, ones] = boxPieces(plan('1d100', [46])).pieces; // 47
    expect(tens).toMatchObject({ shape: 'd10', text: 'tens', wanted: 4 });
    expect(ones).toMatchObject({ shape: 'd10', text: 'ones', wanted: 7 });
    const hundred = boxPieces(plan('1d100', [99])).pieces;
    expect(hundred.map((piece) => piece.wanted)).toEqual([10, 10]); // "00" and "0"
    const seven = boxPieces(plan('1d100', [6])).pieces;
    expect(seven.map((piece) => piece.wanted)).toEqual([10, 7]); // "00" and "7"
  });

  it('flips a coin, and shows dice with no real shape as a cube with the value all over', () => {
    const coin = boxPieces(plan('1 coin', [0])).pieces[0]!;
    expect(coin.shape).toBe('coin');
    const odd = boxPieces(plan('1d7', [4])).pieces[0]!;
    expect(odd).toMatchObject({ shape: 'd6', text: 'all', value: 5 });
  });

  it('marks dice not kept, and crits', () => {
    const pieces = boxPieces(plan('2d20kh1', [19, 4])).pieces;
    expect(pieces.map((piece) => piece.dropped)).toEqual([false, true]);
    expect(pieces[0]!.crit).toBe('max');
  });

  it(`throws at most ${BOX_LIMIT} dice, counting the rest`, () => {
    const { pieces, extra } = boxPieces(plan('30d6', Array.from({ length: 30 }, () => 0)));
    expect(pieces).toHaveLength(BOX_LIMIT);
    expect(extra).toBe(30 - BOX_LIMIT);
  });
});

describe('faceLabels', () => {
  it('shows the decided value on whichever face landed up', () => {
    const [piece] = boxPieces(plan('1d20', [16])).pieces; // 17
    const geometry = dieGeometry('d20');
    for (const landed of [0, 5, 19]) {
      const labels = faceLabels(piece!, landed);
      expect(labels[landed]).toBe('17');
      expect([...labels].sort()).toEqual(Array.from({ length: 20 }, (_, i) => String(i + 1)).sort());
    }
    expect(upwardFace(geometry, [0, 0, 0, 1])).toBeGreaterThanOrEqual(0);
  });

  it('writes d100 dice as tens and ones', () => {
    const [tens, ones] = boxPieces(plan('1d100', [99])).pieces;
    expect(faceLabels(tens!, 3)[3]).toBe('00');
    expect(faceLabels(ones!, 3)[3]).toBe('0');
    expect(faceLabels(tens!, 0)).toContain('40');
  });

  it("puts a d4's result on the corner that landed up", () => {
    const [piece] = boxPieces(plan('1d4', [2])).pieces; // 3
    expect(faceLabels(piece!, 1)[1]).toBe('3');
  });

  it("labels a coin's sides H and T, and leaves its rim blank", () => {
    const [heads] = boxPieces(plan('1 coin', [0])).pieces;
    const geometry = dieGeometry('coin');
    const top = geometry.faceValues.indexOf(1);
    const labels = faceLabels(heads!, top);
    expect(labels[top]).toBe(heads!.wanted === 1 ? 'H' : 'T');
    expect(labels.filter((label) => label === '')).toHaveLength(geometry.faces.length - 2);
  });
});
