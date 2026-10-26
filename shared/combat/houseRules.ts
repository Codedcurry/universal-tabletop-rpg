import type { GameSystem } from '../system';

/**
 * House rules: the DM's rulings, kept. When the engine refuses something
 * (out of range, out of sight, the wrong kind of target, held by a
 * condition, too far to walk), it says why and what would allow it; the DM
 * can allow it just once, or make that a house rule the engine applies from
 * then on. Each rule relaxes one check, for one ability or for all.
 */
export type HouseRule =
  /** An ability (or every ability, with null) reaches `extra` more tiles. */
  | { readonly kind: 'range'; readonly ability: string | null; readonly extra: number }
  /** An ability (or every ability) doesn't need a clear view of its target. */
  | { readonly kind: 'sight'; readonly ability: string | null }
  /** An ability can target any creature, not just enemies, allies, or its user. */
  | { readonly kind: 'target'; readonly ability: string }
  /** Creatures under a condition can still act, or still move. */
  | { readonly kind: 'condition'; readonly condition: string; readonly allows: 'act' | 'move' }
  /** Every creature moves `extra` more tiles each turn. */
  | { readonly kind: 'movement'; readonly extra: number };

/** Why the engine won't allow something, and the house rule that would (none if no ruling can). */
export interface RuleProblem {
  readonly message: string;
  readonly fix: HouseRule | null;
  /**
   * The fix is only needed this time (extra movement for a creature a
   * condition had stopped this turn): allowed, but not kept as a house rule.
   */
  readonly nowOnly?: boolean;
}

/** The most a range or movement rule can add. */
export const MAX_RULE_EXTRA = 50;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** A house rule in words: "Shoot reaches 1 more tile". */
export function describeHouseRule(rule: HouseRule, system: GameSystem | null): string {
  const ability = (id: string | null) => (id === null ? null : (system?.abilities.find((entry) => entry.id === id)?.name ?? id));
  switch (rule.kind) {
    case 'range': {
      const name = ability(rule.ability);
      return name ? `${name} reaches ${plural(rule.extra, 'more tile')}` : `Every ability reaches ${plural(rule.extra, 'more tile')}`;
    }
    case 'sight': {
      const name = ability(rule.ability);
      return name ? `${name} doesn't need a clear view of its target` : `No ability needs a clear view of its target`;
    }
    case 'target':
      return `${ability(rule.ability)} can target any creature`;
    case 'condition': {
      const name = system?.conditions.find((entry) => entry.id === rule.condition)?.name ?? rule.condition;
      return `${name} creatures can still ${rule.allows}`;
    }
    case 'movement':
      return `Every creature moves ${plural(rule.extra, 'more tile')} each turn`;
  }
}

type Data = Record<string, unknown>;
const isObject = (value: unknown): value is Data => typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9_]*$/.test(value) && value.length <= 64;
const isExtra = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_RULE_EXTRA;

/** A well-formed house rule from untrusted data (a saved game), or null. */
export function parseHouseRule(value: unknown): HouseRule | null {
  if (!isObject(value)) return null;
  switch (value.kind) {
    case 'range':
      return (value.ability === null || isId(value.ability)) && isExtra(value.extra) ? { kind: 'range', ability: value.ability, extra: value.extra } : null;
    case 'sight':
      return value.ability === null || isId(value.ability) ? { kind: 'sight', ability: value.ability } : null;
    case 'target':
      return isId(value.ability) ? { kind: 'target', ability: value.ability } : null;
    case 'condition':
      return isId(value.condition) && (value.allows === 'act' || value.allows === 'move') ? { kind: 'condition', condition: value.condition, allows: value.allows } : null;
    case 'movement':
      return isExtra(value.extra) ? { kind: 'movement', extra: value.extra } : null;
    default:
      return null;
  }
}

/** Whether a rule still means something under a system (the ability or condition it names is there). */
export function ruleFits(rule: HouseRule, system: GameSystem): boolean {
  if (rule.kind === 'condition') return system.conditions.some((condition) => condition.id === rule.condition);
  if (rule.kind === 'movement' || rule.ability === null) return true;
  return system.abilities.some((ability) => ability.id === rule.ability);
}

/**
 * The house rules with one more: a range rule for an ability that already
 * has one (or a movement rule) adds to it; a rule already there isn't kept twice.
 */
export function withRule(rules: readonly HouseRule[], rule: HouseRule): HouseRule[] {
  const index = rules.findIndex((other) =>
    rule.kind === 'range' ? other.kind === 'range' && other.ability === rule.ability : rule.kind === 'movement' ? other.kind === 'movement' : JSON.stringify(other) === JSON.stringify(rule),
  );
  if (index < 0) return [...rules, rule];
  const existing = rules[index]!;
  if ((rule.kind === 'range' && existing.kind === 'range') || (rule.kind === 'movement' && existing.kind === 'movement')) {
    return rules.map((other, at) => (at === index ? { ...rule, extra: Math.min(MAX_RULE_EXTRA, existing.extra + rule.extra) } : other));
  }
  return [...rules];
}
