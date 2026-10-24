import { type FormEvent, useState } from 'react';
import type { CombatAction } from '@shared/combat';
import type { RollMode } from '@shared/net';
import { demoFight, demoMap, demoSystem } from '../demo';
import type { HostedGame } from '../net/transport';
import { CombatPanel } from './CombatPanel';
import { LogPanel } from './LogPanel';
import { MapEditor } from './MapEditor';
import { Players } from './Players';

const ROLL_MODES: { value: RollMode; label: string }[] = [
  { value: 'player', label: 'Players roll on their device' },
  { value: 'dmVerified', label: 'DM rolls for everyone' },
  { value: 'physical', label: 'Players use real dice' },
];

export function HostView({ game }: { readonly game: HostedGame }) {
  const { session, code } = game;
  const state = session.snapshot();
  const [title, setTitle] = useState(state.dmTitle);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const link = `${location.origin}${location.pathname}?room=${code}`;

  /** Runs a DM command, showing any problem instead of crashing. */
  function attempt(command: () => void) {
    try {
      command();
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function saveTitle(event: FormEvent) {
    event.preventDefault();
    attempt(() => session.setDmTitle(title));
  }

  function startFight() {
    attempt(() => {
      session.setSystem(demoSystem);
      if (!session.snapshot().map) session.setMap(demoMap);
      session.startCombat(demoFight(session));
    });
  }

  function act(action: CombatAction) {
    const result = session.act(action);
    setError(result.ok ? null : result.reason);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setError('Copy failed: select the link and copy it by hand');
    }
  }

  return (
    <div className="page">
      <header className="card room">
        <div>
          <p className="muted">Room code</p>
          <p className="room-code" data-testid="room-code">
            {code}
          </p>
        </div>
        <div className="grow">
          <p className="muted">Players join with this link</p>
          <p className="join-link" data-testid="join-link">
            {link}
          </p>
          <button type="button" onClick={copyLink}>
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
      </header>

      <section className="card">
        <h2>Map</h2>
        <MapEditor session={session} />
      </section>

      <div className="columns">
        <section className="card">
          <h2>Session</h2>
          <form className="row" onSubmit={saveTitle}>
            <label className="grow">
              <span>Your title</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={40} />
            </label>
            <button type="submit">Save</button>
          </form>
          <label>
            <span>Who rolls dice</span>
            <select
              value={state.rollMode}
              onChange={(event) => attempt(() => session.setRollMode(event.target.value as RollMode))}
            >
              {ROLL_MODES.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </label>
          <h3>Players</h3>
          <Players players={state.players} />
        </section>

        <section className="card">
          <h2>Fight</h2>
          <div className="row">
            <button type="button" className="primary" onClick={startFight}>
              Start demo fight
            </button>
            {state.combat && (
              <button type="button" onClick={() => attempt(() => session.endCombat())}>
                End fight
              </button>
            )}
          </div>
          <CombatPanel state={state} canAct={() => true} onAction={act} />
        </section>

        <section className="card">
          <h2>Log</h2>
          <LogPanel
            state={state}
            viewer="dm"
            whisperTargets={state.players.map((player) => ({ id: player.id, label: player.name }))}
            onSay={(text, to) => attempt(() => session.say(text, to))}
            onRoll={(notation, hidden) => attempt(() => session.roll(notation, { hidden }))}
            canHideRolls
            physicalDice={false}
            error={error}
          />
        </section>
      </div>
    </div>
  );
}
