import { describe, expect, it } from 'vitest';
import { scriptedRandom } from '../random';
import { DICE_TIMING, addToTray, planRollAnimation, removeFromTray, roll, trayNotation } from './index';

// The roll animation is planned from the result, which is decided first:
// dice tumble and land on faces already known. Pure: no graphics.

const T = DICE_TIMING;
const rolled = (notation: string, draws: number[]) => roll(notation, scriptedRandom(draws));

describe('planRollAnimation', () => {
  it('throws, tumbles, settles, then reveals the total and holds it', () => {
    const plan = planRollAnimation(rolled('1d20+3', [9]), 'normal');
    expect(plan.pieces).toEqual([
      { kind: 'die', sides: 20, face: 10, kept: true, startMs: 0, landMs: T.throwMs + T.tumbleMs, crit: null },
    ]);
    expect(plan.totalAtMs).toBe(T.throwMs + T.tumbleMs + T.settleMs);
    expect(plan.endMs).toBe(plan.totalAtMs + T.revealHoldMs);
    expect(plan.bigMoment).toBeNull();
  });

  it('reads the result in about a second and a half', () => {
    const plan = planRollAnimation(rolled('1d20', [9]), 'normal');
    expect(plan.totalAtMs).toBeGreaterThanOrEqual(1200);
    expect(plan.totalAtMs).toBeLessThanOrEqual(1600);
  });

  it('staggers several dice so they land clack-clack-clack, total after the last', () => {
    const plan = planRollAnimation(rolled('3d6', [0, 1, 2]), 'normal');
    const starts = plan.pieces.map((piece) => piece.startMs);
    expect(starts[0]).toBe(0);
    const gap = (starts[1] ?? 0) - (starts[0] ?? 0);
    expect(gap).toBeGreaterThanOrEqual(50);
    expect(gap).toBeLessThanOrEqual(80);
    expect(starts[2]! - starts[1]!).toBe(gap);
    expect(plan.totalAtMs).toBe(Math.max(...plan.pieces.map((piece) => piece.landMs)) + T.settleMs);
  });

  it('speeds up big pools so the total time stays near the target', () => {
    const plan = planRollAnimation(rolled('20d6', new Array(20).fill(2)), 'normal');
    expect(plan.pieces).toHaveLength(20);
    expect(Math.max(...plan.pieces.map((piece) => piece.startMs))).toBeLessThanOrEqual(300);
    expect(plan.totalAtMs).toBeLessThanOrEqual(1700);
  });

  it('spins coins for about a second and shows heads or tails', () => {
    const plan = planRollAnimation(rolled('2 coins', [1, 0]), 'normal');
    expect(plan.pieces.map((piece) => [piece.kind, piece.face])).toEqual([
      ['coin', 'heads'],
      ['coin', 'tails'],
    ]);
    expect(plan.pieces[0]?.landMs).toBe(T.coinSpinMs);
  });

  it('still animates dice that a keep/drop discards, marked as not kept', () => {
    const plan = planRollAnimation(rolled('4d6kh3', [0, 5, 2, 3]), 'normal');
    expect(plan.pieces.map((piece) => piece.kept)).toEqual([false, true, true, true]);
  });

  it('makes a big moment of a natural 20 or natural 1, and holds it longer', () => {
    const nat20 = planRollAnimation(rolled('1d20+5', [19]), 'normal');
    expect(nat20.bigMoment).toBe('max');
    expect(nat20.pieces[0]?.crit).toBe('max');
    expect(nat20.endMs).toBe(nat20.totalAtMs + T.revealHoldMs + T.bigMomentExtraMs);
    expect(planRollAnimation(rolled('1d20', [0]), 'normal').bigMoment).toBe('min');
  });

  it('counts the kept die of an advantage roll', () => {
    expect(planRollAnimation(rolled('2d20kh1', [4, 19]), 'normal').bigMoment).toBe('max');
    // A natural 1 that was dropped doesn't count.
    expect(planRollAnimation(rolled('2d20kh1', [0, 14]), 'normal').bigMoment).toBeNull();
  });

  it('treats a single die of any size the same way', () => {
    expect(planRollAnimation(rolled('1d6', [5]), 'normal').bigMoment).toBe('max');
  });

  it("doesn't make every 6 in a handful of dice a big moment", () => {
    const plan = planRollAnimation(rolled('3d6', [5, 5, 0]), 'normal');
    expect(plan.bigMoment).toBeNull();
    expect(plan.pieces.every((piece) => piece.crit === null)).toBe(true);
  });

  it('scales with the speed setting', () => {
    const normal = planRollAnimation(rolled('1d20', [9]), 'normal');
    const fast = planRollAnimation(rolled('1d20', [9]), 'fast');
    const dramatic = planRollAnimation(rolled('1d20', [9]), 'dramatic');
    expect(fast.endMs).toBeLessThan(normal.endMs);
    expect(dramatic.endMs).toBeGreaterThan(normal.endMs);
  });

  it('shows the result at once with animations off', () => {
    const plan = planRollAnimation(rolled('3d6', [0, 1, 2]), 'off');
    expect(plan.totalAtMs).toBe(0);
    expect(plan.pieces.every((piece) => piece.landMs === 0)).toBe(true);
  });

  it('has nothing to throw for a plain number', () => {
    expect(planRollAnimation(rolled('7', []), 'normal').pieces).toEqual([]);
  });
});

describe('the dice tray', () => {
  it('collects dice into notation in a standard order', () => {
    let tray = addToTray({}, 20);
    tray = addToTray(tray, 6);
    tray = addToTray(tray, 'coin');
    tray = addToTray(tray, 6);
    expect(trayNotation(tray)).toBe('2d6 + 1d20 + 1 coin');
    expect(trayNotation(addToTray(addToTray({}, 'coin'), 'coin'))).toBe('2 coins');
  });

  it('takes dice back out', () => {
    const tray = addToTray(addToTray({}, 8), 8);
    expect(trayNotation(removeFromTray(tray, 8))).toBe('1d8');
    expect(trayNotation(removeFromTray(removeFromTray(tray, 8), 8))).toBe('');
    expect(removeFromTray({}, 4)).toEqual({});
  });

  it('supports any number of sides, like a d7', () => {
    expect(trayNotation(addToTray({}, 7))).toBe('1d7');
  });

  it('is empty to begin with', () => {
    expect(trayNotation({})).toBe('');
  });

  it('never makes a roll the parser would refuse', () => {
    let tray = {};
    for (let i = 0; i < 1200; i++) tray = addToTray(tray, 6);
    expect(trayNotation(tray)).toBe('1000d6');
  });
});
