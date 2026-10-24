import type { CombatAction, CombatEvent } from '../combat';
import { type DiceExpression, parseDice, rollDice } from '../dice';
import { type RandomSource, recordDraws } from '../random';
import type { CreatureSheet } from '../system';
import {
  type ClientMessage,
  type HostMessage,
  HEARTBEAT_TIMEOUT_MS,
  MAX_SNAPSHOT_LOG,
  PROTOCOL_VERSION,
  type SessionSnapshot,
  parseHostMessage,
} from './protocol';
import { applyUpdate, insertLogEntry } from './state';

/**
 * A player's side of a session: keeps a copy of what the DM shares, sends
 * requests, and recovers from gaps by asking for a fresh snapshot.
 */

export type ClientStatus = 'connecting' | 'connected' | 'reconnecting' | 'rejected';

export interface ClientOptions {
  send(message: ClientMessage): void;
  /** Secret identity kept on this device across reloads. */
  token: string;
  name: string;
  character: CreatureSheet | null;
  /** Used for player-mode dice rolls. */
  random: RandomSource;
  now(): number;
  onChange?(): void;
  onCombatEvents?(events: readonly CombatEvent[]): void;
  onRequestFailed?(reason: string): void;
}

/**
 * Turns the faces someone read off physical dice into draws: die faces are
 * 1-based, coins are 1 for heads and 0 for tails.
 */
function facesToDraws(expression: DiceExpression, faces: readonly number[]): number[] {
  const needed = expression.terms.reduce((sum, term) => sum + (term.kind === 'constant' ? 0 : term.count), 0);
  if (faces.length !== needed) throw new Error(`${expression.source} needs ${needed} results, got ${faces.length}`);
  const draws: number[] = [];
  let index = 0;
  for (const term of expression.terms) {
    if (term.kind === 'constant') continue;
    for (let i = 0; i < term.count; i++) {
      const face = faces[index++] as number;
      draws.push(term.kind === 'dice' ? face - 1 : face);
    }
  }
  return draws;
}

export class ClientSession {
  status: ClientStatus = 'connecting';
  rejectionReason: string | null = null;
  playerId: string | null = null;
  state: SessionSnapshot | null = null;
  lastError: string | null = null;

  private awaitingSnapshot = false;
  private lastHeard = 0;
  private nextRequest = 1;

  constructor(private readonly options: ClientOptions) {}

  // -------------------------------------------------------------------------
  // Transport events

  opened(): void {
    this.lastHeard = this.options.now();
    this.options.send({
      type: 'hello',
      protocol: PROTOCOL_VERSION,
      token: this.options.token,
      name: this.options.name,
      character: this.options.character,
    });
  }

  closed(): void {
    if (this.status !== 'rejected') this.status = 'reconnecting';
    this.awaitingSnapshot = false;
    this.options.onChange?.();
  }

  received(data: unknown): void {
    this.lastHeard = this.options.now();
    const message = parseHostMessage(data);
    if (!message) return;
    this.handle(message);
    this.options.onChange?.();
  }

  // -------------------------------------------------------------------------
  // Queries

  /** True when the DM has been silent too long: the connection is probably dead. */
  isStale(now: number): boolean {
    return now - this.lastHeard > HEARTBEAT_TIMEOUT_MS;
  }

  canControl(combatantId: string): boolean {
    const me = this.state?.players.find((player) => player.id === this.playerId);
    return me?.controls.includes(combatantId) ?? false;
  }

  // -------------------------------------------------------------------------
  // Requests. Each returns the request id, or null if not connected.

  act(action: CombatAction): string | null {
    return this.request((requestId) => ({ type: 'combatAction', requestId, action }));
  }

  /** Chat to everyone, or whisper to the DM with `to = "dm"`. */
  say(text: string, to: string | null = null): string | null {
    return this.request((requestId) => ({ type: 'chat', requestId, text, to }));
  }

  /**
   * Rolls dice the way this session's DM chose: on this device (verified by
   * replay on the DM's side) or by the DM. Throws on invalid notation.
   */
  roll(notation: string): string | null {
    const expression = parseDice(notation);
    const mode = this.state?.rollMode;
    if (mode === 'physical') throw new Error('This session uses physical dice: enter what you rolled');
    if (mode === 'dmVerified') {
      return this.request((requestId) => ({ type: 'rollRequest', requestId, notation }));
    }
    if (!this.isConnected()) return null;
    const recorder = recordDraws(this.options.random);
    rollDice(expression, recorder.random);
    return this.request((requestId) => ({ type: 'roll', requestId, notation, mode: 'player', draws: recorder.draws() }));
  }

  /** Reports physical dice: die faces as shown (1-based), coins as 1 = heads, 0 = tails. */
  rollPhysical(notation: string, faces: readonly number[]): string | null {
    const draws = facesToDraws(parseDice(notation), faces);
    return this.request((requestId) => ({ type: 'roll', requestId, notation, mode: 'physical', draws }));
  }

  // -------------------------------------------------------------------------
  // Internals

  private isConnected(): boolean {
    return this.status === 'connected';
  }

  private request(build: (requestId: string) => ClientMessage): string | null {
    if (!this.isConnected()) return null;
    const requestId = `r${this.nextRequest++}`;
    this.options.send(build(requestId));
    return requestId;
  }

  private handle(message: HostMessage): void {
    switch (message.type) {
      case 'welcome':
        this.playerId = message.playerId;
        this.state = message.snapshot;
        this.status = 'connected';
        this.awaitingSnapshot = false;
        return;
      case 'joinRejected':
        this.status = 'rejected';
        this.rejectionReason = message.reason;
        return;
      case 'snapshot':
        this.state = message.snapshot;
        this.awaitingSnapshot = false;
        return;
      case 'update': {
        const state = this.state;
        if (!state || message.version <= state.version) return; // not welcomed yet, or a duplicate
        if (message.version > state.version + 1) {
          // We missed something: ask for everything once and wait for it.
          if (!this.awaitingSnapshot) {
            this.awaitingSnapshot = true;
            this.options.send({ type: 'syncRequest' });
          }
          return;
        }
        this.state = applyUpdate(state, message.version, message.update, MAX_SNAPSHOT_LOG);
        if (message.update.kind === 'combat' && message.update.events.length > 0) {
          this.options.onCombatEvents?.(message.update.events);
        }
        return;
      }
      case 'private':
        if (this.state) {
          this.state = { ...this.state, log: insertLogEntry(this.state.log, message.entry, MAX_SNAPSHOT_LOG) };
        }
        return;
      case 'ping':
        this.options.send({ type: 'pong' });
        return;
      case 'requestFailed':
        this.lastError = message.reason;
        this.options.onRequestFailed?.(message.reason);
        return;
    }
  }
}
