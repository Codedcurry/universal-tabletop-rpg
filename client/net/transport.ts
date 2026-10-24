import { type DataConnection, Peer } from 'peerjs';
import type { CombatEvent } from '@shared/combat';
import {
  ClientSession,
  FrameAssembler,
  HEARTBEAT_INTERVAL_MS,
  HostSession,
  createRoomCode,
  reconnectDelay,
  roomPeerId,
  splitIntoFrames,
} from '@shared/net';
import type { CreatureSheet } from '@shared/system';
import { secureRandom } from '../random';
import { peerOptions } from './config';

// The only code that touches WebRTC. It moves messages between PeerJS data
// connections and the pure session classes in shared/net, which decide everything.

const CONNECTION = { serialization: 'json', reliable: true } as const;
/** Give a rejection message time to arrive before hanging up. */
const CLOSE_DELAY_MS = 500;
const OPEN_TIMEOUT_MS = 10_000;
/** Player requests are always small; anything bigger is junk or hostile. */
const MAX_FROM_PLAYER_CHARS = 200_000;
/** The DM sends whole maps and logs. */
const MAX_FROM_DM_CHARS = 20_000_000;

let nextFrameId = 1;

/** Sends a message, split into frames when it's over the 16 KB PeerJS limit. */
function sendFramed(connection: DataConnection, message: unknown): void {
  for (const part of splitIntoFrames(message, nextFrameId++)) connection.send(part);
}

export interface HostedGame {
  readonly session: HostSession;
  readonly code: string;
  close(): void;
}

export interface HostCallbacks {
  onChange(): void;
  onCombatEvents?(events: readonly CombatEvent[]): void;
}

/** Registers a room with the signaling server and accepts players into it. */
export function hostGame(callbacks: HostCallbacks, attempt = 0): Promise<HostedGame> {
  return new Promise((resolve, reject) => {
    const code = createRoomCode(secureRandom);
    const peer = new Peer(roomPeerId(code), peerOptions());
    const connections = new Map<string, DataConnection>();
    let opened = false;

    const session = new HostSession({
      send: (connectionId, message) => {
        const connection = connections.get(connectionId);
        if (connection) sendFramed(connection, message);
      },
      disconnect: (connectionId) => {
        const connection = connections.get(connectionId);
        connections.delete(connectionId);
        setTimeout(() => connection?.close(), CLOSE_DELAY_MS);
      },
      random: secureRandom,
      now: () => Date.now(),
      onChange: callbacks.onChange,
      ...(callbacks.onCombatEvents ? { onCombatEvents: callbacks.onCombatEvents } : {}),
    });

    peer.on('open', () => {
      opened = true;
      const heartbeat = setInterval(() => session.tick(), HEARTBEAT_INTERVAL_MS);
      resolve({
        session,
        code,
        close: () => {
          clearInterval(heartbeat);
          peer.destroy();
        },
      });
    });

    peer.on('connection', (connection) => {
      const id = connection.connectionId;
      const assembler = new FrameAssembler({ maxMessageChars: MAX_FROM_PLAYER_CHARS });
      connection.on('open', () => {
        connections.set(id, connection);
        session.connected(id);
      });
      connection.on('data', (data) => {
        const message = assembler.receive(data);
        if (message !== null) session.received(id, message);
      });
      const closed = () => {
        if (connections.get(id) !== connection) return;
        connections.delete(id);
        session.disconnected(id);
      };
      connection.on('close', closed);
      connection.on('error', closed);
    });

    // Losing the signaling server doesn't drop existing players; reconnect so new ones can join.
    peer.on('disconnected', () => {
      if (!peer.destroyed) peer.reconnect();
    });

    peer.on('error', (error) => {
      if (opened) return;
      peer.destroy();
      if (error.type === 'unavailable-id' && attempt < 5) {
        hostGame(callbacks, attempt + 1).then(resolve, reject);
      } else {
        reject(error);
      }
    });
  });
}

export interface JoinedGame {
  readonly session: ClientSession;
  leave(): void;
}

export interface JoinOptions {
  code: string;
  token: string;
  name: string;
  character: CreatureSheet | null;
  onChange(): void;
  onCombatEvents?(events: readonly CombatEvent[]): void;
  onRequestFailed?(reason: string): void;
}

/** Connects to the DM's room and keeps reconnecting with backoff until told to leave. */
export function joinGame(options: JoinOptions): JoinedGame {
  let peer: Peer | null = null;
  let peerReady: Promise<Peer> | null = null;
  let connection: DataConnection | null = null;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let left = false;

  const session = new ClientSession({
    send: (message) => {
      if (connection?.open) sendFramed(connection, message);
    },
    token: options.token,
    name: options.name,
    character: options.character,
    random: secureRandom,
    now: () => Date.now(),
    onChange: options.onChange,
    ...(options.onCombatEvents ? { onCombatEvents: options.onCombatEvents } : {}),
    ...(options.onRequestFailed ? { onRequestFailed: options.onRequestFailed } : {}),
  });

  function resetPeer(): void {
    peer?.destroy();
    peer = null;
    peerReady = null;
  }

  function getPeer(): Promise<Peer> {
    peerReady ??= new Promise((resolve, reject) => {
      const created = new Peer(peerOptions());
      peer = created;
      created.on('open', () => resolve(created));
      created.on('disconnected', () => {
        if (!created.destroyed) created.reconnect();
      });
      created.on('error', (error) => {
        if (error.type === 'peer-unavailable') {
          // The DM's room isn't there (yet, or any more).
          lost(null);
        } else if (!created.open || error.type === 'network' || error.type === 'server-error') {
          resetPeer();
          reject(error);
          lost(null);
        }
      });
    });
    return peerReady;
  }

  function connect(): void {
    if (left || session.status === 'rejected') return;
    getPeer().then(
      (ready) => {
        if (left) return;
        const next = ready.connect(roomPeerId(options.code), CONNECTION);
        const assembler = new FrameAssembler({ maxMessageChars: MAX_FROM_DM_CHARS });
        connection = next;
        const timeout = setTimeout(() => {
          if (!next.open) lost(next);
        }, OPEN_TIMEOUT_MS);
        next.on('open', () => {
          clearTimeout(timeout);
          attempt = 0;
          session.opened();
        });
        next.on('data', (data) => {
          const message = assembler.receive(data);
          if (message !== null) session.received(message);
        });
        next.on('close', () => lost(next));
        next.on('error', () => lost(next));
      },
      // getPeer's error handler has already scheduled a retry.
      () => undefined,
    );
  }

  /** The connection is gone (or never came up): pause and try again later. */
  function lost(which: DataConnection | null): void {
    if (which && which !== connection) return; // an older connection already replaced
    const dead = connection;
    connection = null;
    dead?.close();
    session.closed();
    if (left || session.status === 'rejected') return;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, reconnectDelay(attempt++));
  }

  // Phones freeze background tabs; when the player comes back, reconnect right away.
  const onVisible = () => {
    if (document.visibilityState === 'visible' && !connection?.open && !left) {
      clearTimeout(retryTimer);
      attempt = 0;
      connect();
    }
  };
  document.addEventListener('visibilitychange', onVisible);

  // WebRTC may never report that the DM vanished; silence is the reliable signal.
  const watchdog = setInterval(() => {
    if (connection?.open && session.isStale(Date.now())) lost(connection);
  }, HEARTBEAT_INTERVAL_MS);

  connect();
  return {
    session,
    leave() {
      left = true;
      clearTimeout(retryTimer);
      clearInterval(watchdog);
      document.removeEventListener('visibilitychange', onVisible);
      connection?.close();
      resetPeer();
    },
  };
}
