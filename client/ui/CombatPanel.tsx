import type { CombatAction, Combatant } from '@shared/combat';
import { createGrid } from '@shared/grid';
import type { SessionSnapshot } from '@shared/net';
import { type AbilityDef, computeCreature } from '@shared/system';

// A text view of the fight until tokens and the map are rendered (steps 5-7).

interface Props {
  readonly state: SessionSnapshot;
  /** Whether this viewer may act for a combatant. */
  canAct(combatantId: string): boolean;
  onAction(action: CombatAction): void;
}

function validTargets(state: SessionSnapshot, ability: AbilityDef, actor: Combatant): Combatant[] {
  const combat = state.combat;
  if (!combat || !state.map) return [];
  const grid = createGrid(state.map.grid);
  return Object.values(combat.combatants).filter((target) => {
    if (ability.target === 'self') return target.sheet.id === actor.sheet.id;
    if (grid.distance(actor.position, target.position) > ability.range) return false;
    if (ability.target === 'enemy') return target.side !== actor.side && target.hp > 0;
    return target.side === actor.side;
  });
}

export function CombatPanel({ state, canAct, onAction }: Props) {
  const combat = state.combat;
  const system = state.system;
  if (!combat || !system) return <p className="muted">No fight right now.</p>;

  const activeId = combat.order[combat.turnIndex] as string;
  const active = combat.combatants[activeId];
  const myTurn = combat.status === 'active' && active !== undefined && canAct(activeId);
  const abilities = system.abilities.filter((ability) => active?.sheet.abilities.includes(ability.id));

  return (
    <div className="combat">
      <p className="turn-banner" data-testid="turn-banner">
        {combat.status === 'ended'
          ? `Fight over: ${combat.winner} win`
          : `Round ${combat.round} · ${active?.sheet.name}'s turn`}
      </p>

      <ul className="combatants">
        {combat.order.map((id) => {
          const combatant = combat.combatants[id] as Combatant;
          const maxHp = computeCreature(system, combatant.sheet).maxHp;
          return (
            <li key={id} className={id === activeId ? 'active' : undefined}>
              <span className="name">{combatant.sheet.name}</span>
              <span className="side">{combatant.side}</span>
              <span className="hp">
                {combatant.hp > 0 ? `${combatant.hp}/${maxHp} HP` : 'Down'}
              </span>
              {combatant.conditions.length > 0 && (
                <span className="conditions">{combatant.conditions.map((condition) => condition.id).join(', ')}</span>
              )}
            </li>
          );
        })}
      </ul>

      {myTurn && active && (
        <div className="actions">
          {!combat.actionUsed &&
            abilities.flatMap((ability) =>
              validTargets(state, ability, active).map((target) => (
                <button
                  key={`${ability.id}:${target.sheet.id}`}
                  type="button"
                  onClick={() =>
                    onAction({ type: 'useAbility', actorId: activeId, abilityId: ability.id, targetId: target.sheet.id })
                  }
                >
                  {ability.target === 'self' ? ability.name : `${ability.name} → ${target.sheet.name}`}
                </button>
              )),
            )}
          <button type="button" className="primary" onClick={() => onAction({ type: 'endTurn', actorId: activeId })}>
            End turn
          </button>
        </div>
      )}
    </div>
  );
}
