import { MAX_DICE_PER_TERM } from './parse';
import type { RollResult } from './types';

/**
 * Planning the dice animation. The result is decided first (fair, and the
 * same on every screen); the animation just tumbles to faces already known.
 * Every timing lives here, for tuning during playtesting.
 */
export const DICE_TIMING = {
  throwMs: 200,
  /** Tumbling, slowing down. */
  tumbleMs: 900,
  /** The little bounce on landing. */
  settleMs: 200,
  /** How long the total stays up after it pops in. */
  revealHoldMs: 600,
  /** Natural max / natural 1 are worth savoring. */
  bigMomentExtraMs: 400,
  /** Between dice thrown together: a quick clack-clack-clack. */
  staggerMs: 65,
  /** Big pools squeeze their stagger into this, so they don't drag on. */
  maxStaggerSpreadMs: 300,
  coinSpinMs: 1000,
} as const;

export type RollSpeed = 'fast' | 'normal' | 'dramatic' | 'off';

const SPEED_FACTOR: Record<RollSpeed, number> = { fast: 0.6, normal: 1, dramatic: 1.5, off: 0 };

export type Crit = 'max' | 'min';

export interface RollPiece {
  readonly kind: 'die' | 'coin';
  readonly sides: number;
  /** What it lands on: a die face, or heads/tails. */
  readonly face: number | 'heads' | 'tails';
  /** False for dice a keep/drop discarded (shown dimmed). */
  readonly kept: boolean;
  readonly startMs: number;
  readonly landMs: number;
  readonly crit: Crit | null;
}

export interface RollPlan {
  readonly pieces: readonly RollPiece[];
  /** When the total pops in: after the last piece lands and settles. */
  readonly totalAtMs: number;
  readonly endMs: number;
  readonly bigMoment: Crit | null;
}

export function planRollAnimation(result: RollResult, speed: RollSpeed): RollPlan {
  const factor = SPEED_FACTOR[speed];
  const T = DICE_TIMING;
  const faces: { kind: 'die' | 'coin'; sides: number; face: RollPiece['face']; kept: boolean }[] = [];
  for (const term of result.terms) {
    if (term.kind === 'dice') for (const die of term.dice) faces.push({ kind: 'die', sides: term.sides, face: die.value, kept: die.kept });
    if (term.kind === 'coin') for (const flip of term.flips) faces.push({ kind: 'coin', sides: 2, face: flip, kept: true });
  }

  // Natural max / natural 1 count on a d20, or when only one die was thrown.
  const singleDie = faces.filter((piece) => piece.kind === 'die').length === 1;
  const critOf = (piece: (typeof faces)[number]): Crit | null => {
    if (piece.kind !== 'die' || !piece.kept || piece.sides < 2 || !(piece.sides === 20 || singleDie)) return null;
    if (piece.face === piece.sides) return 'max';
    if (piece.face === 1) return 'min';
    return null;
  };

  const gap = faces.length > 1 ? Math.min(T.staggerMs, T.maxStaggerSpreadMs / (faces.length - 1)) : 0;
  const pieces: RollPiece[] = faces.map((piece, index) => {
    const startMs = index * gap * factor;
    const flight = piece.kind === 'coin' ? T.coinSpinMs : T.throwMs + T.tumbleMs;
    return { ...piece, startMs, landMs: startMs + flight * factor, crit: critOf(piece) };
  });

  const bigMoment = pieces.find((piece) => piece.crit === 'max')?.crit ?? pieces.find((piece) => piece.crit === 'min')?.crit ?? null;
  const totalAtMs = pieces.length === 0 ? 0 : Math.max(...pieces.map((piece) => piece.landMs)) + T.settleMs * factor;
  // With animation off the result still shows, briefly.
  const hold = (T.revealHoldMs + (bigMoment ? T.bigMomentExtraMs : 0)) * (factor || 1);
  return { pieces, totalAtMs, endMs: totalAtMs + hold, bigMoment };
}

// ---------------------------------------------------------------------------
// The dice tray: tap dice to collect a throw.

export type TrayDie = number | 'coin';
/** Counts by kind: "d6", "d20", "coin". */
export type Tray = Readonly<Record<string, number>>;

const keyOf = (die: TrayDie) => (die === 'coin' ? 'coin' : `d${die}`);

export function addToTray(tray: Tray, die: TrayDie): Tray {
  const key = keyOf(die);
  return { ...tray, [key]: Math.min(MAX_DICE_PER_TERM, (tray[key] ?? 0) + 1) };
}

export function removeFromTray(tray: Tray, die: TrayDie): Tray {
  const key = keyOf(die);
  const count = (tray[key] ?? 0) - 1;
  const { [key]: _removed, ...rest } = tray;
  return count > 0 ? { ...rest, [key]: count } : rest;
}

/** Dice notation for the tray: smallest dice first, coins last. */
export function trayNotation(tray: Tray): string {
  const dice = Object.entries(tray)
    .filter(([key, count]) => key !== 'coin' && count > 0)
    .map(([key, count]) => [Number(key.slice(1)), count] as const)
    .sort(([a], [b]) => a - b)
    .map(([sides, count]) => `${count}d${sides}`);
  const coins = tray.coin ?? 0;
  if (coins > 0) dice.push(coins === 1 ? '1 coin' : `${coins} coins`);
  return dice.join(' + ');
}
