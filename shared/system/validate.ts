import { FormulaError, formulaHasDice, formulaReferences, parseFormula } from '../formula';
import { GAME_SYSTEM_FORMAT_VERSION, type GameSystem } from './types';

export interface ValidationError {
  /** Where the problem is, e.g. `abilities[2].effects[0].amount`. Empty for the whole file. */
  readonly path: string;
  readonly message: string;
}

export type ValidationResult =
  | { readonly ok: true; readonly system: GameSystem }
  | { readonly ok: false; readonly errors: readonly ValidationError[] };

const ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const TARGETS = new Set(['enemy', 'ally', 'self']);
const ANIMATIONS = new Set(['melee', 'ranged', 'spell', 'item']);
const EFFECT_TYPES = new Set(['damage', 'heal', 'applyCondition']);

type Data = Record<string, unknown>;

function isObject(value: unknown): value is Data {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isInteger = (value: unknown): value is number => Number.isInteger(value);

function child(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`;
  return path === '' ? key : `${path}.${key}`;
}

/**
 * Checks that untrusted data (a user's file, an import, an AI draft) is a
 * valid game system, reporting every problem with its location.
 */
export function validateGameSystem(data: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const fail = (path: string, message: string) => {
    errors.push({ path, message });
  };

  if (!isObject(data)) {
    return { ok: false, errors: [{ path: '', message: 'A game system must be an object' }] };
  }

  // --- small field checkers; each returns whether the field was valid -------

  function requireString(obj: Data, key: string, path: string): boolean {
    const value = obj[key];
    if (typeof value !== 'string' || value.trim() === '') {
      fail(child(path, key), 'Must be a non-empty string');
      return false;
    }
    return true;
  }

  function optionalString(obj: Data, key: string, path: string): void {
    if (obj[key] !== undefined && typeof obj[key] !== 'string') fail(child(path, key), 'Must be a string');
  }

  function optionalBoolean(obj: Data, key: string, path: string): void {
    if (obj[key] !== undefined && typeof obj[key] !== 'boolean') fail(child(path, key), 'Must be true or false');
  }

  function requireInteger(obj: Data, key: string, path: string, min = -Infinity): boolean {
    const value = obj[key];
    if (!isInteger(value) || value < min) {
      fail(child(path, key), min === -Infinity ? 'Must be a whole number' : `Must be a whole number of at least ${min}`);
      return false;
    }
    return true;
  }

  function requireObject(obj: Data, key: string, path: string): Data | undefined {
    const value = obj[key];
    if (!isObject(value)) {
      fail(child(path, key), 'Must be an object');
      return undefined;
    }
    return value;
  }

  function requireList(obj: Data, key: string, path: string): unknown[] {
    const value = obj[key];
    if (!Array.isArray(value)) {
      fail(child(path, key), 'Must be a list');
      return [];
    }
    return value;
  }

  /** Checks an id field is well formed and not already in `taken`, then claims it. */
  function requireId(obj: Data, path: string, taken: Set<string>, takenMessage = 'Duplicate id'): string | undefined {
    const id = obj.id;
    const idPath = child(path, 'id');
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      fail(idPath, 'Must be lowercase letters, digits, and underscores, starting with a letter');
      return undefined;
    }
    if (taken.has(id)) {
      fail(idPath, `${takenMessage}: "${id}"`);
      return undefined;
    }
    taken.add(id);
    return id;
  }

  function requireFormula(
    obj: Data,
    key: string,
    path: string,
    variables: ReadonlySet<string>,
    options: { dice: boolean },
  ): void {
    const fieldPath = child(path, key);
    const text = obj[key];
    if (typeof text !== 'string') {
      fail(fieldPath, 'Must be a formula string');
      return;
    }
    try {
      const formula = parseFormula(text);
      const unknown = formulaReferences(formula).filter((name) => !variables.has(name));
      if (unknown.length > 0) {
        fail(fieldPath, `Unknown variable(s): ${unknown.map((name) => `@${name}`).join(', ')}`);
      }
      if (!options.dice && formulaHasDice(formula)) {
        fail(fieldPath, 'Must not roll dice');
      }
    } catch (error) {
      if (!(error instanceof FormulaError)) throw error;
      fail(fieldPath, `${error.message} (at character ${error.position + 1})`);
    }
  }

  /** Runs `check` on each entry of a list field that is an object. */
  function eachObject(obj: Data, key: string, path: string, check: (entry: Data, entryPath: string) => void): void {
    requireList(obj, key, path).forEach((entry, index) => {
      const entryPath = child(child(path, key), index);
      if (isObject(entry)) check(entry, entryPath);
      else fail(entryPath, 'Must be an object');
    });
  }

  // --- top level ------------------------------------------------------------

  if (data.formatVersion !== GAME_SYSTEM_FORMAT_VERSION) {
    fail('formatVersion', `Unsupported format version (this tool reads version ${GAME_SYSTEM_FORMAT_VERSION})`);
  }
  requireString(data, 'id', '');
  requireString(data, 'name', '');

  // --- stats and derived values: these define the formula variables ---------

  const variables = new Set<string>(['level']);
  const statIds = new Set<string>();

  eachObject(data, 'stats', '', (stat, path) => {
    const id = requireId(stat, path, variables);
    if (id) statIds.add(id);
    requireString(stat, 'name', path);
    requireInteger(stat, 'default', path);
  });

  eachObject(data, 'derived', '', (derived, path) => {
    // Formulas may only use stats, level, and derived values declared earlier.
    const visible = new Set(variables);
    requireId(derived, path, variables, 'Already used by a stat, derived value, or the reserved name "level"');
    requireString(derived, 'name', path);
    requireFormula(derived, 'formula', path, visible, { dice: false });
  });

  // --- levels ---------------------------------------------------------------

  let maxLevel: number | undefined;
  const levels = requireObject(data, 'levels', '');
  if (levels) {
    const thresholds = levels.xpThresholds;
    const valid =
      Array.isArray(thresholds) &&
      thresholds.length > 0 &&
      thresholds[0] === 0 &&
      thresholds.every((xp, i) => isInteger(xp) && (i === 0 || xp > (thresholds[i - 1] as number)));
    if (valid) maxLevel = thresholds.length;
    else fail('levels.xpThresholds', 'Must be a list of whole numbers starting at 0 and strictly increasing');
  }

  // --- core formulas --------------------------------------------------------

  const health = requireObject(data, 'health', '');
  if (health) requireFormula(health, 'max', 'health', variables, { dice: false });
  requireFormula(data, 'defense', '', variables, { dice: false });
  requireFormula(data, 'initiative', '', variables, { dice: true });

  const movement = requireObject(data, 'movement', '');
  if (movement) {
    requireFormula(movement, 'speed', 'movement', variables, { dice: false });
    const stepUpValid = requireInteger(movement, 'maxStepUp', 'movement', 0);
    requireInteger(movement, 'maxStepDown', 'movement', 0);
    if (movement.climb !== undefined) {
      const climb = requireObject(movement, 'climb', 'movement');
      if (climb) {
        // Climbing must reach higher than a normal step, or it does nothing.
        const minHeight = stepUpValid ? (movement.maxStepUp as number) + 1 : 1;
        requireInteger(climb, 'maxHeight', 'movement.climb', minHeight);
        requireInteger(climb, 'costPerLevel', 'movement.climb', 1);
      }
    }
  }

  // --- conditions -----------------------------------------------------------

  const conditionIds = new Set<string>();
  eachObject(data, 'conditions', '', (condition, path) => {
    requireId(condition, path, conditionIds);
    requireString(condition, 'name', path);
    optionalString(condition, 'description', path);
    optionalBoolean(condition, 'preventsActions', path);
    optionalBoolean(condition, 'preventsMovement', path);
  });

  // --- abilities ------------------------------------------------------------

  const abilityIds = new Set<string>();
  eachObject(data, 'abilities', '', (ability, path) => {
    requireId(ability, path, abilityIds);
    requireString(ability, 'name', path);
    optionalString(ability, 'description', path);
    requireInteger(ability, 'range', path, 0);
    if (!TARGETS.has(ability.target as string)) {
      fail(child(path, 'target'), `Must be one of: ${[...TARGETS].join(', ')}`);
    }
    if (!ANIMATIONS.has(ability.animation as string)) {
      fail(child(path, 'animation'), `Must be one of: ${[...ANIMATIONS].join(', ')}`);
    }
    if (ability.attack !== undefined) {
      const attack = requireObject(ability, 'attack', path);
      if (attack) requireFormula(attack, 'roll', child(path, 'attack'), variables, { dice: true });
    }
    if (Array.isArray(ability.effects) && ability.effects.length === 0) {
      fail(child(path, 'effects'), 'Must have at least one effect');
    }
    eachObject(ability, 'effects', path, (effect, effectPath) => {
      if (!EFFECT_TYPES.has(effect.type as string)) {
        fail(child(effectPath, 'type'), `Must be one of: ${[...EFFECT_TYPES].join(', ')}`);
      } else if (effect.type === 'applyCondition') {
        if (!conditionIds.has(effect.condition as string)) {
          fail(child(effectPath, 'condition'), `Unknown condition "${String(effect.condition)}"`);
        }
        requireInteger(effect, 'rounds', effectPath, 1);
      } else {
        requireFormula(effect, 'amount', effectPath, variables, { dice: true });
      }
    });
  });

  // --- monsters -------------------------------------------------------------

  const monsterIds = new Set<string>();
  eachObject(data, 'monsters', '', (monster, path) => {
    requireId(monster, path, monsterIds);
    requireString(monster, 'name', path);
    if (requireInteger(monster, 'level', path, 1) && maxLevel !== undefined && (monster.level as number) > maxLevel) {
      fail(child(path, 'level'), `Must be at most the max level (${maxLevel})`);
    }
    const stats = requireObject(monster, 'stats', path);
    for (const [stat, value] of Object.entries(stats ?? {})) {
      const statPath = child(child(path, 'stats'), stat);
      if (!statIds.has(stat)) fail(statPath, `Unknown stat "${stat}"`);
      else if (!isInteger(value)) fail(statPath, 'Must be a whole number');
    }
    requireList(monster, 'abilities', path).forEach((abilityId, index) => {
      if (typeof abilityId !== 'string' || !abilityIds.has(abilityId)) {
        fail(child(child(path, 'abilities'), index), `Unknown ability "${String(abilityId)}"`);
      }
    });
    requireInteger(monster, 'xpValue', path, 0);
  });

  return errors.length === 0 ? { ok: true, system: data as unknown as GameSystem } : { ok: false, errors };
}
