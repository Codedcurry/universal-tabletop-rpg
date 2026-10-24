import { useEffect, useReducer, useState } from 'react';
import { normalizeRoomCode } from '@shared/net';
import { demoCharacter } from './demo';
import { joinedRoom, playerToken, rememberJoinedRoom, saveName, savedName } from './net/identity';
import { type HostedGame, type JoinedGame, hostGame, joinGame } from './net/transport';
import { HostView } from './ui/HostView';
import { Home } from './ui/Home';
import { PlayerView } from './ui/PlayerView';

type View =
  | { readonly kind: 'home' }
  | { readonly kind: 'host'; readonly game: HostedGame }
  | { readonly kind: 'player'; readonly game: JoinedGame; readonly code: string };

const roomFromUrl = normalizeRoomCode(new URLSearchParams(location.search).get('room') ?? '');
/** Module-level so React StrictMode's double effect run can't join twice. */
let autoRejoinDone = false;

export function App() {
  const [view, setView] = useState<View>({ kind: 'home' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sessions are plain objects that report changes; re-render when they do.
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  function host(name: string) {
    saveName(name);
    setBusy(true);
    hostGame({ onChange: rerender }).then(
      (game) => {
        setBusy(false);
        setView({ kind: 'host', game });
      },
      (failure: unknown) => {
        setBusy(false);
        setError(`Couldn't start hosting: ${failure instanceof Error ? failure.message : String(failure)}`);
      },
    );
  }

  function join(name: string, code: string) {
    saveName(name);
    rememberJoinedRoom(code);
    history.replaceState(null, '', `?room=${code}`);
    const game = joinGame({
      code,
      token: playerToken(),
      name,
      character: demoCharacter(name),
      onChange: rerender,
      onRequestFailed: (reason) => setError(reason),
    });
    setView({ kind: 'player', game, code });
  }

  // After a reload, rejoin the room this tab was in.
  useEffect(() => {
    if (autoRejoinDone) return;
    autoRejoinDone = true;
    if (roomFromUrl && joinedRoom() === roomFromUrl && savedName()) join(savedName(), roomFromUrl);
  }, []);

  // Leave cleanly when the page closes.
  useEffect(() => {
    const leave = () => {
      if (view.kind === 'host') view.game.close();
      if (view.kind === 'player') view.game.leave();
    };
    window.addEventListener('pagehide', leave);
    return () => window.removeEventListener('pagehide', leave);
  }, [view]);

  switch (view.kind) {
    case 'home':
      return (
        <Home
          initialName={savedName()}
          initialCode={roomFromUrl ?? ''}
          busy={busy}
          error={error}
          onHost={host}
          onJoin={join}
        />
      );
    case 'host':
      return <HostView game={view.game} />;
    case 'player':
      return <PlayerView game={view.game} code={view.code} error={error} />;
  }
}
