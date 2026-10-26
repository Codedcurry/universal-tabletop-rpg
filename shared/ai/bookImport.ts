import { FormulaError, parseFormula } from '../formula';
import {
  type AbilityDef,
  type AbilityTarget,
  type ConditionDef,
  type DerivedDef,
  type EffectDef,
  GAME_SYSTEM_FORMAT_VERSION,
  type GameSystem,
  type MonsterDef,
  type ResourceDef,
  type StatDef,
  idFrom,
  validateGameSystem,
} from '../system';
import type { AiProvider, StopSignal } from './provider';

/**
 * Importing a rulebook the user owns: its text, section by section, goes to
 * the user's AI, which picks out what fits the game system format (stats,
 * formulas, conditions, abilities, monsters) as JSON. The pieces are merged
 * and tidied into a draft system that the DM reviews and corrects in the
 * rules editor before it's used. The book's text never leaves the AI the
 * user chose.
 */

/** About how much book text goes to the AI at once: small enough for local models. */
export const SECTION_CHARS = 9000;

export interface BookSection {
  /** The pages it covers, from 1. */
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

/** The book's pages (their text) cut into sections of whole pages, each about `maxChars` long (a longer page is cut up). */
export function sectionsOf(pages: readonly string[], maxChars = SECTION_CHARS): BookSection[] {
  const sections: BookSection[] = [];
  let current: { from: number; to: number; parts: string[]; size: number } | null = null;
  const flush = () => {
    if (current && current.size > 0) sections.push({ from: current.from, to: current.to, text: current.parts.join('\n\n') });
    current = null;
  };
  pages.forEach((raw, index) => {
    const page = index + 1;
    const text = raw.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (text === '') return;
    if (text.length > maxChars) {
      flush();
      for (let at = 0; at < text.length; at += maxChars) sections.push({ from: page, to: page, text: text.slice(at, at + maxChars) });
      return;
    }
    if (current && current.size + text.length > maxChars) flush();
    current ??= { from: page, to: page, parts: [], size: 0 };
    current.parts.push(text);
    current.size += text.length;
    current.to = page;
  });
  flush();
  return sections;
}

/** The instructions: what the format is, and how to answer. The same for every section. */
export const IMPORT_INSTRUCTIONS = `You turn tabletop RPG rulebook text into game data for a battle-map tool. You are given one section of a book the user owns.
Reply with ONE JSON object and nothing else. Include only what THIS section actually states; leave out keys it says nothing about. Never invent rules.

Keys (all optional):
- "name": the game's name.
- "stats": [{"name": "Strength", "short": "str", "default": 10}] - the numbers every creature has.
- "derived": [{"name": "Strength modifier", "short": "str_mod", "formula": "floor((@str - 10) / 2)"}] - values worked out from stats and @level (no dice). A bonus that changes with level is one too: "+2 at levels 1-4, +3 at levels 5-8" is {"name": "Proficiency", "short": "prof", "formula": "2 + floor((@level - 1) / 4)"}. Any value a formula uses must be a stat or derived value.
- "xpForLevel": [0, 300, 900] - total XP needed for level 1, 2, 3...
- "maxHp": formula for a creature's maximum hit points (no dice), e.g. "8 + @con_mod + (@level - 1) * 5".
- "defense": formula an attack roll must meet or beat to hit (armor class), e.g. "10 + @dex_mod".
- "initiative": formula rolled for turn order, e.g. "1d20 + @dex_mod".
- "speed": tiles (5-foot squares) a creature moves per turn, as a formula, e.g. "6".
- "critical": {"hit": 20, "miss": 1} - natural die rolls that always hit (damage dice twice) or always miss.
- "resources": [{"name": "Mana", "max": "2 + @level", "refill": "fight"}] - points abilities spend; refill is "turn" or "fight".
- "conditions": [{"name": "Stunned", "description": "...", "preventsActions": true, "preventsMovement": true}]
- "abilities": [{"name": "Longsword", "description": "...", "range": 1, "target": "enemy", "attackRoll": "1d20 + @str_mod + @prof", "effects": [{"damage": "1d8 + @str_mod"}], "cost": {"Mana": 2}, "reaction": "enemyLeaves"}]
  target is "enemy", "ally", or "self". range is in tiles (5-foot squares; 1 = touching). Give "attackRoll" only if the text says to roll to hit (healing an ally needs none). Copy dice and bonuses exactly as written: add nothing the text doesn't say. effects are any of {"damage": formula}, {"heal": formula}, {"condition": "Stunned", "rounds": 1}, {"restore": "Mana", "amount": formula}. reaction (only for reactions) is "enemyLeaves" or "attacked".
- "monsters": [{"name": "Goblin", "level": 1, "stats": {"str": 8, "dex": 14}, "abilities": ["Scimitar", {"name": "Bite", "range": 1, "target": "enemy", "attackRoll": "1d20 + 2", "effects": [{"damage": "1d4"}]}], "xp": 50}] - each of its attacks and powers, by name (if described elsewhere) or written out in full like an entry of "abilities".

Formulas: numbers, dice like 1d20 or 2d6, + - * / ( ), floor, ceil, round, min, max, abs, and variables written @short (a stat or derived value's short name, or @level). Use short names that are lowercase letters, digits, and underscores.`;

/** What one section's reply should look like (everything optional; checked as it's merged). */
interface Extract {
  name?: unknown;
  stats?: unknown;
  derived?: unknown;
  xpForLevel?: unknown;
  maxHp?: unknown;
  defense?: unknown;
  initiative?: unknown;
  speed?: unknown;
  critical?: unknown;
  resources?: unknown;
  conditions?: unknown;
  abilities?: unknown;
  monsters?: unknown;
}

/**
 * The JSON object in a model's reply: fenced in ```json or not, with chatter
 * around it, trailing commas forgiven. Null if there's none.
 */
export function readJsonReply(reply: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(reply)?.[1];
  const text = fenced ?? reply;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const body = text.slice(start, end + 1);
  for (const attempt of [body, body.replace(/,\s*([}\]])/g, '$1')]) {
    try {
      const value: unknown = JSON.parse(attempt);
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch {
      // try the next way
    }
  }
  return null;
}

// --- merging the pieces -----------------------------------------------------

type Data = Record<string, unknown>;
const isObject = (value: unknown): value is Data => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : typeof value === 'number' ? String(value) : undefined);
const whole = (value: unknown): number | undefined => {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? Math.round(number) : undefined;
};
const list = (value: unknown): Data[] => (Array.isArray(value) ? value.filter(isObject) : []);
const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Whether a formula reads (variables aren't checked here: the review shows unknown ones). */
function formula(value: unknown): string | undefined {
  const written = text(value);
  if (!written) return undefined;
  try {
    parseFormula(written);
    return written;
  } catch (error) {
    if (error instanceof FormulaError) return undefined;
    throw error;
  }
}

/** What the sections found so far, by name, before it's made into a system. */
export interface ImportDraft {
  name?: string | undefined;
  stats: Map<string, { name: string; short?: string; default?: number }>;
  derived: Map<string, { name: string; short?: string; formula: string }>;
  xpForLevel?: number[] | undefined;
  maxHp?: string | undefined;
  defense?: string | undefined;
  initiative?: string | undefined;
  speed?: string | undefined;
  critical?: { readonly hit?: number; readonly miss?: number } | undefined;
  resources: Map<string, { name: string; max: string; refill: 'turn' | 'fight' }>;
  conditions: Map<string, { name: string; description?: string; preventsActions?: boolean; preventsMovement?: boolean }>;
  abilities: Map<string, Data>;
  monsters: Map<string, Data>;
}

export const emptyDraft = (): ImportDraft => ({
  stats: new Map(),
  derived: new Map(),
  resources: new Map(),
  conditions: new Map(),
  abilities: new Map(),
  monsters: new Map(),
});

/** Adds one section's reply to the draft: the first good value of each thing wins; later sections fill gaps. */
export function mergeExtract(draft: ImportDraft, reply: Extract): void {
  draft.name ??= text(reply.name);
  for (const stat of list(reply.stats)) {
    const name = text(stat.name);
    if (!name || draft.stats.has(key(name))) continue;
    const short = text(stat.short);
    const value = whole(stat.default);
    draft.stats.set(key(name), { name, ...(short ? { short } : {}), ...(value === undefined ? {} : { default: value }) });
  }
  for (const derived of list(reply.derived)) {
    const name = text(derived.name);
    const written = formula(derived.formula);
    if (!name || !written || draft.derived.has(key(name))) continue;
    const short = text(derived.short);
    draft.derived.set(key(name), { name, ...(short ? { short } : {}), formula: written });
  }
  if (!draft.xpForLevel && Array.isArray(reply.xpForLevel)) {
    const levels = reply.xpForLevel.map(whole).filter((xp): xp is number => xp !== undefined);
    if (levels.length > 0) draft.xpForLevel = levels;
  }
  draft.maxHp ??= formula(reply.maxHp);
  draft.defense ??= formula(reply.defense);
  draft.initiative ??= formula(reply.initiative);
  draft.speed ??= formula(reply.speed);
  if (!draft.critical && isObject(reply.critical)) {
    const hit = whole(reply.critical.hit);
    const miss = whole(reply.critical.miss);
    if (hit !== undefined || miss !== undefined) draft.critical = { ...(hit === undefined ? {} : { hit }), ...(miss === undefined ? {} : { miss }) };
  }
  for (const resource of list(reply.resources)) {
    const name = text(resource.name);
    const max = formula(resource.max);
    if (!name || !max || draft.resources.has(key(name))) continue;
    draft.resources.set(key(name), { name, max, refill: resource.refill === 'turn' ? 'turn' : 'fight' });
  }
  for (const condition of list(reply.conditions)) {
    const name = text(condition.name);
    if (!name || draft.conditions.has(key(name))) continue;
    const description = text(condition.description);
    draft.conditions.set(key(name), {
      name,
      ...(description ? { description } : {}),
      ...(condition.preventsActions === true ? { preventsActions: true } : {}),
      ...(condition.preventsMovement === true ? { preventsMovement: true } : {}),
    });
  }
  for (const ability of list(reply.abilities)) {
    const name = text(ability.name);
    if (name && !draft.abilities.has(key(name))) draft.abilities.set(key(name), ability);
  }
  for (const monster of list(reply.monsters)) {
    const name = text(monster.name);
    if (!name || draft.monsters.has(key(name))) continue;
    // Abilities written out in the monster join the abilities; the monster keeps their names.
    const abilities = (Array.isArray(monster.abilities) ? monster.abilities : []).map((ability) => {
      if (!isObject(ability)) return ability;
      const abilityName = text(ability.name);
      if (abilityName && !draft.abilities.has(key(abilityName))) draft.abilities.set(key(abilityName), ability);
      return abilityName;
    });
    draft.monsters.set(key(name), { ...monster, abilities });
  }
}

/** Formula variables written with a name instead of a short name (@Strength), set right where we can tell. */
function shortened(written: string, aliases: ReadonlyMap<string, string>): string {
  return written.replace(/@([A-Za-z][A-Za-z0-9_]*)/g, (whole, name: string) => {
    const alias = aliases.get(key(name)) ?? aliases.get(name.toLowerCase());
    return alias ? `@${alias}` : whole.toLowerCase();
  });
}

const STARTER_XP = [0, 300, 900, 2700, 6500];

/**
 * The draft as a game system: ids from names, short names for formulas,
 * defaults where the book said nothing (noted), monsters' abilities matched
 * by name, effects and targets made to fit. Anything still wrong is left
 * for the DM: `validateGameSystem` (and the rules editor) points at it.
 */
export function draftToSystem(draft: ImportDraft): { system: GameSystem; notes: string[] } {
  const notes: string[] = [];
  const variables = new Set<string>(['level']);
  const aliases = new Map<string, string>();

  const stats: StatDef[] = [...draft.stats.values()].map((stat) => {
    const id = idFrom(stat.short ?? stat.name, variables);
    variables.add(id);
    aliases.set(key(stat.name), id);
    if (stat.short) aliases.set(key(stat.short), id);
    return { id, name: stat.name, default: stat.default ?? 10 };
  });
  if (stats.length === 0) {
    stats.push({ id: 'might', name: 'Might', default: 10 });
    variables.add('might');
    notes.push('No stats were found: "Might" stands in for them.');
  }
  const derived: DerivedDef[] = [...draft.derived.values()].map((value) => {
    const id = idFrom(value.short ?? value.name, variables);
    variables.add(id);
    aliases.set(key(value.name), id);
    if (value.short) aliases.set(key(value.short), id);
    return { id, name: value.name, formula: '' };
  });
  // Formulas, once every short name is known.
  const fix = (written: string) => shortened(written, aliases);
  [...draft.derived.values()].forEach((value, index) => {
    derived[index] = { ...derived[index]!, formula: fix(value.formula) };
  });

  const fallback = (found: string | undefined, standIn: string, what: string) => {
    if (found) return fix(found);
    notes.push(`No ${what} was found: "${standIn}" stands in for it.`);
    return standIn;
  };

  const resourceIds = new Set<string>();
  const resources: ResourceDef[] = [...draft.resources.values()].map((resource) => {
    const id = idFrom(resource.name, resourceIds);
    resourceIds.add(id);
    return { id, name: resource.name, max: fix(resource.max), refill: resource.refill };
  });
  const resourceByName = new Map(resources.map((resource) => [key(resource.name), resource.id]));

  const conditionIds = new Set<string>();
  const conditions: ConditionDef[] = [...draft.conditions.values()].map((condition) => {
    const id = idFrom(condition.name, conditionIds);
    conditionIds.add(id);
    return { id, ...condition };
  });
  const conditionByName = new Map(conditions.map((condition) => [key(condition.name), condition.id]));

  const abilityIds = new Set<string>();
  const abilityByName = new Map<string, string>();
  const abilities: AbilityDef[] = [...draft.abilities.values()].map((raw) => {
    const name = text(raw.name) as string;
    const id = idFrom(name, abilityIds);
    abilityIds.add(id);
    abilityByName.set(key(name), id);
    const effects: EffectDef[] = list(raw.effects).flatMap((effect): EffectDef[] => {
      const damage = formula(effect.damage);
      if (damage) return [{ type: 'damage', amount: fix(damage) }];
      const heal = formula(effect.heal);
      if (heal) return [{ type: 'heal', amount: fix(heal) }];
      const condition = text(effect.condition);
      if (condition) {
        const id = conditionByName.get(key(condition));
        return id ? [{ type: 'applyCondition', condition: id, rounds: Math.max(1, whole(effect.rounds) ?? 1) }] : [];
      }
      const restore = text(effect.restore);
      const amount = formula(effect.amount);
      const resource = restore ? resourceByName.get(key(restore)) : undefined;
      return resource && amount ? [{ type: 'restore', resource, amount: fix(amount) }] : [];
    });
    const target: AbilityTarget = raw.target === 'ally' || raw.target === 'self' ? raw.target : 'enemy';
    const range = Math.max(0, whole(raw.range) ?? 1);
    // Rolling to hit is for abilities aimed at enemies (an ally or oneself is never "missed").
    const attack = target === 'enemy' ? formula(raw.attackRoll) : undefined;
    const description = text(raw.description);
    const cost = isObject(raw.cost)
      ? Object.fromEntries(
          Object.entries(raw.cost).flatMap(([resource, amount]) => {
            const id = resourceByName.get(key(resource)) ?? (resourceIds.has(resource) ? resource : undefined);
            const points = whole(amount);
            return id && points !== undefined && points >= 1 ? [[id, points]] : [];
          }),
        )
      : {};
    const reaction = raw.reaction === 'enemyLeaves' || raw.reaction === 'attacked' ? { trigger: raw.reaction as 'enemyLeaves' | 'attacked' } : undefined;
    const heals = effects.some((effect) => effect.type === 'heal' || effect.type === 'restore');
    return {
      id,
      name,
      ...(description ? { description } : {}),
      range,
      target,
      ...(attack ? { attack: { roll: fix(attack) } } : {}),
      // Nothing it does was understood: a stand-in for the DM to correct.
      effects: effects.length > 0 ? effects : [{ type: 'damage', amount: '1d6' }],
      animation: heals || Object.keys(cost).length > 0 ? 'spell' : range > 1 ? 'ranged' : 'melee',
      ...(Object.keys(cost).length > 0 ? { cost } : {}),
      ...(reaction ? { reaction } : {}),
    } satisfies AbilityDef;
  });
  const unclear = abilities.filter((ability, index) => list([...draft.abilities.values()][index]?.effects).length === 0 || ability.effects.length === 0);
  if (unclear.length > 0) notes.push(`What ${unclear.map((ability) => ability.name).join(', ')} ${unclear.length === 1 ? 'does' : 'do'} wasn't clear: check their effects.`);

  const xpThresholds = draft.xpForLevel && draft.xpForLevel[0] === 0 ? draft.xpForLevel : STARTER_XP;
  if (xpThresholds === STARTER_XP) notes.push('No XP table was found: a starter one stands in for it.');

  const monsterIds = new Set<string>();
  const monsters: MonsterDef[] = [...draft.monsters.values()].map((raw) => {
    const name = text(raw.name) as string;
    const id = idFrom(name, monsterIds);
    monsterIds.add(id);
    const statValues = isObject(raw.stats)
      ? Object.fromEntries(
          Object.entries(raw.stats).flatMap(([stat, value]) => {
            const id = aliases.get(key(stat)) ?? (variables.has(stat) ? stat : undefined);
            const number = whole(value);
            return id && stats.some((entry) => entry.id === id) && number !== undefined ? [[id, number]] : [];
          }),
        )
      : {};
    const known = (Array.isArray(raw.abilities) ? raw.abilities : []).flatMap((ability) => {
      const name = text(ability);
      const found = name ? (abilityByName.get(key(name)) ?? (abilityIds.has(name) ? name : undefined)) : undefined;
      return found ? [found] : [];
    });
    return {
      id,
      name,
      level: Math.min(xpThresholds.length, Math.max(1, whole(raw.level) ?? 1)),
      stats: statValues,
      abilities: [...new Set(known)],
      xpValue: Math.max(0, whole(raw.xp) ?? 0),
    };
  });

  const system: GameSystem = {
    formatVersion: GAME_SYSTEM_FORMAT_VERSION,
    id: idFrom(draft.name ?? 'imported', new Set()),
    name: draft.name ?? 'Imported rules',
    stats,
    derived,
    levels: { xpThresholds },
    health: { max: fallback(draft.maxHp, '10 + @level * 2', 'max HP formula') },
    defense: fallback(draft.defense, '10', 'defense formula'),
    initiative: fallback(draft.initiative, '1d20', 'initiative roll'),
    movement: { speed: fallback(draft.speed, '6', 'speed'), maxStepUp: 1, maxStepDown: 2 },
    conditions,
    abilities,
    monsters,
    ...(resources.length > 0 ? { resources } : {}),
    ...(draft.critical ? { critical: draft.critical } : {}),
  };
  return { system, notes };
}

export interface ImportProgress {
  /** Sections done, and how many in all. */
  readonly done: number;
  readonly total: number;
  /** The section being read now. */
  readonly section: BookSection | null;
}

export interface ImportResult {
  readonly system: GameSystem;
  /** What stood in for missing parts, and what to check. */
  readonly notes: readonly string[];
  /** How many problems the rules editor will show. */
  readonly problems: number;
  /** Sections the AI's reply couldn't be read for (skipped). */
  readonly skipped: readonly BookSection[];
}

/**
 * Reads a rulebook with the user's AI, section by section, into a draft game
 * system for the DM to review. Stops (rejecting) when `signal` aborts.
 */
export async function importRulebook(
  pages: readonly string[],
  provider: AiProvider,
  options: { signal?: StopSignal; onProgress?: (progress: ImportProgress) => void; maxChars?: number } = {},
): Promise<ImportResult> {
  const sections = sectionsOf(pages, options.maxChars);
  const draft = emptyDraft();
  const skipped: BookSection[] = [];
  for (const [index, section] of sections.entries()) {
    options.signal?.throwIfAborted();
    options.onProgress?.({ done: index, total: sections.length, section });
    const reply = await provider.complete({
      system: IMPORT_INSTRUCTIONS,
      prompt: `Pages ${section.from}${section.to === section.from ? '' : `–${section.to}`} of the book:\n\n${section.text}`,
      json: true,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const found = readJsonReply(reply);
    if (found) mergeExtract(draft, found);
    else skipped.push(section);
  }
  options.onProgress?.({ done: sections.length, total: sections.length, section: null });
  const { system, notes } = draftToSystem(draft);
  const checked = validateGameSystem(system);
  if (skipped.length > 0) {
    const where = skipped.map((section) => (section.from === section.to ? `page ${section.from}` : `pages ${section.from}–${section.to}`)).join(', ');
    notes.push(`The AI's answer for ${where} couldn't be read, so ${skipped.length === 1 ? 'it was' : 'they were'} skipped.`);
  }
  return { system, notes, problems: checked.ok ? 0 : checked.errors.length, skipped };
}
