import { type FormEvent, useId, useState } from 'react';
import {
  DiceNotationError,
  type DiceExpression,
  type RollSlot,
  type RollSpeed,
  type Tray,
  type TrayDie,
  addToTray,
  parseDice,
  rollSlots,
  trayNotation,
} from '@shared/dice';
import { setDiceSpeed, useDiceSpeed } from './diceSpeed';

// The dice panel: tap dice into a tray (or type notation for anything
// fancier), roll, re-roll, and choose how long the animation plays.

const QUICK_DICE: { die: TrayDie; label: string }[] = [
  { die: 'coin', label: 'Coin' },
  { die: 4, label: 'd4' },
  { die: 6, label: 'd6' },
  { die: 8, label: 'd8' },
  { die: 10, label: 'd10' },
  { die: 12, label: 'd12' },
  { die: 20, label: 'd20' },
  { die: 100, label: 'd100' },
];

const SPEEDS: { value: RollSpeed; label: string }[] = [
  { value: 'fast', label: 'Fast' },
  { value: 'normal', label: 'Normal' },
  { value: 'dramatic', label: 'Dramatic' },
  { value: 'off', label: 'Off' },
];

/** Typing that many results by hand is a chore, not a feature. */
const MAX_PHYSICAL_SLOTS = 20;

interface Props {
  /** Players type in what their real dice show. */
  readonly physicalDice: boolean;
  /** Only the DM can roll in secret. */
  readonly canHideRolls: boolean;
  /** `faces` is set in physical mode: die faces 1..n, coins 1 = heads, 0 = tails. */
  onRoll(notation: string, hidden: boolean, faces: number[] | null): void;
}

type Parsed = { expression: DiceExpression; error: null } | { expression: null; error: string | null };

function parse(notation: string): Parsed {
  if (notation.trim() === '') return { expression: null, error: null };
  try {
    return { expression: parseDice(notation), error: null };
  } catch (caught) {
    if (caught instanceof DiceNotationError) return { expression: null, error: caught.message };
    throw caught;
  }
}

/** The face entered for a slot, or null if it's missing or impossible. */
function faceValue(slot: RollSlot, entry: string): number | null {
  if (slot.kind === 'coin') return entry === 'heads' ? 1 : entry === 'tails' ? 0 : null;
  const value = Number(entry);
  return entry !== '' && Number.isInteger(value) && value >= 1 && value <= slot.sides ? value : null;
}

/** "Die 2 of 3 · d6" / "Coin 1 of 2": numbered separately so they match what's on the table. */
function slotLabels(slots: readonly RollSlot[]): string[] {
  const dice = slots.filter((slot) => slot.kind === 'die').length;
  const coins = slots.length - dice;
  let die = 0;
  let coin = 0;
  return slots.map((slot) =>
    slot.kind === 'die' ? `Die ${++die} of ${dice} · d${slot.sides}` : `Coin ${++coin} of ${coins}`,
  );
}

export function DiceForm({ physicalDice, canHideRolls, onRoll }: Props) {
  const [notation, setNotation] = useState('');
  const [hidden, setHidden] = useState(false);
  const [entries, setEntries] = useState<string[]>([]);
  const [tray, setTray] = useState<Tray>({});
  const [lastNotation, setLastNotation] = useState<string | null>(null);
  const speed = useDiceSpeed();
  const helpId = useId();

  function addDie(die: TrayDie) {
    // Typing by hand replaces the tray; tapping a die starts it again from what's in it.
    const next = addToTray(tray, die);
    setTray(next);
    setNotation(trayNotation(next));
  }

  function clear() {
    setTray({});
    setNotation('');
    setEntries([]);
  }

  const parsed = parse(notation);
  const slots = physicalDice && parsed.expression ? rollSlots(parsed.expression) : [];
  const tooManySlots = slots.length > MAX_PHYSICAL_SLOTS;
  const faces = slots.map((slot, index) => faceValue(slot, entries[index] ?? ''));
  const labels = slotLabels(slots);
  const ready = parsed.expression !== null && !tooManySlots && faces.every((face) => face !== null);

  function setEntry(index: number, value: string) {
    setEntries((current) => {
      const next = [...current];
      next[index] = value;
      return next;
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    onRoll(notation, hidden, physicalDice ? (faces as number[]) : null);
    setLastNotation(notation);
    clear();
  }

  function reroll() {
    if (lastNotation && !physicalDice) onRoll(lastNotation, hidden, null);
  }

  return (
    <form onSubmit={submit}>
      <div className="quick-dice" role="group" aria-label="Add dice to the tray">
        {QUICK_DICE.map(({ die, label }) => (
          <button key={label} type="button" aria-label={`Add ${label === 'Coin' ? 'coin' : label}`} onClick={() => addDie(die)}>
            {label}
          </button>
        ))}
      </div>
      <p className="hint" id={helpId}>
        <b>d20</b> = one 20-sided die · <b>2d6+3</b> = two 6-sided dice, plus 3 · <b>3 coins</b> = flip three coins
      </p>
      {physicalDice && (
        <p className="instructions">
          Roll your real dice, then enter what each one shows. First type what you're rolling, and a box appears for
          every die.
        </p>
      )}

      <div className="row">
        <label className="grow">
          <span>Dice to roll</span>
          <input
            value={notation}
            onChange={(event) => {
              setNotation(event.target.value);
              setTray({});
            }}
            placeholder="e.g. d20 or 2d6+3"
            aria-describedby={helpId}
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {canHideRolls && (
          <label className="check">
            <input type="checkbox" checked={hidden} onChange={(event) => setHidden(event.target.checked)} />
            Hidden
          </label>
        )}
        <button type="submit" className="primary" disabled={!ready}>
          Roll
        </button>
      </div>
      <div className="row dice-extras">
        <button type="button" onClick={clear} disabled={notation === ''}>
          Clear
        </button>
        <button type="button" onClick={reroll} disabled={!lastNotation || physicalDice} title={lastNotation ?? undefined}>
          Re-roll
        </button>
        <label>
          <span>Dice animation</span>
          <select value={speed} onChange={(event) => setDiceSpeed(event.target.value as RollSpeed)}>
            {SPEEDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {parsed.error && <p className="field-error">{parsed.error}</p>}
      {tooManySlots && <p className="field-error">That's a lot of dice to type in: at most {MAX_PHYSICAL_SLOTS}.</p>}

      {slots.length > 0 && !tooManySlots && (
        <div className="faces">
          {slots.map((slot, index) => {
            const entry = entries[index] ?? '';
            const label = labels[index] as string;
            const invalid = entry !== '' && faces[index] === null;
            return (
              <label key={`${index}:${slot.kind}`} className="face">
                <span>{label}</span>
                {slot.kind === 'die' ? (
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={slot.sides}
                    value={entry}
                    onChange={(event) => setEntry(index, event.target.value)}
                    aria-invalid={invalid}
                  />
                ) : (
                  <select value={entry} onChange={(event) => setEntry(index, event.target.value)}>
                    <option value="">Choose…</option>
                    <option value="heads">Heads</option>
                    <option value="tails">Tails</option>
                  </select>
                )}
                {invalid && slot.kind === 'die' && <span className="field-error">Enter 1 to {slot.sides}</span>}
              </label>
            );
          })}
        </div>
      )}
    </form>
  );
}
