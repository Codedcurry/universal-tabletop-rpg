import { type RandomSource, scriptedRandom } from '../random';
import { parseDice } from './parse';
import type {
  CoinFace,
  CoinTerm,
  CoinTermResult,
  DiceExpression,
  DiceTerm,
  DiceTermResult,
  DieResult,
  KeepRule,
  RollResult,
  TermResult,
} from './types';

/**
 * Decides which dice count toward the total. Ties go to the earlier die, so
 * when equal values compete for the last kept slot, the later one is dropped.
 */
function keptFlags(values: readonly number[], keep: KeepRule | undefined): boolean[] {
  if (!keep) return values.map(() => true);
  const keepCount = keep.mode === 'kh' || keep.mode === 'kl' ? keep.count : values.length - keep.count;
  const preferHigh = keep.mode === 'kh' || keep.mode === 'dl';
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => (preferHigh ? b.value - a.value : a.value - b.value) || a.index - b.index);
  const flags = values.map(() => false);
  for (const { index } of order.slice(0, keepCount)) flags[index] = true;
  return flags;
}

export function rollDiceTerm(term: DiceTerm, random: RandomSource): DiceTermResult {
  const values = Array.from({ length: term.count }, () => random.nextInt(term.sides) + 1);
  const flags = keptFlags(values, term.keep);
  const dice: DieResult[] = values.map((value, i) => ({ value, kept: flags[i] as boolean }));
  const sum = dice.reduce((total, die) => (die.kept ? total + die.value : total), 0);
  const base = { kind: 'dice', sign: term.sign, sides: term.sides, dice, subtotal: term.sign * sum } as const;
  return term.keep ? { ...base, keep: term.keep } : base;
}

function flipCoins(term: CoinTerm, random: RandomSource): CoinTermResult {
  const flips: CoinFace[] = Array.from({ length: term.count }, () => (random.nextInt(2) === 1 ? 'heads' : 'tails'));
  const heads = flips.filter((face) => face === 'heads').length;
  return { kind: 'coin', sign: term.sign, flips, subtotal: term.sign * heads };
}

/** Rolls an already-parsed expression. Terms and dice are rolled left to right. */
export function rollDice(expression: DiceExpression, random: RandomSource): RollResult {
  const terms: TermResult[] = expression.terms.map((term) => {
    switch (term.kind) {
      case 'dice':
        return rollDiceTerm(term, random);
      case 'coin':
        return flipCoins(term, random);
      case 'constant':
        return { kind: 'constant', sign: term.sign, value: term.value, subtotal: term.sign * term.value };
    }
  });
  const total = terms.reduce((sum, term) => sum + term.subtotal, 0);
  return { notation: expression.source, terms, total };
}

/** Parses and rolls in one step. Throws DiceNotationError on invalid notation. */
export function roll(notation: string, random: RandomSource): RollResult {
  return rollDice(parseDice(notation), random);
}

export class RollReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RollReplayError';
  }
}

/**
 * Rebuilds a roll from the raw random draws that produced it (0-based, in
 * roll order). The DM uses this to verify rolls made on a player's device:
 * any draw that doesn't fit its die, or too few or too many draws, is rejected.
 */
export function replayRoll(notation: string, draws: readonly number[]): RollResult {
  const expression = parseDice(notation);
  const random = scriptedRandom(draws);
  let result: RollResult;
  try {
    result = rollDice(expression, random);
  } catch (error) {
    throw new RollReplayError(`These dice values don't fit ${notation}: ${error instanceof Error ? error.message : error}`);
  }
  if (random.remaining() > 0) throw new RollReplayError(`More dice values than ${notation} needs`);
  return result;
}
