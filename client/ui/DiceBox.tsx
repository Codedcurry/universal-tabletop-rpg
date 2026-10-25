import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type RollPlan, type RollSpeed, boxPieces, dieGeometry, faceLabels, planRollAnimation, upwardFace } from '@shared/dice';
import type { LogEntry } from '@shared/net';
import { sounds } from '../audio/soundEngine';
import { finalRotation, simulateThrow } from '../dice/simulate';
import { type DieLook, DiceView } from '../render/DiceView';
import { setDiceBoxPinned, useDiceBoxPinned, useDiceSpeed } from './diceSpeed';

// The dice box: every roll anyone sees in the log is thrown into a tray as
// real 3D dice that tumble, bounce, and knock into each other. The throw is
// physics, simulated ahead of time from a seed shared by everyone; the
// result was already decided by the secure roll, and the faces are
// relabelled so the face that lands up shows it. Tap to skip.
//
// Pinned open (the Dice box button), the tray stays up: it shows the last
// roll's dice at rest, new rolls land in it, and a tap skips to the end.

type RollEntry = Extract<LogEntry, { kind: 'roll' }>;

/** Playback speed of the throw for each dice-animation setting (0: dice already at rest). */
const RATE: Record<RollSpeed, number> = { fast: 1.6, normal: 1, dramatic: 0.75, off: 0 };
/** How long the result stays up once the dice settle (a big moment a little longer). */
const HOLD_MS = 1600;
const BIG_MOMENT_EXTRA_MS = 500;

/** The same throw for everyone who sees this roll. */
function throwSeed(entry: RollEntry): number {
  let hash = 2166136261;
  for (const char of `${entry.seq}:${entry.from}:${entry.result.notation}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

interface Throw {
  readonly entry: RollEntry;
  readonly plan: RollPlan;
  readonly rate: number;
}

export function DiceBox({ log, nameOf }: { log: readonly LogEntry[]; nameOf(id: string): string }) {
  const speed = useDiceSpeed();
  const pinned = useDiceBoxPinned();
  const [queue, setQueue] = useState<RollEntry[]>([]);
  const [showing, setShowing] = useState<Throw | null>(null);
  const [settled, setSettled] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  // Pinned open, the tray can be dragged by its header wherever it's out of the way.
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; from: { x: number; y: number } } | null>(null);
  // Rolls already in the log when we arrive aren't thrown again.
  const seen = useRef<number>(Math.max(0, ...log.map((entry) => entry.seq)));

  // New rolls join the queue; a backlog skips to the newest, so it never lags behind.
  useEffect(() => {
    const fresh = log.filter((entry): entry is RollEntry => entry.kind === 'roll' && entry.seq > seen.current);
    if (fresh.length === 0) return;
    seen.current = Math.max(...fresh.map((entry) => entry.seq));
    setQueue((current) => [...current, ...fresh].slice(-2));
  }, [log]);

  useEffect(() => {
    if (showing || queue.length === 0) return;
    const [next, ...rest] = queue as [RollEntry, ...RollEntry[]];
    setQueue(rest);
    setSettled(false);
    setShowing({ entry: next, plan: planRollAnimation(next.result, speed), rate: RATE[speed] });
  }, [queue, showing, speed]);

  const pieces = useMemo(() => (showing ? boxPieces(showing.plan) : null), [showing]);
  const lastRoll = useMemo(() => [...log].reverse().find((entry): entry is RollEntry => entry.kind === 'roll') ?? null, [log]);

  // Opened by hand: show the last roll, its dice already at rest.
  useEffect(() => {
    if (!pinned || showing || queue.length > 0 || !lastRoll) return;
    setSettled(false);
    setShowing({ entry: lastRoll, plan: planRollAnimation(lastRoll.result, 'normal'), rate: 0 });
  }, [pinned, showing, queue, lastRoll]);

  // Throw: simulate, relabel the faces for where they landed, and play it back.
  useEffect(() => {
    if (!canvas.current) return;
    if (!showing || !pieces) {
      // Pinned open with nothing rolled yet: just the empty tray.
      if (!pinned) return;
      const empty = new DiceView(canvas.current);
      return () => empty.dispose();
    }
    const view = new DiceView(canvas.current);
    const recording = simulateThrow(
      pieces.pieces.map((piece) => ({ shape: piece.shape })),
      throwSeed(showing.entry),
    );
    const looks: DieLook[] = pieces.pieces.map((piece, index) => {
      const landed = upwardFace(dieGeometry(piece.shape), finalRotation(recording, index));
      return { shape: piece.shape, labels: faceLabels(piece, landed), dropped: piece.dropped, crit: piece.crit };
    });
    if (showing.rate > 0) {
      sounds.play('diceRattle');
      // A clack for each knock, as loud ones happen (a handful at most, so a big pool doesn't roar).
      const knocks = [...recording.impacts].sort((a, b) => b.strength - a.strength).slice(0, 12);
      for (const knock of knocks) sounds.play('diceClack', (knock.tick * recording.dt * 1000) / showing.rate);
    }
    view.play(recording, looks, showing.rate, () => {
      setSettled(true);
      if (showing.plan.bigMoment) sounds.play(showing.plan.bigMoment === 'max' ? 'critSting' : 'fumbleSting');
      if ('vibrate' in navigator && matchMedia('(pointer: coarse)').matches) navigator.vibrate(15);
    });
    return () => view.dispose();
  }, [showing, pieces, pinned]);

  // Once settled, the result stays up a moment, then the box closes (unless pinned open).
  useEffect(() => {
    if (!settled || !showing || pinned) return;
    const timer = setTimeout(() => setShowing(null), HOLD_MS + (showing.plan.bigMoment ? BIG_MOMENT_EXTRA_MS : 0));
    return () => clearTimeout(timer);
  }, [settled, showing, pinned]);

  if (!showing && !pinned) return null;
  const entry = showing?.entry ?? null;
  const plan = showing?.plan ?? null;

  function close() {
    setShowing(null);
    setDiceBoxPinned(false);
  }

  // Straight into the page body, so nothing on the page can cover the box.
  return createPortal(
    <div
      className={`dice-tray${pinned ? ' pinned' : ''}${plan?.bigMoment ? ` big-${plan.bigMoment}` : ''}`}
      style={pinned ? { translate: `${offset.x}px ${offset.y}px` } : undefined}
      data-testid="dice-roll"
      data-big-moment={plan?.bigMoment ?? ''}
      role="status"
      aria-label={entry ? `${nameOf(entry.from)} rolled ${entry.result.notation}` : 'Dice box'}
      onClick={() => {
        if (!pinned) setShowing(null);
        // Pinned: a tap skips to the end, the dice already at rest.
        else if (!settled) setShowing((current) => (current ? { ...current, rate: 0 } : current));
      }}
      title={pinned ? 'Tap to skip to the result' : 'Tap to skip'}
    >
      <header
        className="dice-tray-head"
        onPointerDown={(event) => {
          if (!pinned || (event.target as HTMLElement).closest('button')) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, from: offset };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (start) setOffset({ x: start.from.x + event.clientX - start.x, y: start.from.y + event.clientY - start.y });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onClick={(event) => {
          if (pinned) event.stopPropagation(); // dragging the header isn't a tap on the dice
        }}
        title={pinned ? 'Drag to move the dice box' : undefined}
      >
        <span className="dice-tray-who">{entry ? `${nameOf(entry.from)} · ${entry.result.notation}` : 'No rolls yet'}</span>
        {settled && entry && (
          <span className="dice-tray-total" data-testid="roll-total">
            {entry.result.total}
          </span>
        )}
        <button
          type="button"
          className="dice-tray-close"
          aria-label="Close dice"
          onClick={(event) => {
            event.stopPropagation();
            close();
          }}
        >
          ×
        </button>
      </header>
      <canvas ref={canvas} className="dice-tray-canvas" />
      {settled && plan?.bigMoment && <p className="dice-tray-moment">{plan.bigMoment === 'max' ? 'Natural max!' : 'Natural 1…'}</p>}
      {pieces && pieces.extra > 0 && <p className="dice-tray-more">+{pieces.extra} more dice</p>}
      {/* What the dice show, for screen readers (and tests). */}
      <ul className="visually-hidden">
        {plan?.pieces.map((piece, index) => (
          <li key={index} data-testid="rolling-die" data-face={String(piece.face)} data-crit={piece.crit ?? ''}>
            {piece.kind === 'coin' ? `coin: ${piece.face}` : `d${piece.sides}: ${piece.face}${piece.kept ? '' : ' (not kept)'}`}
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
}
