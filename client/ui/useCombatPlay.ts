import { useEffect, useMemo, useRef, useState } from 'react';
import { type CombatAction, type CombatContext, type CombatState, abilityReach, moveOptions, targetOptions } from '@shared/combat';
import { type Cell, cellKey } from '@shared/grid';
import { type MapData, createWorldMap } from '@shared/map';
import { type GameSystem, abilityIntent } from '@shared/system';
import type { HighlightKind, TilePointer } from '../render/WorldView';

// Playing the fight from the map, shared by players and the DM's Play tool:
// the active creature's reachable tiles are highlighted and a click moves
// there; picking an ability highlights its targets and a click attacks.

/** A press that moves less than this (pixels) is a click; more is a drag that pans the view. */
const CLICK_SLOP = 8;

interface Options {
  readonly combat: CombatState | null;
  readonly system: GameSystem | null;
  readonly map: MapData | null;
  canControl(combatantId: string): boolean;
  act(action: CombatAction): void;
}

export interface CombatPlay {
  readonly context: CombatContext | null;
  /** The creature whose turn it is, if this viewer may act for it. */
  readonly actorId: string | null;
  /** The ability waiting for a target, if any. */
  readonly ability: string | null;
  readonly highlight: readonly Cell[];
  /** What the highlight means: where to move, or who the chosen ability hurts or helps. */
  readonly highlightKind: Exclude<HighlightKind, 'brush'>;
  readonly targets: readonly string[];
  /** Every tile the picked (or previewed) ability reaches, shown faintly under the targets. */
  readonly reach: readonly Cell[];
  /** Whether that ability hurts or helps, for the reach color. */
  readonly reachKind: 'harm' | 'help';
  /** Shows an ability's range without picking it (hovering its button), or stops with null. */
  previewAbility(abilityId: string | null): void;
  selectAbility(abilityId: string): void;
  endTurn(): void;
  onPointer(pointer: TilePointer): void;
  onTokenClick(combatantId: string): void;
}

export function useCombatPlay({ combat, system, map, canControl, act }: Options): CombatPlay {
  const context = useMemo<CombatContext | null>(
    () => (combat && system && map ? { system, map: createWorldMap(map) } : null),
    [combat !== null, system, map],
  );
  const activeId = combat?.status === 'active' ? (combat.order[combat.turnIndex] ?? null) : null;
  const actorId = activeId && canControl(activeId) ? activeId : null;
  const [ability, setAbility] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // A new turn, or the action being spent, drops any half-chosen ability.
  useEffect(() => {
    setAbility(null);
    setPreview(null); // the bar may have gone from under the pointer
  }, [actorId, combat?.round, combat?.actionUsed]);

  const moves = useMemo(
    () => (context && combat && actorId && !ability ? moveOptions(context, combat, actorId) : new Map()),
    [context, combat, actorId, ability],
  );
  const targets = useMemo(
    () => (context && combat && actorId && ability ? targetOptions(context, combat, actorId, ability) : []),
    [context, combat, actorId, ability],
  );
  const shown = ability ?? preview;
  const reach = useMemo(
    () => (context && combat && actorId && shown ? abilityReach(context, combat, actorId, shown) : []),
    [context, combat, actorId, shown],
  );
  const shownDefinition = shown ? system?.abilities.find((entry) => entry.id === shown) : undefined;
  const reachKind = shownDefinition ? abilityIntent(shownDefinition) : 'harm';

  const highlight = useMemo<Cell[]>(() => {
    if (!combat) return [];
    if (preview && !ability) return []; // just the range while previewing
    if (ability) return targets.map((id) => combat.combatants[id]?.position).filter((cell): cell is Cell => !!cell);
    return [...moves.values()].map((reach) => reach.cell);
  }, [combat, ability, preview, targets, moves]);

  const chosen = ability ? system?.abilities.find((entry) => entry.id === ability) : undefined;
  const highlightKind = chosen ? abilityIntent(chosen) : 'move';

  const attack = (targetId: string) => {
    if (!actorId || !ability || !targets.includes(targetId)) return;
    act({ type: 'useAbility', actorId, abilityId: ability, targetId });
    setAbility(null);
  };

  const clickCell = (cell: Cell) => {
    if (!combat || !actorId) return;
    if (ability) {
      const target = targets.find((id) => {
        const position = combat.combatants[id]?.position;
        return position !== undefined && cellKey(position) === cellKey(cell);
      });
      if (target) attack(target);
      return;
    }
    if (moves.has(cellKey(cell))) act({ type: 'move', actorId, to: cell });
  };

  const pressedAt = useRef<{ x: number; y: number } | null>(null);

  return {
    context,
    actorId,
    ability,
    highlight,
    highlightKind,
    targets,
    reach,
    reachKind,
    previewAbility: setPreview,
    selectAbility(abilityId) {
      if (!actorId || !system) return;
      const definition = system.abilities.find((entry) => entry.id === abilityId);
      if (definition?.target === 'self') {
        act({ type: 'useAbility', actorId, abilityId, targetId: actorId });
        return;
      }
      setAbility((current) => (current === abilityId ? null : abilityId));
    },
    endTurn() {
      if (actorId) act({ type: 'endTurn', actorId });
    },
    onPointer(pointer) {
      if (pointer.type === 'cancel') {
        setAbility(null);
        return;
      }
      if (pointer.button !== 0) return;
      if (pointer.type === 'down') pressedAt.current = { x: pointer.x, y: pointer.y };
      if (pointer.type !== 'up' || !pressedAt.current) return;
      const moved = Math.hypot(pointer.x - pressedAt.current.x, pointer.y - pressedAt.current.y);
      pressedAt.current = null;
      if (moved <= CLICK_SLOP && pointer.cell) clickCell(pointer.cell);
    },
    onTokenClick: attack,
  };
}
