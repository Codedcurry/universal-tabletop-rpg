import { type FormEvent, useId, useState } from 'react';
import type { RollResult } from '@shared/dice';
import type { LogEntry, RollSource, SessionSnapshot } from '@shared/net';
import { DiceForm } from './DiceForm';

// Chat and roll log. Step 7 turns this into the tabbed log panel with
// animated dice; for now it shows everything in one list.

interface Props {
  readonly state: SessionSnapshot;
  /** "dm" or this player's id. */
  readonly viewer: string;
  /** Who this viewer can whisper to: id and label. */
  readonly whisperTargets: readonly { id: string; label: string }[];
  onSay(text: string, to: string | null): void;
  /** `faces` is set when the session uses physical dice. */
  onRoll(notation: string, hidden: boolean, faces: number[] | null): void;
  /** Only the DM can roll in secret. */
  readonly canHideRolls: boolean;
  /** Players type in what their real dice show. */
  readonly physicalDice: boolean;
  readonly error: string | null;
}

const MODE_LABELS: Record<RollSource, string> = {
  player: 'rolled on device',
  dmVerified: 'rolled by the DM',
  physical: 'physical dice',
  dm: 'DM roll',
};

function describeRoll(result: RollResult): string {
  return result.terms
    .map((term, index) => {
      const sign = term.sign < 0 ? '- ' : index === 0 ? '' : '+ ';
      if (term.kind === 'constant') return `${sign}${term.value}`;
      if (term.kind === 'coin') return `${sign}[${term.flips.map((flip) => (flip === 'heads' ? 'H' : 'T')).join(' ')}]`;
      return `${sign}[${term.dice.map((die) => (die.kept ? `${die.value}` : `(${die.value})`)).join(' ')}]`;
    })
    .join(' ');
}

export function LogPanel(props: Props) {
  const { state, viewer, whisperTargets, onSay, onRoll, canHideRolls, physicalDice, error } = props;
  const [message, setMessage] = useState('');
  const [to, setTo] = useState('');
  const chatHeading = useId();
  const diceHeading = useId();

  const nameOf = (id: string) =>
    id === 'dm' ? state.dmTitle : (state.players.find((player) => player.id === id)?.name ?? id);

  function send(event: FormEvent) {
    event.preventDefault();
    if (message.trim() === '') return;
    onSay(message, to === '' ? null : to);
    setMessage('');
  }

  function render(entry: LogEntry) {
    switch (entry.kind) {
      case 'system':
        return <em>{entry.text}</em>;
      case 'chat':
        return (
          <>
            <strong>{nameOf(entry.from)}</strong>
            {entry.to && <span className="whisper"> → {nameOf(entry.to)} (whisper)</span>}: {entry.text}
          </>
        );
      case 'roll':
        return (
          <>
            <strong>{nameOf(entry.from)}</strong> rolled {entry.result.notation} ={' '}
            <span className="roll-total">{entry.result.total}</span>{' '}
            <span className="muted">
              {describeRoll(entry.result)} · {MODE_LABELS[entry.mode]}
              {entry.hidden ? ' · hidden' : ''}
            </span>
          </>
        );
    }
  }

  return (
    <div className="log-panel">
      <ol className="log" data-testid="log">
        {state.log.map((entry) => (
          <li key={entry.seq} data-kind={entry.kind}>
            {render(entry)}
          </li>
        ))}
      </ol>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="chat-box" aria-labelledby={chatHeading}>
        <h3 id={chatHeading}>Chat</h3>
        <form className="row" onSubmit={send}>
          <label>
            <span>To</span>
            <select value={to} onChange={(event) => setTo(event.target.value)}>
              <option value="">Everyone</option>
              {whisperTargets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grow">
            <span>Message</span>
            <input
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={viewer === 'dm' ? 'Say something to the table…' : 'Say something…'}
              maxLength={1000}
            />
          </label>
          <button type="submit">Send</button>
        </form>
      </section>

      <section className="dice-box" aria-labelledby={diceHeading}>
        <h3 id={diceHeading}>Roll dice</h3>
        <DiceForm physicalDice={physicalDice} canHideRolls={canHideRolls} onRoll={onRoll} />
      </section>
    </div>
  );
}
