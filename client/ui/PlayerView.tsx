import { useState } from 'react';
import type { CombatEvent } from '@shared/combat';
import type { Cell } from '@shared/grid';
import type { JoinedGame } from '../net/transport';
import { CombatPanel } from './CombatPanel';
import { DiceRollAnimation } from './DiceRollAnimation';
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
  readonly combatEvents: { readonly events: readonly CombatEvent[]; readonly key: number } | null;
}

export function PlayerView({ game, code, error, focus, combatEvents }: Props) {
  const { session } = game;
  const state = session.state;
  // This player's own character, if they brought one.
  const mine = state?.players.find((player) => player.id === session.playerId)?.character?.id;
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
      {state && (
        <DiceRollAnimation
          log={state.log}
          nameOf={(id) => (id === 'dm' ? state.dmTitle : (state.players.find((player) => player.id === id)?.name ?? id))}
        />
      )}
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
          {/* Says plainly when the DM has taken over this player's character. */}
          {!state.playersControlOwn && mine && state.combat?.combatants[mine] && !session.canControl(mine) && (
            <p className="control-note" data-testid="control-note" role="status">
              {state.dmTitle} is playing your character for now.
            </p>
          )}
          <MapViewer
            map={state.map}
            focus={focus}
            combat={state.combat}
            system={state.system}
            combatEvents={combatEvents}
            canControl={(id) => session.status === 'connected' && session.canControl(id)}
            act={(action) => session.act(action)}
          />
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
            <CombatPanel state={state} />
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
