import { useMemo, useRef } from 'react';
import type { CombatState } from '@shared/combat';
import { cellKey } from '@shared/grid';
import type { WorldMap } from '@shared/map';
import { VISION_RANGE, sightOf } from '@shared/vision';

// Fog of war for one player: what the creatures they control can see right
// now, what they have seen before (remembered, dimmed), and which creatures
// are out of sight. The DM always sees everything.
//
// It is worked out in the player's browser from the full game state, so it
// hides things on screen but isn't secret from someone digging in the
// browser's developer tools; fine for a table of friends.

export interface Fog {
  readonly visible: ReadonlySet<string>;
  readonly explored: ReadonlySet<string>;
}

const NOBODY: ReadonlySet<string> = new Set();

export function useFog(
  world: WorldMap | null,
  combat: CombatState | null,
  on: boolean,
  controlled: readonly string[],
): { fog: Fog | null; hidden: ReadonlySet<string> } {
  const explored = useRef(new Set<string>());
  const controlledKey = controlled.join('\n');
  return useMemo(() => {
    if (!on || !world) return { fog: null, hidden: NOBODY };
    const mine = new Set(controlled);
    const viewers = Object.entries(combat?.combatants ?? {})
      .filter(([id]) => mine.has(id))
      .map(([, combatant]) => combatant.position);
    const visible = new Set(sightOf(world, viewers, VISION_RANGE));
    for (const key of visible) explored.current.add(key);
    const hidden = new Set(
      Object.entries(combat?.combatants ?? {})
        .filter(([id, combatant]) => !mine.has(id) && !visible.has(cellKey(combatant.position)))
        .map(([id]) => id),
    );
    return { fog: { visible, explored: new Set(explored.current) }, hidden };
    // `controlledKey` stands for `controlled`, which is a fresh array each render.
  }, [on, world, combat, controlledKey]);
}
