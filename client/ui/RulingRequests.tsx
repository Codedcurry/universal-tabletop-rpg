import { useState } from 'react';
import { type CombatAction, describeHouseRule } from '@shared/combat';
import type { HostSession, PendingRuling } from '@shared/net';

// Players asking the DM to allow something the rules refuse, shown above the
// DM's map until answered: allow it just once, make it a house rule, or no.

/** What a player wants to do, in words: "Ana the Bold: Strike on Goblin". */
function describeAction(action: CombatAction, session: HostSession): string {
  const { combat, system } = session.snapshot();
  const name = (id: string) => combat?.combatants[id]?.sheet.name ?? id;
  switch (action.type) {
    case 'move':
      return `${name(action.actorId)}: move`;
    case 'useAbility': {
      const ability = system?.abilities.find((entry) => entry.id === action.abilityId)?.name ?? action.abilityId;
      return action.targetId === action.actorId ? `${name(action.actorId)}: ${ability}` : `${name(action.actorId)}: ${ability} on ${name(action.targetId)}`;
    }
    case 'endTurn':
      return `${name(action.actorId)}: end turn`;
    case 'react':
      return `${name(action.actorId)}: react`;
    case 'pass':
      return `${name(action.actorId)}: don't react`;
  }
}

export function RulingRequests({ session }: { session: HostSession }) {
  const requests = session.pendingRulings();
  const [error, setError] = useState<string | null>(null);
  if (requests.length === 0 && !error) return null;
  const system = session.snapshot().system;

  function answer(request: PendingRuling, choice: 'once' | 'always' | 'no') {
    const result = session.answerRuling(request.id, choice);
    setError(choice === 'no' || result.ok ? null : result.reason);
  }

  return (
    <section className="ruling-requests" aria-label="Players asking for a ruling">
      {requests.map((request) => {
        const kept = request.problems.filter((problem) => problem.fix && !problem.nowOnly).map((problem) => describeHouseRule(problem.fix!, system));
        return (
          <div key={request.id} className="ruling-request" role="group" aria-label={`${request.playerName} asks`}>
            <p>
              <strong>{request.playerName} asks to allow it.</strong> {describeAction(request.action, session)}.{' '}
              <span className="muted">Not by the rules: {request.problems.map((problem) => problem.message).join('; ')}.</span>
            </p>
            <div className="row">
              <button type="button" onClick={() => answer(request, 'once')}>
                Allow just this once
              </button>
              {kept.length > 0 && (
                <button type="button" className="primary" onClick={() => answer(request, 'always')}>
                  Make it a house rule: {kept.join('; ')}
                </button>
              )}
              <button type="button" onClick={() => answer(request, 'no')}>
                No
              </button>
            </div>
          </div>
        );
      })}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
