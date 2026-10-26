import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  type BookArea,
  type BookMap,
  type ImportProgress,
  type MapGuideResult,
  type MapPlanResult,
  areaText,
  findAreas,
  findMaps,
  furnishMap,
  importRulebook,
  placeLabels,
  planMap,
  type TracedMap,
  traceMap,
} from '@shared/ai';
import type { HostSession } from '@shared/net';
import type { GameSystem } from '@shared/system';
import { MAX_BACKDROP_CHARS, type MapBackdrop, type MapData } from '@shared/map';
import { isPdf, isPicture, readBookPages, readMapPage, readMapPicture } from '../ai/bookText';
import { type AiSettings, loadAiSettings, makeProvider, saveAiSettings } from '../ai/providers';
import { AiSetup } from './AiSetup';
import { LocalAiGuide, LocalAiNotice } from './LocalAiGuide';
import { MapPreview } from './MapPreview';
import { RulesReview } from './RulesReview';

// The DM tools' Books tab: the DM's books (rulebooks, monster books,
// adventures), added once, used for everything. Their rules are read by the
// DM's AI together and reviewed change by change; the maps found in them
// (pages whose labels name keyed areas) are listed, to make one in a click:
// traced from the page and furnished from the areas' descriptions. The
// books stay in this browser tab, and go only to the DM's own AI.

/** About how much area text goes with a map. */
const MAP_TEXT = 14_000;

interface Book {
  readonly id: number;
  readonly file: File;
  readonly name: string;
  readonly pages: readonly string[];
  readonly areas: readonly BookArea[];
  readonly maps: readonly BookMap[];
  readonly forRules: boolean;
  /** A map picture (JPG, PNG), not a book: one "page", no text. */
  readonly picture: boolean;
}

/**
 * The part of a page picture a traced map covers, as a compact JPEG laid on
 * the map's ground (null if it's too big to send to players even when shrunk).
 */
function pictureOf(pixels: ImageData, traced: TracedMap): MapBackdrop | null {
  const page = document.createElement('canvas');
  page.width = pixels.width;
  page.height = pixels.height;
  (page.getContext('2d') as CanvasRenderingContext2D).putImageData(pixels, 0, 0);
  const across = traced.width * traced.square;
  const down = traced.height * traced.square;
  for (const [scale, quality] of [
    [1, 0.85],
    [0.75, 0.8],
    [0.5, 0.75],
  ] as const) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(across * scale));
    canvas.height = Math.max(1, Math.round(down * scale));
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(page, traced.origin.x, traced.origin.y, across, down, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL('image/jpeg', quality);
    if (image.length <= MAX_BACKDROP_CHARS) return { image, width: traced.width, height: traced.height };
  }
  return null;
}

const bookName = (file: File) => file.name.replace(/\.(pdf|txt|md|png|jpe?g|webp|gif)$/i, '').replace(/\s*\[[^\]]*\]\s*/g, ' ').trim();

export function BooksPanel({ session, onUseMap }: { session: HostSession; onUseMap: (map: MapData, scene: string | null) => void }) {
  const [settings, setSettings] = useState<AiSettings>(loadAiSettings);
  const [books, setBooks] = useState<readonly Book[]>([]);
  const [reading, setReading] = useState<string | null>(null);
  const [rulesProgress, setRulesProgress] = useState<ImportProgress | null>(null);
  const [review, setReview] = useState<{ system: GameSystem; notes: readonly string[] } | null>(null);
  const [making, setMaking] = useState<string | null>(null);
  const [made, setMade] = useState<MapPlanResult | MapGuideResult | null>(null);
  /** The text the map was made from: its areas' descriptions (for narration). */
  const [madeFrom, setMadeFrom] = useState<string | null>(null);
  const [other, setOther] = useState({ book: 0, page: 1 });
  /** The DM's own description of the encounter, used with whatever the page says. */
  const [described, setDescribed] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopper = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  useEffect(() => () => stopper.current?.abort(), []);
  const busy = reading !== null || rulesProgress !== null || making !== null;

  const change = (patch: Partial<AiSettings>) =>
    setSettings((now) => {
      const next = { ...now, ...patch };
      saveAiSettings(next);
      return next;
    });

  async function addBooks(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    setError(null);
    for (const file of files) {
      try {
        setReading(`Reading ${file.name}…`);
        if (isPicture(file)) {
          // A map picture: listed as a map to make, with nothing to read for rules.
          setBooks((now) => [...now, { id: nextId.current++, file, name: bookName(file), pages: [''], areas: [], maps: [{ page: 1, areas: [] }], forRules: false, picture: true }]);
          continue;
        }
        const pages = await readBookPages(file, (page, total) => setReading(`Reading ${file.name}: page ${page} of ${total}…`));
        const areas = findAreas(pages);
        const book: Book = { id: nextId.current++, file, name: bookName(file), pages, areas, maps: findMaps(pages, areas), forRules: true, picture: false };
        setBooks((now) => [...now, book]);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    }
    setReading(null);
  }

  /** Every page of the books chosen for rules, in order, with a name for each ("Player's Book, page 12"). */
  const rulesPages = useMemo(() => {
    const chosen = books.filter((book) => book.forRules);
    return { pages: chosen.flatMap((book) => book.pages), names: chosen.flatMap((book) => book.pages.map((_, index) => `${book.name}, page ${index + 1}`)), count: chosen.length };
  }, [books]);

  async function readRules() {
    const controller = new AbortController();
    stopper.current = controller;
    setError(null);
    setNotice(null);
    try {
      const result = await importRulebook(rulesPages.pages, makeProvider(settings), { signal: controller.signal, onProgress: setRulesProgress, pageNames: rulesPages.names });
      setReview({ system: result.system, notes: ['Read from your books by AI: check each change before you say yes.', ...result.notes] });
    } catch (caught) {
      setError(controller.signal.aborted ? 'Stopped.' : caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRulesProgress(null);
      stopper.current = null;
    }
  }

  /** Makes a map from a page: traced from its picture and furnished from its areas, or (no grid) planned from the text. */
  async function makeMap(book: Book, page: number, areas: readonly BookArea[]) {
    const controller = new AbortController();
    stopper.current = controller;
    setError(null);
    setMade(null);
    const provider = makeProvider(settings);
    // What's in the encounter: its areas' descriptions, else the page's text, plus the DM's own words.
    const found = areas.length > 0 ? areaText(book.pages, book.areas, areas, MAP_TEXT) : (book.pages[page - 1] ?? '');
    const text = [found, described.trim() ? `The game master says: ${described.trim()}` : ''].filter(Boolean).join('\n\n');
    setMadeFrom(text || null);
    try {
      if (isPdf(book.file) || book.picture) {
        setMaking(book.picture ? `Tracing ${book.name}…` : `Tracing page ${page}…`);
        const read = book.picture ? await readMapPicture(book.file) : await readMapPage(book.file, page);
        const traced = traceMap(read.pixels);
        if (traced) {
          setMaking('Furnishing it from the book… This can take a minute.');
          const labels = placeLabels(read.words, areas, traced);
          const result = await furnishMap(provider, traced, { labels, text, grid: 'square', signal: controller.signal });
          // The page's own art on the ground, lined up with the traced squares.
          const backdrop = pictureOf(read.pixels, traced);
          // With the art, the traced walls lie flat under it (the art shows them): they still block the way and the view.
          const map = backdrop ? { ...result.map, backdrop, tiles: result.map.tiles.map((tile) => (tile.blocked && !tile.object ? { ...tile, height: 0 } : tile)) } : result.map;
          setMade({ ...result, map, name: areas.length > 0 ? areas.map((area) => area.name).join(', ') : book.picture ? book.name : result.name });
          return;
        }
      }
      if (book.picture && !text) throw new Error(`No map grid found in ${book.name}: describe the encounter below, and the AI will lay out a map from that`);
      // No grid to trace (an outdoor painting, a text file): the AI lays it out from the text.
      setMaking('No map grid on that page: laying it out from the text… This can take a minute.');
      const grid = session.snapshot().map?.grid;
      setMade(await planMap(provider, { text: text || book.pages.slice(page - 1, page + 1).join('\n') }, { signal: controller.signal, ...(grid ? { grid } : {}) }));
    } catch (caught) {
      setError(controller.signal.aborted ? 'Stopped.' : caught instanceof Error ? caught.message : String(caught));
    } finally {
      setMaking(null);
      stopper.current = null;
    }
  }

  const ready = settings.model !== '';
  const mapsFound = books.flatMap((book) => book.maps.map((map) => ({ book, map })));
  const otherBook = books.find((book) => book.id === other.book && !book.picture) ?? books.find((book) => !book.picture);

  return (
    <div className="books-panel">
      <LocalAiNotice />
      <details className="panel" open={!ready}>
        <summary>Your AI{ready ? `: ${settings.model}` : ' (set it up first)'}</summary>
        <LocalAiGuide open={!ready} />
        <AiSetup settings={settings} onChange={change} disabled={busy} />
      </details>

      <section className="books-section" aria-label="Your books">
        <h3>Your books</h3>
        <p className="muted small">
          Add every book the game needs (core rules, monsters, the adventure): they&apos;re read once, here in this tab, and go only to your AI. Books you own are
          for your own games.
        </p>
        <label className="file-button">
          <span>Add books or map pictures (PDF, text, JPG, PNG)</span>
          <input type="file" multiple accept=".pdf,.txt,.md,.png,.jpg,.jpeg,.webp,application/pdf,text/plain,image/png,image/jpeg,image/webp" aria-label="Add books" disabled={busy} onChange={(event) => void addBooks(event)} />
        </label>
        {reading && (
          <p className="muted" role="status">
            {reading}
          </p>
        )}
        {books.length > 0 && (
          <ul className="tile-list" aria-label="Books">
            {books.map((book) => (
              <li key={book.id}>
                <span className="grow">
                  <strong>{book.name}</strong>
                  <span className="muted">
                    {' '}
                    · {book.picture ? 'map picture' : `${book.pages.length} pages${book.maps.length > 0 ? ` · ${book.maps.length} map${book.maps.length === 1 ? '' : 's'}` : ''}`}
                  </span>
                </span>
                {!book.picture && (
                <label className="check" title="Read this book's rules, monsters, and spells">
                  <input
                    type="checkbox"
                    checked={book.forRules}
                    disabled={busy}
                    onChange={(event) => setBooks((now) => now.map((entry) => (entry.id === book.id ? { ...entry, forRules: event.target.checked } : entry)))}
                  />
                  <span>Rules</span>
                </label>
                )}
                <button type="button" aria-label={`Remove ${book.name}`} disabled={busy} onClick={() => setBooks((now) => now.filter((entry) => entry.id !== book.id))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {books.length > 0 && <p className="muted small">The books stay in this tab only: after reloading the page, add them again.</p>}
      </section>

      {books.length > 0 && (
        <section className="books-section" aria-label="Rules from your books">
          <h3>Rules</h3>
          <p className="muted small">
            Reads the rules, monsters, spells, and conditions in the books ticked &quot;Rules&quot; ({rulesPages.pages.length} pages), together. You then see every
            change it would make, and say yes or no to each.
          </p>
          {rulesProgress ? (
            <div className="book-progress">
              <progress max={rulesProgress.total} value={rulesProgress.done} aria-label="Reading the rules" />
              <p className="muted" role="status">
                {rulesProgress.section
                  ? `Reading ${rulesPages.names[rulesProgress.section.from - 1] ?? ''} (part ${rulesProgress.done + 1} of ${rulesProgress.total})…`
                  : 'Putting it together…'}
              </p>
              <button type="button" onClick={() => stopper.current?.abort()}>
                Stop
              </button>
            </div>
          ) : (
            <button type="button" className="primary" disabled={busy || !ready || rulesPages.count === 0} onClick={() => void readRules()}>
              Read the rules from {rulesPages.count} {rulesPages.count === 1 ? 'book' : 'books'}
            </button>
          )}
        </section>
      )}

      {books.length > 0 && (
        <section className="books-section" aria-label="Maps from your books">
          <h3>Maps and encounters</h3>
          {mapsFound.length === 0 ? (
            <p className="muted small">No maps found in these books (they&apos;re found by labels naming the book&apos;s numbered areas). Pick a page below.</p>
          ) : (
            <ul className="tile-list" aria-label="Maps found">
              {mapsFound.map(({ book, map }) => (
                <li key={`${book.id}:${map.page}`}>
                  <span className="grow">
                    <strong>{book.picture ? book.name : map.areas.map((area) => `${area.key} ${area.name}`).join(', ')}</strong>
                    <span className="muted">
                      {' '}
                      · {book.picture ? 'map picture' : `${book.name}, page ${map.page}`}
                    </span>
                  </span>
                  <button type="button" disabled={busy || !ready} onClick={() => void makeMap(book, map.page, map.areas)}>
                    Make this map
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="books-describe">
            <span>Describe the encounter (optional: what's there, who, what happens)</span>
            <textarea rows={2} value={described} maxLength={2000} onChange={(event) => setDescribed(event.target.value)} />
          </label>
          <div className="row">
            <label>
              <span>Or a page of</span>
              <select value={otherBook?.id ?? ''} onChange={(event) => setOther((now) => ({ ...now, book: Number(event.target.value) }))}>
                {books.filter((book) => !book.picture).map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Page</span>
              <input type="number" min={1} max={otherBook?.pages.length ?? 1} value={other.page} onChange={(event) => setOther((now) => ({ ...now, page: Number(event.target.value) }))} />
            </label>
            <button
              type="button"
              disabled={busy || !ready || !otherBook}
              onClick={() => otherBook && void makeMap(otherBook, other.page, otherBook.maps.find((map) => map.page === other.page)?.areas ?? [])}
            >
              Make a map from this page
            </button>
          </div>
          {making && (
            <div className="row">
              <p className="muted" role="status">
                {making}
              </p>
              <button type="button" onClick={() => stopper.current?.abort()}>
                Stop
              </button>
            </div>
          )}
          {made?.kind === 'map' && (
            <section className="map-result" aria-label="The map">
              <h4>{made.name}</h4>
              <MapPreview map={made.map} />
              {made.notes.map((note) => (
                <p key={note} className="muted small">
                  {note}
                </p>
              ))}
              <div className="row">
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    onUseMap(made.map, madeFrom);
                    setMade(null);
                    setNotice('The map is in use: see the Map tab to touch it up (Undo brings the old one back).');
                  }}
                >
                  Use this map
                </button>
                <button type="button" onClick={() => setMade(null)}>
                  Discard
                </button>
              </div>
            </section>
          )}
          {made?.kind === 'guide' && (
            <section className="map-result" aria-label="How to set up this map">
              <p>
                <strong>No map from that page:</strong> {made.reason}
              </p>
              {made.guide.length > 0 && (
                <ol>
                  {made.guide.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              )}
            </section>
          )}
        </section>
      )}

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {review && (
        <RulesReview
          current={session.snapshot().system}
          incoming={review.system}
          title={`Rules from ${rulesPages.count} ${rulesPages.count === 1 ? 'book' : 'books'}`}
          notes={review.notes}
          onApply={(system) => {
            try {
              const changes = session.setSystem(system, {});
              setReview(null);
              setNotice(changes.length > 0 ? `Rules updated. ${changes.join('; ')}.` : 'Rules updated: see the Rules tab.');
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : String(caught));
            }
          }}
          onEdit={() => {
            setReview(null);
            setNotice('To edit them first: apply what you want here, then use Edit rules in the Rules tab.');
          }}
          onCancel={() => setReview(null)}
        />
      )}
    </div>
  );
}
