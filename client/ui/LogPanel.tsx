import { type FormEvent, useId, useState } from 'react';
import type { SessionSnapshot } from '@shared/net';
import { DiceForm } from './DiceForm';
import { LogList } from './LogList';

// The log (in tabs; see LogList), then chat, then the dice panel.

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

  return (
    <div className="log-panel">
      <LogList log={state.log} nameOf={nameOf} />

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
