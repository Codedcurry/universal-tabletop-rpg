import { type KeyboardEvent, type PointerEvent, useEffect, useId, useRef, useState } from 'react';
import type { CombatState, Combatant } from '@shared/combat';
import { type GameSystem, computeCreature } from '@shared/system';

// The creatures on the map, which is also the turn order (top goes first;
// a note under the heading says how the order is decided right now).
// Click one to select it; drag a
// row (by its handle, or anywhere with a mouse) to change the order, or
// focus the handle and use the arrow keys.

/** A press must travel this far (pixels) before it becomes a drag, so clicks still select. */
const DRAG_START = 5;

interface Props {
  readonly combat: CombatState;
  readonly system: GameSystem;
  readonly selectedId: string | null;
  /** Whether starting the fight will roll initiative (and re-sort this list). */
  readonly rollInitiative: boolean;
  onSelect(id: string | null): void;
  onReorder(order: readonly string[]): void;
}

interface Press {
  readonly id: string;
  readonly pointerId: number;
  readonly startY: number;
  dragging: boolean;
}

/** How the order is decided at this moment, in one line. */
function orderNote(status: CombatState['status'], rollInitiative: boolean): string {
  if (status === 'active') return 'Top goes first. Drag to change the order; whoever is acting keeps their turn.';
  if (rollInitiative) return 'Initiative is rolled when the fight starts and sorts this list. Drag to set the order yourself.';
  return 'The fight will go in this order, top first. Drag to change it.';
}

export function Roster({ combat, system, selectedId, rollInitiative, onSelect, onReorder }: Props) {
  const headingId = useId();
  /** The order while a row is being dragged, and which row. */
  const [preview, setPreview] = useState<{ readonly id: string; readonly order: readonly string[] } | null>(null);
  const press = useRef<Press | null>(null);
  const justDragged = useRef(false);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const refocus = useRef<string | null>(null);
  const order = preview?.order ?? combat.order;
  const actingId = combat.status === 'active' ? combat.order[combat.turnIndex] : undefined;

  // A row moved with the keyboard is re-rendered elsewhere: keep its handle focused.
  useEffect(() => {
    if (refocus.current) handles.current.get(refocus.current)?.focus();
    refocus.current = null;
  }, [combat.order]);

  function commit(next: readonly string[]) {
    if (next.join('\n') !== combat.order.join('\n')) onReorder(next);
  }

  function onPointerDown(event: PointerEvent<HTMLLIElement>, id: string) {
    const onHandle = (event.target as HTMLElement).closest('.drag-handle') !== null;
    // Touch drags only from the handle, so the list still scrolls with a finger.
    if (event.button !== 0 || (!onHandle && event.pointerType !== 'mouse')) return;
    if (onHandle) event.preventDefault();
    justDragged.current = false;
    press.current = { id, pointerId: event.pointerId, startY: event.clientY, dragging: false };
  }

  function onPointerMove(event: PointerEvent<HTMLLIElement>) {
    const current = press.current;
    if (!current || event.pointerId !== current.pointerId) return;
    if (!current.dragging) {
      if (Math.abs(event.clientY - current.startY) < DRAG_START) return;
      current.dragging = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    // The dragged row goes after every other row whose middle is above the pointer.
    const others = order.filter((id) => id !== current.id);
    const index = others.filter((id) => {
      const box = rows.current.get(id)?.getBoundingClientRect();
      return box !== undefined && box.top + box.height / 2 < event.clientY;
    }).length;
    setPreview({ id: current.id, order: [...others.slice(0, index), current.id, ...others.slice(index)] });
  }

  function onPointerUp(event: PointerEvent<HTMLLIElement>) {
    const current = press.current;
    if (!current || event.pointerId !== current.pointerId) return;
    press.current = null;
    if (current.dragging) {
      justDragged.current = true; // the click that ends a drag doesn't select
      if (preview) commit(preview.order);
    }
    setPreview(null);
  }

  function onHandleKey(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const from = combat.order.indexOf(id);
    const to = from + step;
    if (to < 0 || to >= combat.order.length) return;
    const next = [...combat.order];
    next.splice(from, 1);
    next.splice(to, 0, id);
    refocus.current = id;
    commit(next);
  }

  return (
    <>
      <h3 id={headingId}>Turn order</h3>
      <p className="muted roster-note" data-testid="turn-order-note">
        {orderNote(combat.status, rollInitiative)}
      </p>
      <ul className="roster" aria-labelledby={headingId}>
        {order.map((id, index) => {
          const combatant = combat.combatants[id] as Combatant;
          const max = computeCreature(system, combatant.sheet).maxHp;
          const name = combatant.sheet.name;
          const dragging = preview?.id === id;
          return (
            <li
              key={id}
              ref={(element) => {
                if (element) rows.current.set(id, element);
                else rows.current.delete(id);
              }}
              className={`${dragging ? 'dragging' : ''}${id === actingId ? ' acting' : ''}`}
              onPointerDown={(event) => onPointerDown(event, id)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => {
                press.current = null;
                setPreview(null);
              }}
            >
              <button
                type="button"
                className="drag-handle"
                aria-label={`Reorder ${name}`}
                title="Drag to change the turn order, or use the arrow keys"
                ref={(element) => {
                  if (element) handles.current.set(id, element);
                  else handles.current.delete(id);
                }}
                onKeyDown={(event) => onHandleKey(event, id)}
              >
                ⠿
              </button>
              <button
                type="button"
                className="roster-entry"
                aria-pressed={id === selectedId}
                onClick={() => {
                  if (justDragged.current) {
                    justDragged.current = false;
                    return;
                  }
                  onSelect(id === selectedId ? null : id);
                }}
              >
                <span className="turn-number">{index + 1}</span>
                <span className="name">{name}</span>
                <span className="muted">{combatant.side}</span>
                <span>{combatant.hp > 0 ? `${combatant.hp}/${max} HP` : 'Down'}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
