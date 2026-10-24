import { type FormEvent, useState } from 'react';
import { normalizeRoomCode } from '@shared/net';

interface Props {
  readonly initialName: string;
  readonly initialCode: string;
  readonly busy: boolean;
  readonly error: string | null;
  onHost(name: string): void;
  onJoin(name: string, code: string): void;
}

export function Home({ initialName, initialCode, busy, error, onHost, onJoin }: Props) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(initialCode);
  const [problem, setProblem] = useState<string | null>(null);

  function join(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeRoomCode(code);
    if (name.trim() === '') return setProblem('Enter your name first');
    if (!normalized) return setProblem('Room codes are 6 letters and numbers, like K7QW2M');
    setProblem(null);
    onJoin(name.trim(), normalized);
  }

  function host() {
    if (name.trim() === '') return setProblem('Enter your name first');
    setProblem(null);
    onHost(name.trim());
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
        <button type="button" onClick={host} disabled={busy}>
          {busy ? 'Starting…' : 'Host a game'}
        </button>
      </section>

      {(problem ?? error) && (
        <p className="error" role="alert">
          {problem ?? error}
        </p>
      )}
    </div>
  );
}
