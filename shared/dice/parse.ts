import type { DiceExpression, DiceTerm, KeepMode, KeepRule, Sign, Term } from './types';

export const MAX_DICE_PER_TERM = 1000;
export const MAX_SIDES = 1_000_000;

export class DiceNotationError extends Error {
  /** Index into the original text where the problem is. */
  readonly position: number;

  constructor(message: string, position: number) {
    super(message);
    this.name = 'DiceNotationError';
    this.position = position;
  }
}

type Token =
  | { readonly type: 'number'; readonly value: number; readonly text: string; readonly start: number }
  | { readonly type: 'word'; readonly text: string; readonly start: number }
  | { readonly type: 'symbol'; readonly text: '+' | '-' | '%'; readonly start: number };

const KEEP_MODES: ReadonlySet<string> = new Set<KeepMode>(['kh', 'kl', 'dh', 'dl']);
const COIN_WORDS: ReadonlySet<string> = new Set(['coin', 'coins']);

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (/\s/.test(ch)) {
      i++;
    } else if (/\d/.test(ch)) {
      const start = i;
      while (i < text.length && /\d/.test(text[i] as string)) i++;
      const digits = text.slice(start, i);
      tokens.push({ type: 'number', value: Number(digits), text: digits, start });
    } else if (/[a-z]/i.test(ch)) {
      const start = i;
      while (i < text.length && /[a-z]/i.test(text[i] as string)) i++;
      tokens.push({ type: 'word', text: text.slice(start, i).toLowerCase(), start });
    } else if (ch === '+' || ch === '-' || ch === '%') {
      tokens.push({ type: 'symbol', text: ch, start: i });
      i++;
    } else {
      throw new DiceNotationError(`Unexpected "${ch}"`, i);
    }
  }
  return tokens;
}

// The checks below are shared with the formula parser so dice inside formulas
// follow exactly the same limits.

/** Validates how many dice (or coins) a term rolls. */
export function checkCount(count: number, what: 'dice' | 'coins', position: number): void {
  if (count < 1) throw new DiceNotationError(`Need at least 1 ${what}`, position);
  if (count > MAX_DICE_PER_TERM) throw new DiceNotationError(`At most ${MAX_DICE_PER_TERM} ${what} per roll`, position);
}

export function checkSides(sides: number, position: number): void {
  if (sides < 1) throw new DiceNotationError('A die needs at least 1 side', position);
  if (sides > MAX_SIDES) throw new DiceNotationError(`At most ${MAX_SIDES} sides per die`, position);
}

/** Keeping or dropping must leave at least one die and no more than were rolled. */
export function checkKeep(mode: KeepMode, count: number, diceCount: number, position: number): void {
  const keeping = mode === 'kh' || mode === 'kl';
  if (keeping && count < 1) {
    throw new DiceNotationError('Must keep at least 1 die', position);
  }
  if (keeping && count > diceCount) {
    throw new DiceNotationError(`Can't keep ${count} of ${diceCount} dice`, position);
  }
  if (!keeping && count < 1) {
    throw new DiceNotationError('Must drop at least 1 die', position);
  }
  if (!keeping && count >= diceCount) {
    throw new DiceNotationError(`Dropping ${count} of ${diceCount} dice leaves none to keep`, position);
  }
}

function describe(token: Token): string {
  return `"${token.text}"`;
}

/**
 * Parses dice notation such as `2d6+3`, `4d6kh3`, `1d20-1`, `3d8+1d6`, `d%`,
 * `d7`, or `5 coins`. Throws DiceNotationError on invalid input.
 */
export function parseDice(source: string): DiceExpression {
  const tokens = tokenize(source);
  let index = 0;

  const peek = (): Token | undefined => tokens[index];
  const endPosition = source.length;
  const positionOf = (token: Token | undefined) => token?.start ?? endPosition;

  function isWord(token: Token | undefined, words: ReadonlySet<string> | string): boolean {
    if (token?.type !== 'word') return false;
    return typeof words === 'string' ? token.text === words : words.has(token.text);
  }

  function parseKeep(diceCount: number): KeepRule | undefined {
    const token = peek();
    if (token?.type !== 'word' || !KEEP_MODES.has(token.text)) return undefined;
    index++;
    const mode = token.text as KeepMode;
    let count = 1;
    const next = peek();
    if (next?.type === 'number') {
      count = next.value;
      index++;
    }
    checkKeep(mode, count, diceCount, token.start);
    return { mode, count };
  }

  function parseDiceRest(sign: Sign, count: number, countPosition: number): DiceTerm {
    index++; // the "d"
    checkCount(count, 'dice', countPosition);
    const sidesToken = peek();
    let sides: number;
    if (sidesToken?.type === 'number') {
      sides = sidesToken.value;
      checkSides(sides, sidesToken.start);
    } else if (sidesToken?.type === 'symbol' && sidesToken.text === '%') {
      sides = 100;
    } else {
      throw new DiceNotationError('Expected the number of sides after "d"', positionOf(sidesToken));
    }
    index++;
    const keep = parseKeep(count);
    return keep ? { kind: 'dice', sign, count, sides, keep } : { kind: 'dice', sign, count, sides };
  }

  function parseTerm(sign: Sign): Term {
    const token = peek();
    if (token === undefined) {
      throw new DiceNotationError('Expected a number or dice', endPosition);
    }
    if (token.type === 'number') {
      const next = tokens[index + 1];
      if (isWord(next, 'd')) {
        index++;
        return parseDiceRest(sign, token.value, token.start);
      }
      if (isWord(next, COIN_WORDS)) {
        checkCount(token.value, 'coins', token.start);
        index += 2;
        return { kind: 'coin', sign, count: token.value };
      }
      if (!Number.isSafeInteger(token.value)) {
        throw new DiceNotationError('Number is too large', token.start);
      }
      index++;
      return { kind: 'constant', sign, value: token.value };
    }
    if (isWord(token, 'd')) return parseDiceRest(sign, 1, token.start);
    if (isWord(token, COIN_WORDS)) {
      index++;
      return { kind: 'coin', sign, count: 1 };
    }
    throw new DiceNotationError(`Unexpected ${describe(token)}`, token.start);
  }

  function parseSign(): Sign | undefined {
    const token = peek();
    if (token?.type !== 'symbol' || token.text === '%') return undefined;
    index++;
    return token.text === '-' ? -1 : 1;
  }

  if (tokens.length === 0) {
    throw new DiceNotationError('Enter a roll, like 2d6+3', 0);
  }

  const terms: Term[] = [parseTerm(parseSign() ?? 1)];
  while (index < tokens.length) {
    const sign = parseSign();
    if (sign === undefined) {
      const token = peek() as Token;
      throw new DiceNotationError(`Expected + or - before ${describe(token)}`, token.start);
    }
    terms.push(parseTerm(sign));
  }

  return { source, terms };
}

/** One physical die or coin a player has to roll and read. */
export type RollSlot = { readonly kind: 'die'; readonly sides: number } | { readonly kind: 'coin' };

/** Every die and coin in a roll, in roll order (including dice a keep/drop will discard). */
export function rollSlots(expression: DiceExpression): RollSlot[] {
  return expression.terms.flatMap((term): RollSlot[] => {
    if (term.kind === 'dice') return Array.from({ length: term.count }, () => ({ kind: 'die', sides: term.sides }));
    if (term.kind === 'coin') return Array.from({ length: term.count }, () => ({ kind: 'coin' }));
    return [];
  });
}
