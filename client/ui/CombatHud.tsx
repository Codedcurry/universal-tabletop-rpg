import { type CSSProperties, useId } from 'react';
import { type CombatState, targetOptions } from '@shared/combat';
import { type GameSystem, abilityIntent, computeCreature, levelForXp } from '@shared/system';
import { placeholderStyle } from '../style/stylePack';
import type { CombatPlay } from './useCombatPlay';

// The combat bar for whoever may act now: HP, XP, moves left, a big button
// per ability, and End turn. Fixed to the bottom of the screen on phones.
// A line under it says what the map highlight means, in the same color:
// yellow where you can move, red who you can hurt, blue who you can help.

const HINTS = {
  move: { color: 'Yellow', text: ' tiles: where you can move. Tap one to go there.' },
  harm: { color: 'Red', text: ': who you can hit. Tap one, or its name tag.' },
  help: { color: 'Blue', text: ': who you can help. Tap one, or its name tag.' },
} as const;

/** The style pack's action colors, for the hint swatches and ability buttons. */
const actionColors = {
  '--move': placeholderStyle.actionColors.move,
  '--harm': placeholderStyle.actionColors.harm,
  '--help': placeholderStyle.actionColors.help,
} as CSSProperties;

function Meter({ label, value, max, description, tone }: {
  label: string;
  value: number;
  max: number;
  description: string;
  tone: 'hp' | 'xp';
}) {
  const id = useId();
  const share = max > 0 ? Math.max(0, Math.min(1, value / max)) : 1;
  return (
    <div className={`hud-meter ${tone}`}>
      <span className="hud-meter-label">{label}</span>
      <div
        className="hud-meter-track"
        role="meter"
        aria-label={label}
        aria-describedby={id}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
      >
        <div className={`hud-meter-fill${tone === 'hp' && share <= 0.35 ? ' low' : ''}`} style={{ width: `${share * 100}%` }} />
      </div>
      <span id={id} className="hud-meter-text">
        {description}
      </span>
    </div>
  );
}

export function CombatHud({ combat, system, play }: { combat: CombatState; system: GameSystem; play: CombatPlay }) {
  const { actorId, context } = play;
  const actor = actorId ? combat.combatants[actorId] : undefined;
  if (!actorId || !actor || !context) return null;

  const numbers = computeCreature(system, actor.sheet);
  const thresholds = system.levels.xpThresholds;
  const level = levelForXp(system, actor.sheet.xp);
  const floor = thresholds[level - 1] ?? 0;
  const next = thresholds[level];
  const abilities = system.abilities.filter((ability) => actor.sheet.abilities.includes(ability.id));
  const moves = combat.movementLeft;

  return (
    <section className="combat-hud" aria-label="Your turn" style={actionColors}>
      <div className="hud-who">
        <strong>{actor.sheet.name}</strong>
        <span data-testid="movement-left" className="muted">
          {moves === 1 ? '1 move left' : `${moves} moves left`}
        </span>
      </div>
      <div className="hud-meters">
        <Meter label="HP" value={actor.hp} max={numbers.maxHp} description={`${actor.hp} of ${numbers.maxHp}`} tone="hp" />
        {actor.isPlayerCharacter && (
          <Meter
            label="XP"
            value={actor.sheet.xp - floor}
            max={next === undefined ? 1 : next - floor}
            description={next === undefined ? 'max level' : `${actor.sheet.xp - floor} of ${next - floor} to level ${level + 1}`}
            tone="xp"
          />
        )}
      </div>
      <div className="hud-abilities">
        {abilities.map((ability) => {
          const usable = !combat.actionUsed && targetOptions(context, combat, actorId, ability.id).length > 0;
          return (
            <button
              key={ability.id}
              type="button"
              className={`hud-ability ${abilityIntent(ability)}`}
              aria-pressed={play.ability === ability.id}
              disabled={!usable}
              title={ability.description ?? `${ability.name} (range ${ability.range})`}
              onClick={() => play.selectAbility(ability.id)}
            >
              {ability.name}
            </button>
          );
        })}
        <button type="button" className="primary hud-end" onClick={play.endTurn}>
          End turn
        </button>
      </div>
      {(play.ability || (moves > 0 && play.highlight.length > 0)) && (
        <p className={`hud-hint ${play.highlightKind}`}>
          <span className="swatch" aria-hidden="true" />
          <span>
            <strong>{HINTS[play.highlightKind].color}</strong>
            {HINTS[play.highlightKind].text}
          </span>
        </p>
      )}
    </section>
  );
}
