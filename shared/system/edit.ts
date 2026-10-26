import { type CreatureSheet, computeCreature } from './creature';
import { GAME_SYSTEM_FORMAT_VERSION, type GameSystem } from './types';

/**
 * Editing a game system by hand (the DM's rules editor): a blank system to
 * start from, readable ids for new entries, removals that tidy up what
 * pointed at the removed entry, and fitting creatures already in play to a
 * changed system.
 */

/** A small working system to build on: one stat, level 1 to 5, a basic attack, one monster. */
export function blankSystem(name = 'My system'): GameSystem {
  return {
    formatVersion: GAME_SYSTEM_FORMAT_VERSION,
    id: idFrom(name, new Set()),
    name,
    stats: [{ id: 'might', name: 'Might', default: 10 }],
    derived: [{ id: 'might_mod', name: 'Might modifier', formula: 'floor((@might - 10) / 2)' }],
    levels: { xpThresholds: [0, 100, 300, 600, 1000] },
    health: { max: '10 + @level * 2' },
    defense: '10',
    initiative: '1d20',
    movement: { speed: '6', maxStepUp: 1, maxStepDown: 2 },
    conditions: [],
    abilities: [
      {
        id: 'attack',
        name: 'Attack',
        range: 1,
        target: 'enemy',
        attack: { roll: '1d20 + @might_mod' },
        effects: [{ type: 'damage', amount: '1d6 + @might_mod' }],
        animation: 'melee',
      },
    ],
    monsters: [{ id: 'monster', name: 'Monster', level: 1, stats: {}, abilities: ['attack'], xpValue: 50 }],
  };
}

/**
 * An id for an entry named `name`, in the system's id style (lowercase
 * letters, digits, underscores, starting with a letter), not in `taken`.
 */
export function idFrom(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^[^a-z]+/, '')
      .replace(/_+$/, '')
      .slice(0, 32) || 'entry';
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** Removes a stat, and its value from every monster. (Formulas that use it are left for the DM to fix: the editor shows them.) */
export function removeStat(system: GameSystem, id: string): GameSystem {
  return {
    ...system,
    stats: system.stats.filter((stat) => stat.id !== id),
    monsters: system.monsters.map((monster) => ({ ...monster, stats: Object.fromEntries(Object.entries(monster.stats).filter(([stat]) => stat !== id)) })),
  };
}

/** Removes an ability, and takes it off every monster that had it. */
export function removeAbility(system: GameSystem, id: string): GameSystem {
  return {
    ...system,
    abilities: system.abilities.filter((ability) => ability.id !== id),
    monsters: system.monsters.map((monster) => ({ ...monster, abilities: monster.abilities.filter((ability) => ability !== id) })),
  };
}

/** Removes a condition, and every effect that applied it. */
export function removeCondition(system: GameSystem, id: string): GameSystem {
  return {
    ...system,
    conditions: system.conditions.filter((condition) => condition.id !== id),
    abilities: system.abilities.map((ability) => ({
      ...ability,
      effects: ability.effects.filter((effect) => effect.type !== 'applyCondition' || effect.condition !== id),
    })),
  };
}

/** Removes a resource, its cost from every ability, and every effect that restored it. */
export function removeResource(system: GameSystem, id: string): GameSystem {
  return {
    ...system,
    resources: (system.resources ?? []).filter((resource) => resource.id !== id),
    abilities: system.abilities.map((ability) => {
      const { cost, ...rest } = ability;
      const kept = Object.fromEntries(Object.entries(cost ?? {}).filter(([resource]) => resource !== id));
      return {
        ...rest,
        ...(Object.keys(kept).length > 0 ? { cost: kept } : {}),
        effects: ability.effects.filter((effect) => effect.type !== 'restore' || effect.resource !== id),
      };
    }),
  };
}

/**
 * A creature's sheet fitted to a system: renamed stats (old id → new id) keep
 * their values; stats and abilities the system doesn't have are dropped (and listed).
 */
export function fitSheet(original: CreatureSheet, system: GameSystem, renames: Readonly<Record<string, string>> = {}): { sheet: CreatureSheet; dropped: string[] } {
  const renamed = Object.keys(original.stats).some((stat) => renames[stat] !== undefined && renames[stat] !== stat);
  const sheet = renamed ? { ...original, stats: Object.fromEntries(Object.entries(original.stats).map(([stat, value]) => [renames[stat] ?? stat, value])) } : original;
  const stats = new Set(system.stats.map((stat) => stat.id));
  const abilities = new Set(system.abilities.map((ability) => ability.id));
  const dropped = [
    ...Object.keys(sheet.stats)
      .filter((stat) => !stats.has(stat))
      .map((stat) => `stat ${stat}`),
    ...sheet.abilities.filter((ability) => !abilities.has(ability)).map((ability) => `ability ${ability}`),
  ];
  if (dropped.length === 0) return { sheet, dropped };

  return {
    sheet: {
      ...sheet,
      stats: Object.fromEntries(Object.entries(sheet.stats).filter(([stat]) => stats.has(stat))),
      abilities: sheet.abilities.filter((ability) => abilities.has(ability)),
    },
    dropped,
  };
}

interface Fittable {
  readonly sheet: CreatureSheet;
  readonly hp: number;
  readonly conditions: readonly { readonly id: string }[];
  readonly resources?: Readonly<Record<string, number>>;
}

/**
 * Creatures in play fitted to a changed system: unknown stats, abilities,
 * and conditions dropped, and HP kept within the new maximum. Returns the
 * creatures (the same object when nothing changed) and readable changes
 * ("Goblin loses ability shoot").
 */
export function fitCreatures<T extends Fittable>(
  creatures: Readonly<Record<string, T>>,
  system: GameSystem,
  renames: Readonly<Record<string, string>> = {},
): { creatures: Readonly<Record<string, T>>; changes: string[] } {
  const conditions = new Set(system.conditions.map((condition) => condition.id));
  const changes: string[] = [];
  let changed = false;
  const fitted = Object.fromEntries(
    Object.entries(creatures).map(([id, creature]) => {
      const { sheet, dropped } = fitSheet(creature.sheet, system, renames);
      const lost = creature.conditions.filter((condition) => !conditions.has(condition.id));
      const numbers = computeCreature(system, sheet);
      const maxHp = numbers.maxHp;
      const hp = Math.min(creature.hp, maxHp);
      // Points left in resources the system still has, within their new maximums.
      const resources = creature.resources
        ? Object.fromEntries(
            Object.entries(creature.resources)
              .filter(([id]) => id in numbers.resources)
              .map(([id, left]) => [id, Math.min(left, numbers.resources[id] ?? 0)]),
          )
        : undefined;
      const resourcesChanged = creature.resources !== undefined && JSON.stringify(resources) !== JSON.stringify(creature.resources);
      for (const entry of dropped) changes.push(`${sheet.name} loses ${entry}`);
      for (const condition of lost) changes.push(`${sheet.name} is no longer ${condition.id}`);
      if (hp < creature.hp) changes.push(`${sheet.name}'s HP drops to the new maximum, ${maxHp}`);
      if (sheet === creature.sheet && lost.length === 0 && hp === creature.hp && !resourcesChanged) return [id, creature];
      changed = true;
      const fitted = { ...creature, sheet, hp, conditions: creature.conditions.filter((condition) => conditions.has(condition.id)) };
      return [id, resourcesChanged ? { ...fitted, resources } : fitted];
    }),
  ) as Record<string, T>;
  return { creatures: changed ? fitted : creatures, changes };
}

/** A formula with every use of the variable `from` renamed to `to` (@from, not @from_mod). */
function renameVariable(formula: string, from: string, to: string): string {
  return formula.replace(new RegExp(`@${from}(?![a-z0-9_])`, 'g'), `@${to}`);
}

/**
 * Renames a stat's or derived value's formula name, everywhere it's used:
 * every formula, and monsters' stat values. Throws if the new name is taken.
 */
export function renameVariableId(system: GameSystem, from: string, to: string): GameSystem {
  if (from === to) return system;
  const taken = ['level', ...system.stats.map((stat) => stat.id), ...system.derived.map((derived) => derived.id)];
  if (taken.includes(to)) throw new Error(`"${to}" is already used`);
  const rename = (formula: string) => renameVariable(formula, from, to);
  return {
    ...system,
    stats: system.stats.map((stat) => (stat.id === from ? { ...stat, id: to } : stat)),
    derived: system.derived.map((derived) => ({ ...derived, id: derived.id === from ? to : derived.id, formula: rename(derived.formula) })),
    health: { max: rename(system.health.max) },
    defense: rename(system.defense),
    initiative: rename(system.initiative),
    movement: { ...system.movement, speed: rename(system.movement.speed) },
    ...(system.resources ? { resources: system.resources.map((resource) => ({ ...resource, max: rename(resource.max) })) } : {}),
    abilities: system.abilities.map((ability) => ({
      ...ability,
      ...(ability.attack ? { attack: { roll: rename(ability.attack.roll) } } : {}),
      effects: ability.effects.map((effect) => (effect.type === 'applyCondition' ? effect : { ...effect, amount: rename(effect.amount) })),
    })),
    monsters: system.monsters.map((monster) => ({
      ...monster,
      stats: Object.fromEntries(Object.entries(monster.stats).map(([stat, value]) => [stat === from ? to : stat, value])),
    })),
  };
}

/** Renames an ability, condition, or monster id, and every reference to it. */
export function renameEntryId(system: GameSystem, kind: 'ability' | 'condition' | 'monster' | 'resource', from: string, to: string): GameSystem {
  if (from === to) return system;
  const swap = (id: string) => (id === from ? to : id);
  if (kind === 'resource') {
    return {
      ...system,
      resources: (system.resources ?? []).map((resource) => ({ ...resource, id: swap(resource.id) })),
      abilities: system.abilities.map((ability) => ({
        ...ability,
        ...(ability.cost ? { cost: Object.fromEntries(Object.entries(ability.cost).map(([id, amount]) => [swap(id), amount])) } : {}),
        effects: ability.effects.map((effect) => (effect.type === 'restore' ? { ...effect, resource: swap(effect.resource) } : effect)),
      })),
    };
  }
  if (kind === 'monster') return { ...system, monsters: system.monsters.map((monster) => ({ ...monster, id: swap(monster.id) })) };
  if (kind === 'ability') {
    return {
      ...system,
      abilities: system.abilities.map((ability) => ({ ...ability, id: swap(ability.id) })),
      monsters: system.monsters.map((monster) => ({ ...monster, abilities: monster.abilities.map(swap) })),
    };
  }
  return {
    ...system,
    conditions: system.conditions.map((condition) => ({ ...condition, id: swap(condition.id) })),
    abilities: system.abilities.map((ability) => ({
      ...ability,
      effects: ability.effects.map((effect) => (effect.type === 'applyCondition' ? { ...effect, condition: swap(effect.condition) } : effect)),
    })),
  };
}

/** The rules editor's sections, and which one each part of a system is in. */
export type EditorSection = 'basics' | 'stats' | 'conditions' | 'abilities' | 'monsters';

export function pathSection(path: string): EditorSection {
  const head = path.split(/[.[]/)[0];
  if (head === 'stats' || head === 'derived' || head === 'resources') return 'stats';
  if (head === 'conditions' || head === 'abilities' || head === 'monsters') return head;
  return 'basics';
}

const FIELD_NAMES: Readonly<Record<string, string>> = {
  id: 'id',
  name: 'name',
  default: 'default',
  formula: 'formula',
  max: 'max HP',
  defense: 'defense',
  initiative: 'initiative',
  xpThresholds: 'XP for each level',
  speed: 'speed',
  maxStepUp: 'step up',
  maxStepDown: 'step down',
  maxHeight: 'climb height',
  costPerLevel: 'climb cost',
  range: 'range',
  target: 'target',
  animation: 'animation',
  roll: 'attack roll',
  effects: 'effects',
  amount: 'amount',
  condition: 'condition',
  rounds: 'rounds',
  level: 'level',
  xpValue: 'XP value',
  abilities: 'abilities',
  stats: 'stats',
  refill: 'refill',
  resource: 'resource',
};

/** Where a validation problem is, in words: "Abilities › Shield Bash › effect 1 › amount". */
export function describePath(system: GameSystem, path: string): string {
  if (path === '') return 'The system';
  const parts = path.split('.').flatMap((part) => {
    const match = /^([A-Za-z]+)(?:\[(\d+)\])?$/.exec(part);
    return match ? [{ key: match[1]!, index: match[2] === undefined ? null : Number(match[2]) }] : [{ key: part, index: null }];
  });
  const [first, ...rest] = parts;
  if (!first) return path;
  const words: string[] = [];
  const lists: Record<string, { label: string; entries: readonly { readonly name?: string; readonly id?: string }[] }> = {
    stats: { label: 'Stats', entries: system.stats },
    derived: { label: 'Stats', entries: system.derived },
    resources: { label: 'Stats', entries: system.resources ?? [] },
    conditions: { label: 'Conditions', entries: system.conditions },
    abilities: { label: 'Abilities', entries: system.abilities },
    monsters: { label: 'Monsters', entries: system.monsters },
  };
  const list = lists[first.key];
  if (list && first.index !== null) {
    const entry = list.entries[first.index];
    words.push(list.label, entry?.name || entry?.id || `entry ${first.index + 1}`);
  } else {
    words.push('Basics');
    if (first.key !== 'health' && first.key !== 'movement' && first.key !== 'levels' && first.key !== 'critical') words.push(FIELD_NAMES[first.key] ?? first.key);
  }
  for (const part of rest) {
    if (first.key === 'resources' && part.key === 'max') words.push('max');
    else if (first.key === 'critical') words.push(part.key === 'hit' ? 'critical hit roll' : 'critical miss roll');
    else if (part.key === 'cost') words.push('cost');
    else if (part.key === 'effects' && part.index !== null) words.push(`effect ${part.index + 1}`);
    else if (part.key === 'climb' || part.key === 'attack') continue;
    else words.push(part.index === null ? (FIELD_NAMES[part.key] ?? part.key) : `${FIELD_NAMES[part.key] ?? part.key} ${part.index + 1}`);
  }
  return words.join(' › ');
}
