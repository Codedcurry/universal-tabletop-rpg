import { useRef, useState } from 'react';
import { type DmSuggestion, NARRATION_LINES, NARRATION_TONES, type NarrationTone, suggestNarration, suggestNext } from '@shared/ai';
import type { HostSession, LogEntry } from '@shared/net';
import { loadAiSettings, makeProvider } from '../ai/providers';

// The DM's AI helping at the table, above the log: narration (what just
// happened, and the scene when the map came from a book, as a line or two to
// read out, edited, sent to everyone's chat, or dropped), and "What next?"
// (a few things the DM could do now, with why, from the adventure's text,
// the creatures, and the log). Only ever suggestions.

/** A log entry as a line of text for the AI (hidden rolls and whispers left out). */
function lineOf(entry: LogEntry, nameOf: (id: string) => string): string | null {
  switch (entry.kind) {
    case 'system':
    case 'game':
      return entry.text;
    case 'chat':
      return entry.to === null ? `${nameOf(entry.from)} says: ${entry.text}` : null;
    case 'roll':
      return entry.hidden ? null : `${nameOf(entry.from)} rolls ${entry.result.total}`;
  }
}

export function NarrationHelper({ session, scene, onOpenBooks }: { session: HostSession; scene: string | null; onOpenBooks: () => void }) {
  const [tone, setTone] = useState<NarrationTone>('vivid');
  const [text, setText] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<readonly DmSuggestion[] | null>(null);
  const stopper = useRef<AbortController | null>(null);

  /** What the AI needs: its settings (or null, with the DM told to set it up), and the latest log lines. */
  function context() {
    const settings = loadAiSettings();
    if (!settings.model) {
      setError('Set up your AI in the Books tab first.');
      return null;
    }
    const state = session.snapshot();
    const nameOf = (id: string) => (id === 'dm' ? state.dmTitle : (state.players.find((player) => player.id === id)?.name ?? id));
    const recent = state.log.flatMap((entry) => lineOf(entry, nameOf) ?? []);
    const creatures = Object.values(state.combat?.combatants ?? {}).map(
      (creature) =>
        `${creature.sheet.name} (${creature.side}): ${creature.hp > 0 ? `${creature.hp} HP` : 'down'}${creature.conditions.length > 0 ? `, ${creature.conditions.map((condition) => condition.id).join(', ')}` : ''}`,
    );
    return { settings, recent, creatures };
  }

  /** Runs one request to the AI, with Stop, and its errors shown. */
  async function ask(run: (signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController();
    stopper.current = controller;
    setWorking(true);
    setError(null);
    try {
      await run(controller.signal);
    } catch (caught) {
      setError(controller.signal.aborted ? null : caught instanceof Error ? caught.message : String(caught));
    } finally {
      setWorking(false);
      stopper.current = null;
    }
  }

  async function whatNext() {
    const found = context();
    if (!found) return;
    await ask(async (signal) => setIdeas(await suggestNext(makeProvider(found.settings), { recent: found.recent, creatures: found.creatures, signal, ...(scene ? { scene } : {}) })));
  }

  async function suggest() {
    const found = context();
    if (!found) return;
    await ask(async (signal) => {
      setText(await suggestNarration(makeProvider(found.settings), { recent: found.recent.slice(-NARRATION_LINES), tone, signal, ...(scene ? { scene } : {}) }));
    });
  }

  return (
    <section className="narration" aria-label="DM help">
      <div className="row">
        <button type="button" disabled={working} onClick={() => void suggest()} title="Your AI suggests a line or two about what just happened">
          {working ? 'Thinking…' : 'Suggest narration'}
        </button>
        <button type="button" disabled={working} onClick={() => void whatNext()} title="Your AI suggests what you could do next, from the adventure and the game so far">
          What next?
        </button>
        {working && (
          <button type="button" onClick={() => stopper.current?.abort()}>
            Stop
          </button>
        )}
        <label>
          <span>Tone</span>
          <select value={tone} onChange={(event) => setTone(event.target.value as NarrationTone)}>
            {NARRATION_TONES.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>
      </div>
      {text !== null && (
        <div className="narration-suggestion">
          <label>
            <span>Suggested narration (edit it as you like)</span>
            <textarea rows={3} value={text} onChange={(event) => setText(event.target.value)} />
          </label>
          <div className="row">
            <button
              type="button"
              className="primary"
              disabled={text.trim() === ''}
              onClick={() => {
                session.say(text.trim());
                setText(null);
              }}
            >
              Send to everyone
            </button>
            <button type="button" disabled={working} onClick={() => void suggest()}>
              Another
            </button>
            <button type="button" onClick={() => setText(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}
      {ideas !== null && (
        <div className="dm-ideas" role="group" aria-label="What you could do next">
          <ol>
            {ideas.map((idea) => (
              <li key={idea.idea}>
                <strong>{idea.idea}</strong>
                {idea.why && <span className="muted small"> {idea.why}</span>}
              </li>
            ))}
          </ol>
          <button type="button" className="small" onClick={() => setIdeas(null)}>
            Dismiss
          </button>
        </div>
      )}
      {error && (
        <p className="field-error">
          {error}{' '}
          {error.includes('Books tab') && (
            <button type="button" className="link" onClick={onOpenBooks}>
              Open the Books tab
            </button>
          )}
        </p>
      )}
    </section>
  );
}
