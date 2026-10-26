import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type MapGuideResult, type MapPlanResult, planMap, previewTiles } from '@shared/ai';
import type { GridKind } from '@shared/grid';
import type { MapData } from '@shared/map';
import { isPdf, readBookPages, renderPdfPages } from '../ai/bookText';
import { type AiSettings, loadAiSettings, makeProvider, saveAiSettings } from '../ai/providers';
import { placeholderStyle } from '../style/stylePack';
import { AiSetup } from './AiSetup';
import { LocalAiGuide } from './LocalAiGuide';

// A map from a book the DM owns, made with their own AI: from the pages of
// an encounter, either its text (the place it describes) or its map picture
// (for an AI that can see). The map is previewed before it replaces the
// current one (and Undo brings that back); when the pages don't say enough,
// the AI explains how to set the map up by hand instead.

/** A small top-down picture of a map plan: terrain colours, solid tiles darker, objects as dots, higher ground lighter. */
function MapPreview({ map }: { map: MapData }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const tiles = useMemo(() => previewTiles(map), [map]);
  const width = Math.max(...tiles.map((tile) => tile.x)) + 1;
  const height = Math.max(...tiles.map((tile) => tile.y)) + 1;
  const size = Math.max(4, Math.floor(320 / Math.max(width, height)));
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    for (const tile of tiles) {
      ctx.fillStyle = placeholderStyle.terrain[tile.terrain]?.color ?? '#5f9e4a';
      ctx.fillRect(tile.x * size, tile.y * size, size, size);
      const shade = tile.blocked ? 'rgba(0, 0, 0, 0.45)' : tile.height > 0 ? `rgba(255, 255, 255, ${Math.min(0.4, tile.height * 0.12)})` : null;
      if (shade) {
        ctx.fillStyle = shade;
        ctx.fillRect(tile.x * size, tile.y * size, size, size);
      }
      if (tile.object) {
        ctx.fillStyle = '#1a1420';
        ctx.beginPath();
        ctx.arc((tile.x + 0.5) * size, (tile.y + 0.5) * size, size * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [tiles, size]);
  return (
    <canvas
      ref={canvas}
      className="map-preview"
      width={width * size}
      height={height * size}
      role="img"
      aria-label={`Preview: a ${width} by ${height} ${map.grid} map`}
    />
  );
}

export function MapFromBook({ grid, onUse, onCancel }: { grid?: GridKind | undefined; onUse: (map: MapData) => void; onCancel: () => void }) {
  const [settings, setSettings] = useState<AiSettings>(loadAiSettings);
  const [book, setBook] = useState<{ file: File; pages: string[] } | null>(null);
  const [range, setRange] = useState({ from: 1, to: 1 });
  const [mode, setMode] = useState<'text' | 'pictures'>('text');
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<MapPlanResult | MapGuideResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopper = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => dialog.current?.focus(), []);
  useEffect(() => () => stopper.current?.abort(), []);

  const change = (patch: Partial<AiSettings>) =>
    setSettings((now) => {
      const next = { ...now, ...patch };
      saveAiSettings(next);
      return next;
    });

  async function chooseBook(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    setResult(null);
    try {
      const pages = await readBookPages(file).catch((caught: unknown) => {
        // A scanned PDF has no text, but its map pictures can still be looked at.
        if (isPdf(file) && caught instanceof Error && /no text/.test(caught.message)) return [] as string[];
        throw caught;
      });
      setBook({ file, pages });
      setRange({ from: 1, to: Math.max(1, Math.min(pages.length || 1, 4)) });
      if (pages.length === 0) setMode('pictures');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function make() {
    if (!book) return;
    const controller = new AbortController();
    stopper.current = controller;
    setWorking(true);
    setError(null);
    setResult(null);
    try {
      const text = book.pages.slice(range.from - 1, range.to).join('\n\n');
      const source = mode === 'pictures' ? { pictures: await renderPdfPages(book.file, range.from, range.to), text } : { text };
      // On the current map's grid, so Undo can bring the old map back.
      setResult(await planMap(makeProvider(settings), source, { signal: controller.signal, ...(grid ? { grid } : {}) }));
    } catch (caught) {
      setError(controller.signal.aborted ? 'Stopped.' : caught instanceof Error ? caught.message : String(caught));
    } finally {
      setWorking(false);
      stopper.current = null;
    }
  }

  const pageCount = book ? Math.max(book.pages.length, 1) : 0;

  return createPortal(
    <div className="picker-backdrop">
      <div
        ref={dialog}
        className="panel picker-dialog book-import"
        role="dialog"
        aria-modal="true"
        aria-label="Map from a book"
        tabIndex={-1}
        onKeyDown={(event) => event.key === 'Escape' && !working && onCancel()}
      >
        <div className="picker-head">
          <h3>Make a map from a book, with AI</h3>
          <button type="button" aria-label="Close" title="Cancel" disabled={working} onClick={onCancel}>
            ×
          </button>
        </div>
        <LocalAiGuide open={!settings.model} />
        <p className="muted">
          Choose the pages of one encounter: the AI recreates its map picture, or makes a map that fits the place it describes. If the pages don&apos;t say
          enough, it tells you how to set the map up yourself. You see the map before it&apos;s used, and Undo brings the old one back.
        </p>
        <AiSetup settings={settings} onChange={change} disabled={working} modelHint={mode === 'pictures' ? 'e.g. qwen2.5vl:7b' : 'e.g. qwen2.5:14b'} />

        <fieldset className="panel" disabled={working}>
          <legend>The encounter</legend>
          <div className="row">
            <label className="file-button">
              <span>{book ? 'Choose another' : 'Choose the book (PDF or text)'}</span>
              <input type="file" accept=".pdf,.txt,.md,application/pdf,text/plain" aria-label="Book file" onChange={(event) => void chooseBook(event)} />
            </label>
            {book && (
              <>
                <span className="muted">
                  {book.file.name}: {pageCount} page{pageCount === 1 ? '' : 's'}
                </span>
                <label>
                  <span>From page</span>
                  <input type="number" min={1} max={pageCount} value={range.from} onChange={(event) => setRange((now) => ({ ...now, from: Number(event.target.value) }))} />
                </label>
                <label>
                  <span>To page</span>
                  <input type="number" min={1} max={pageCount} value={range.to} onChange={(event) => setRange((now) => ({ ...now, to: Number(event.target.value) }))} />
                </label>
              </>
            )}
          </div>
          {book && (
            <div className="row" role="radiogroup" aria-label="Read">
              <label className="check">
                <input type="radio" name="map-mode" checked={mode === 'text'} disabled={book.pages.length === 0} onChange={() => setMode('text')} />
                <span>The text (a place it describes)</span>
              </label>
              <label className="check">
                <input type="radio" name="map-mode" checked={mode === 'pictures'} disabled={!isPdf(book.file)} onChange={() => setMode('pictures')} />
                <span>The map pictures (experimental: needs an AI that can see, like qwen2.5vl; expect a rough start to fix up)</span>
              </label>
            </div>
          )}
        </fieldset>

        {working && (
          <p className="muted" role="status">
            {mode === 'pictures' ? 'Looking at the map…' : 'Reading the encounter…'} This can take a minute.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {result?.kind === 'map' && (
          <section className="map-result" aria-label="The map">
            <h4>{result.name}</h4>
            <MapPreview map={result.map} />
            {result.notes.map((note) => (
              <p key={note} className="muted small">
                {note}
              </p>
            ))}
          </section>
        )}
        {result?.kind === 'guide' && (
          <section className="map-result" aria-label="How to set up this map">
            <p>
              <strong>No map from these pages:</strong> {result.reason}
            </p>
            {result.guide.length > 0 && (
              <>
                <p>To set it up yourself:</p>
                <ol>
                  {result.guide.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </>
            )}
          </section>
        )}

        <div className="row">
          {working ? (
            <button type="button" onClick={() => stopper.current?.abort()}>
              Stop
            </button>
          ) : result?.kind === 'map' ? (
            <button type="button" className="primary" onClick={() => onUse(result.map)}>
              Use this map
            </button>
          ) : null}
          {!working && (
            <button type="button" className={result?.kind === 'map' ? '' : 'primary'} disabled={!book || !settings.model || range.from > range.to} onClick={() => void make()}>
              {result ? 'Try again' : 'Make the map'}
            </button>
          )}
          <button type="button" disabled={working} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
