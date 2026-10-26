import type { AbilityDef, ConditionDef, DerivedDef, EffectDef, GameSystem, MonsterDef, ResourceDef, StatDef } from './types';

/**
 * Reviewing new rules before they're used: every difference between the
 * rules in play and the incoming ones (an imported book, a loaded file) as a
 * change the DM can accept or not, each saying what it does to the site
 * (a new button in the combat bar, a new meter, a monster to add). The
 * accepted changes are then combined into the rules to use.
 */

export type ChangeArea = 'basics' | 'stats' | 'resources' | 'conditions' | 'abilities' | 'monsters';

export interface RuleChange {
  /** Stable for this pair of systems, e.g. "abilities:fire_bolt". */
  readonly id: string;
  readonly kind: 'add' | 'change' | 'remove';
  readonly area: ChangeArea;
  /** What it is: "Ability: Ember Bolt". */
  readonly title: string;
  /** What it says: "range 8 · 2 Focus · 2d6 damage", or for a change, what's different. */
  readonly detail: string;
  /** What it does to the site. */
  readonly site: string;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function effectText(effect: EffectDef, system: GameSystem): string {
  switch (effect.type) {
    case 'damage':
      return `${effect.amount} damage`;
    case 'heal':
      return `heals ${effect.amount}`;
    case 'applyCondition':
      return `${system.conditions.find((condition) => condition.id === effect.condition)?.name ?? effect.condition} for ${plural(effect.rounds, 'round')}`;
    case 'restore':
      return `gives back ${effect.amount} ${system.resources?.find((resource) => resource.id === effect.resource)?.name ?? effect.resource}`;
  }
}

function abilityText(ability: AbilityDef, system: GameSystem): string {
  const target = ability.target === 'self' ? 'self' : `${ability.target === 'ally' ? 'an ally' : 'an enemy'}, range ${ability.range}`;
  return [
    ability.reaction ? `reaction (${ability.reaction.trigger === 'attacked' ? 'when hit' : 'when an enemy leaves'}${ability.reaction.defense ? `, +${ability.reaction.defense} defense` : ''})` : null,
    target,
    ability.attack ? `attack ${ability.attack.roll}` : null,
    ...ability.effects.map((effect) => effectText(effect, system)),
    ...Object.entries(ability.cost ?? {}).map(([id, amount]) => `${amount} ${system.resources?.find((resource) => resource.id === id)?.name ?? id}`),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
}

const monsterText = (monster: MonsterDef, system: GameSystem) =>
  [
    `level ${monster.level}`,
    `${monster.xpValue} XP`,
    ...Object.entries(monster.stats).map(([id, value]) => `${system.stats.find((stat) => stat.id === id)?.name ?? id} ${value}`),
    monster.abilities.length > 0 ? `abilities: ${monster.abilities.map((id) => system.abilities.find((ability) => ability.id === id)?.name ?? id).join(', ')}` : 'no abilities',
  ].join(' · ');

const conditionText = (condition: ConditionDef) =>
  [condition.preventsActions ? "can't act" : null, condition.preventsMovement ? "can't move" : null, condition.description ?? null].filter(Boolean).join(' · ') || 'no effect on its own';

/** The entries of one kind, how they read, and what they do to the site. */
interface Kind<T extends { readonly id: string; readonly name: string }> {
  readonly area: ChangeArea;
  readonly label: string;
  entries(system: GameSystem): readonly T[];
  text(entry: T, system: GameSystem): string;
  added(entry: T): string;
  removed(entry: T, current: GameSystem): string;
  changed(entry: T): string;
}

const KINDS = [
  {
    area: 'stats',
    label: 'Stat',
    entries: (system) => system.stats,
    text: (stat) => `@${stat.id}, ${stat.default} by default`,
    added: (stat) => `A new number on every creature (${stat.name}), set in the creature editor.`,
    removed: (stat) => `Creatures lose their ${stat.name}.`,
    changed: () => 'Changes creatures\' starting value.',
  } satisfies Kind<StatDef>,
  {
    area: 'stats',
    label: 'Worked-out value',
    entries: (system) => system.derived,
    text: (derived) => `@${derived.id} = ${derived.formula}`,
    added: () => 'Usable in formulas.',
    removed: () => 'No longer usable in formulas.',
    changed: () => 'Changes every formula that uses it.',
  } satisfies Kind<DerivedDef>,
  {
    area: 'resources',
    label: 'Resource',
    entries: (system) => system.resources ?? [],
    text: (resource) => `max ${resource.max}, refills each ${resource.refill}`,
    added: (resource) => `Adds a ${resource.name} meter to the combat bar, and ${resource.name} costs on ability buttons.`,
    removed: (resource) => `Removes the ${resource.name} meter, and its costs from abilities.`,
    changed: (resource) => `Changes how much ${resource.name} creatures have.`,
  } satisfies Kind<ResourceDef>,
  {
    area: 'conditions',
    label: 'Condition',
    entries: (system) => system.conditions,
    text: (condition) => conditionText(condition),
    added: () => 'Abilities can put it on creatures; it shows in the creature editor.',
    removed: () => 'Creatures under it are freed; abilities stop putting it on.',
    changed: () => 'Changes what it does to creatures under it.',
  } satisfies Kind<ConditionDef>,
  {
    area: 'abilities',
    label: 'Ability',
    entries: (system) => system.abilities,
    text: (ability, system) => abilityText(ability, system),
    added: (ability) =>
      ability.reaction
        ? `A reaction creatures with it can use on others' turns (a prompt appears when it's possible).`
        : `Adds a ${ability.name} button to the combat bar for creatures that have it.`,
    removed: (ability, current) => {
      const users = current.monsters.filter((monster) => monster.abilities.includes(ability.id)).length;
      return `Removes its button${users > 0 ? `, and takes it from ${plural(users, 'monster')}` : ''}.`;
    },
    changed: (ability) => `Changes what ${ability.name} does.`,
  } satisfies Kind<AbilityDef>,
  {
    area: 'monsters',
    label: 'Monster',
    entries: (system) => system.monsters,
    text: (monster, system) => monsterText(monster, system),
    added: () => 'Can be added to a fight from the Encounter tab.',
    removed: () => 'No longer in the Encounter tab (any already on the map stay).',
    changed: () => 'New ones added from the Encounter tab are different.',
  } satisfies Kind<MonsterDef>,
] as const;

/** The parts of an entry that differ, in words ("range 6 → 8"). */
function differences(before: string, after: string): string {
  const old = before.split(' · ');
  const now = after.split(' · ');
  const gone = old.filter((part) => !now.includes(part));
  const added = now.filter((part) => !old.includes(part));
  if (gone.length === 0 && added.length === 0) return 'Its name or details change.';
  return [...gone.map((part) => `was: ${part}`), ...added.map((part) => `now: ${part}`)].join(' · ');
}

const BASICS: readonly { key: string; title: string; read(system: GameSystem): unknown; text(system: GameSystem): string; site: string }[] = [
  { key: 'name', title: 'Name', read: (s) => s.name, text: (s) => s.name, site: 'The rules are called this.' },
  { key: 'levels', title: 'XP for each level', read: (s) => s.levels, text: (s) => s.levels.xpThresholds.join(', '), site: 'Changes when creatures level up.' },
  { key: 'health', title: 'Max HP', read: (s) => s.health, text: (s) => s.health.max, site: 'Changes every creature\'s HP bar.' },
  { key: 'defense', title: 'Defense', read: (s) => s.defense, text: (s) => s.defense, site: 'Changes what attacks must roll to hit.' },
  { key: 'initiative', title: 'Initiative', read: (s) => s.initiative, text: (s) => s.initiative, site: 'Changes the turn order rolled at the start of a fight.' },
  {
    key: 'movement',
    title: 'Movement',
    read: (s) => s.movement,
    text: (s) => `speed ${s.movement.speed}, step up ${s.movement.maxStepUp}, drop ${s.movement.maxStepDown}${s.movement.climb ? `, climb ${s.movement.climb.maxHeight}` : ''}`,
    site: 'Changes how far creatures move, and the yellow tiles in the combat bar.',
  },
  {
    key: 'critical',
    title: 'Critical hits',
    read: (s) => s.critical ?? null,
    text: (s) => (s.critical ? [s.critical.hit ? `always hits on ${s.critical.hit}+` : null, s.critical.miss ? `always misses on ${s.critical.miss} or less` : null].filter(Boolean).join(', ') : 'none'),
    site: 'Changes how attack rolls are decided, and the log says "critical hit!".',
  },
];

/** Every difference between the rules in play and the incoming ones, basics first, then by area. */
export function diffSystems(current: GameSystem | null, next: GameSystem): RuleChange[] {
  const changes: RuleChange[] = [];
  for (const basic of BASICS) {
    if (current && same(basic.read(current), basic.read(next))) continue;
    const kind = current ? 'change' : 'add';
    const detail = current ? `${basic.text(current)} → ${basic.text(next)}` : basic.text(next);
    changes.push({ id: `basics:${basic.key}`, kind, area: 'basics', title: basic.title, detail, site: basic.site });
  }
  for (const kind of KINDS as unknown as readonly Kind<{ id: string; name: string }>[]) {
    const before = current ? kind.entries(current) : [];
    const after = kind.entries(next);
    const prefix = `${kind.area}:${kind.label === 'Worked-out value' ? 'derived:' : ''}`;
    for (const entry of after) {
      const old = before.find((other) => other.id === entry.id);
      if (!old) changes.push({ id: `${prefix}${entry.id}`, kind: 'add', area: kind.area, title: `${kind.label}: ${entry.name}`, detail: kind.text(entry, next), site: kind.added(entry) });
      else if (!same(old, entry)) {
        changes.push({
          id: `${prefix}${entry.id}`,
          kind: 'change',
          area: kind.area,
          title: `${kind.label}: ${entry.name}`,
          detail: differences(kind.text(old, current as GameSystem), kind.text(entry, next)),
          site: kind.changed(entry),
        });
      }
    }
    for (const entry of before) {
      if (!after.some((other) => other.id === entry.id)) {
        changes.push({ id: `${prefix}${entry.id}`, kind: 'remove', area: kind.area, title: `${kind.label}: ${entry.name}`, detail: kind.text(entry, current as GameSystem), site: kind.removed(entry, current as GameSystem) });
      }
    }
  }
  return changes;
}

/** One list, with the accepted changes from `next` and everything else as in `current`. */
function combineList<T extends { readonly id: string }>(current: readonly T[], next: readonly T[], accepted: (id: string) => boolean): T[] {
  // Entries kept or changed stay where they were; accepted additions come after, in the incoming order.
  const kept = current.flatMap((entry) => {
    const incoming = next.find((other) => other.id === entry.id);
    if (!incoming) return accepted(entry.id) ? [] : [entry];
    return [accepted(entry.id) ? incoming : entry];
  });
  return [...kept, ...next.filter((entry) => !current.some((other) => other.id === entry.id) && accepted(entry.id))];
}

/**
 * The rules with only the accepted changes (by `RuleChange.id`). What then
 * points at something no longer there (a monster's ability, a cost in a
 * resource left out) is taken out, and listed; formulas using a stat left
 * out are left for the rules editor to point at.
 */
export function combineChanges(current: GameSystem | null, next: GameSystem, accepted: ReadonlySet<string>): { system: GameSystem; tidied: string[] } {
  const base = current ?? next;
  const take = (key: string) => current === null || accepted.has(`basics:${key}`);
  const ids = (area: string) => (id: string) => accepted.has(`${area}:${id}`);
  const stats = combineList(current?.stats ?? [], next.stats, ids('stats'));
  const derived = combineList(current?.derived ?? [], next.derived, ids('stats:derived'));
  const resources = combineList(current?.resources ?? [], next.resources ?? [], ids('resources'));
  const conditions = combineList(current?.conditions ?? [], next.conditions, ids('conditions'));
  const abilityList = combineList(current?.abilities ?? [], next.abilities, ids('abilities'));
  const monsterList = combineList(current?.monsters ?? [], next.monsters, ids('monsters'));

  const tidied: string[] = [];
  const has = { condition: new Set(conditions.map((entry) => entry.id)), resource: new Set(resources.map((entry) => entry.id)), stat: new Set(stats.map((entry) => entry.id)) };
  const abilities = abilityList.map((ability) => {
    const effects = ability.effects.filter((effect) => {
      const missing = (effect.type === 'applyCondition' && !has.condition.has(effect.condition)) || (effect.type === 'restore' && !has.resource.has(effect.resource));
      if (missing) tidied.push(`${ability.name} no longer ${effectText(effect, next)}, since that was left out.`);
      return !missing;
    });
    const cost = Object.fromEntries(Object.entries(ability.cost ?? {}).filter(([id]) => has.resource.has(id)));
    if (Object.keys(cost).length < Object.keys(ability.cost ?? {}).length) tidied.push(`${ability.name} no longer costs a resource that was left out.`);
    const { cost: _cost, ...rest } = ability;
    return { ...rest, effects, ...(Object.keys(cost).length > 0 ? { cost } : {}) };
  });
  const abilityIds = new Set(abilities.map((ability) => ability.id));
  const monsters = monsterList.map((monster) => {
    const kept = monster.abilities.filter((id) => abilityIds.has(id));
    if (kept.length < monster.abilities.length) tidied.push(`${monster.name} loses abilities that were left out.`);
    const statValues = Object.fromEntries(Object.entries(monster.stats).filter(([id]) => has.stat.has(id)));
    return { ...monster, abilities: kept, stats: statValues };
  });

  const critical = take('critical') ? next.critical : base.critical;
  const { resources: _resources, critical: _critical, ...rest } = base;
  const system: GameSystem = {
    ...rest,
    name: take('name') ? next.name : base.name,
    id: take('name') ? next.id : base.id,
    levels: take('levels') ? next.levels : base.levels,
    health: take('health') ? next.health : base.health,
    defense: take('defense') ? next.defense : base.defense,
    initiative: take('initiative') ? next.initiative : base.initiative,
    movement: take('movement') ? next.movement : base.movement,
    stats,
    derived,
    conditions,
    abilities,
    monsters,
    ...(resources.length > 0 ? { resources } : {}),
    ...(critical ? { critical } : {}),
  };
  return { system, tidied };
}
