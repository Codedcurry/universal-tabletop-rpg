import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { RollResult } from '@shared/dice';
import type { LogEntry, RollSource } from '@shared/net';

// The log, in tabs: everything, General (joins, turns, rounds), Player chat,
// and the Game log (rolls and what happens in fights). Timestamped and
// color-coded; a roll's full breakdown opens on tap. On phones it's a drawer.

type Tab = 'all' | 'general' | 'chat' | 'game';

const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'general', label: 'General' },
  { id: 'chat', label: 'Player chat' },
  { id: 'game', label: 'Game log' },
];

const IN_TAB: Record<Tab, (entry: LogEntry) => boolean> = {
  all: () => true,
  general: (entry) => entry.kind === 'system',
  chat: (entry) => entry.kind === 'chat',
  game: (entry) => entry.kind === 'roll' || entry.kind === 'game',
};

const MODE_LABELS: Record<RollSource, string> = {
  player: 'rolled on device',
  dmVerified: 'rolled by the DM',
  physical: 'physical dice',
  dm: 'DM roll',
};

function describeRoll(result: RollResult): string {
  return result.terms
    .map((term, index) => {
      const sign = term.sign < 0 ? '- ' : index === 0 ? '' : '+ ';
      if (term.kind === 'constant') return `${sign}${term.value}`;
      if (term.kind === 'coin') return `${sign}[${term.flips.map((flip) => (flip === 'heads' ? 'H' : 'T')).join(' ')}]`;
      return `${sign}[${term.dice.map((die) => (die.kept ? `${die.value}` : `(${die.value})`)).join(' ')}]`;
    })
    .join(' ');
}

const PHONE = '(max-width: 700px)';

function useNarrow(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const query = matchMedia(PHONE);
      query.addEventListener('change', listener);
      return () => query.removeEventListener('change', listener);
    },
    () => matchMedia(PHONE).matches,
  );
}

function RollLine({ entry, nameOf }: { entry: Extract<LogEntry, { kind: 'roll' }>; nameOf(id: string): string }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  return (
    <>
      <button type="button" className="roll-summary" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen(!open)}>
        <strong>{nameOf(entry.from)}</strong> rolled {entry.result.notation} ={' '}
        <span className="roll-total">{entry.result.total}</span>
      </button>
      <span id={detailsId} className="roll-breakdown" data-testid="roll-breakdown" hidden={!open}>
        {describeRoll(entry.result)} · {MODE_LABELS[entry.mode]}
        {entry.hidden ? ' · hidden' : ''}
      </span>
    </>
  );
}

export function LogList({ log, nameOf }: { log: readonly LogEntry[]; nameOf(id: string): string }) {
  const [tab, setTab] = useState<Tab>('all');
  const narrow = useNarrow();
  const [open, setOpen] = useState(!narrow);
  const panelId = useId();
  const listRef = useRef<HTMLOListElement>(null);
  // Entries that arrived while the drawer was closed.
  const [seenSeq, setSeenSeq] = useState(() => Math.max(0, ...log.map((entry) => entry.seq)));
  const newest = Math.max(0, ...log.map((entry) => entry.seq));
  const unread = open ? 0 : log.filter((entry) => entry.seq > seenSeq).length;

  useEffect(() => {
    if (open) setSeenSeq(newest);
  }, [open, newest]);
  // Keep the newest entry in view.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [log.length, tab, open]);

  const shown = log.filter(IN_TAB[tab]);

  function render(entry: LogEntry) {
    switch (entry.kind) {
      case 'system':
        return <em>{entry.text}</em>;
      case 'game':
        return <span>{entry.text}</span>;
      case 'chat':
        return (
          <>
            <strong>{nameOf(entry.from)}</strong>
            {entry.to && <span className="whisper"> → {nameOf(entry.to)} (whisper)</span>}: {entry.text}
          </>
        );
      case 'roll':
        return <RollLine entry={entry} nameOf={nameOf} />;
    }
  }

  return (
    <div className="log-list">
      {narrow && (
        <button
          type="button"
          className="log-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(!open)}
        >
          Log{unread > 0 ? ` (${unread} new)` : ''} {open ? '▾' : '▸'}
        </button>
      )}
      <div id={panelId} hidden={!open}>
        <div className="log-tabs" role="tablist" aria-label="Log">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              aria-controls={`${panelId}-panel`}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`${panelId}-panel`} aria-label={TABS.find((entry) => entry.id === tab)?.label}>
          <ol className="log" data-testid="log" ref={listRef}>
            {shown.map((entry) => (
              <li
                key={entry.seq}
                data-kind={entry.kind}
                className={entry.kind === 'game' ? `tone-${entry.tone}` : undefined}
              >
                <time dateTime={new Date(entry.time).toISOString()}>
                  {new Date(entry.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </time>{' '}
                {render(entry)}
              </li>
            ))}
            {shown.length === 0 && <li className="muted">Nothing here yet.</li>}
          </ol>
        </div>
      </div>
    </div>
  );
}
