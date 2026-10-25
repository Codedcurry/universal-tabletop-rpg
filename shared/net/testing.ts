import type { CombatEvent } from '../combat';
import type { SavedGame } from './saved';
import type { Cell } from '../grid';
import type { RandomSource } from '../random';
import { scriptedRandom } from '../random';
import type { CreatureSheet } from '../system';
import { ClientSession } from './client';
import { HostSession } from './host';

/**
 * An in-memory network for testing sessions without WebRTC. Messages are
 * JSON-encoded exactly like the real transport and queued until flush(), so
 * tests can drop, duplicate, or reorder them and cut connections.
 */

export interface Envelope {
  readonly connectionId: string;
  readonly direction: 'toHost' | 'toClient';
  /** JSON text, or null for "the host closed this connection". */
  readonly data: string | null;
}

export type Interceptor = (envelope: Envelope) => 'deliver' | 'drop' | 'duplicate' | 'hold';

/** Random numbers from a queue first, then a fixed pseudo-random sequence. */
export function queuedRandom(): { random: RandomSource; push(...values: number[]): void } {
  const queue: number[] = [];
  let state = 42;
  return {
    random: {
      nextInt(max) {
        const next = queue.shift();
        if (next !== undefined) return scriptedRandom([next]).nextInt(max);
        state = (state * 1103515245 + 12345) % 2 ** 31;
        return state % max;
      },
    },
    push: (...values) => queue.push(...values),
  };
}

export interface TestPlayer {
  readonly session: ClientSession;
  readonly token: string;
  readonly connectionId: string;
  /** Combat events this player's session reported, one array per update. */
  readonly combatEvents: (readonly CombatEvent[])[];
  readonly failures: string[];
  /** Cells the DM asked this player's camera to look at. */
  readonly focuses: Cell[];
  /** Simulates the connection dropping (both sides notice). */
  disconnect(): void;
  /** Opens a fresh connection with the same identity. */
  reconnect(): void;
  /** Sends arbitrary data as this player, bypassing the client session. */
  sendRaw(data: unknown): void;
}

export interface JoinOptions {
  readonly character?: CreatureSheet | null;
  /** Values for this player's dice, in order. */
  readonly random?: readonly number[];
  readonly token?: string;
}

export function createTestNetwork(options: { dmTitle?: string; restore?: SavedGame } = {}) {
  let queue: Envelope[] = [];
  let held: Envelope[] = [];
  let interceptor: Interceptor | null = null;
  let clock = 1_000;
  let nextConnection = 1;
  let nextToken = 1;
  const clients = new Map<string, ClientSession>();
  const rawSinks = new Map<string, { messages: unknown[]; close(): void }>();
  const open = new Set<string>();
  const hostRandom = queuedRandom();
  const dmCombatEvents: (readonly CombatEvent[])[] = [];

  const host = new HostSession({
    send: (connectionId, message) => {
      queue.push({ connectionId, direction: 'toClient', data: JSON.stringify(message) });
    },
    disconnect: (connectionId) => {
      queue.push({ connectionId, direction: 'toClient', data: null });
    },
    random: hostRandom.random,
    now: () => clock,
    ...(options.dmTitle === undefined ? {} : { dmTitle: options.dmTitle }),
    onCombatEvents: (events) => dmCombatEvents.push(events),
  });
  if (options.restore) host.restore(options.restore);

  function deliver(envelope: Envelope): void {
    if (!open.has(envelope.connectionId)) return;
    if (envelope.direction === 'toHost') {
      host.received(envelope.connectionId, JSON.parse(envelope.data as string));
      return;
    }
    const raw = rawSinks.get(envelope.connectionId);
    if (raw) {
      if (envelope.data === null) {
        open.delete(envelope.connectionId);
        raw.close();
      } else {
        raw.messages.push(JSON.parse(envelope.data));
      }
      return;
    }
    const client = clients.get(envelope.connectionId);
    if (!client) return;
    if (envelope.data === null) {
      open.delete(envelope.connectionId);
      client.closed();
    } else {
      client.received(JSON.parse(envelope.data));
    }
  }

  /** Delivers queued messages (and any they trigger) until the network is quiet. */
  function flush(): void {
    for (let rounds = 0; queue.length > 0; rounds++) {
      if (rounds > 10_000) throw new Error('Network did not settle');
      const batch = queue;
      queue = [];
      for (const envelope of batch) {
        const decision = interceptor ? interceptor(envelope) : 'deliver';
        if (decision === 'drop') continue;
        if (decision === 'hold') {
          held.push(envelope);
          continue;
        }
        deliver(envelope);
        if (decision === 'duplicate') deliver(envelope);
      }
    }
  }

  /** Delivers held messages now (after later ones), simulating reordering. */
  function release(): void {
    const late = held;
    held = [];
    for (const envelope of late) deliver(envelope);
    flush();
  }

  function join(name: string, joinOptions: JoinOptions = {}): TestPlayer {
    const token = joinOptions.token ?? `test_token_${String(nextToken++).padStart(8, '0')}`;
    const combatEvents: (readonly CombatEvent[])[] = [];
    const failures: string[] = [];
    const focuses: Cell[] = [];
    let connectionId = '';

    const session = new ClientSession({
      send: (message) => {
        queue.push({ connectionId, direction: 'toHost', data: JSON.stringify(message) });
      },
      token,
      name,
      character: joinOptions.character ?? null,
      random: scriptedRandom(joinOptions.random ?? []),
      now: () => clock,
      onCombatEvents: (events) => combatEvents.push(events),
      onRequestFailed: (reason) => failures.push(reason),
      onFocus: (cell) => focuses.push(cell),
    });

    function connect(): void {
      connectionId = `conn${nextConnection++}`;
      clients.set(connectionId, session);
      open.add(connectionId);
      host.connected(connectionId);
      session.opened();
      flush();
    }

    connect();
    return {
      session,
      token,
      get connectionId() {
        return connectionId;
      },
      combatEvents,
      failures,
      focuses,
      disconnect() {
        open.delete(connectionId);
        host.disconnected(connectionId);
        session.closed();
        flush();
      },
      reconnect: connect,
      sendRaw(data) {
        queue.push({ connectionId, direction: 'toHost', data: JSON.stringify(data) });
        flush();
      },
    };
  }

  /** A connection with no client session: send anything, see exactly what comes back. */
  function rawConnection() {
    const connectionId = `conn${nextConnection++}`;
    const messages: unknown[] = [];
    let closed = false;
    rawSinks.set(connectionId, { messages, close: () => (closed = true) });
    open.add(connectionId);
    host.connected(connectionId);
    return {
      connectionId,
      messages,
      get closed() {
        return closed;
      },
      send(data: unknown) {
        queue.push({ connectionId, direction: 'toHost', data: JSON.stringify(data) });
        flush();
      },
    };
  }

  return {
    host,
    rawConnection,
    /** The fake clock, in milliseconds. */
    now: () => clock,
    /** Moves the fake clock forward. */
    advance(ms: number) {
      clock += ms;
    },
    hostRandom,
    dmCombatEvents,
    join,
    flush,
    release,
    /** Sets (or clears, with null) a filter applied to every delivery. */
    intercept(next: Interceptor | null) {
      interceptor = next;
    },
  };
}
