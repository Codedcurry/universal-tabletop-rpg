import type { CombatAction, CombatState } from '@shared/combat';
import type { GameSystem } from '@shared/system';

// When a creature may react (an enemy leaving its reach, an attack about to
// hit it), the fight waits: whoever controls it (and the DM) picks a
// reaction or lets it go; everyone else sees who the fight is waiting for.

export function ReactionPrompt({
  combat,
  system,
  canControl,
  act,
}: {
  combat: CombatState;
  system: GameSystem;
  canControl(combatantId: string): boolean;
  act(action: CombatAction): void;
}) {
  const pending = combat.pending;
  const option = pending?.options[0];
  if (!pending || !option) return null;
  const name = (id: string) => combat.combatants[id]?.sheet.name ?? id;
  const reactor = name(option.reactorId);
  const what =
    pending.trigger === 'attacked' && pending.attack
      ? `${name(pending.triggerId)}'s ${system.abilities.find((ability) => ability.id === pending.attack?.abilityId)?.name ?? 'attack'} would hit ${reactor} (${pending.attack.total} vs defense ${pending.attack.defense}).`
      : `${name(pending.triggerId)} is leaving ${reactor}'s reach.`;

  if (!canControl(option.reactorId)) {
    return (
      <p className="reaction-wait" role="status" data-testid="reaction-wait">
        {what} Waiting for {reactor} to react…
      </p>
    );
  }
  return (
    <section className="reaction-prompt" role="group" aria-label={`${reactor} can react`}>
      <p>
        <strong>{reactor} can react.</strong> {what}
      </p>
      <div className="row">
        {option.abilityIds.map((abilityId) => {
          const ability = system.abilities.find((entry) => entry.id === abilityId);
          const defense = pending.trigger === 'attacked' ? ability?.reaction?.defense : undefined;
          return (
            <button key={abilityId} type="button" className="primary" onClick={() => act({ type: 'react', actorId: option.reactorId, abilityId })}>
              {ability?.name ?? abilityId}
              {defense ? ` (+${defense} defense)` : ''}
            </button>
          );
        })}
        <button type="button" onClick={() => act({ type: 'pass', actorId: option.reactorId })}>
          Don&apos;t react
        </button>
      </div>
    </section>
  );
}
