import { useEffect, useRef, useState } from 'react';
import { type RollPlan, planRollAnimation } from '@shared/dice';
import type { LogEntry } from '@shared/net';
import { useDiceSpeed } from './diceSpeed';

// Every roll anyone sees in the log is thrown on screen: dice tumble and
// land on faces already decided, then the total pops in. Tap to skip.
// Placeholder look until style packs (step 13) bring real dice art.

type RollEntry = Extract<LogEntry, { kind: 'roll' }>;

interface Showing {
  readonly entry: RollEntry;
  readonly plan: RollPlan;
  readonly startedAt: number;
}

/** A tumbling die flickers through faces; deterministic per die and moment. */
function tumblingFace(sides: number, seed: number, elapsed: number): number {
  const tick = Math.floor(elapsed / 70);
  return ((tick * 7919 + seed * 104729) % sides) + 1;
}

export function DiceRollAnimation({ log, nameOf }: { log: readonly LogEntry[]; nameOf(id: string): string }) {
  const speed = useDiceSpeed();
  const [queue, setQueue] = useState<RollEntry[]>([]);
  const [showing, setShowing] = useState<Showing | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // Rolls already in the log when we arrive aren't thrown again.
  const seen = useRef<number>(Math.max(0, ...log.map((entry) => entry.seq)));
  const vibrated = useRef(new Set<number>());

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
    vibrated.current = new Set();
    setElapsed(0);
    setShowing({ entry: next, plan: planRollAnimation(next.result, speed), startedAt: performance.now() });
  }, [queue, showing, speed]);

  // Drive the animation frame by frame until it ends.
  useEffect(() => {
    if (!showing) return;
    let frame = 0;
    const tick = () => {
      const now = performance.now() - showing.startedAt;
      if (now >= showing.plan.endMs) {
        setShowing(null);
        return;
      }
      setElapsed(now);
      // A short buzz as each die lands, where the device supports it.
      showing.plan.pieces.forEach((piece, index) => {
        if (now >= piece.landMs && !vibrated.current.has(index)) {
          vibrated.current.add(index);
          if (piece.landMs > 0 && 'vibrate' in navigator && matchMedia('(pointer: coarse)').matches) navigator.vibrate(15);
        }
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [showing]);

  if (!showing) return null;
  const { entry, plan } = showing;
  const totalShown = elapsed >= plan.totalAtMs;

  return (
    <div
      className={`dice-roll${plan.bigMoment ? ` big-${plan.bigMoment}` : ''}`}
      data-testid="dice-roll"
      data-big-moment={plan.bigMoment ?? ''}
      role="status"
      aria-label={`${nameOf(entry.from)} rolled ${entry.result.notation}`}
      onClick={() => setShowing(null)}
      title="Tap to skip"
    >
      <p className="dice-roll-who">
        {nameOf(entry.from)} rolls {entry.result.notation}
      </p>
      <div className="dice-roll-pieces">
        {plan.pieces.map((piece, index) => {
          const landed = elapsed >= piece.landMs;
          const thrown = elapsed >= piece.startMs;
          const face =
            piece.kind === 'coin'
              ? landed
                ? piece.face === 'heads'
                  ? 'H'
                  : 'T'
                : Math.floor(elapsed / 90) % 2 === 0
                  ? 'H'
                  : 'T'
              : landed
                ? String(piece.face)
                : String(tumblingFace(piece.sides, index + 1, elapsed));
          const classes = [
            'piece',
            piece.kind,
            !thrown ? 'waiting' : landed ? 'landed' : 'tumbling',
            piece.kept ? '' : 'dropped',
            landed && piece.crit ? `crit-${piece.crit}` : '',
          ].join(' ');
          return (
            <span
              key={index}
              className={classes}
              data-testid="rolling-die"
              data-face={String(piece.face)}
              data-crit={piece.crit ?? ''}
            >
              <span className="piece-face">{face}</span>
              {piece.kind === 'die' && <span className="piece-sides">d{piece.sides}</span>}
            </span>
          );
        })}
      </div>
      {totalShown && (
        <p className="dice-roll-total" data-testid="roll-total">
          {entry.result.total}
        </p>
      )}
      {totalShown && plan.bigMoment && (
        <p className="dice-roll-moment">{plan.bigMoment === 'max' ? 'Natural max!' : 'Natural 1…'}</p>
      )}
    </div>
  );
}
