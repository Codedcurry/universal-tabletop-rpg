import { evaluateFormula, parseFormula } from '../formula';
import type { RandomSource } from '../random';
import type { GameSystem } from './types';

/**
 * A creature's persistent data: a player's character (kept on their device) or
 * a monster instance. Everything else is computed from it by the system.
 */
export interface CreatureSheet {
  readonly id: string;
  readonly name: string;
  /** Stat values; stats left out use the system default. */
  readonly stats: Readonly<Record<string, number>>;
  readonly xp: number;
  readonly abilities: readonly string[];
}

export interface CreatureNumbers {
  readonly level: number;
  /** Every formula variable for this creature: stats, derived values, level. */
  readonly vars: Readonly<Record<string, number>>;
  readonly maxHp: number;
  readonly defense: number;
  readonly speed: number;
}

/** These formulas are validated to be dice-free, so rolling here is a bug. */
const noDice: RandomSource = {
  nextInt() {
    throw new Error('This formula must not roll dice');
  },
};

function evaluateFixed(text: string, vars: Readonly<Record<string, number>>): number {
  return evaluateFormula(parseFormula(text), vars, noDice).value;
}

export function levelForXp(system: GameSystem, xp: number): number {
  if (xp < 0) throw new RangeError(`XP cannot be negative, got ${xp}`);
  const thresholds = system.levels.xpThresholds;
  let level = 0;
  while (level < thresholds.length && (thresholds[level] as number) <= xp) level++;
  return level;
}

export function computeCreature(system: GameSystem, sheet: CreatureSheet): CreatureNumbers {
  const known = new Set(system.stats.map((stat) => stat.id));
  for (const stat of Object.keys(sheet.stats)) {
    if (!known.has(stat)) throw new Error(`${sheet.name} has a stat "${stat}" that ${system.name} does not define`);
  }

  const level = levelForXp(system, sheet.xp);
  const vars: Record<string, number> = { level };
  for (const stat of system.stats) vars[stat.id] = sheet.stats[stat.id] ?? stat.default;
  for (const derived of system.derived) vars[derived.id] = evaluateFixed(derived.formula, vars);

  return {
    level,
    vars,
    maxHp: Math.max(1, Math.floor(evaluateFixed(system.health.max, vars))),
    defense: Math.floor(evaluateFixed(system.defense, vars)),
    speed: Math.max(0, Math.floor(evaluateFixed(system.movement.speed, vars))),
  };
}

/** A complete sheet for one instance of a monster from the system's list. */
export function sheetFromMonster(system: GameSystem, monsterId: string, id: string, name?: string): CreatureSheet {
  const monster = system.monsters.find((entry) => entry.id === monsterId);
  if (!monster) throw new Error(`${system.name} has no monster "${monsterId}"`);
  const stats: Record<string, number> = {};
  for (const stat of system.stats) stats[stat.id] = monster.stats[stat.id] ?? stat.default;
  return {
    id,
    name: name ?? monster.name,
    stats,
    xp: system.levels.xpThresholds[monster.level - 1] ?? 0,
    abilities: [...monster.abilities],
  };
}
