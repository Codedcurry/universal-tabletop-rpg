import type { AbilityDef } from './types';

/** Whether an ability hurts its target or helps it (for showing targets in matching colors). */
export type AbilityIntent = 'harm' | 'help';

/** Anything aimed at enemies, rolled as an attack, or dealing damage is harm; the rest is help. */
export function abilityIntent(ability: AbilityDef): AbilityIntent {
  if (ability.target === 'enemy' || ability.attack) return 'harm';
  return ability.effects.some((effect) => effect.type === 'damage') ? 'harm' : 'help';
}
