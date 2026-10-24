import { useState } from 'react';
import type { Cell } from '@shared/grid';
import type { JoinedGame } from '../net/transport';
import { CombatPanel } from './CombatPanel';
import { LogPanel } from './LogPanel';
import { MapViewer } from './MapViewer';
import { Players } from './Players';

function statusText(game: JoinedGame, code: string): string {
  const { session } = game;
  switch (session.status) {
    case 'connecting':
      return `Looking for game ${code}…`;
    case 'connected':
      return `Connected to game ${code}`;
    case 'reconnecting':
      return session.playerId
        ? `Paused: waiting for the ${session.state?.dmTitle ?? 'DM'} to come back…`
        : `Looking for game ${code}… (is the DM's page open?)`;
    case 'rejected':
      return `Couldn't join: ${session.rejectionReason}`;
  }
}

interface Props {
  readonly game: JoinedGame;
  readonly code: string;
  readonly error: string | null;
  readonly focus: { readonly cell: Cell; readonly key: number } | null;
}

export function PlayerView({ game, code, error, focus }: Props) {
  const { session } = game;
  const state = session.state;
  const [localError, setLocalError] = useState<string | null>(null);

  function roll(notation: string, faces: number[] | null) {
    try {
      if (faces) session.rollPhysical(notation, faces);
      else session.roll(notation);
      setLocalError(null);
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <div className="page">
      <header className={`card status ${session.status}`}>
        <p data-testid="status">{statusText(game, code)}</p>
        {state && (
          <p>
            <span data-testid="dm-title">{state.dmTitle}</span> is running this game
          </p>
        )}
      </header>

      {state && (
        <section className="card">
          <h2>Map</h2>
          <MapViewer map={state.map} focus={focus} />
        </section>
      )}

      {state && (
        <div className="columns">
          <section className="card">
            <h2>Players</h2>
            <Players players={state.players} />
          </section>

          <section className="card">
            <h2>Fight</h2>
            <CombatPanel
              state={state}
              canAct={(id) => session.status === 'connected' && session.canControl(id)}
              onAction={(action) => session.act(action)}
            />
          </section>

          <section className="card">
            <h2>Log</h2>
            <LogPanel
              state={state}
              viewer={session.playerId ?? ''}
              whisperTargets={[{ id: 'dm', label: state.dmTitle }]}
              onSay={(text, to) => session.say(text, to)}
              onRoll={(notation, _hidden, faces) => roll(notation, faces)}
              canHideRolls={false}
              physicalDice={state.rollMode === 'physical'}
              error={localError ?? error}
            />
          </section>
        </div>
      )}
    </div>
  );
}
