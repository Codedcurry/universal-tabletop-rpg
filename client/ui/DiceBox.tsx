import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type RollPlan, type RollSpeed, boxPieces, dieGeometry, faceLabels, planRollAnimation, upwardFace } from '@shared/dice';
import type { LogEntry } from '@shared/net';
import { sounds } from '../audio/soundEngine';
import { finalRotation, simulateThrow } from '../dice/simulate';
import { type DieLook, DiceView } from '../render/DiceView';
import { useDiceSpeed } from './diceSpeed';

// The dice box: every roll anyone sees in the log is thrown into a tray as
// real 3D dice that tumble, bounce, and knock into each other. The throw is
// physics, simulated ahead of time from a seed shared by everyone; the
// result was already decided by the secure roll, and the faces are
// relabelled so the face that lands up shows it. Tap to skip.

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
  const [queue, setQueue] = useState<RollEntry[]>([]);
  const [showing, setShowing] = useState<Throw | null>(null);
  const [settled, setSettled] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
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

  // Throw: simulate, relabel the faces for where they landed, and play it back.
  useEffect(() => {
    if (!showing || !pieces || !canvas.current) return;
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
  }, [showing, pieces]);

  // Once settled, the result stays up a moment, then the box closes.
  useEffect(() => {
    if (!settled || !showing) return;
    const timer = setTimeout(() => setShowing(null), HOLD_MS + (showing.plan.bigMoment ? BIG_MOMENT_EXTRA_MS : 0));
    return () => clearTimeout(timer);
  }, [settled, showing]);

  if (!showing) return null;
  const { entry, plan } = showing;

  // Straight into the page body, so nothing on the page can cover the box.
  return createPortal(
    <div
      className={`dice-tray${plan.bigMoment ? ` big-${plan.bigMoment}` : ''}`}
      data-testid="dice-roll"
      data-big-moment={plan.bigMoment ?? ''}
      role="status"
      aria-label={`${nameOf(entry.from)} rolled ${entry.result.notation}`}
      onClick={() => setShowing(null)}
      title="Tap to skip"
    >
      <header className="dice-tray-head">
        <span className="dice-tray-who">
          {nameOf(entry.from)} · {entry.result.notation}
        </span>
        {settled && (
          <span className="dice-tray-total" data-testid="roll-total">
            {entry.result.total}
          </span>
        )}
        <button type="button" className="dice-tray-close" aria-label="Close dice" onClick={() => setShowing(null)}>
          ×
        </button>
      </header>
      <canvas ref={canvas} className="dice-tray-canvas" />
      {settled && plan.bigMoment && <p className="dice-tray-moment">{plan.bigMoment === 'max' ? 'Natural max!' : 'Natural 1…'}</p>}
      {pieces && pieces.extra > 0 && <p className="dice-tray-more">+{pieces.extra} more dice</p>}
      {/* What the dice show, for screen readers (and tests). */}
      <ul className="visually-hidden">
        {plan.pieces.map((piece, index) => (
          <li key={index} data-testid="rolling-die" data-face={String(piece.face)} data-crit={piece.crit ?? ''}>
            {piece.kind === 'coin' ? `coin: ${piece.face}` : `d${piece.sides}: ${piece.face}${piece.kept ? '' : ' (not kept)'}`}
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
}
