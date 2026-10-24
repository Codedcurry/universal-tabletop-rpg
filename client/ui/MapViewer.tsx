import { useMemo, useState } from 'react';
import type { CombatAction, CombatEvent, CombatState } from '@shared/combat';
import type { Cell } from '@shared/grid';
import { type MapData, createWorldMap } from '@shared/map';
import type { GameSystem } from '@shared/system';
import { CombatHud } from './CombatHud';
import { useCombatPlay } from './useCombatPlay';
import { WorldCanvas, mapSummary, tileDescription } from './WorldCanvas';

interface Props {
  readonly map: MapData | null;
  /** Where the DM last asked everyone to look. */
  readonly focus?: { readonly cell: Cell; readonly key: number } | null;
  readonly combat: CombatState | null;
  readonly system: GameSystem | null;
  readonly combatEvents: { readonly events: readonly CombatEvent[]; readonly key: number } | null;
  canControl(combatantId: string): boolean;
  act(action: CombatAction): void;
}

/** A player's view of the map, updated live as the DM edits; the fight is played from here. */
export function MapViewer({ map, focus = null, combat, system, combatEvents, canControl, act }: Props) {
  const [hovered, setHovered] = useState<Cell | null>(null);
  const world = useMemo(() => (map ? createWorldMap(map) : null), [map]);
  const play = useCombatPlay({ combat, system, map, canControl, act });
  if (!map || !world) return <p className="muted">The DM hasn't made a map yet.</p>;
  return (
    <div className="map-view">
      <p className="map-summary" data-testid="map-summary">
        {mapSummary(map)}
      </p>
      <WorldCanvas
        map={map}
        editing={false}
        focus={focus}
        highlight={play.highlight}
        highlightKind={play.highlightKind}
        combat={combat}
        system={system}
        combatEvents={combatEvents}
        targets={play.targets}
        onTokenClick={play.onTokenClick}
        onPointer={(pointer) => {
          setHovered(pointer.cell);
          play.onPointer(pointer);
        }}
      />
      {combat && system && <CombatHud combat={combat} system={system} play={play} />}
      <p className="hint">Drag to move the view · wheel or pinch to zoom · Q/E, the turn buttons, or a two-finger twist to turn</p>
      <p className="tile-info" data-testid="tile-info">
        {tileDescription(world, hovered)}
      </p>
    </div>
  );
}
