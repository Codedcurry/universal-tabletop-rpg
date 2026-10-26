import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type ImportProgress, type ImportResult, importRulebook } from '@shared/ai';
import { readBookPages } from '../ai/bookText';
import { AI_KINDS, type AiKind, type AiSettings, listModels, loadAiSettings, makeProvider, saveAiSettings } from '../ai/providers';

// Importing a rulebook the DM owns with their own AI: set up the AI (Ollama
// or LM Studio on this computer, or another service with their key), pick
// the book (a PDF or a text file) and the pages, and watch it read section
// by section. The result opens in the rules editor to be checked.

export function BookImport({ onDone, onCancel }: { onDone: (result: ImportResult) => void; onCancel: () => void }) {
  const [settings, setSettings] = useState<AiSettings>(loadAiSettings);
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [book, setBook] = useState<{ name: string; pages: string[] } | null>(null);
  const [range, setRange] = useState({ from: 1, to: 1 });
  const [progress, setProgress] = useState<ImportProgress | null>(null);
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

  async function check() {
    setStatus({ ok: true, text: 'Checking…' });
    try {
      const found = await listModels(settings);
      setModels(found);
      if (!settings.model && found[0]) change({ model: found[0] });
      setStatus(found.length > 0 ? { ok: true, text: `Connected: ${found.length} model${found.length === 1 ? '' : 's'}` } : { ok: false, text: 'Connected, but it has no models yet: download one first.' });
    } catch (caught) {
      setStatus({ ok: false, text: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  async function chooseBook(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    try {
      const pages = await readBookPages(file);
      setBook({ name: file.name, pages });
      setRange({ from: 1, to: pages.length });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function start() {
    if (!book) return;
    const controller = new AbortController();
    stopper.current = controller;
    setError(null);
    try {
      const pages = book.pages.map((page, index) => (index + 1 >= range.from && index + 1 <= range.to ? page : ''));
      const result = await importRulebook(pages, makeProvider(settings), { signal: controller.signal, onProgress: setProgress });
      onDone(result);
    } catch (caught) {
      setProgress(null);
      setError(controller.signal.aborted ? 'Stopped.' : caught instanceof Error ? caught.message : String(caught));
    } finally {
      stopper.current = null;
    }
  }

  const reading = progress !== null;
  const section = progress?.section;

  return createPortal(
    <div className="picker-backdrop">
      <div
        ref={dialog}
        className="panel picker-dialog book-import"
        role="dialog"
        aria-modal="true"
        aria-label="Import a rulebook"
        tabIndex={-1}
        onKeyDown={(event) => event.key === 'Escape' && !reading && onCancel()}
      >
        <div className="picker-head">
          <h3>Import a rulebook with AI</h3>
          <button type="button" aria-label="Close" title="Cancel" disabled={reading} onClick={onCancel}>
            ×
          </button>
        </div>
        <p className="muted">
          For a book you own. Its text goes only to the AI you choose here, a section at a time, and the result stays in your game. AI makes mistakes: what it finds
          opens in the rules editor for you to check before it&apos;s used.
        </p>

        <fieldset className="panel" disabled={reading}>
          <legend>Your AI</legend>
          <div className="row">
            <label className="grow">
              <span>AI</span>
              <select
                value={settings.kind}
                onChange={(event) => {
                  const kind = event.target.value as AiKind;
                  change({ kind, baseUrl: AI_KINDS.find((entry) => entry.id === kind)?.baseUrl ?? '', model: '' });
                  setModels([]);
                  setStatus(null);
                }}
              >
                {AI_KINDS.map((kind) => (
                  <option key={kind.id} value={kind.id}>
                    {kind.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grow">
              <span>Address</span>
              <input value={settings.baseUrl} onChange={(event) => change({ baseUrl: event.target.value })} />
            </label>
          </div>
          <div className="row">
            <label className="grow">
              <span>Model</span>
              <input list="ai-models" value={settings.model} placeholder="e.g. llama3.1" onChange={(event) => change({ model: event.target.value })} />
              <datalist id="ai-models">
                {models.map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </label>
            {settings.kind === 'openai' && (
              <label className="grow">
                <span>API key (kept on this device only)</span>
                <input type="password" autoComplete="off" value={settings.apiKey} onChange={(event) => change({ apiKey: event.target.value })} />
              </label>
            )}
            <button type="button" onClick={() => void check()}>
              Check connection
            </button>
          </div>
          {status && (
            <p className={status.ok ? 'muted' : 'field-error'} role="status">
              {status.text}
            </p>
          )}
          {settings.kind === 'ollama' && (
            <details className="small">
              <summary>Setting up Ollama (free, runs on your computer)</summary>
              <ol>
                <li>Install it from ollama.com.</li>
                <li>
                  Download a model: in a terminal, <code>ollama pull llama3.1</code> (or another; bigger ones read rules better).
                </li>
                <li>
                  Let this site talk to it: set the environment variable <code>OLLAMA_ORIGINS</code> to <code>{location.origin}</code>, then restart Ollama.
                </li>
              </ol>
            </details>
          )}
        </fieldset>

        <fieldset className="panel" disabled={reading}>
          <legend>The book</legend>
          <div className="row">
            <label className="file-button">
              <span>{book ? 'Choose another' : 'Choose the book (PDF or text)'}</span>
              <input type="file" accept=".pdf,.txt,.md,application/pdf,text/plain" aria-label="Rulebook file" onChange={(event) => void chooseBook(event)} />
            </label>
            {book && (
              <>
                <span className="muted">
                  {book.name}: {book.pages.length} page{book.pages.length === 1 ? '' : 's'}
                </span>
                <label>
                  <span>From page</span>
                  <input type="number" min={1} max={book.pages.length} value={range.from} onChange={(event) => setRange((now) => ({ ...now, from: Number(event.target.value) }))} />
                </label>
                <label>
                  <span>To page</span>
                  <input type="number" min={1} max={book.pages.length} value={range.to} onChange={(event) => setRange((now) => ({ ...now, to: Number(event.target.value) }))} />
                </label>
              </>
            )}
          </div>
        </fieldset>

        {reading && progress && (
          <div className="book-progress">
            <progress max={progress.total} value={progress.done} aria-label="Reading the book" />
            <p className="muted" role="status">
              {section
                ? `Reading page${section.from === section.to ? ` ${section.from}` : `s ${section.from}–${section.to}`} (${progress.done + 1} of ${progress.total})…`
                : 'Putting it together…'}
            </p>
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="row">
          {reading ? (
            <button type="button" onClick={() => stopper.current?.abort()}>
              Stop
            </button>
          ) : (
            <button type="button" className="primary" disabled={!book || !settings.model || range.from > range.to} onClick={() => void start()}>
              Read the book
            </button>
          )}
          <button type="button" disabled={reading} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
