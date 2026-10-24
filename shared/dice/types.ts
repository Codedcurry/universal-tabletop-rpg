export type Sign = 1 | -1;

/** kh = keep highest, kl = keep lowest, dh = drop highest, dl = drop lowest. */
export type KeepMode = 'kh' | 'kl' | 'dh' | 'dl';

export interface KeepRule {
  readonly mode: KeepMode;
  readonly count: number;
}

export interface DiceTerm {
  readonly kind: 'dice';
  readonly sign: Sign;
  readonly count: number;
  readonly sides: number;
  readonly keep?: KeepRule;
}

export interface ConstantTerm {
  readonly kind: 'constant';
  readonly sign: Sign;
  readonly value: number;
}

/** Coin flips; the term's value is the number of heads. */
export interface CoinTerm {
  readonly kind: 'coin';
  readonly sign: Sign;
  readonly count: number;
}

export type Term = DiceTerm | ConstantTerm | CoinTerm;

/** A parsed roll, reusable for re-rolls and saved favorites. */
export interface DiceExpression {
  /** The text exactly as the user typed it. */
  readonly source: string;
  readonly terms: readonly Term[];
}

export interface DieResult {
  readonly value: number;
  /** False when a keep/drop modifier discarded this die. */
  readonly kept: boolean;
}

export interface DiceTermResult {
  readonly kind: 'dice';
  readonly sign: Sign;
  readonly sides: number;
  readonly keep?: KeepRule;
  readonly dice: readonly DieResult[];
  readonly subtotal: number;
}

export interface ConstantTermResult {
  readonly kind: 'constant';
  readonly sign: Sign;
  readonly value: number;
  readonly subtotal: number;
}

export type CoinFace = 'heads' | 'tails';

export interface CoinTermResult {
  readonly kind: 'coin';
  readonly sign: Sign;
  readonly flips: readonly CoinFace[];
  readonly subtotal: number;
}

export type TermResult = DiceTermResult | ConstantTermResult | CoinTermResult;

export interface RollResult {
  readonly notation: string;
  readonly terms: readonly TermResult[];
  readonly total: number;
}
