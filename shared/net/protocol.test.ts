import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, parseClientMessage } from './index';

// Everything a player's device sends is untrusted. parseClientMessage either
// returns a well-formed message or null; the DM ignores nulls.

const token = 'tok_abcdefghijklmnop';
const sheet = { id: 'hero', name: 'Ana', stats: { str: 14 }, xp: 0, abilities: ['strike'] };

describe('parseClientMessage', () => {
  it.each([
    ['hello', { type: 'hello', protocol: PROTOCOL_VERSION, token, name: 'Ana', character: sheet }],
    ['hello without a character', { type: 'hello', protocol: PROTOCOL_VERSION, token, name: 'Ana', character: null }],
    ['sync request', { type: 'syncRequest' }],
    ['move', { type: 'combatAction', requestId: 'r1', action: { type: 'move', actorId: 'pc-p1', to: { q: 1, r: -2 } } }],
    [
      'ability',
      {
        type: 'combatAction',
        requestId: 'r1',
        action: { type: 'useAbility', actorId: 'pc-p1', abilityId: 'strike', targetId: 'goblin' },
      },
    ],
    ['end turn', { type: 'combatAction', requestId: 'r1', action: { type: 'endTurn', actorId: 'pc-p1' } }],
    ['chat', { type: 'chat', requestId: 'r1', text: 'hello', to: null }],
    ['whisper', { type: 'chat', requestId: 'r1', text: 'psst', to: 'dm' }],
    ['roll', { type: 'roll', requestId: 'r1', notation: '2d6', mode: 'player', draws: [1, 4] }],
    ['physical roll', { type: 'roll', requestId: 'r1', notation: 'd20', mode: 'physical', draws: [19] }],
    ['roll request', { type: 'rollRequest', requestId: 'r1', notation: '1d20+2' }],
  ])('accepts a valid %s', (_name, message) => {
    expect(parseClientMessage(message)).toEqual(message);
  });

  it('drops unknown extra fields', () => {
    expect(parseClientMessage({ type: 'syncRequest', evil: true })).toEqual({ type: 'syncRequest' });
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['a string', 'hello'],
    ['an array', []],
    ['an unknown type', { type: 'becomeDm' }],
    ['a missing type', { token }],
    ['hello with a non-numeric protocol', { type: 'hello', protocol: '1', token, name: 'Ana', character: null }],
    ['hello with a short token', { type: 'hello', protocol: 1, token: 'abc', name: 'Ana', character: null }],
    ['hello with a token containing odd characters', { type: 'hello', protocol: 1, token: 'tok abc!defghijklmn', name: 'Ana', character: null }],
    ['hello with a non-string name', { type: 'hello', protocol: 1, token, name: 7, character: null }],
    ['hello with a huge name', { type: 'hello', protocol: 1, token, name: 'x'.repeat(201), character: null }],
    ['hello with a malformed character', { type: 'hello', protocol: 1, token, name: 'Ana', character: { ...sheet, xp: -1 } }],
    ['hello with fractional stats', { type: 'hello', protocol: 1, token, name: 'Ana', character: { ...sheet, stats: { str: 1.5 } } }],
    ['hello with non-string abilities', { type: 'hello', protocol: 1, token, name: 'Ana', character: { ...sheet, abilities: [1] } }],
    ['an action with an unknown type', { type: 'combatAction', requestId: 'r1', action: { type: 'win', actorId: 'a' } }],
    ['a move without a destination', { type: 'combatAction', requestId: 'r1', action: { type: 'move', actorId: 'a' } }],
    ['a move to a fractional cell', { type: 'combatAction', requestId: 'r1', action: { type: 'move', actorId: 'a', to: { q: 0.5, r: 0 } } }],
    ['an ability without a target', { type: 'combatAction', requestId: 'r1', action: { type: 'useAbility', actorId: 'a', abilityId: 'x' } }],
    ['an action without a request id', { type: 'combatAction', action: { type: 'endTurn', actorId: 'a' } }],
    ['empty chat', { type: 'chat', requestId: 'r1', text: '   ', to: null }],
    ['oversized chat', { type: 'chat', requestId: 'r1', text: 'x'.repeat(1001), to: null }],
    ['chat with a bad recipient', { type: 'chat', requestId: 'r1', text: 'hi', to: 5 }],
    ['a roll with an unknown mode', { type: 'roll', requestId: 'r1', notation: 'd6', mode: 'loaded', draws: [5] }],
    ['a roll with non-integer draws', { type: 'roll', requestId: 'r1', notation: 'd6', mode: 'player', draws: [2.5] }],
    ['a roll with too many draws', { type: 'roll', requestId: 'r1', notation: 'd6', mode: 'player', draws: new Array(5001).fill(0) }],
    ['a roll with oversized notation', { type: 'roll', requestId: 'r1', notation: 'd6+'.repeat(100), mode: 'player', draws: [] }],
  ])('rejects %s', (_name, message) => {
    expect(parseClientMessage(message)).toBeNull();
  });
});

it('accepts a heartbeat reply', () => {
  expect(parseClientMessage({ type: 'pong' })).toEqual({ type: 'pong' });
});
