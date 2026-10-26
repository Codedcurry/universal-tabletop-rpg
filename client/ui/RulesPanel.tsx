import { type ChangeEvent, useState } from 'react';
import { describeHouseRule } from '@shared/combat';
import type { HostSession } from '@shared/net';
import { type GameSystem, blankSystem, describePath, validateGameSystem } from '@shared/system';
import { BookImport } from './BookImport';
import { LocalAiNotice } from './LocalAiGuide';
import { SystemEditor } from './SystemEditor';

// The DM tools' Rules tab: the game system in play, at a glance; edit it in
// the rules editor, start a new one, or save it to a file and load one
// (homebrew to share, or a backup). A loaded file opens in the editor to be
// looked over before it's used. A rulebook the DM owns can be read by their
// AI into a draft, checked in the editor too. The DM's house rules are
// listed, to drop.

/** The file a system is saved as. */
const FILE_SUFFIX = '.system.json';

function download(system: GameSystem) {
  const blob = new Blob([JSON.stringify(system, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${system.id}${FILE_SUFFIX}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function RulesPanel({ session }: { session: HostSession }) {
  const { system, combat, houseRules } = session.snapshot();
  const [editing, setEditing] = useState<{ system: GameSystem; title: string; note?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inPlay = combat ? Object.keys(combat.combatants).length : 0;
  const fitNote = inPlay > 0 ? 'Creatures already on the map keep only the stats, abilities, and conditions these rules have.' : undefined;

  function apply(next: GameSystem, renames: Readonly<Record<string, string>>) {
    try {
      const changes = session.setSystem(next, renames);
      setEditing(null);
      setError(null);
      setNotice(changes.length > 0 ? `Rules updated. ${changes.join('; ')}.` : 'Rules updated.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function load(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const data: unknown = JSON.parse(await file.text());
      const result = validateGameSystem(data);
      if (!result.ok) {
        const first = result.errors.slice(0, 3).map((problem) => `${describePath(data as GameSystem, problem.path)}: ${problem.message}`);
        throw new Error(`${file.name} isn't a game system this tool can read (${first.join('; ')})`);
      }
      setError(null);
      setNotice(null);
      setEditing({ system: result.system, title: `Load ${result.system.name}`, ...(fitNote ? { note: fitNote } : {}) });
    } catch (caught) {
      setError(caught instanceof SyntaxError ? `${file.name} isn't a game system file` : caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <div className="rules-panel">
      {system ? (
        <>
          <p>
            <strong>{system.name}</strong>
          </p>
          <p className="muted" data-testid="rules-summary">
            {system.stats.length} stats · {system.abilities.length} abilities · {system.conditions.length} conditions · {system.monsters.length} monsters · levels 1 to{' '}
            {system.levels.xpThresholds.length}
          </p>
        </>
      ) : (
        <p className="muted">No game system yet.</p>
      )}
      <div className="row">
        <button type="button" className="primary" disabled={!system} onClick={() => system && setEditing({ system, title: `Edit ${system.name}`, ...(fitNote ? { note: fitNote } : {}) })}>
          Edit rules
        </button>
        <button
          type="button"
          onClick={() => setEditing({ system: blankSystem(), title: 'New game system', note: fitNote ?? 'A small system to build on: rename it, then add your stats, abilities, and monsters.' })}
        >
          New system
        </button>
      </div>
      <div className="row">
        <button type="button" disabled={!system} onClick={() => system && download(system)}>
          Save rules to a file
        </button>
        <label className="file-button">
          <span>Load rules from a file</span>
          <input type="file" accept=".json,application/json" aria-label="Load rules from a file" onChange={(event) => void load(event)} />
        </label>
      </div>
      <h3>House rules</h3>
      {houseRules.length === 0 ? (
        <p className="muted small">
          None yet. When the rules refuse something in a fight (out of range, out of sight, held by a condition, too far to walk), you can allow it just once, or make it a
          house rule: it's listed here, everyone sees it, and it applies from then on.
        </p>
      ) : (
        <ul className="tile-list" aria-label="House rules">
          {houseRules.map((rule, index) => (
            <li key={`${index}:${JSON.stringify(rule)}`}>
              <span className="grow">{describeHouseRule(rule, system)}</span>
              <button type="button" aria-label={`Drop house rule: ${describeHouseRule(rule, system)}`} onClick={() => session.removeHouseRule(index)}>
                Drop
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <button type="button" onClick={() => setImporting(true)}>
          Import from a rulebook (AI)
        </button>
      </div>
      <LocalAiNotice />
      <p className="muted small">Rules files hold no art or maps: share your homebrew, or keep a backup. Rules from a book you own are for your own games only.</p>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {importing && (
        <BookImport
          onCancel={() => setImporting(false)}
          onDone={(result) => {
            setImporting(false);
            const checks = result.notes.length > 0 ? ` ${result.notes.join(' ')}` : '';
            setEditing({
              system: result.system,
              title: `Imported: ${result.system.name}`,
              note: `Read from your book by AI: check everything before applying it.${checks}${fitNote ? ` ${fitNote}` : ''}`,
            });
          }}
        />
      )}
      {editing && (
        <SystemEditor
          key={editing.title}
          initial={editing.system}
          title={editing.title}
          {...(editing.note ? { note: editing.note } : {})}
          onApply={apply}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}
