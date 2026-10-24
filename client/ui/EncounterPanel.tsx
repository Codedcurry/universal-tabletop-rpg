import { type FormEvent, useMemo, useState } from 'react';
import { type ActiveCondition, type CombatState, type Combatant, type CombatantPatch, type CombatantSetup, setupFromMonster } from '@shared/combat';
import type { HostSession } from '@shared/net';
import { type GameSystem, computeCreature } from '@shared/system';
import { Roster } from './Roster';

// The DM's encounter controls: start and stop the fight, add creatures
// (monsters, or players' characters) and place them with a click on the map,
// and select any creature to rename it, edit it, move it, or remove it.

/** A creature waiting to be placed, or one being moved: the next map click decides where. */
export type Placing =
  | { readonly kind: 'new'; readonly setup: Omit<CombatantSetup, 'position'>; readonly label: string }
  | { readonly kind: 'move'; readonly id: string; readonly label: string };

interface Props {
  readonly session: HostSession;
  readonly selectedId: string | null;
  onSelect(id: string | null): void;
  onPlace(placing: Placing | null): void;
  onError(message: string | null): void;
}

const SIDES = ['party', 'monsters', 'neutral'];

/** "Goblin", then "Goblin 2", "Goblin 3"... and an id nobody has. */
function nextMonster(combat: CombatState | null, system: GameSystem, monsterId: string): { id: string; name: string } {
  const base = system.monsters.find((monster) => monster.id === monsterId)?.name ?? monsterId;
  const taken = new Set(Object.keys(combat?.combatants ?? {}));
  const names = new Set(Object.values(combat?.combatants ?? {}).map((combatant) => combatant.sheet.name));
  let n = 1;
  while (taken.has(`${monsterId}-${n}`)) n++;
  let name = base;
  for (let k = 2; names.has(name); k++) name = `${base} ${k}`;
  return { id: `${monsterId}-${n}`, name };
}

export function EncounterPanel({ session, selectedId, onSelect, onPlace, onError }: Props) {
  const snapshot = session.snapshot();
  const { combat, system, map, players } = snapshot;
  const [choice, setChoice] = useState('');
  const [side, setSide] = useState('');
  // Off: the fight runs in the listed order. Arranging the list before the fight turns it off.
  const [rollInitiative, setRollInitiative] = useState(true);

  if (!system || !map) return <p className="muted">Make a map first (the Map tab), then place creatures here.</p>;

  const placedIds = new Set(Object.keys(combat?.combatants ?? {}));
  const playerOptions = players.filter((player) => player.character && !placedIds.has(player.character.id));
  const selected = selectedId ? combat?.combatants[selectedId] : undefined;
  const status = combat?.status ?? 'setup';

  function report(result: { ok: boolean; reason?: string }) {
    onError(result.ok ? null : (result.reason ?? 'That change was refused'));
  }

  function startPlacing(event: FormEvent) {
    event.preventDefault();
    if (!system || choice === '') return;
    if (choice.startsWith('player:')) {
      const player = players.find((entry) => entry.id === choice.slice(7));
      if (!player?.character) return;
      onPlace({
        kind: 'new',
        label: player.character.name,
        setup: { sheet: player.character, side: side || 'party', isPlayerCharacter: true },
      });
    } else {
      const monsterId = choice.slice(8);
      const { id, name } = nextMonster(combat, system, monsterId);
      // Where it goes is decided by the next click on the map.
      const { position: _unplaced, ...setup } = setupFromMonster(system, monsterId, { id, side: side || 'monsters', position: { q: 0, r: 0 }, name });
      onPlace({ kind: 'new', label: name, setup });
    }
  }

  return (
    <div className="encounter">
      <div className="row">
        {status === 'active' ? (
          <button type="button" onClick={() => session.stopFight()}>
            Stop fight
          </button>
        ) : (
          <>
            <button type="button" className="primary" disabled={!combat} onClick={() => report(session.beginFight({ rollInitiative }))}>
              Start fight
            </button>
            <label className="check" title="Off: creatures act in the order listed below">
              <input type="checkbox" checked={rollInitiative} onChange={(event) => setRollInitiative(event.target.checked)} />
              Roll initiative
            </label>
          </>
        )}
        <button type="button" disabled={!combat} onClick={() => session.endCombat()} title="Removes every creature from the map">
          Clear encounter
        </button>
      </div>

      <form className="add-creature" onSubmit={startPlacing}>
        <label>
          <span>Add</span>
          <select value={choice} onChange={(event) => setChoice(event.target.value)}>
            <option value="">Choose a creature…</option>
            {playerOptions.length > 0 && (
              <optgroup label="Players' characters">
                {playerOptions.map((player) => (
                  <option key={player.id} value={`player:${player.id}`}>
                    {player.character?.name} (player)
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Monsters">
              {system.monsters.map((monster) => (
                <option key={monster.id} value={`monster:${monster.id}`}>
                  {monster.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label>
          <span>Side</span>
          <select value={side} onChange={(event) => setSide(event.target.value)}>
            <option value="">Automatic</option>
            {SIDES.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={choice === ''}>
          Place on map
        </button>
      </form>

      {combat && combat.order.length > 0 ? (
        <Roster
          combat={combat}
          system={system}
          selectedId={selectedId}
          rollInitiative={rollInitiative}
          onSelect={onSelect}
          onReorder={(order) => {
            report(session.reorderCreatures(order));
            if (status !== 'active') setRollInitiative(false);
          }}
        />
      ) : (
        <>
          <h3>Turn order</h3>
          <p className="muted">Nobody yet. Choose a creature above and place it on the map.</p>
        </>
      )}

      {selected && selectedId && (
        <CreatureEditor
          key={selectedId}
          id={selectedId}
          combatant={selected}
          system={system}
          onSave={(name, patch) => {
            if (name !== selected.sheet.name) {
              const renamed = session.renameCreature(selectedId, name);
              if (!renamed.ok) return report(renamed);
            }
            if (Object.keys(patch).length > 0) report(session.editCreature(selectedId, patch));
            else onError(null);
          }}
          onMove={() => onPlace({ kind: 'move', id: selectedId, label: selected.sheet.name })}
          onRemove={() => {
            report(session.removeCreature(selectedId));
            onSelect(null);
          }}
        />
      )}
    </div>
  );
}

interface EditorProps {
  readonly id: string;
  readonly combatant: Combatant;
  readonly system: GameSystem;
  onSave(name: string, patch: CombatantPatch): void;
  onMove(): void;
  onRemove(): void;
}

/** Edits one creature. Only fields that changed are sent, so the log says exactly what changed. */
function CreatureEditor({ combatant, system, onSave, onMove, onRemove }: EditorProps) {
  const sheet = combatant.sheet;
  const statValue = (statId: string) => sheet.stats[statId] ?? system.stats.find((stat) => stat.id === statId)?.default ?? 0;
  const [name, setName] = useState(sheet.name);
  const [hp, setHp] = useState(String(combatant.hp));
  const [stats, setStats] = useState(() => Object.fromEntries(system.stats.map((stat) => [stat.id, String(statValue(stat.id))])));
  const [xp, setXp] = useState(String(sheet.xp));
  const [side, setSide] = useState(combatant.side);
  const [isPc, setIsPc] = useState(combatant.isPlayerCharacter);
  const [xpValue, setXpValue] = useState(String(combatant.xpValue));
  const [conditions, setConditions] = useState<ActiveCondition[]>([...combatant.conditions]);
  const [abilities, setAbilities] = useState<string[]>([...sheet.abilities]);
  const maxHp = useMemo(() => computeCreature(system, sheet).maxHp, [system, sheet]);

  function save(event: FormEvent) {
    event.preventDefault();
    const patch: { -readonly [K in keyof CombatantPatch]: CombatantPatch[K] } = {};
    const changedStats = Object.fromEntries(
      Object.entries(stats)
        .map(([statId, value]) => [statId, Number(value)] as const)
        .filter(([statId, value]) => value !== statValue(statId)),
    );
    if (Object.keys(changedStats).length > 0) patch.stats = changedStats;
    if (Number(hp) !== combatant.hp) patch.hp = Number(hp);
    if (Number(xp) !== sheet.xp) patch.xp = Number(xp);
    if (side.trim() !== combatant.side) patch.side = side;
    if (isPc !== combatant.isPlayerCharacter) patch.isPlayerCharacter = isPc;
    if (Number(xpValue) !== combatant.xpValue) patch.xpValue = Number(xpValue);
    if (JSON.stringify(conditions) !== JSON.stringify(combatant.conditions)) patch.conditions = conditions;
    if (JSON.stringify(abilities) !== JSON.stringify(sheet.abilities)) patch.abilities = abilities;
    onSave(name, patch);
  }

  const toggleCondition = (id: string, on: boolean) =>
    setConditions((current) => (on ? [...current, { id, remainingRounds: 1 }] : current.filter((entry) => entry.id !== id)));
  const setRounds = (id: string, rounds: number) =>
    setConditions((current) => current.map((entry) => (entry.id === id ? { ...entry, remainingRounds: rounds } : entry)));

  return (
    <form className="creature-editor" onSubmit={save}>
      <fieldset>
        <legend>Edit {sheet.name}</legend>
        <div className="editor-grid">
          <label>
            <span>Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} />
          </label>
          <label>
            <span>HP</span>
            <input type="number" min={0} max={maxHp} value={hp} onChange={(event) => setHp(event.target.value)} />
          </label>
          {system.stats.map((stat) => (
            <label key={stat.id}>
              <span>{stat.name}</span>
              <input
                type="number"
                value={stats[stat.id] ?? ''}
                onChange={(event) => setStats((current) => ({ ...current, [stat.id]: event.target.value }))}
              />
            </label>
          ))}
          <label>
            <span>XP</span>
            <input type="number" min={0} value={xp} onChange={(event) => setXp(event.target.value)} />
          </label>
          <label>
            <span>Side</span>
            <input value={side} onChange={(event) => setSide(event.target.value)} maxLength={40} list="sides" />
          </label>
          <label>
            <span>XP when defeated</span>
            <input type="number" min={0} value={xpValue} onChange={(event) => setXpValue(event.target.value)} />
          </label>
        </div>
        <datalist id="sides">
          {SIDES.map((entry) => (
            <option key={entry} value={entry} />
          ))}
        </datalist>
        <label className="check">
          <input type="checkbox" checked={isPc} onChange={(event) => setIsPc(event.target.checked)} />
          Player character (earns XP)
        </label>

        <details>
          <summary>Conditions</summary>
          {system.conditions.map((condition) => {
            const active = conditions.find((entry) => entry.id === condition.id);
            return (
              <div key={condition.id} className="row">
                <label className="check">
                  <input type="checkbox" checked={!!active} onChange={(event) => toggleCondition(condition.id, event.target.checked)} />
                  {condition.name}
                </label>
                {active && (
                  <label>
                    <span>Rounds</span>
                    <input
                      type="number"
                      min={1}
                      value={active.remainingRounds}
                      onChange={(event) => setRounds(condition.id, Number(event.target.value))}
                    />
                  </label>
                )}
              </div>
            );
          })}
        </details>
        <details>
          <summary>Abilities</summary>
          {system.abilities.map((ability) => (
            <label key={ability.id} className="check">
              <input
                type="checkbox"
                checked={abilities.includes(ability.id)}
                onChange={(event) =>
                  setAbilities((current) => (event.target.checked ? [...current, ability.id] : current.filter((id) => id !== ability.id)))
                }
              />
              {ability.name}
            </label>
          ))}
        </details>

        <div className="row">
          <button type="submit" className="primary">
            Save changes
          </button>
          <button type="button" onClick={onMove}>
            Move on map
          </button>
          <button type="button" className="danger" onClick={onRemove}>
            Remove
          </button>
        </div>
      </fieldset>
    </form>
  );
}
