import { useEffect, useMemo, useState } from 'react';
import type { CombatAction, CombatEvent, CombatState, HouseRule } from '@shared/combat';
import type { Cell } from '@shared/grid';
import { type MapData, createWorldMap } from '@shared/map';
import type { GameSystem } from '@shared/system';
import type { CustomArt } from '@shared/style/art';
import { sounds } from '../audio/soundEngine';
import { CombatHud } from './CombatHud';
import { ReactionPrompt } from './ReactionPrompt';
import { useCombatPlay } from './useCombatPlay';
import { useFog } from './useFog';
import { WorldCanvas, mapSummary, tileDescription } from './WorldCanvas';

interface Props {
  readonly map: MapData | null;
  /** Where the DM last asked everyone to look. */
  readonly focus?: { readonly cell: Cell; readonly key: number } | null;
  readonly combat: CombatState | null;
  readonly system: GameSystem | null;
  readonly combatEvents: { readonly events: readonly CombatEvent[]; readonly key: number } | null;
  /** The DM turned on fog of war: see only what this player's creatures see. */
  readonly fogOfWar?: boolean;
  /** The DM's own art for the game. */
  readonly art?: CustomArt;
  /** The DM's house rules. */
  readonly houseRules?: readonly HouseRule[];
  canControl(combatantId: string): boolean;
  act(action: CombatAction): void;
  /** Asks the DM to allow something the rules refuse. */
  askRuling?(action: CombatAction): void;
}

/** A player's view of the map, updated live as the DM edits; the fight is played from here. */
export function MapViewer({ map, focus = null, combat, system, combatEvents, fogOfWar = false, art, houseRules, canControl, act, askRuling }: Props) {
  const [hovered, setHovered] = useState<Cell | null>(null);
  const world = useMemo(() => (map ? createWorldMap(map) : null), [map]);
  const play = useCombatPlay({ combat, system, map, ...(houseRules ? { houseRules } : {}), canControl, act });
  // A chime when one of this player's creatures gets its turn.
  const myTurn = play.actorId;
  useEffect(() => {
    if (myTurn) sounds.play('yourTurn');
  }, [myTurn]);
  const controlled = Object.keys(combat?.combatants ?? {}).filter(canControl);
  const { fog, hidden } = useFog(world, combat, fogOfWar, controlled);
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
        reach={play.reach}
        reachKind={play.reachKind}
        combat={combat}
        system={system}
        combatEvents={combatEvents}
        fog={fog}
        {...(art ? { art } : {})}
        hiddenTokens={hidden}
        targets={play.targets}
        onTokenClick={play.onTokenClick}
        onPointer={(pointer) => {
          setHovered(pointer.cell);
          play.onPointer(pointer);
        }}
      />
      {combat && system && <ReactionPrompt combat={combat} system={system} canControl={canControl} act={act} />}
      {combat && system && <CombatHud combat={combat} system={system} play={play} ruling={askRuling ? { ask: askRuling } : {}} />}
      <p className="hint">Drag to move the view · wheel or pinch to zoom · Q/E, the turn buttons, or a two-finger twist to turn</p>
      <p className="tile-info" data-testid="tile-info">
        {tileDescription(world, hovered, { fog })}
      </p>
    </div>
  );
}
