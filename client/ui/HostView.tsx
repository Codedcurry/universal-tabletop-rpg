import { type FormEvent, useEffect, useRef, useState } from 'react';
import { type CombatEvent } from '@shared/combat';
import { type Cell, cellKey } from '@shared/grid';
import type { RollMode } from '@shared/net';
import { demoFight, demoMap, demoSystem } from '../demo';
import type { HostedGame } from '../net/transport';
import { CombatPanel } from './CombatPanel';
import { DiceRollAnimation } from './DiceRollAnimation';
import { EncounterPanel, type Placing } from './EncounterPanel';
import { LogPanel } from './LogPanel';
import { MapEditor } from './MapEditor';
import { Players } from './Players';

// The DM's page: the map front and center, the DM tools beside it grouped in
// tabs (Encounter, Map, Session) and hideable, then the turn order and log.

const ROLL_MODES: { value: RollMode; label: string }[] = [
  { value: 'player', label: 'Players roll on their device' },
  { value: 'dmVerified', label: 'DM rolls for everyone' },
  { value: 'physical', label: 'Players use real dice' },
];

type Tab = 'encounter' | 'map' | 'session';
const TABS: { id: Tab; label: string }[] = [
  { id: 'encounter', label: 'Encounter' },
  { id: 'map', label: 'Map' },
  { id: 'session', label: 'Session' },
];

interface Props {
  readonly game: HostedGame;
  readonly combatEvents: { readonly events: readonly CombatEvent[]; readonly key: number } | null;
}

export function HostView({ game, combatEvents }: Props) {
  const { session, code } = game;
  const state = session.snapshot();
  const [title, setTitle] = useState(state.dmTitle);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<Tab>('map');
  const [toolsOpen, setToolsOpen] = useState(true);
  const [toolsSlot, setToolsSlot] = useState<HTMLElement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [encounterError, setEncounterError] = useState<string | null>(null);
  const link = `${location.origin}${location.pathname}?room=${code}`;

  // The game system the encounter tools offer creatures from (a sample one until game system entry, step 15).
  useEffect(() => {
    if (!session.snapshot().system) session.setSystem(demoSystem);
  }, [session]);

  // When a fight starts while the DM is editing the map, show the encounter.
  const fighting = state.combat?.status === 'active';
  useEffect(() => {
    if (fighting) setTab((current) => (current === 'map' ? 'encounter' : current));
  }, [fighting]);

  // Placing or moving a creature needs a click on the map: bring it into view.
  const mapCard = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!placing || !mapCard.current) return;
    const box = mapCard.current.getBoundingClientRect();
    if (box.top < 0 || box.bottom > window.innerHeight) mapCard.current.scrollIntoView({ block: 'nearest' });
  }, [placing]);

  /** Runs a DM command, showing any problem instead of crashing. */
  function attempt(command: () => void) {
    try {
      command();
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function saveTitle(event: FormEvent) {
    event.preventDefault();
    attempt(() => session.setDmTitle(title));
  }

  function startDemoFight() {
    attempt(() => {
      session.setSystem(demoSystem);
      if (!session.snapshot().map) session.setMap(demoMap);
      session.startCombat(demoFight(session));
    });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setError('Copy failed: select the link and copy it by hand');
    }
  }

  /** Map clicks outside the map tools: place or move a creature, or select the one clicked. */
  function onMapClick(cell: Cell): boolean {
    if (placing) {
      const result =
        placing.kind === 'new'
          ? session.addCreature({ ...placing.setup, position: cell })
          : session.placeCreature(placing.id, cell);
      if (result.ok) {
        setSelectedId(placing.kind === 'new' ? placing.setup.sheet.id : placing.id);
        setPlacing(null);
        setEncounterError(null);
      } else {
        setEncounterError(result.reason);
      }
      return true;
    }
    const clicked = Object.entries(state.combat?.combatants ?? {}).find(
      ([, combatant]) => cellKey(combatant.position) === cellKey(cell),
    );
    if (clicked) setSelectedId(clicked[0]);
    return false; // the fight still gets the click (moving, targeting)
  }

  const editing = toolsOpen && tab === 'map';

  return (
    <div className="page dm-page">
      <DiceRollAnimation
        log={state.log}
        nameOf={(id) => (id === 'dm' ? state.dmTitle : (state.players.find((player) => player.id === id)?.name ?? id))}
      />
      <header className="card room">
        <div>
          <p className="muted">Room code</p>
          <p className="room-code" data-testid="room-code">
            {code}
          </p>
        </div>
        <div className="grow">
          <p className="muted">Players join with this link</p>
          <p className="join-link" data-testid="join-link">
            {link}
          </p>
          <button type="button" onClick={copyLink}>
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
      </header>

      <div className={`dm-layout${toolsOpen ? '' : ' tools-hidden'}`}>
        <section className="card map-card" ref={mapCard}>
          <h2>Map</h2>
          <MapEditor
            session={session}
            combatEvents={combatEvents}
            editing={editing}
            toolsSlot={toolsSlot}
            onMapClick={onMapClick}
            mapOverlay={
              placing ? (
                <div className="stroke-hint" role="status">
                  <span>
                    {placing.kind === 'new' ? `Click a tile to place ${placing.label}` : `Click a tile to move ${placing.label}`}
                  </span>
                  <button type="button" onClick={() => setPlacing(null)}>
                    Cancel
                  </button>
                </div>
              ) : null
            }
          />
        </section>

        <aside className="card dm-tools" aria-label="DM tools">
          <div className="dm-tools-head">
            <h2>DM tools</h2>
            <button type="button" aria-expanded={toolsOpen} onClick={() => setToolsOpen((open) => !open)}>
              {toolsOpen ? 'Hide DM tools' : 'Show DM tools'}
            </button>
          </div>
          <div hidden={!toolsOpen}>
            <div className="dm-tabs" role="tablist" aria-label="DM tools">
              {TABS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === entry.id}
                  onClick={() => setTab(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>

            <div role="tabpanel" aria-label="Encounter" hidden={tab !== 'encounter'}>
              {encounterError && (
                <p className="error" role="alert">
                  {encounterError}
                </p>
              )}
              <EncounterPanel
                session={session}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onPlace={setPlacing}
                onError={setEncounterError}
              />
            </div>

            {/* The map editor renders its tools here, keeping their state while hidden. */}
            <div role="tabpanel" aria-label="Map" hidden={tab !== 'map'} ref={setToolsSlot} />

            <div role="tabpanel" aria-label="Session" hidden={tab !== 'session'}>
              <form className="row" onSubmit={saveTitle}>
                <label className="grow">
                  <span>Your title</span>
                  <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={40} />
                </label>
                <button type="submit">Save</button>
              </form>
              <label>
                <span>Who rolls dice</span>
                <select
                  value={state.rollMode}
                  onChange={(event) => attempt(() => session.setRollMode(event.target.value as RollMode))}
                >
                  {ROLL_MODES.map((mode) => (
                    <option key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="check" title="Off: you play everyone, apart from creatures you hand to a player">
                <input
                  type="checkbox"
                  checked={state.playersControlOwn}
                  onChange={(event) => session.setPlayersControlOwn(event.target.checked)}
                />
                Players control their own characters
              </label>
              <label className="check" title="Players see only what their characters can see; you always see everything">
                <input type="checkbox" checked={state.fogOfWar} onChange={(event) => session.setFogOfWar(event.target.checked)} />
                Fog of war
              </label>
              <h3>Players</h3>
              <Players players={state.players} />
            </div>
          </div>
        </aside>
      </div>

      <div className="columns two">
        <section className="card">
          <h2>Fight</h2>
          <div className="row">
            <button type="button" className="primary" onClick={startDemoFight}>
              Start demo fight
            </button>
          </div>
          <CombatPanel state={state} />
        </section>

        <section className="card">
          <h2>Log</h2>
          <LogPanel
            state={state}
            viewer="dm"
            whisperTargets={state.players.map((player) => ({ id: player.id, label: player.name }))}
            onSay={(text, to) => attempt(() => session.say(text, to))}
            onRoll={(notation, hidden) => attempt(() => session.roll(notation, { hidden }))}
            canHideRolls
            physicalDice={false}
            error={error}
          />
        </section>
      </div>
    </div>
  );
}
