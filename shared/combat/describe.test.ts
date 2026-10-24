import { describe as group, expect, it } from 'vitest';
import { type CombatEvent, describeCombatEvents } from './index';

// Combat events as lines for the log: actions go to the Game log, turn and
// round changes to General.

const names: Record<string, string> = { ana: 'Ana', g1: 'Goblin 1', cleric: 'Cleric' };
const context = {
  nameOf: (id: string) => names[id] ?? id,
  abilityName: (id: string) => ({ strike: 'Strike', mend: 'Mend', second_wind: 'Second Wind' })[id] ?? id,
  conditionName: (id: string) => (id === 'stunned' ? 'Stunned' : id),
};
const lines = (events: CombatEvent[]) => describeCombatEvents(events, context);

group('describeCombatEvents', () => {
  it('reports an attack: the roll against defense, then the damage', () => {
    expect(
      lines([
        { type: 'abilityUsed', actorId: 'ana', abilityId: 'strike', targetId: 'g1', animation: 'melee' },
        { type: 'attackRolled', actorId: 'ana', targetId: 'g1', total: 15, defense: 12, hit: true, dice: [] },
        { type: 'damaged', targetId: 'g1', amount: 5, hp: 3, dice: [] },
      ]),
    ).toEqual([
      { channel: 'game', tone: 'action', text: "Ana's Strike on Goblin 1: 15 vs defense 12, hit" },
      { channel: 'game', tone: 'damage', text: 'Goblin 1 takes 5 damage (3 HP left)' },
    ]);
  });

  it('reports a miss', () => {
    expect(
      lines([
        { type: 'abilityUsed', actorId: 'ana', abilityId: 'strike', targetId: 'g1', animation: 'melee' },
        { type: 'attackRolled', actorId: 'ana', targetId: 'g1', total: 7, defense: 12, hit: false, dice: [] },
      ]),
    ).toEqual([{ channel: 'game', tone: 'action', text: "Ana's Strike on Goblin 1: 7 vs defense 12, miss" }]);
  });

  it('reports abilities without an attack roll, on others and on yourself', () => {
    expect(
      lines([
        { type: 'abilityUsed', actorId: 'ana', abilityId: 'mend', targetId: 'cleric', animation: 'spell' },
        { type: 'healed', targetId: 'cleric', amount: 7, hp: 9, dice: [] },
        { type: 'abilityUsed', actorId: 'ana', abilityId: 'second_wind', targetId: 'ana', animation: 'item' },
      ]).map((line) => line.text),
    ).toEqual(['Ana uses Mend on Cleric', 'Cleric heals 7 (9 HP)', 'Ana uses Second Wind']);
  });

  it('reports going down, getting up, and conditions', () => {
    expect(
      lines([
        { type: 'downed', targetId: 'g1' },
        { type: 'revived', targetId: 'cleric' },
        { type: 'conditionApplied', targetId: 'g1', conditionId: 'stunned', rounds: 1 },
        { type: 'conditionApplied', targetId: 'g1', conditionId: 'stunned', rounds: 2 },
        { type: 'conditionExpired', targetId: 'g1', conditionId: 'stunned' },
      ]).map((line) => line.text),
    ).toEqual([
      'Goblin 1 is down!',
      'Cleric is back on their feet',
      'Goblin 1 is Stunned for 1 round',
      'Goblin 1 is Stunned for 2 rounds',
      'Goblin 1 is no longer Stunned',
    ]);
  });

  it('reports movement', () => {
    expect(lines([{ type: 'moved', combatantId: 'ana', path: [], cost: 3 }])).toEqual([
      { channel: 'game', tone: 'info', text: 'Ana moves 3 tiles' },
    ]);
    expect(lines([{ type: 'moved', combatantId: 'ana', path: [], cost: 1 }])[0]?.text).toBe('Ana moves 1 tile');
  });

  it('reports the start of a fight: initiative and turn order', () => {
    expect(
      lines([
        { type: 'initiativeRolled', combatantId: 'ana', total: 15, dice: [] },
        { type: 'initiativeRolled', combatantId: 'g1', total: 9, dice: [] },
        { type: 'combatStarted', order: ['ana', 'g1'] },
      ]),
    ).toEqual([
      { channel: 'game', tone: 'info', text: 'Ana rolls 15 for initiative' },
      { channel: 'game', tone: 'info', text: 'Goblin 1 rolls 9 for initiative' },
      { channel: 'game', tone: 'info', text: 'The fight begins! Turn order: Ana, Goblin 1' },
    ]);
  });

  it('puts round and turn changes in General', () => {
    expect(
      lines([
        { type: 'turnEnded', combatantId: 'ana' },
        { type: 'roundStarted', round: 2 },
        { type: 'turnStarted', combatantId: 'g1', round: 2 },
      ]),
    ).toEqual([
      { channel: 'general', tone: 'info', text: 'Round 2' },
      { channel: 'general', tone: 'info', text: "Goblin 1's turn" },
    ]);
  });

  it('reports the end of a fight and the rewards', () => {
    expect(
      lines([
        { type: 'combatEnded', winner: 'party' },
        { type: 'xpGained', combatantId: 'ana', amount: 50, xp: 350 },
        { type: 'levelUp', combatantId: 'ana', level: 2 },
      ]),
    ).toEqual([
      { channel: 'game', tone: 'info', text: 'The fight is over: party wins' },
      { channel: 'game', tone: 'xp', text: 'Ana gains 50 XP (350 total)' },
      { channel: 'game', tone: 'xp', text: 'Ana reaches level 2!' },
    ]);
  });
});

group("the DM's changes", () => {
  const dm = { ...context, dmTitle: 'Keeper' };
  it('are recorded in the Game log under the DM\'s chosen title', () => {
    expect(
      describeCombatEvents(
        [
          { type: 'combatantAdded', combatantId: 'g1' },
          { type: 'combatantRemoved', combatantId: 'gone', name: 'Goblin 2' },
          { type: 'combatantPlaced', combatantId: 'ana', to: { q: 1, r: 1 } },
          { type: 'combatantRenamed', combatantId: 'g1', from: 'Goblin 1', to: 'Grizzle' },
          { type: 'combatantEdited', combatantId: 'g1', changes: ['HP 8 → 3', 'Strength 8 → 12'] },
          { type: 'turnOrderChanged', order: ['g1', 'ana'] },
        ],
        dm,
      ),
    ).toEqual([
      { channel: 'game', tone: 'info', text: 'Keeper adds Goblin 1' },
      { channel: 'game', tone: 'info', text: 'Keeper removes Goblin 2' },
      { channel: 'game', tone: 'info', text: 'Keeper moves Ana' },
      { channel: 'game', tone: 'info', text: 'Keeper renames Goblin 1 to Grizzle' },
      { channel: 'game', tone: 'info', text: 'Keeper changes Goblin 1: HP 8 → 3, Strength 8 → 12' },
      { channel: 'game', tone: 'info', text: 'Keeper changes the turn order: Goblin 1, Ana' },
    ]);
  });

  it('say "DM" when no title is given', () => {
    expect(describeCombatEvents([{ type: 'combatantAdded', combatantId: 'g1' }], context)[0]?.text).toBe('DM adds Goblin 1');
  });
});
