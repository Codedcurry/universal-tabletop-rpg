import {
  DiceNotationError,
  type DiceTerm,
  type DiceTermResult,
  type KeepMode,
  checkCount,
  checkKeep,
  checkSides,
  rollDiceTerm,
} from '../dice';
import type { RandomSource } from '../random';

/**
 * Formulas: arithmetic over numbers, dice, and @variables, used by game system
 * files. Examples: `floor((@str - 10) / 2)`, `1d20 + @str_mod + @prof`.
 *
 * Grammar:
 *   expr    := term (('+' | '-') term)*
 *   term    := unary (('*' | '/') unary)*
 *   unary   := '-' unary | primary
 *   primary := INTEGER | DICE | '@' NAME | FUNCTION '(' expr (',' expr)* ')' | '(' expr ')'
 *   DICE    := INTEGER? 'd' (INTEGER | '%') (('kh' | 'kl' | 'dh' | 'dl') INTEGER?)?
 */

export class FormulaError extends Error {
  readonly position: number;

  constructor(message: string, position: number) {
    super(message);
    this.name = 'FormulaError';
    this.position = position;
  }
}

const FUNCTIONS = {
  floor: { minArgs: 1, maxArgs: 1, apply: (args: number[]) => Math.floor(args[0] as number) },
  ceil: { minArgs: 1, maxArgs: 1, apply: (args: number[]) => Math.ceil(args[0] as number) },
  round: { minArgs: 1, maxArgs: 1, apply: (args: number[]) => Math.round(args[0] as number) },
  abs: { minArgs: 1, maxArgs: 1, apply: (args: number[]) => Math.abs(args[0] as number) },
  min: { minArgs: 1, maxArgs: Infinity, apply: (args: number[]) => Math.min(...args) },
  max: { minArgs: 1, maxArgs: Infinity, apply: (args: number[]) => Math.max(...args) },
} as const;

type FunctionName = keyof typeof FUNCTIONS;

function isFunctionName(name: string): name is FunctionName {
  return Object.hasOwn(FUNCTIONS, name);
}

export type FormulaNode =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'variable'; readonly name: string; readonly position: number }
  | { readonly kind: 'dice'; readonly term: DiceTerm }
  | { readonly kind: 'negate'; readonly operand: FormulaNode }
  | {
      readonly kind: 'binary';
      readonly operator: '+' | '-' | '*' | '/';
      readonly left: FormulaNode;
      readonly right: FormulaNode;
      readonly position: number;
    }
  | { readonly kind: 'call'; readonly name: FunctionName; readonly args: readonly FormulaNode[] };

export interface Formula {
  readonly source: string;
  readonly root: FormulaNode;
}

export interface FormulaResult {
  readonly value: number;
  /** Every dice roll made while evaluating, left to right, for the roll log. */
  readonly dice: readonly DiceTermResult[];
}

// ---------------------------------------------------------------------------
// Tokenizer

type SymbolText = '+' | '-' | '*' | '/' | '(' | ')' | ',';

type Token =
  | { readonly type: 'number'; readonly value: number; readonly start: number }
  | { readonly type: 'dice'; readonly term: DiceTerm; readonly start: number }
  | { readonly type: 'variable'; readonly name: string; readonly start: number }
  | { readonly type: 'name'; readonly name: string; readonly start: number }
  | { readonly type: 'symbol'; readonly text: SymbolText; readonly start: number };

const DICE_PATTERN = /^(\d*)d(\d+|%)(?:(kh|kl|dh|dl)(\d*))?/i;
const NAME_PATTERN = /^[a-z_][a-z0-9_]*/i;
const NAME_CHAR = /[a-z0-9_]/i;
const SYMBOLS: ReadonlySet<string> = new Set<SymbolText>(['+', '-', '*', '/', '(', ')', ',']);

function diceToken(match: RegExpExecArray, start: number): Token {
  const [, countText = '', sidesText = '', keepText, keepCountText] = match;
  const count = countText === '' ? 1 : Number(countText);
  const sidesStart = start + countText.length + 1;
  try {
    checkCount(count, 'dice', start);
    const sides = sidesText === '%' ? 100 : Number(sidesText);
    checkSides(sides, sidesStart);
    const term: DiceTerm = { kind: 'dice', sign: 1, count, sides };
    if (keepText === undefined) return { type: 'dice', term, start };
    const mode = keepText.toLowerCase() as KeepMode;
    const keepCount = keepCountText ? Number(keepCountText) : 1;
    checkKeep(mode, keepCount, count, sidesStart + sidesText.length);
    return { type: 'dice', term: { ...term, keep: { mode, count: keepCount } }, start };
  } catch (error) {
    if (error instanceof DiceNotationError) throw new FormulaError(error.message, error.position);
    throw error;
  }
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const dice = /[\dd]/i.test(ch) ? DICE_PATTERN.exec(text.slice(i)) : null;
    if (dice) {
      tokens.push(diceToken(dice, i));
      i += dice[0].length;
      if (i < text.length && NAME_CHAR.test(text[i] as string)) {
        throw new FormulaError(`Unexpected "${text[i]}" after dice`, i);
      }
    } else if (/\d/.test(ch)) {
      const start = i;
      while (i < text.length && /\d/.test(text[i] as string)) i++;
      tokens.push({ type: 'number', value: Number(text.slice(start, i)), start });
    } else if (ch === '@') {
      const name = NAME_PATTERN.exec(text.slice(i + 1));
      if (!name) throw new FormulaError('Expected a variable name after "@"', i);
      tokens.push({ type: 'variable', name: name[0], start: i });
      i += 1 + name[0].length;
    } else if (NAME_PATTERN.test(ch)) {
      const name = NAME_PATTERN.exec(text.slice(i)) as RegExpExecArray;
      tokens.push({ type: 'name', name: name[0].toLowerCase(), start: i });
      i += name[0].length;
    } else if (SYMBOLS.has(ch)) {
      tokens.push({ type: 'symbol', text: ch as SymbolText, start: i });
      i++;
    } else {
      throw new FormulaError(`Unexpected "${ch}"`, i);
    }
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser

export function parseFormula(source: string): Formula {
  const tokens = tokenize(source);
  let index = 0;

  const peek = (): Token | undefined => tokens[index];
  const positionOf = (token: Token | undefined) => token?.start ?? source.length;

  function isSymbol(token: Token | undefined, text: string): boolean {
    return token?.type === 'symbol' && token.text === text;
  }

  function expectSymbol(text: string): void {
    const token = peek();
    if (!isSymbol(token, text)) {
      throw new FormulaError(`Expected "${text}"`, positionOf(token));
    }
    index++;
  }

  function parseExpression(): FormulaNode {
    let left = parseTerm();
    for (let token = peek(); isSymbol(token, '+') || isSymbol(token, '-'); token = peek()) {
      index++;
      const operator = (token as { text: '+' | '-' }).text;
      left = { kind: 'binary', operator, left, right: parseTerm(), position: (token as Token).start };
    }
    return left;
  }

  function parseTerm(): FormulaNode {
    let left = parseUnary();
    for (let token = peek(); isSymbol(token, '*') || isSymbol(token, '/'); token = peek()) {
      index++;
      const operator = (token as { text: '*' | '/' }).text;
      left = { kind: 'binary', operator, left, right: parseUnary(), position: (token as Token).start };
    }
    return left;
  }

  function parseUnary(): FormulaNode {
    if (isSymbol(peek(), '-')) {
      index++;
      return { kind: 'negate', operand: parseUnary() };
    }
    return parsePrimary();
  }

  function parsePrimary(): FormulaNode {
    const token = peek();
    if (token === undefined) throw new FormulaError('Expected a value', source.length);
    switch (token.type) {
      case 'number':
        index++;
        return { kind: 'number', value: token.value };
      case 'dice':
        index++;
        return { kind: 'dice', term: token.term };
      case 'variable':
        index++;
        return { kind: 'variable', name: token.name, position: token.start };
      case 'name':
        return parseCall(token);
      case 'symbol': {
        if (token.text !== '(') throw new FormulaError(`Unexpected "${token.text}"`, token.start);
        index++;
        const inner = parseExpression();
        expectSymbol(')');
        return inner;
      }
    }
  }

  function parseCall(token: Extract<Token, { type: 'name' }>): FormulaNode {
    if (!isFunctionName(token.name)) {
      throw new FormulaError(
        `Unknown function "${token.name}" (variables start with @, functions are ${Object.keys(FUNCTIONS).join(', ')})`,
        token.start,
      );
    }
    index++;
    expectSymbol('(');
    const args = [parseExpression()];
    while (isSymbol(peek(), ',')) {
      index++;
      args.push(parseExpression());
    }
    expectSymbol(')');
    const { minArgs, maxArgs } = FUNCTIONS[token.name];
    if (args.length < minArgs || args.length > maxArgs) {
      const expected = maxArgs === minArgs ? `${minArgs}` : `at least ${minArgs}`;
      throw new FormulaError(`${token.name}() takes ${expected} argument(s), got ${args.length}`, token.start);
    }
    return { kind: 'call', name: token.name, args };
  }

  if (tokens.length === 0) throw new FormulaError('Formula is empty', 0);
  const root = parseExpression();
  if (index < tokens.length) {
    throw new FormulaError('Expected an operator such as + or *', positionOf(peek()));
  }
  return { source, root };
}

// ---------------------------------------------------------------------------
// Evaluation and inspection

function applyOperator(node: Extract<FormulaNode, { kind: 'binary' }>, left: number, right: number): number {
  switch (node.operator) {
    case '+':
      return left + right;
    case '-':
      return left - right;
    case '*':
      return left * right;
    case '/':
      if (right === 0) throw new FormulaError('Division by zero', node.position);
      return left / right;
  }
}

export function evaluateFormula(
  formula: Formula,
  vars: Readonly<Record<string, number>>,
  random: RandomSource,
): FormulaResult {
  const dice: DiceTermResult[] = [];

  function evaluate(node: FormulaNode): number {
    switch (node.kind) {
      case 'number':
        return node.value;
      case 'variable': {
        if (!Object.hasOwn(vars, node.name)) {
          throw new FormulaError(`Unknown variable @${node.name}`, node.position);
        }
        return vars[node.name] as number;
      }
      case 'dice': {
        const result = rollDiceTerm(node.term, random);
        dice.push(result);
        return result.subtotal;
      }
      case 'negate':
        return -evaluate(node.operand);
      case 'binary':
        return applyOperator(node, evaluate(node.left), evaluate(node.right));
      case 'call':
        return FUNCTIONS[node.name].apply(node.args.map(evaluate));
    }
  }

  const value = evaluate(formula.root) + 0;
  return { value, dice };
}

function walk(node: FormulaNode, visit: (node: FormulaNode) => void): void {
  visit(node);
  switch (node.kind) {
    case 'negate':
      walk(node.operand, visit);
      break;
    case 'binary':
      walk(node.left, visit);
      walk(node.right, visit);
      break;
    case 'call':
      for (const arg of node.args) walk(arg, visit);
      break;
    default:
      break;
  }
}

/** Variable names the formula uses, once each, in order of appearance. */
export function formulaReferences(formula: Formula): string[] {
  const names = new Set<string>();
  walk(formula.root, (node) => {
    if (node.kind === 'variable') names.add(node.name);
  });
  return [...names];
}

export function formulaHasDice(formula: Formula): boolean {
  let found = false;
  walk(formula.root, (node) => {
    if (node.kind === 'dice') found = true;
  });
  return found;
}
