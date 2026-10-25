import { useEffect, useReducer, useRef, useState } from 'react';
import type { CombatEvent } from '@shared/combat';
import type { Cell } from '@shared/grid';
import { type SavedGame, normalizeRoomCode } from '@shared/net';
import { demoCharacter } from './demo';
import { hostedRoom, joinedRoom, playerToken, rememberHostedRoom, rememberJoinedRoom, saveName, savedName } from './net/identity';
import { deleteSavedGame, listSavedGames, putSavedGame } from './storage/savedGames';
import { type HostedGame, type JoinedGame, hostGame, joinGame } from './net/transport';
import { HostView } from './ui/HostView';
import { Home } from './ui/Home';
import { PlayerView } from './ui/PlayerView';
import { useDisplaySettings } from './ui/displaySettings';
import { useWakeLock } from './ui/useWakeLock';
import { sounds } from './audio/soundEngine';

type View =
  | { readonly kind: 'home' }
  | { readonly kind: 'host'; readonly game: HostedGame }
  | { readonly kind: 'player'; readonly game: JoinedGame; readonly code: string };

const roomFromUrl = normalizeRoomCode(new URLSearchParams(location.search).get('room') ?? '');
/** Module-level so React StrictMode's double effect run can't join (or resume) twice. */
let autoRejoinDone = false;
/** Save the DM's game this long after the last change (and right away when the page closes). */
const AUTOSAVE_MS = 800;

export function App() {
  const [view, setView] = useState<View>({ kind: 'home' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ cell: Cell; key: number } | null>(null);
  // The latest combat action, which the map acts out; `key` makes each one play once.
  // A soft click for every button press (the sound engine stays quiet with effects off).
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if ((event.target as HTMLElement | null)?.closest('button, [role="tab"]')) sounds.play('click');
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  // In a game, keep the screen awake (unless turned off under ⚙ on the map).
  const { keepAwake } = useDisplaySettings();
  useWakeLock(keepAwake && view.kind !== 'home');
  const [combatEvents, setCombatEvents] = useState<{ events: readonly CombatEvent[]; key: number } | null>(null);
  const onCombatEvents = (events: readonly CombatEvent[]) =>
    setCombatEvents((previous) => ({ events, key: (previous?.key ?? 0) + 1 }));
  // Sessions are plain objects that report changes; re-render when they do.
  const [changes, rerender] = useReducer((count: number) => count + 1, 0);
  const [savedGames, setSavedGames] = useState<SavedGame[]>([]);
  const [hostNotice, setHostNotice] = useState<string | null>(null);
  const refreshSaved = () => void listSavedGames().then(setSavedGames);
  useEffect(refreshSaved, []);

  function host(name: string, resume?: SavedGame) {
    saveName(name);
    setBusy(true);
    hostGame({ onChange: rerender, onCombatEvents }, resume ? { resume } : {}).then(
      (game) => {
        setBusy(false);
        rememberHostedRoom(game.code);
        setHostNotice(
          resume && resume.code !== game.code
            ? `This game's old room (${resume.code}) is open somewhere else, so it carries on in a new room: share the new link with your players.`
            : null,
        );
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
      onFocus: (cell) => setFocus((previous) => ({ cell, key: (previous?.key ?? 0) + 1 })),
      onCombatEvents,
    });
    setView({ kind: 'player', game, code });
  }

  // After a reload, carry on: rejoin the room this tab was in, or resume the game it was hosting.
  useEffect(() => {
    if (autoRejoinDone) return;
    autoRejoinDone = true;
    if (roomFromUrl && joinedRoom() === roomFromUrl && savedName()) {
      join(savedName(), roomFromUrl);
      return;
    }
    const hosting = hostedRoom();
    if (hosting) {
      void listSavedGames().then((games) => {
        const game = games.find((entry) => entry.code === hosting);
        if (game) host(savedName() || 'DM', game);
      });
    }
  }, []);

  // The DM's game is saved in this browser within a moment of every change (a steady
  // stream of changes doesn't put it off), and right away when the tab is hidden or closed.
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveNow = useRef<() => void>(() => undefined);
  saveNow.current = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (view.kind !== 'host') return;
    void putSavedGame(view.game.session.saveGame(view.game.code)).then((kept) => {
      if (kept) setLastSaved(Date.now());
    });
  };
  useEffect(() => {
    if (view.kind !== 'host' || saveTimer.current) return;
    saveTimer.current = setTimeout(() => saveNow.current(), AUTOSAVE_MS);
  }, [view, changes]);
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') saveNow.current();
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => document.removeEventListener('visibilitychange', onHidden);
  }, []);

  // Leave cleanly when the page closes.
  useEffect(() => {
    const leave = () => {
      if (view.kind === 'host') {
        saveNow.current();
        view.game.close();
      }
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
          savedGames={savedGames}
          onHost={host}
          onJoin={join}
          onDeleteSaved={(code) => void deleteSavedGame(code).then(refreshSaved)}
        />
      );
    case 'host':
      return <HostView game={view.game} combatEvents={combatEvents} lastSaved={lastSaved} notice={hostNotice} />;
    case 'player':
      return <PlayerView game={view.game} code={view.code} error={error} focus={focus} combatEvents={combatEvents} />;
  }
}
