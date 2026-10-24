import type { Combatant } from '@shared/combat';
import type { SessionSnapshot } from '@shared/net';
import { computeCreature } from '@shared/system';

// The turn order at a glance. Actions are taken from the map and the combat
// bar (see CombatHud); this panel only shows who is up and how everyone is.

export function CombatPanel({ state }: { readonly state: SessionSnapshot }) {
  const combat = state.combat;
  const system = state.system;
  if (!combat || !system) return <p className="muted">No fight right now.</p>;

  const activeId = combat.order[combat.turnIndex] as string;
  const active = combat.combatants[activeId];

  return (
    <div className="combat">
      <p className="turn-banner" data-testid="turn-banner">
        {combat.status === 'setup'
          ? `Setting up · ${combat.order.length} ${combat.order.length === 1 ? 'creature' : 'creatures'} placed`
          : combat.status === 'ended'
            ? `Fight over · ${combat.winner ?? 'nobody'} won`
            : `Round ${combat.round} · ${active?.sheet.name}'s turn`}
      </p>

      <ol className="combatants" data-testid="turn-order">
        {combat.order.map((id) => {
          const combatant = combat.combatants[id] as Combatant;
          const maxHp = computeCreature(system, combatant.sheet).maxHp;
          return (
            <li key={id} className={combat.status === 'active' && id === activeId ? 'active' : undefined}>
              <span className="name">{combatant.sheet.name}</span>
              <span className="side">{combatant.side}</span>
              <span className="hp">{combatant.hp > 0 ? `${combatant.hp}/${maxHp} HP` : 'Down'}</span>
              {combatant.conditions.length > 0 && (
                <span className="conditions">{combatant.conditions.map((condition) => condition.id).join(', ')}</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
