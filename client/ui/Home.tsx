import { type ChangeEvent, type FormEvent, useState } from 'react';
import { type SavedGame, normalizeRoomCode, validateSavedGame } from '@shared/net';
import { mapSummary } from './WorldCanvas';

interface Props {
  readonly initialName: string;
  readonly initialCode: string;
  readonly busy: boolean;
  readonly error: string | null;
  /** Games saved in this browser, newest first. */
  readonly savedGames: readonly SavedGame[];
  onHost(name: string, resume?: SavedGame): void;
  onJoin(name: string, code: string): void;
  onDeleteSaved(code: string): void;
}

export function Home({ initialName, initialCode, busy, error, savedGames, onHost, onJoin, onDeleteSaved }: Props) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(initialCode);
  const [problem, setProblem] = useState<string | null>(null);
  /** The saved game waiting for "Yes, delete" (there's no undo). */
  const [deleting, setDeleting] = useState<string | null>(null);

  function join(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeRoomCode(code);
    if (name.trim() === '') return setProblem('Enter your name first');
    if (!normalized) return setProblem('Room codes are 6 letters and numbers, like K7QW2M');
    setProblem(null);
    onJoin(name.trim(), normalized);
  }

  function host(resume?: SavedGame) {
    if (name.trim() === '') return setProblem('Enter your name first');
    setProblem(null);
    onHost(name.trim(), resume);
  }

  /** Carries on a game from a file someone saved (on this computer or another). */
  async function loadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return setProblem(`${file.name} isn't a saved game file`);
    }
    const result = validateSavedGame(data);
    if (!result.ok) return setProblem(`Can't load ${file.name}: ${result.error}`);
    host(result.game);
  }

  return (
    <div className="page home">
      <h1>Tabletop RPG</h1>
      <section className="card">
        <label>
          <span>Your name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} autoComplete="nickname" />
        </label>
      </section>

      <section className="card">
        <h2>Join a game</h2>
        <form className="row" onSubmit={join}>
          <label className="grow">
            <span>Room code</span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="K7QW2M"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button type="submit" className="primary" disabled={busy}>
            Join
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Run a game</h2>
        <p className="muted">Hosting works best on a PC: phones pause background tabs, which pauses the game.</p>
        <div className="row">
          <button type="button" onClick={() => host()} disabled={busy}>
            {busy ? 'Starting…' : 'Host a game'}
          </button>
          <label className="file-button">
            <span>Load game file</span>
            <input type="file" accept="application/json,.json" onChange={loadFile} disabled={busy} />
          </label>
        </div>
      </section>

      {savedGames.length > 0 && (
        <section className="card saved-games" aria-label="Saved games">
          <h2>Saved games</h2>
          <p className="muted">Kept in this browser as you play. Resume one to carry on in the same room: players&apos; links still work.</p>
          <ul>
            {savedGames.map((game) => (
              <li key={game.code}>
                <div className="grow">
                  <strong className="room-code-small">{game.code}</strong>
                  <span className="muted">
                    {game.state.map ? mapSummary(game.state.map) : 'no map yet'} · {game.players.length}{' '}
                    {game.players.length === 1 ? 'player' : 'players'}
                  </span>
                  <time dateTime={new Date(game.savedAt).toISOString()} className="muted">
                    saved {new Date(game.savedAt).toLocaleString()}
                  </time>
                </div>
                <button type="button" className="primary" aria-label={`Resume ${game.code}`} onClick={() => host(game)} disabled={busy}>
                  Resume
                </button>
                {deleting === game.code ? (
                  <button
                    type="button"
                    className="danger"
                    aria-label={`Yes, delete ${game.code}`}
                    onClick={() => {
                      setDeleting(null);
                      onDeleteSaved(game.code);
                    }}
                  >
                    Yes, delete
                  </button>
                ) : (
                  <button type="button" aria-label={`Delete ${game.code}`} onClick={() => setDeleting(game.code)}>
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(problem ?? error) && (
        <p className="error" role="alert">
          {problem ?? error}
        </p>
      )}
    </div>
  );
}
