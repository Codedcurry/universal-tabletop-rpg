import { type CSSProperties, useId, useState } from 'react';
import { type CombatAction, type CombatState, describeHouseRule, resourceLeft } from '@shared/combat';
import { type GameSystem, abilityIntent, computeCreature, levelForXp } from '@shared/system';
import { placeholderStyle } from '../style/stylePack';
import type { CombatPlay, Refusal } from './useCombatPlay';

// The combat bar for whoever may act now: HP, XP, moves left, a big button
// per ability, and End turn. Fixed to the bottom of the screen on phones.
// A line under it says what the map highlight means, in the same color:
// yellow where you can move, red who you can hurt, blue who you can help.
// Something the rules refuse is explained under it: the DM can allow it
// once or make it a house rule; a player can ask the DM.

const HINTS = {
  move: { color: 'Yellow', text: ' tiles: where you can move. Tap one to go there.' },
  harm: { color: 'Red', text: ': who you can hit (shaded: the range). Tap one, or its name tag.' },
  help: { color: 'Blue', text: ': who you can help (shaded: the range). Tap one, or its name tag.' },
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
  tone: 'hp' | 'xp' | 'resource';
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

/** How the viewer can answer a refusal: the DM overrules it, a player asks the DM. */
export interface RulingHandlers {
  overrule?(action: CombatAction, always: boolean): void;
  ask?(action: CombatAction): void;
}

/** Why the rules refuse what was just tried, and what the viewer can do about it. */
function RefusalBox({ refusal, system, ruling, onDismiss }: { refusal: Refusal; system: GameSystem; ruling: RulingHandlers; onDismiss(): void }) {
  const [asked, setAsked] = useState(false);
  const fixable = refusal.problems.every((problem) => problem.fix !== null);
  const kept = refusal.problems.filter((problem) => problem.fix && !problem.nowOnly).map((problem) => describeHouseRule(problem.fix!, system));
  return (
    <div className="hud-refusal" role="alert" aria-label="Not allowed">
      <p>
        <strong>Not by the rules:</strong> {refusal.problems.map((problem) => problem.message).join('; ')}.
      </p>
      <div className="row">
        {fixable && ruling.overrule && (
          <>
            <button type="button" onClick={() => ruling.overrule?.(refusal.action, false)}>
              Allow just this once
            </button>
            {kept.length > 0 && (
              <button type="button" className="primary" onClick={() => ruling.overrule?.(refusal.action, true)}>
                Make it a house rule: {kept.join('; ')}
              </button>
            )}
          </>
        )}
        {fixable &&
          ruling.ask &&
          (asked ? (
            <span className="muted" role="status">
              Asked the DM: their answer will show in the log.
            </span>
          ) : (
            <button
              type="button"
              className="primary"
              onClick={() => {
                ruling.ask?.(refusal.action);
                setAsked(true);
              }}
            >
              Ask the DM
            </button>
          ))}
        <button type="button" onClick={onDismiss}>
          {fixable && !asked ? 'Never mind' : 'OK'}
        </button>
      </div>
    </div>
  );
}

export function CombatHud({ combat, system, play, ruling = {} }: { combat: CombatState; system: GameSystem; play: CombatPlay; ruling?: RulingHandlers }) {
  const { actorId, context } = play;
  const actor = actorId ? combat.combatants[actorId] : undefined;
  if (!actorId || !actor || !context) return null;

  const numbers = computeCreature(system, actor.sheet);
  const thresholds = system.levels.xpThresholds;
  const level = levelForXp(system, actor.sheet.xp);
  const floor = thresholds[level - 1] ?? 0;
  const next = thresholds[level];
  // Reactions aren't actions: they're listed apart, ready or used this round.
  const known = system.abilities.filter((ability) => actor.sheet.abilities.includes(ability.id));
  const abilities = known.filter((ability) => !ability.reaction);
  const reactions = known.filter((ability) => ability.reaction);
  const moves = combat.movementLeft;
  const chosen = play.ability ? abilities.find((ability) => ability.id === play.ability) : undefined;

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
        {(system.resources ?? []).map((resource) => {
          const max = numbers.resources[resource.id] ?? 0;
          const left = resourceLeft(system, actor, resource.id);
          return <Meter key={resource.id} label={resource.name} value={left} max={max} description={`${left} of ${max}`} tone="resource" />;
        })}
      </div>
      <div className="hud-abilities">
        {abilities.map((ability) => {
          // Pickable whenever the action is free, even with nobody in reach (picking shows the range) or held
          // by a condition (picking says why not, for the DM to overrule).
          const short = Object.entries(ability.cost ?? {}).find(([id, amount]) => resourceLeft(system, actor, id) < amount);
          const usable = !combat.actionUsed && !short;
          return (
            <button
              key={ability.id}
              type="button"
              className={`hud-ability ${abilityIntent(ability)}`}
              aria-pressed={play.ability === ability.id}
              disabled={!usable}
              title={
                short
                  ? `Not enough ${system.resources?.find((resource) => resource.id === short[0])?.name ?? short[0]}`
                  : (ability.description ?? `${ability.name} (range ${ability.range})`)
              }
              onClick={() => play.selectAbility(ability.id)}
              // Hovering or focusing an ability previews its range on the map.
              onPointerEnter={() => play.previewAbility(ability.id)}
              onPointerLeave={() => play.previewAbility(null)}
              onFocus={() => play.previewAbility(ability.id)}
              onBlur={() => play.previewAbility(null)}
            >
              {ability.name}
              <small className="hud-range">
                {[
                  ability.target === 'self' ? 'self' : `range ${ability.range}`,
                  ...Object.entries(ability.cost ?? {}).map(([id, amount]) => `${amount} ${system.resources?.find((resource) => resource.id === id)?.name ?? id}`),
                ].join(' · ')}
              </small>
            </button>
          );
        })}
        <button type="button" className="primary hud-end" onClick={play.endTurn}>
          End turn
        </button>
      </div>
      {reactions.length > 0 && (
        <p className="hud-reactions muted small" data-testid="reactions">
          Reactions ({actor.reactionUsed ? 'used this round' : 'ready'}): {reactions.map((ability) => ability.name).join(', ')}
        </p>
      )}
      {play.refusal && <RefusalBox key={JSON.stringify(play.refusal.action)} refusal={play.refusal} system={system} ruling={ruling} onDismiss={play.dismissRefusal} />}
      {chosen && play.targets.length === 0 ? (
        <p className={`hud-hint ${play.reachKind}`}>
          <span className="swatch" aria-hidden="true" />
          <span>
            <strong>{HINTS[play.reachKind].color} shading</strong>: {chosen.name}'s range ({chosen.range === 1 ? '1 tile' : `${chosen.range} tiles`}). Nobody is in range: move closer, pick another, or click a creature to see why not.
          </span>
        </p>
      ) : (play.ability || (moves > 0 && play.highlight.length > 0)) && (
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
