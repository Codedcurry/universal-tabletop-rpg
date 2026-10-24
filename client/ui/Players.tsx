import type { PublicPlayer } from '@shared/net';

export function Players({ players }: { readonly players: readonly PublicPlayer[] }) {
  if (players.length === 0) return <p className="muted">No players yet. Share the link!</p>;
  return (
    <ul className="players" data-testid="players">
      {players.map((player) => (
        <li key={player.id} data-testid="player">
          <span className={player.connected ? 'dot online' : 'dot'} aria-hidden="true" />
          {player.name}
          <span className="muted">{player.connected ? ' online' : ' away'}</span>
        </li>
      ))}
    </ul>
  );
}
