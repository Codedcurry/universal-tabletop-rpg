import { describe, expect, it } from 'vitest';
import { skirmish } from './samples/skirmish';
import { validateGameSystem } from './index';

// System files come from users (manual entry, imports, AI-assisted book import),
// so validation must catch every mistake and point at exactly where it is.

// Tests break the data in ways the types forbid, so the copy is untyped.
type Mutable = any;

function mutated(change: (system: Mutable) => void): unknown {
  const copy = JSON.parse(JSON.stringify(skirmish)) as Mutable;
  change(copy);
  return copy;
}

function errorPaths(data: unknown): string[] {
  const result = validateGameSystem(data);
  if (result.ok) return [];
  return result.errors.map((error) => error.path);
}

describe('validateGameSystem', () => {
  it('accepts the bundled sample system', () => {
    const result = validateGameSystem(skirmish);
    expect(result).toEqual({ ok: true, system: skirmish });
  });

  it('accepts a system without climbing or optional descriptions', () => {
    expect(errorPaths(mutated((s) => delete s.movement.climb))).toEqual([]);
  });

  it('accepts the sample after a JSON round trip', () => {
    expect(validateGameSystem(JSON.parse(JSON.stringify(skirmish))).ok).toBe(true);
  });

  it.each([null, [], 'skirmish', 3])('rejects a non-object (%j)', (data) => {
    expect(errorPaths(data)).toEqual(['']);
  });

  it('gives each error a message', () => {
    const result = validateGameSystem(mutated((s) => (s.formatVersion = 2)));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toMatch(/version/i);
  });

  it('reports every problem at once, not just the first', () => {
    const paths = errorPaths(
      mutated((s) => {
        s.name = '';
        s.defense = '10 +';
        s.monsters[0].xpValue = -5;
      }),
    );
    expect(paths).toEqual(expect.arrayContaining(['name', 'defense', 'monsters[0].xpValue']));
  });

  describe.each<[string, (system: Mutable) => void, string]>([
    // top level
    ['unsupported format version', (s) => (s.formatVersion = 2), 'formatVersion'],
    ['missing name', (s) => delete s.name, 'name'],
    ['empty id', (s) => (s.id = ''), 'id'],
    ['stats not a list', (s) => (s.stats = {}), 'stats'],
    // stats
    ['badly formed stat id', (s) => (s.stats[0].id = 'Str!'), 'stats[0].id'],
    ['duplicate stat id', (s) => (s.stats[1].id = 'str'), 'stats[1].id'],
    ['fractional stat default', (s) => (s.stats[0].default = 1.5), 'stats[0].default'],
    ['missing stat name', (s) => delete s.stats[2].name, 'stats[2].name'],
    // derived
    ['derived id clashing with a stat', (s) => (s.derived[0].id = 'str'), 'derived[0].id'],
    ['derived id using the reserved name level', (s) => (s.derived[0].id = 'level'), 'derived[0].id'],
    ['derived formula with a syntax error', (s) => (s.derived[0].formula = 'floor((@str - 10) / 2'), 'derived[0].formula'],
    ['derived formula using a later derived value', (s) => (s.derived[0].formula = '@prof'), 'derived[0].formula'],
    ['derived formula rolling dice', (s) => (s.derived[0].formula = '1d6'), 'derived[0].formula'],
    // levels
    ['empty XP table', (s) => (s.levels.xpThresholds = []), 'levels.xpThresholds'],
    ['XP table not starting at 0', (s) => (s.levels.xpThresholds = [100, 200]), 'levels.xpThresholds'],
    ['XP table not increasing', (s) => (s.levels.xpThresholds = [0, 300, 300]), 'levels.xpThresholds'],
    ['fractional XP threshold', (s) => (s.levels.xpThresholds = [0, 2.5]), 'levels.xpThresholds'],
    // core formulas
    ['max HP using an unknown variable', (s) => (s.health.max = '8 + @wis'), 'health.max'],
    ['max HP rolling dice', (s) => (s.health.max = '1d8 + @con_mod'), 'health.max'],
    ['defense rolling dice', (s) => (s.defense = '1d4 + 10'), 'defense'],
    ['initiative with a syntax error', (s) => (s.initiative = '1d20 +'), 'initiative'],
    ['speed rolling dice', (s) => (s.movement.speed = '1d6'), 'movement.speed'],
    // movement
    ['negative step up', (s) => (s.movement.maxStepUp = -1), 'movement.maxStepUp'],
    ['fractional step down', (s) => (s.movement.maxStepDown = 1.5), 'movement.maxStepDown'],
    ['climb lower than a normal step', (s) => (s.movement.climb.maxHeight = 0), 'movement.climb.maxHeight'],
    ['free climbing', (s) => (s.movement.climb.costPerLevel = 0), 'movement.climb.costPerLevel'],
    // conditions
    ['duplicate condition id', (s) => (s.conditions[1].id = 'stunned'), 'conditions[1].id'],
    ['non-boolean condition flag', (s) => (s.conditions[0].preventsActions = 'yes'), 'conditions[0].preventsActions'],
    ['non-string description', (s) => (s.conditions[0].description = 5), 'conditions[0].description'],
    // abilities
    ['duplicate ability id', (s) => (s.abilities[1].id = 'strike'), 'abilities[1].id'],
    ['negative range', (s) => (s.abilities[0].range = -1), 'abilities[0].range'],
    ['unknown target type', (s) => (s.abilities[0].target = 'everyone'), 'abilities[0].target'],
    ['unknown animation', (s) => (s.abilities[0].animation = 'dance'), 'abilities[0].animation'],
    ['attack roll with a syntax error', (s) => (s.abilities[0].attack.roll = '1d20 + + 2'), 'abilities[0].attack.roll'],
    ['no effects', (s) => (s.abilities[0].effects = []), 'abilities[0].effects'],
    ['unknown effect type', (s) => (s.abilities[0].effects[0].type = 'explode'), 'abilities[0].effects[0].type'],
    ['damage using an unknown variable', (s) => (s.abilities[0].effects[0].amount = '@wis'), 'abilities[0].effects[0].amount'],
    ['unknown condition', (s) => (s.abilities[2].effects[1].condition = 'frozen'), 'abilities[2].effects[1].condition'],
    ['zero-round condition', (s) => (s.abilities[2].effects[1].rounds = 0), 'abilities[2].effects[1].rounds'],
    // monsters
    ['duplicate monster id', (s) => (s.monsters[1].id = 'goblin'), 'monsters[1].id'],
    ['monster with an unknown ability', (s) => s.monsters[0].abilities.push('fireball'), 'monsters[0].abilities[2]'],
    ['monster with an unknown stat', (s) => (s.monsters[0].stats.wis = 12), 'monsters[0].stats.wis'],
    ['monster with a fractional stat', (s) => (s.monsters[0].stats.str = 8.5), 'monsters[0].stats.str'],
    ['monster below level 1', (s) => (s.monsters[0].level = 0), 'monsters[0].level'],
    ['monster above the max level', (s) => (s.monsters[0].level = 6), 'monsters[0].level'],
    ['negative monster XP', (s) => (s.monsters[0].xpValue = -1), 'monsters[0].xpValue'],
  ])('rejects %s', (_name, change, path) => {
    it(`at ${path}`, () => {
      expect(errorPaths(mutated(change))).toContain(path);
    });
  });
});
