import type { CombatEvent } from './types';

/** One line for the log. Actions go to the Game log; turns and rounds to General. */
export interface CombatLine {
  readonly channel: 'game' | 'general';
  /** For color-coding. */
  readonly tone: 'action' | 'damage' | 'heal' | 'info' | 'xp';
  readonly text: string;
}

export interface DescribeContext {
  nameOf(combatantId: string): string;
  abilityName(abilityId: string): string;
  conditionName(conditionId: string): string;
  /** A resource's name ("Mana"); its id if left out. */
  resourceName?(resourceId: string): string;
  /** What the DM calls themselves (defaults to "DM"). */
  readonly dmTitle?: string;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** How an attack roll went: hit or miss, and whether the natural roll made it critical. */
function outcome(event: { readonly hit: boolean; readonly critical?: 'hit' | 'miss' }): string {
  if (event.critical === 'hit') return 'critical hit!';
  if (event.critical === 'miss') return 'critical miss';
  return event.hit ? 'hit' : 'miss';
}

/** Turns the events of a combat action into readable log lines. */
export function describeCombatEvents(events: readonly CombatEvent[], context: DescribeContext): CombatLine[] {
  const { nameOf, abilityName, conditionName } = context;
  const resourceName = (id: string) => context.resourceName?.(id) ?? id;
  const dm = context.dmTitle ?? 'DM';
  const lines: CombatLine[] = [];
  const game = (text: string, tone: CombatLine['tone'] = 'info') => lines.push({ channel: 'game', tone, text });
  const general = (text: string) => lines.push({ channel: 'general', tone: 'info', text });

  events.forEach((event, index) => {
    switch (event.type) {
      case 'abilityUsed': {
        const ability = abilityName(event.abilityId);
        const next = events[index + 1];
        if (next?.type === 'attackRolled' && next.actorId === event.actorId) {
          // The attack roll is reported with the ability, as one line.
          game(
            `${nameOf(event.actorId)}'s ${ability} on ${nameOf(event.targetId)}: ${next.total} vs defense ${next.defense}, ${outcome(next)}`,
            'action',
          );
        } else if (event.targetId === event.actorId) {
          game(`${nameOf(event.actorId)} uses ${ability}`, 'action');
        } else {
          game(`${nameOf(event.actorId)} uses ${ability} on ${nameOf(event.targetId)}`, 'action');
        }
        break;
      }
      case 'attackRolled': {
        const previous = events[index - 1];
        if (previous?.type === 'abilityUsed' && previous.actorId === event.actorId) break; // already reported
        game(`${nameOf(event.actorId)} attacks ${nameOf(event.targetId)}: ${event.total} vs defense ${event.defense}, ${outcome(event)}`, 'action');
        break;
      }
      case 'damaged':
        game(`${nameOf(event.targetId)} takes ${event.amount} damage (${event.hp} HP left)`, 'damage');
        break;
      case 'resourceSpent':
        game(`${nameOf(event.combatantId)} spends ${event.amount} ${resourceName(event.resource)} (${event.left} left)`);
        break;
      case 'resourceRestored':
        game(`${nameOf(event.targetId)} regains ${event.amount} ${resourceName(event.resource)} (${event.left})`, 'heal');
        break;
      case 'healed':
        game(`${nameOf(event.targetId)} heals ${event.amount} (${event.hp} HP)`, 'heal');
        break;
      case 'downed':
        game(`${nameOf(event.targetId)} is down!`, 'damage');
        break;
      case 'revived':
        game(`${nameOf(event.targetId)} is back on their feet`, 'heal');
        break;
      case 'conditionApplied':
        game(`${nameOf(event.targetId)} is ${conditionName(event.conditionId)} for ${plural(event.rounds, 'round')}`);
        break;
      case 'conditionExpired':
        game(`${nameOf(event.targetId)} is no longer ${conditionName(event.conditionId)}`);
        break;
      case 'moved':
        game(`${nameOf(event.combatantId)} moves ${plural(event.cost, 'tile')}`);
        break;
      case 'initiativeRolled':
        game(`${nameOf(event.combatantId)} rolls ${event.total} for initiative`);
        break;
      case 'combatStarted':
        game(`The fight begins! Turn order: ${event.order.map(nameOf).join(', ')}`);
        break;
      case 'roundStarted':
        general(`Round ${event.round}`);
        break;
      case 'turnStarted':
        general(`${nameOf(event.combatantId)}'s turn`);
        break;
      case 'turnEnded':
        break;
      case 'combatEnded':
        game(`The fight is over: ${event.winner} wins`);
        break;
      case 'xpGained':
        game(`${nameOf(event.combatantId)} gains ${event.amount} XP (${event.xp} total)`, 'xp');
        break;
      case 'levelUp':
        game(`${nameOf(event.combatantId)} reaches level ${event.level}!`, 'xp');
        break;
      case 'combatantAdded':
        game(`${dm} adds ${nameOf(event.combatantId)}`);
        break;
      case 'combatantRemoved':
        game(`${dm} removes ${event.name}`);
        break;
      case 'combatantPlaced':
        game(`${dm} moves ${nameOf(event.combatantId)}`);
        break;
      case 'combatantRenamed':
        game(`${dm} renames ${event.from} to ${event.to}`);
        break;
      case 'combatantEdited':
        game(`${dm} changes ${nameOf(event.combatantId)}: ${event.changes.join(', ')}`);
        break;
      case 'turnOrderChanged':
        game(`${dm} changes the turn order: ${event.order.map(nameOf).join(', ')}`);
        break;
    }
  });
  return lines;
}
