import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type ChangeArea, type GameSystem, type RuleChange, combineChanges, describePath, diffSystems, validateGameSystem } from '@shared/system';

// New rules (an imported book, a loaded file) are reviewed before they're
// used: everything that will be added, changed, or removed, each with what it
// does to the site, and a yes or no for each. The accepted changes are
// combined and checked; what doesn't fit together can be fixed in the rules
// editor, and nothing changes in the game until they're applied.

const AREAS: readonly { id: ChangeArea; label: string }[] = [
  { id: 'basics', label: 'Basics' },
  { id: 'stats', label: 'Stats' },
  { id: 'resources', label: 'Resources' },
  { id: 'conditions', label: 'Conditions' },
  { id: 'abilities', label: 'Abilities' },
  { id: 'monsters', label: 'Monsters' },
];
const VERBS: Record<RuleChange['kind'], string> = { add: 'Add', change: 'Change', remove: 'Remove' };

export function RulesReview({
  current,
  incoming,
  title,
  notes = [],
  onApply,
  onEdit,
  onCancel,
}: {
  current: GameSystem | null;
  incoming: GameSystem;
  title: string;
  /** What to know first (what an import assumed). */
  notes?: readonly string[];
  onApply: (system: GameSystem) => void;
  /** Opens the combined rules in the rules editor instead. */
  onEdit: (system: GameSystem) => void;
  onCancel: () => void;
}) {
  const changes = useMemo(() => diffSystems(current, incoming), [current, incoming]);
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(() => new Set(changes.map((change) => change.id)));
  const combined = useMemo(() => combineChanges(current, incoming, accepted), [current, incoming, accepted]);
  const checked = useMemo(() => validateGameSystem(combined.system), [combined]);
  const problems = checked.ok ? [] : checked.errors;
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => dialog.current?.focus(), []);

  const set = (id: string, yes: boolean) =>
    setAccepted((now) => {
      const next = new Set(now);
      if (yes) next.add(id);
      else next.delete(id);
      return next;
    });
  const count = (kind: RuleChange['kind']) => changes.filter((change) => change.kind === kind).length;
  const yes = changes.filter((change) => accepted.has(change.id)).length;

  return createPortal(
    <div className="picker-backdrop">
      <div
        ref={dialog}
        className="panel picker-dialog rules-review"
        role="dialog"
        aria-modal="true"
        aria-label="Review the changes"
        tabIndex={-1}
        onKeyDown={(event) => event.key === 'Escape' && onCancel()}
      >
        <div className="picker-head">
          <h3>Review the changes: {title}</h3>
          <button type="button" aria-label="Close" title="Cancel" onClick={onCancel}>
            ×
          </button>
        </div>
        {notes.map((note) => (
          <p key={note} className="muted small">
            {note}
          </p>
        ))}
        {changes.length === 0 ? (
          <p>These rules are the same as the ones in play: nothing would change.</p>
        ) : (
          <>
            <p data-testid="review-summary">
              {count('add')} to add · {count('change')} to change · {count('remove')} to remove. Say yes or no to each; nothing changes until you apply them.
            </p>
            <div className="row">
              <button type="button" onClick={() => setAccepted(new Set(changes.map((change) => change.id)))}>
                Yes to all
              </button>
              <button type="button" onClick={() => setAccepted(new Set())}>
                No to all
              </button>
            </div>
          </>
        )}

        {AREAS.map((area) => {
          const inArea = changes.filter((change) => change.area === area.id);
          if (inArea.length === 0) return null;
          return (
            <section key={area.id} className="review-area" aria-label={area.label}>
              <h4>{area.label}</h4>
              {inArea.map((change) => {
                const on = accepted.has(change.id);
                const name = `${VERBS[change.kind]} ${change.title}`;
                return (
                  <div key={change.id} className={`review-change ${change.kind}${on ? '' : ' declined'}`} role="group" aria-label={name}>
                    <div className="grow">
                      <p>
                        <span className={`review-kind ${change.kind}`}>{VERBS[change.kind]}</span> <strong>{change.title}</strong>
                      </p>
                      <p className="muted small">{change.detail}</p>
                      <p className="small">On the site: {change.site}</p>
                    </div>
                    <div className="segmented" role="group" aria-label={`Accept: ${name}`}>
                      <button type="button" aria-pressed={on} onClick={() => set(change.id, true)}>
                        Yes
                      </button>
                      <button type="button" aria-pressed={!on} onClick={() => set(change.id, false)}>
                        No
                      </button>
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })}

        {combined.tidied.length > 0 && (
          <div className="review-tidied">
            <p className="small">Because of what you said no to:</p>
            <ul>
              {combined.tidied.map((line) => (
                <li key={line} className="small">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        )}
        {problems.length > 0 && (
          <div className="rules-problems" role="alert">
            <strong>
              {problems.length} {problems.length === 1 ? 'thing needs' : 'things need'} fixing before these rules can be used (say yes to what they need, or fix them in
              the rules editor):
            </strong>
            <ul>
              {problems.slice(0, 8).map((problem) => (
                <li key={`${problem.path}:${problem.message}`}>
                  {describePath(combined.system, problem.path)}: {problem.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="row rules-actions">
          <button type="button" className="primary" disabled={problems.length > 0 || yes === 0} onClick={() => checked.ok && onApply(checked.system)}>
            Apply {yes} {yes === 1 ? 'change' : 'changes'}
          </button>
          <button type="button" onClick={() => onEdit(combined.system)}>
            {problems.length > 0 ? 'Fix in the rules editor' : 'Edit before applying'}
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
