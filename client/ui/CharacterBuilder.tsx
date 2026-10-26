import { type FormEvent, useMemo, useState } from 'react';
import { type CreatureSheet, type GameSystem, computeCreature } from '@shared/system';

// A player making their character with the game's own rules (whatever the
// DM is running, imported from a book or homebrew): a name, a number for each
// stat (the rules' defaults to start), and the abilities they want; what that
// works out to (modifiers, max HP, defense) shows as they go. Saved, it goes
// to the DM, who checks it against the rules; it's also kept on this device,
// to bring next time.

const STORAGE_KEY = 'ttrpg.character';

/** The character this device last made (for joining a game with it). */
export function savedCharacter(): CreatureSheet | null {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as CreatureSheet | null;
    return saved && typeof saved.name === 'string' && typeof saved.stats === 'object' && Array.isArray(saved.abilities) ? saved : null;
  } catch {
    return null;
  }
}

function saveCharacter(character: CreatureSheet): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(character));
  } catch {
    // Private browsing: it lasts until the page closes.
  }
}

/** One line about an ability: who it's for, how far, what it costs. */
function abilityLine(system: GameSystem, id: string): string {
  const ability = system.abilities.find((entry) => entry.id === id);
  if (!ability) return '';
  const parts = [
    ability.reaction ? 'reaction' : null,
    ability.target === 'self' ? 'self' : `${ability.target}, range ${ability.range}`,
    ...Object.entries(ability.cost ?? {}).map(([resource, amount]) => `${amount} ${system.resources?.find((entry) => entry.id === resource)?.name ?? resource}`),
  ].filter(Boolean);
  return parts.join(' · ');
}

export function CharacterBuilder({
  system,
  current,
  defaultName,
  onSave,
  onCancel,
}: {
  system: GameSystem;
  current: CreatureSheet | null;
  defaultName: string;
  onSave: (character: CreatureSheet) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(current?.name ?? defaultName);
  const [stats, setStats] = useState<Record<string, string>>(() =>
    Object.fromEntries(system.stats.map((stat) => [stat.id, String(current?.stats[stat.id] ?? stat.default)])),
  );
  const [abilities, setAbilities] = useState<string[]>(() => (current?.abilities ?? []).filter((id) => system.abilities.some((ability) => ability.id === id)));

  const sheet: CreatureSheet = useMemo(
    () => ({
      id: current?.id ?? 'character',
      name: name.trim() || defaultName,
      stats: Object.fromEntries(Object.entries(stats).map(([id, value]) => [id, Math.round(Number(value) || 0)])),
      xp: current?.xp ?? 0,
      abilities,
    }),
    [current, name, stats, abilities, defaultName],
  );
  // What the numbers work out to, under these rules (or why they don't).
  const worked = useMemo(() => {
    try {
      return { numbers: computeCreature(system, sheet), error: null };
    } catch (caught) {
      return { numbers: null, error: caught instanceof Error ? caught.message : String(caught) };
    }
  }, [system, sheet]);

  function save(event: FormEvent) {
    event.preventDefault();
    if (!worked.numbers || abilities.length === 0) return;
    saveCharacter(sheet);
    onSave(sheet);
  }

  const numbers = worked.numbers;
  return (
    <form className="character-builder" aria-label="Your character" onSubmit={save}>
      <p className="muted small">With the rules of {system.name}. The DM checks it, and can change it.</p>
      <label>
        <span>Name</span>
        <input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} />
      </label>
      <fieldset className="builder-stats">
        <legend>Stats</legend>
        {system.stats.map((stat) => (
          <label key={stat.id}>
            <span>{stat.name}</span>
            <input type="number" inputMode="numeric" value={stats[stat.id] ?? ''} onChange={(event) => setStats((now) => ({ ...now, [stat.id]: event.target.value }))} />
          </label>
        ))}
      </fieldset>
      {numbers ? (
        <p className="builder-numbers" data-testid="character-numbers">
          Level {numbers.level} · {numbers.maxHp} HP · defense {numbers.defense} · speed {numbers.speed}
          {system.derived.map((derived) => ` · ${derived.name} ${numbers.vars[derived.id] ?? 0}`).join('')}
          {(system.resources ?? []).map((resource) => ` · ${resource.name} ${numbers.resources[resource.id] ?? 0}`).join('')}
        </p>
      ) : (
        <p className="field-error">{worked.error}</p>
      )}
      <fieldset className="builder-abilities">
        <legend>Abilities ({abilities.length} chosen)</legend>
        {system.abilities.map((ability) => (
          <label key={ability.id} className="check">
            <input
              type="checkbox"
              checked={abilities.includes(ability.id)}
              onChange={(event) => setAbilities((now) => (event.target.checked ? [...now, ability.id] : now.filter((id) => id !== ability.id)))}
            />
            <span>
              <strong>{ability.name}</strong> <span className="muted small">{abilityLine(system, ability.id)}</span>
              {ability.description && <span className="muted small builder-description">{ability.description}</span>}
            </span>
          </label>
        ))}
      </fieldset>
      {abilities.length === 0 && <p className="field-error">Choose at least one ability.</p>}
      <div className="row">
        <button type="submit" className="primary" disabled={!numbers || abilities.length === 0}>
          Save my character
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
