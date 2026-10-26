import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  type AbilityDef,
  type AbilityTarget,
  type EditorSection,
  type EffectDef,
  type GameSystem,
  type MonsterDef,
  describePath,
  idFrom,
  pathSection,
  removeAbility,
  removeCondition,
  removeResource,
  removeStat,
  renameEntryId,
  renameVariableId,
  validateGameSystem,
} from '@shared/system';

// The DM's rules editor: a game system as forms, in sections (basics, stats,
// conditions, abilities, monsters), checked as it's typed, with each problem
// shown by its field and listed in words. Nothing changes in the game until
// it's applied. New entries get ids from their names; a stat's formula name
// (@str) can be changed, and every formula using it follows. Optional parts
// of the format: resources (mana, spell slots) that abilities cost and
// effects give back, and critical hits and misses.

const SECTIONS: readonly { id: EditorSection; label: string }[] = [
  { id: 'basics', label: 'Basics' },
  { id: 'stats', label: 'Stats' },
  { id: 'conditions', label: 'Conditions' },
  { id: 'abilities', label: 'Abilities' },
  { id: 'monsters', label: 'Monsters' },
];
const TARGETS: readonly { id: AbilityTarget; label: string }[] = [
  { id: 'enemy', label: 'an enemy' },
  { id: 'ally', label: 'an ally' },
  { id: 'self', label: 'themself' },
];
const ANIMATIONS = ['melee', 'ranged', 'spell', 'item'] as const;

/** A labelled field with its problem (if any) under it. */
function Field({ label, error, children, wide }: { label: string; error: string | undefined; children: ReactNode; wide?: boolean }) {
  return (
    <label className={wide ? 'rules-field grow' : 'rules-field'}>
      <span>{label}</span>
      {children}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

/** A number box: an empty or partial entry is passed on as NaN, which the checks report. */
function NumberInput({ value, onChange, min }: { value: number; onChange: (value: number) => void; min?: number }) {
  return (
    <input
      type="number"
      inputMode="numeric"
      {...(min === undefined ? {} : { min })}
      value={Number.isFinite(value) ? value : ''}
      onChange={(event) => onChange(event.target.value === '' ? Number.NaN : Number(event.target.value))}
    />
  );
}

/** A box committed when it loses focus (or Enter), for things like ids where every keystroke would be a rename. */
function CommitInput({ value, onCommit, label }: { value: string; onCommit: (value: string) => void; label?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      value={text}
      {...(label ? { 'aria-label': label } : {})}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => text !== value && onCommit(text)}
      onKeyDown={(event) => event.key === 'Enter' && (event.currentTarget as HTMLInputElement).blur()}
    />
  );
}

export function SystemEditor({
  initial,
  title,
  note,
  onApply,
  onCancel,
}: {
  initial: GameSystem;
  title: string;
  note?: string;
  /** The finished system, and the stats renamed in it (old formula name → new), so creatures in play keep their values. */
  onApply: (system: GameSystem, renames: Readonly<Record<string, string>>) => void;
  onCancel: () => void;
}) {
  const [system, setSystem] = useState(initial);
  const [section, setSection] = useState<EditorSection>('basics');
  /** Entries added here (by id), whose ids still follow their names. */
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const [renameError, setRenameError] = useState<string | null>(null);
  /** Stats the game already had, renamed here: their first id → their id now. */
  const [renames, setRenames] = useState<Readonly<Record<string, string>>>({});
  const [xpText, setXpText] = useState(initial.levels.xpThresholds.join(', '));
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => dialog.current?.focus(), []);

  const result = useMemo(() => validateGameSystem(system), [system]);
  const errors = result.ok ? [] : result.errors;
  const errorAt = (path: string) => errors.find((error) => error.path === path)?.message;
  const counts = (id: EditorSection) => errors.filter((error) => pathSection(error.path) === id).length;
  const variables = ['level', ...system.stats.map((stat) => stat.id), ...system.derived.map((derived) => derived.id)];

  const update = (change: (now: GameSystem) => GameSystem) => setSystem(change);
  const at = <T,>(list: readonly T[], index: number, value: T): T[] => list.map((entry, i) => (i === index ? value : entry));
  const without = <T,>(list: readonly T[], index: number): T[] => list.filter((_, i) => i !== index);

  /** A new entry's name changed: its id follows, with every reference. */
  function renamed(kind: 'ability' | 'condition' | 'monster' | 'resource' | 'stat', id: string, name: string, now: GameSystem): GameSystem {
    if (!added.has(id)) return now;
    const taken = new Set(
      kind === 'ability'
        ? now.abilities.map((entry) => entry.id)
        : kind === 'condition'
          ? now.conditions.map((entry) => entry.id)
          : kind === 'monster'
            ? now.monsters.map((entry) => entry.id)
            : kind === 'resource'
              ? (now.resources ?? []).map((entry) => entry.id)
              : ['level', ...now.stats.map((entry) => entry.id), ...now.derived.map((entry) => entry.id)],
    );
    taken.delete(id);
    const next = idFrom(name, taken);
    if (next === id) return now;
    setAdded((ids) => new Set([...[...ids].filter((entry) => entry !== id), next]));
    return kind === 'stat' ? renameVariableId(now, id, next) : renameEntryId(now, kind, id, next);
  }

  function renameVariable(from: string, to: string) {
    try {
      const next = to.trim();
      setSystem((now) => renameVariableId(now, from, next));
      setAdded((ids) => new Set([...ids].filter((entry) => entry !== from)));
      if (initial.stats.some((stat) => stat.id === from) || Object.values(renames).includes(from)) {
        setRenames((all) => {
          const original = Object.keys(all).find((key) => all[key] === from) ?? from;
          return { ...all, [original]: next };
        });
      }
      setRenameError(null);
    } catch (caught) {
      setRenameError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function addEntry(kind: 'stat' | 'derived' | 'resource' | 'condition' | 'ability' | 'monster') {
    setSystem((now) => {
      if (kind === 'resource') {
        const id = idFrom('New resource', new Set((now.resources ?? []).map((entry) => entry.id)));
        setAdded((ids) => new Set([...ids, id]));
        return { ...now, resources: [...(now.resources ?? []), { id, name: 'New resource', max: '3', refill: 'fight' }] };
      }
      const variableIds = new Set(['level', ...now.stats.map((stat) => stat.id), ...now.derived.map((derived) => derived.id)]);
      if (kind === 'stat') {
        const id = idFrom('New stat', variableIds);
        setAdded((ids) => new Set([...ids, id]));
        return { ...now, stats: [...now.stats, { id, name: 'New stat', default: 10 }] };
      }
      if (kind === 'derived') {
        const id = idFrom('New value', variableIds);
        setAdded((ids) => new Set([...ids, id]));
        return { ...now, derived: [...now.derived, { id, name: 'New value', formula: '0' }] };
      }
      if (kind === 'condition') {
        const id = idFrom('New condition', new Set(now.conditions.map((entry) => entry.id)));
        setAdded((ids) => new Set([...ids, id]));
        return { ...now, conditions: [...now.conditions, { id, name: 'New condition' }] };
      }
      if (kind === 'ability') {
        const id = idFrom('New ability', new Set(now.abilities.map((entry) => entry.id)));
        setAdded((ids) => new Set([...ids, id]));
        const ability: AbilityDef = { id, name: 'New ability', range: 1, target: 'enemy', attack: { roll: '1d20' }, effects: [{ type: 'damage', amount: '1d6' }], animation: 'melee' };
        return { ...now, abilities: [...now.abilities, ability] };
      }
      const id = idFrom('New monster', new Set(now.monsters.map((entry) => entry.id)));
      setAdded((ids) => new Set([...ids, id]));
      const monster: MonsterDef = { id, name: 'New monster', level: 1, stats: {}, abilities: now.abilities[0] ? [now.abilities[0].id] : [], xpValue: 50 };
      return { ...now, monsters: [...now.monsters, monster] };
    });
  }

  const formulaHint = (
    <p className="muted small">
      Formulas use numbers, dice (1d20, 2d6), + − × ÷ ( ), floor, ceil, round, min, max, abs, and these values: {variables.map((name) => `@${name}`).join(', ')}.
    </p>
  );

  const setEffect = (abilityIndex: number, effectIndex: number, effect: EffectDef) =>
    update((now) => {
      const ability = now.abilities[abilityIndex]!;
      return { ...now, abilities: at(now.abilities, abilityIndex, { ...ability, effects: at(ability.effects, effectIndex, effect) }) };
    });

  return createPortal(
    <div className="picker-backdrop">
      <div
        ref={dialog}
        className="panel picker-dialog rules-editor"
        role="dialog"
        aria-modal="true"
        aria-label="Rules editor"
        tabIndex={-1}
        onKeyDown={(event) => event.key === 'Escape' && onCancel()}
      >
        <div className="picker-head">
          <h3>{title}</h3>
          <button type="button" aria-label="Close" title="Cancel" onClick={onCancel}>
            ×
          </button>
        </div>
        {note && <p className="muted">{note}</p>}

        <div className="art-tabs" role="tablist" aria-label="Rules sections">
          {SECTIONS.map((entry) => (
            <button key={entry.id} type="button" role="tab" aria-selected={section === entry.id} onClick={() => setSection(entry.id)}>
              {entry.label}
              {counts(entry.id) > 0 && <span className="rules-count"> ({counts(entry.id)} to fix)</span>}
            </button>
          ))}
        </div>

        {errors.length > 0 && (
          <div className="rules-problems" role="alert">
            <strong>
              {errors.length} {errors.length === 1 ? 'problem' : 'problems'} to fix before applying:
            </strong>
            <ul>
              {errors.slice(0, 12).map((error) => (
                <li key={`${error.path}:${error.message}`}>
                  <button type="button" className="link" onClick={() => setSection(pathSection(error.path))}>
                    {describePath(system, error.path)}
                  </button>
                  : {error.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {renameError && <p className="field-error">{renameError}</p>}

        <div role="tabpanel" aria-label="Basics" hidden={section !== 'basics'}>
          <div className="row">
            <Field label="System name" error={errorAt('name')} wide>
              <input value={system.name} onChange={(event) => update((now) => ({ ...now, name: event.target.value }))} />
            </Field>
            <Field label="XP for each level (from level 1)" error={errorAt('levels.xpThresholds')} wide>
              <input
                value={xpText}
                onChange={(event) => {
                  setXpText(event.target.value);
                  const values = event.target.value
                    .split(/[\s,]+/)
                    .filter((part) => part !== '')
                    .map(Number);
                  update((now) => ({ ...now, levels: { xpThresholds: values } }));
                }}
              />
            </Field>
          </div>
          <div className="row">
            <Field label="Max HP" error={errorAt('health.max')} wide>
              <input className="formula" value={system.health.max} onChange={(event) => update((now) => ({ ...now, health: { max: event.target.value } }))} />
            </Field>
            <Field label="Defense (what an attack must meet or beat)" error={errorAt('defense')} wide>
              <input className="formula" value={system.defense} onChange={(event) => update((now) => ({ ...now, defense: event.target.value }))} />
            </Field>
            <Field label="Initiative (rolled; highest goes first)" error={errorAt('initiative')} wide>
              <input className="formula" value={system.initiative} onChange={(event) => update((now) => ({ ...now, initiative: event.target.value }))} />
            </Field>
          </div>
          <div className="row">
            <Field label="Speed (tiles a turn)" error={errorAt('movement.speed')}>
              <input className="formula" value={system.movement.speed} onChange={(event) => update((now) => ({ ...now, movement: { ...now.movement, speed: event.target.value } }))} />
            </Field>
            <Field label="Highest step up" error={errorAt('movement.maxStepUp')}>
              <NumberInput min={0} value={system.movement.maxStepUp} onChange={(value) => update((now) => ({ ...now, movement: { ...now.movement, maxStepUp: value } }))} />
            </Field>
            <Field label="Highest drop down" error={errorAt('movement.maxStepDown')}>
              <NumberInput min={0} value={system.movement.maxStepDown} onChange={(value) => update((now) => ({ ...now, movement: { ...now.movement, maxStepDown: value } }))} />
            </Field>
            <label className="check">
              <input
                type="checkbox"
                checked={system.movement.climb !== undefined}
                onChange={(event) =>
                  update((now) => {
                    const { climb: _climb, ...rest } = now.movement;
                    return { ...now, movement: event.target.checked ? { ...rest, climb: { maxHeight: rest.maxStepUp + 2, costPerLevel: 1 } } : rest };
                  })
                }
              />
              <span>Creatures can climb higher</span>
            </label>
            {system.movement.climb && (
              <>
                <Field label="Highest climb" error={errorAt('movement.climb.maxHeight')}>
                  <NumberInput
                    min={1}
                    value={system.movement.climb.maxHeight}
                    onChange={(value) => update((now) => ({ ...now, movement: { ...now.movement, climb: { ...now.movement.climb!, maxHeight: value } } }))}
                  />
                </Field>
                <Field label="Extra movement per level climbed" error={errorAt('movement.climb.costPerLevel')}>
                  <NumberInput
                    min={1}
                    value={system.movement.climb.costPerLevel}
                    onChange={(value) => update((now) => ({ ...now, movement: { ...now.movement, climb: { ...now.movement.climb!, costPerLevel: value } } }))}
                  />
                </Field>
              </>
            )}
          </div>
          <h4>Critical hits</h4>
          <div className="row">
            <label className="check">
              <input
                type="checkbox"
                checked={system.critical !== undefined}
                onChange={(event) =>
                  update((now) => {
                    const { critical: _critical, ...rest } = now;
                    return event.target.checked ? { ...rest, critical: { hit: 20, miss: 1 } } : rest;
                  })
                }
              />
              <span>Attack rolls can be critical (by the natural roll: the first die)</span>
            </label>
            {system.critical && (
              <>
                <Field label="Always hits, damage dice twice, on at least" error={errorAt('critical.hit')}>
                  <input
                    type="number"
                    min={1}
                    placeholder="never"
                    value={system.critical.hit ?? ''}
                    onChange={(event) =>
                      update((now) => {
                        const { hit: _hit, ...rest } = now.critical ?? {};
                        return { ...now, critical: event.target.value === '' ? rest : { ...rest, hit: Number(event.target.value) } };
                      })
                    }
                  />
                </Field>
                <Field label="Always misses on at most" error={errorAt('critical.miss')}>
                  <input
                    type="number"
                    min={1}
                    placeholder="never"
                    value={system.critical.miss ?? ''}
                    onChange={(event) =>
                      update((now) => {
                        const { miss: _miss, ...rest } = now.critical ?? {};
                        return { ...now, critical: event.target.value === '' ? rest : { ...rest, miss: Number(event.target.value) } };
                      })
                    }
                  />
                </Field>
              </>
            )}
          </div>
          {formulaHint}
        </div>

        <div role="tabpanel" aria-label="Stats" hidden={section !== 'stats'}>
          <h4>Stats</h4>
          <p className="muted small">What every creature has a number for. The formula name is how formulas use it (@str).</p>
          {system.stats.map((stat, index) => (
            <div key={`stat-${index}`} className="row rules-row" role="group" aria-label={`Stat ${stat.name}`}>
              <Field label="Name" error={errorAt(`stats[${index}].name`)} wide>
                <input
                  value={stat.name}
                  onChange={(event) => {
                    const name = event.target.value;
                    update((now) => renamed('stat', stat.id, name, { ...now, stats: at(now.stats, index, { ...now.stats[index]!, name }) }));
                  }}
                />
              </Field>
              <Field label="Formula name" error={errorAt(`stats[${index}].id`)}>
                <CommitInput value={stat.id} onCommit={(value) => renameVariable(stat.id, value)} />
              </Field>
              <Field label="Default" error={errorAt(`stats[${index}].default`)}>
                <NumberInput value={stat.default} onChange={(value) => update((now) => ({ ...now, stats: at(now.stats, index, { ...now.stats[index]!, default: value }) }))} />
              </Field>
              <button type="button" aria-label={`Remove stat ${stat.name}`} onClick={() => update((now) => removeStat(now, stat.id))}>
                Remove
              </button>
            </div>
          ))}
          <button type="button" onClick={() => addEntry('stat')}>
            Add a stat
          </button>

          <h4>Worked-out values</h4>
          <p className="muted small">Values worked out from stats and level (modifiers, proficiency), usable in later formulas. No dice.</p>
          {system.derived.map((derived, index) => (
            <div key={`derived-${index}`} className="row rules-row" role="group" aria-label={`Value ${derived.name}`}>
              <Field label="Name" error={errorAt(`derived[${index}].name`)} wide>
                <input
                  value={derived.name}
                  onChange={(event) => {
                    const name = event.target.value;
                    update((now) => renamed('stat', derived.id, name, { ...now, derived: at(now.derived, index, { ...now.derived[index]!, name }) }));
                  }}
                />
              </Field>
              <Field label="Formula name" error={errorAt(`derived[${index}].id`)}>
                <CommitInput value={derived.id} onCommit={(value) => renameVariable(derived.id, value)} />
              </Field>
              <Field label="Formula" error={errorAt(`derived[${index}].formula`)} wide>
                <input
                  className="formula"
                  value={derived.formula}
                  onChange={(event) => update((now) => ({ ...now, derived: at(now.derived, index, { ...now.derived[index]!, formula: event.target.value }) }))}
                />
              </Field>
              <button type="button" aria-label={`Remove value ${derived.name}`} onClick={() => update((now) => ({ ...now, derived: without(now.derived, index) }))}>
                Remove
              </button>
            </div>
          ))}
          <button type="button" onClick={() => addEntry('derived')}>
            Add a worked-out value
          </button>

          <h4>Resources</h4>
          <p className="muted small">Points abilities spend (mana, spell slots, ki): each creature has up to its max, refilled each turn or each fight.</p>
          {(system.resources ?? []).map((resource, index) => (
            <div key={`resource-${index}`} className="row rules-row" role="group" aria-label={`Resource ${resource.name}`}>
              <Field label="Name" error={errorAt(`resources[${index}].name`)} wide>
                <input
                  value={resource.name}
                  onChange={(event) => {
                    const name = event.target.value;
                    update((now) => renamed('resource', resource.id, name, { ...now, resources: at(now.resources ?? [], index, { ...(now.resources ?? [])[index]!, name }) }));
                  }}
                />
              </Field>
              <Field label="Max" error={errorAt(`resources[${index}].max`)} wide>
                <input
                  className="formula"
                  value={resource.max}
                  onChange={(event) => update((now) => ({ ...now, resources: at(now.resources ?? [], index, { ...(now.resources ?? [])[index]!, max: event.target.value }) }))}
                />
              </Field>
              <Field label="Refills" error={errorAt(`resources[${index}].refill`)}>
                <select
                  value={resource.refill}
                  onChange={(event) =>
                    update((now) => ({ ...now, resources: at(now.resources ?? [], index, { ...(now.resources ?? [])[index]!, refill: event.target.value as 'turn' | 'fight' }) }))
                  }
                >
                  <option value="turn">every turn</option>
                  <option value="fight">every fight</option>
                </select>
              </Field>
              <button type="button" aria-label={`Remove resource ${resource.name}`} onClick={() => update((now) => removeResource(now, resource.id))}>
                Remove
              </button>
            </div>
          ))}
          <button type="button" onClick={() => addEntry('resource')}>
            Add a resource
          </button>
          {formulaHint}
        </div>

        <div role="tabpanel" aria-label="Conditions" hidden={section !== 'conditions'}>
          <p className="muted small">Effects that last a few rounds (stunned, rooted), put on by abilities.</p>
          {system.conditions.map((condition, index) => (
            <div key={`condition-${index}`} className="row rules-row" role="group" aria-label={`Condition ${condition.name}`}>
              <Field label="Name" error={errorAt(`conditions[${index}].name`)}>
                <input
                  value={condition.name}
                  onChange={(event) => {
                    const name = event.target.value;
                    update((now) => renamed('condition', condition.id, name, { ...now, conditions: at(now.conditions, index, { ...now.conditions[index]!, name }) }));
                  }}
                />
              </Field>
              <Field label="What it does" error={errorAt(`conditions[${index}].description`)} wide>
                <input
                  value={condition.description ?? ''}
                  onChange={(event) =>
                    update((now) => {
                      const { description: _description, ...rest } = now.conditions[index]!;
                      return { ...now, conditions: at(now.conditions, index, event.target.value ? { ...rest, description: event.target.value } : rest) };
                    })
                  }
                />
              </Field>
              <label className="check">
                <input
                  type="checkbox"
                  checked={condition.preventsActions ?? false}
                  onChange={(event) => update((now) => ({ ...now, conditions: at(now.conditions, index, { ...now.conditions[index]!, preventsActions: event.target.checked }) }))}
                />
                <span>Can&apos;t act</span>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={condition.preventsMovement ?? false}
                  onChange={(event) => update((now) => ({ ...now, conditions: at(now.conditions, index, { ...now.conditions[index]!, preventsMovement: event.target.checked }) }))}
                />
                <span>Can&apos;t move</span>
              </label>
              <button type="button" aria-label={`Remove condition ${condition.name}`} onClick={() => update((now) => removeCondition(now, condition.id))}>
                Remove
              </button>
            </div>
          ))}
          <button type="button" onClick={() => addEntry('condition')}>
            Add a condition
          </button>
        </div>

        <div role="tabpanel" aria-label="Abilities" hidden={section !== 'abilities'}>
          {system.abilities.map((ability, index) => (
            <details key={`ability-${index}`} className="rules-card" open={added.has(ability.id) || undefined} aria-label={`Ability ${ability.name}`}>
              <summary>
                {ability.name || 'Unnamed ability'}
                {errors.some((error) => error.path.startsWith(`abilities[${index}]`)) && <span className="rules-count"> (to fix)</span>}
              </summary>
              <div className="row">
                <Field label="Name" error={errorAt(`abilities[${index}].name`)}>
                  <input
                    value={ability.name}
                    onChange={(event) => {
                      const name = event.target.value;
                      update((now) => renamed('ability', ability.id, name, { ...now, abilities: at(now.abilities, index, { ...now.abilities[index]!, name }) }));
                    }}
                  />
                </Field>
                <Field label="Aimed at" error={errorAt(`abilities[${index}].target`)}>
                  <select
                    value={ability.target}
                    onChange={(event) => update((now) => ({ ...now, abilities: at(now.abilities, index, { ...now.abilities[index]!, target: event.target.value as AbilityTarget }) }))}
                  >
                    {TARGETS.map((target) => (
                      <option key={target.id} value={target.id}>
                        {target.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Range (tiles)" error={errorAt(`abilities[${index}].range`)}>
                  <NumberInput min={0} value={ability.range} onChange={(value) => update((now) => ({ ...now, abilities: at(now.abilities, index, { ...now.abilities[index]!, range: value }) }))} />
                </Field>
                <Field label="Animation" error={errorAt(`abilities[${index}].animation`)}>
                  <select
                    value={ability.animation}
                    onChange={(event) =>
                      update((now) => ({ ...now, abilities: at(now.abilities, index, { ...now.abilities[index]!, animation: event.target.value as AbilityDef['animation'] }) }))
                    }
                  >
                    {ANIMATIONS.map((animation) => (
                      <option key={animation} value={animation}>
                        {animation}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Description" error={errorAt(`abilities[${index}].description`)} wide>
                <input
                  value={ability.description ?? ''}
                  onChange={(event) =>
                    update((now) => {
                      const { description: _description, ...rest } = now.abilities[index]!;
                      return { ...now, abilities: at(now.abilities, index, event.target.value ? { ...rest, description: event.target.value } : rest) };
                    })
                  }
                />
              </Field>
              <div className="row">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={ability.attack !== undefined}
                    onChange={(event) =>
                      update((now) => {
                        const { attack: _attack, ...rest } = now.abilities[index]!;
                        return { ...now, abilities: at(now.abilities, index, event.target.checked ? { ...rest, attack: { roll: '1d20' } } : rest) };
                      })
                    }
                  />
                  <span>Needs an attack roll (hits on meeting the target&apos;s defense)</span>
                </label>
                {ability.attack && (
                  <Field label="Attack roll" error={errorAt(`abilities[${index}].attack.roll`)} wide>
                    <input
                      className="formula"
                      value={ability.attack.roll}
                      onChange={(event) => update((now) => ({ ...now, abilities: at(now.abilities, index, { ...now.abilities[index]!, attack: { roll: event.target.value } }) }))}
                    />
                  </Field>
                )}
              </div>
              {(system.resources ?? []).length > 0 && (
                <div className="row">
                  {(system.resources ?? []).map((resource) => (
                    <Field key={resource.id} label={`${resource.name} cost`} error={errorAt(`abilities[${index}].cost.${resource.id}`)}>
                      <input
                        type="number"
                        min={0}
                        placeholder="0"
                        value={ability.cost?.[resource.id] ?? ''}
                        onChange={(event) =>
                          update((now) => {
                            const { cost, ...rest } = now.abilities[index]!;
                            const next = Object.fromEntries(Object.entries(cost ?? {}).filter(([id]) => id !== resource.id));
                            if (event.target.value !== '' && Number(event.target.value) !== 0) next[resource.id] = Number(event.target.value);
                            return { ...now, abilities: at(now.abilities, index, Object.keys(next).length > 0 ? { ...rest, cost: next } : rest) };
                          })
                        }
                      />
                    </Field>
                  ))}
                </div>
              )}
              <h5>What it does</h5>
              {errorAt(`abilities[${index}].effects`) && <p className="field-error">{errorAt(`abilities[${index}].effects`)}</p>}
              {ability.effects.map((effect, effectIndex) => {
                const base = `abilities[${index}].effects[${effectIndex}]`;
                return (
                  <div key={effectIndex} className="row rules-row" role="group" aria-label={`Effect ${effectIndex + 1}`}>
                    <Field label="Effect" error={errorAt(`${base}.type`)}>
                      <select
                        value={effect.type}
                        onChange={(event) => {
                          const type = event.target.value as EffectDef['type'];
                          setEffect(
                            index,
                            effectIndex,
                            type === 'applyCondition'
                              ? { type, condition: system.conditions[0]?.id ?? '', rounds: 1 }
                              : type === 'restore'
                                ? { type, resource: system.resources?.[0]?.id ?? '', amount: effect.type === 'applyCondition' ? '1d4' : effect.amount }
                                : { type, amount: effect.type === 'applyCondition' ? '1d6' : effect.amount },
                          );
                        }}
                      >
                        <option value="damage">damage</option>
                        <option value="heal">heal</option>
                        <option value="applyCondition">put on a condition</option>
                        {((system.resources ?? []).length > 0 || effect.type === 'restore') && <option value="restore">give back a resource</option>}
                      </select>
                    </Field>
                    {effect.type === 'applyCondition' ? (
                      <>
                        <Field label="Condition" error={errorAt(`${base}.condition`)}>
                          <select value={effect.condition} onChange={(event) => setEffect(index, effectIndex, { ...effect, condition: event.target.value })}>
                            {!system.conditions.some((condition) => condition.id === effect.condition) && <option value={effect.condition}>(choose one)</option>}
                            {system.conditions.map((condition) => (
                              <option key={condition.id} value={condition.id}>
                                {condition.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Rounds" error={errorAt(`${base}.rounds`)}>
                          <NumberInput min={1} value={effect.rounds} onChange={(value) => setEffect(index, effectIndex, { ...effect, rounds: value })} />
                        </Field>
                      </>
                    ) : effect.type === 'restore' ? (
                      <>
                        <Field label="Resource" error={errorAt(`${base}.resource`)}>
                          <select value={effect.resource} onChange={(event) => setEffect(index, effectIndex, { ...effect, resource: event.target.value })}>
                            {!(system.resources ?? []).some((resource) => resource.id === effect.resource) && <option value={effect.resource}>(choose one)</option>}
                            {(system.resources ?? []).map((resource) => (
                              <option key={resource.id} value={resource.id}>
                                {resource.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Amount" error={errorAt(`${base}.amount`)} wide>
                          <input className="formula" value={effect.amount} onChange={(event) => setEffect(index, effectIndex, { ...effect, amount: event.target.value })} />
                        </Field>
                      </>
                    ) : (
                      <Field label="Amount" error={errorAt(`${base}.amount`)} wide>
                        <input className="formula" value={effect.amount} onChange={(event) => setEffect(index, effectIndex, { ...effect, amount: event.target.value })} />
                      </Field>
                    )}
                    <button
                      type="button"
                      aria-label={`Remove effect ${effectIndex + 1}`}
                      onClick={() => update((now) => ({ ...now, abilities: at(now.abilities, index, { ...now.abilities[index]!, effects: without(now.abilities[index]!.effects, effectIndex) }) }))}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
              <div className="row">
                <button
                  type="button"
                  onClick={() =>
                    update((now) => ({
                      ...now,
                      abilities: at(now.abilities, index, { ...now.abilities[index]!, effects: [...now.abilities[index]!.effects, { type: 'damage', amount: '1d6' }] }),
                    }))
                  }
                >
                  Add an effect
                </button>
                <button type="button" aria-label={`Remove ability ${ability.name}`} onClick={() => update((now) => removeAbility(now, ability.id))}>
                  Remove ability
                </button>
              </div>
            </details>
          ))}
          <button type="button" onClick={() => addEntry('ability')}>
            Add an ability
          </button>
          {formulaHint}
        </div>

        <div role="tabpanel" aria-label="Monsters" hidden={section !== 'monsters'}>
          {system.monsters.map((monster, index) => (
            <details key={`monster-${index}`} className="rules-card" open={added.has(monster.id) || undefined} aria-label={`Monster ${monster.name}`}>
              <summary>
                {monster.name || 'Unnamed monster'} · level {Number.isFinite(monster.level) ? monster.level : '?'}
                {errors.some((error) => error.path.startsWith(`monsters[${index}]`)) && <span className="rules-count"> (to fix)</span>}
              </summary>
              <div className="row">
                <Field label="Name" error={errorAt(`monsters[${index}].name`)}>
                  <input
                    value={monster.name}
                    onChange={(event) => {
                      const name = event.target.value;
                      update((now) => renamed('monster', monster.id, name, { ...now, monsters: at(now.monsters, index, { ...now.monsters[index]!, name }) }));
                    }}
                  />
                </Field>
                <Field label="Level" error={errorAt(`monsters[${index}].level`)}>
                  <NumberInput min={1} value={monster.level} onChange={(value) => update((now) => ({ ...now, monsters: at(now.monsters, index, { ...now.monsters[index]!, level: value }) }))} />
                </Field>
                <Field label="XP for defeating it" error={errorAt(`monsters[${index}].xpValue`)}>
                  <NumberInput min={0} value={monster.xpValue} onChange={(value) => update((now) => ({ ...now, monsters: at(now.monsters, index, { ...now.monsters[index]!, xpValue: value }) }))} />
                </Field>
              </div>
              <div className="row">
                {system.stats.map((stat) => (
                  <Field key={stat.id} label={stat.name} error={errorAt(`monsters[${index}].stats.${stat.id}`)}>
                    <input
                      type="number"
                      placeholder={String(stat.default)}
                      value={monster.stats[stat.id] ?? ''}
                      onChange={(event) =>
                        update((now) => {
                          const current = now.monsters[index]!;
                          const stats = Object.fromEntries(Object.entries(current.stats).filter(([key]) => key !== stat.id));
                          if (event.target.value !== '') stats[stat.id] = Number(event.target.value);
                          return { ...now, monsters: at(now.monsters, index, { ...current, stats }) };
                        })
                      }
                    />
                  </Field>
                ))}
              </div>
              <fieldset className="rules-abilities">
                <legend>Abilities</legend>
                {system.abilities.map((ability) => (
                  <label key={ability.id} className="check">
                    <input
                      type="checkbox"
                      checked={monster.abilities.includes(ability.id)}
                      onChange={(event) =>
                        update((now) => {
                          const current = now.monsters[index]!;
                          const abilities = event.target.checked ? [...current.abilities, ability.id] : current.abilities.filter((id) => id !== ability.id);
                          return { ...now, monsters: at(now.monsters, index, { ...current, abilities }) };
                        })
                      }
                    />
                    <span>{ability.name}</span>
                  </label>
                ))}
              </fieldset>
              <button type="button" aria-label={`Remove monster ${monster.name}`} onClick={() => update((now) => ({ ...now, monsters: without(now.monsters, index) }))}>
                Remove monster
              </button>
            </details>
          ))}
          <button type="button" onClick={() => addEntry('monster')}>
            Add a monster
          </button>
        </div>

        <div className="row rules-actions">
          <button type="button" className="primary" disabled={!result.ok} onClick={() => result.ok && onApply(result.system, renames)}>
            Apply to game
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
