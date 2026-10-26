import { type FormEvent, useRef, useState } from 'react';
import { makeObject } from '@shared/ai';
import type { CustomObject } from '@shared/map';
import { loadAiSettings, makeProvider } from '../ai/providers';

// Making an object for the map from the DM's own words ("a makeshift bed: a
// rug on the floor"), with their AI. Shown before it's added; once added it's
// one of the map's own objects, picked in the object tool and placed.

export function ObjectMaker({ taken, onAdd, onOpenBooks }: { taken: readonly string[]; onAdd: (object: CustomObject) => void; onOpenBooks?: () => void }) {
  const [description, setDescription] = useState('');
  const [made, setMade] = useState<CustomObject | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopper = useRef<AbortController | null>(null);

  async function make(event: FormEvent) {
    event.preventDefault();
    const settings = loadAiSettings();
    if (!settings.model) {
      setError('Set up your AI in the Books tab first.');
      return;
    }
    const controller = new AbortController();
    stopper.current = controller;
    setWorking(true);
    setError(null);
    setMade(null);
    try {
      setMade(await makeObject(makeProvider(settings), description, { signal: controller.signal, taken }));
    } catch (caught) {
      setError(controller.signal.aborted ? null : caught instanceof Error ? caught.message : String(caught));
    } finally {
      setWorking(false);
      stopper.current = null;
    }
  }

  return (
    <div className="object-maker" role="group" aria-label="Make something new">
      <form className="row" onSubmit={(event) => void make(event)}>
        <label className="grow">
          <span>Describe something to make</span>
          <input value={description} maxLength={500} placeholder="a makeshift bed: a rug on the floor" onChange={(event) => setDescription(event.target.value)} />
        </label>
        <button type="submit" disabled={working || description.trim() === ''}>
          {working ? 'Making…' : 'Make it (AI)'}
        </button>
        {working && (
          <button type="button" onClick={() => stopper.current?.abort()}>
            Stop
          </button>
        )}
      </form>
      {made && (
        <div className="row made-object">
          <span className="swatches" aria-hidden="true">
            {made.parts.map((part, index) => (
              <span key={index} className="swatch small" style={{ background: part.color }} />
            ))}
          </span>
          <span className="grow">
            <strong>{made.name}</strong>
            <span className="muted small">
              {' '}
              · {made.parts.length} {made.parts.length === 1 ? 'part' : 'parts'}
              {made.blocks ? ' · blocks the way' : ''}
              {made.blocksSight ? ' · hides what’s behind' : ''}
            </span>
          </span>
          <button
            type="button"
            className="primary"
            onClick={() => {
              onAdd(made);
              setMade(null);
              setDescription('');
            }}
          >
            Add to this map
          </button>
          <button type="button" onClick={() => setMade(null)}>
            Discard
          </button>
        </div>
      )}
      {error && (
        <p className="field-error">
          {error}{' '}
          {error.includes('Books tab') && onOpenBooks && (
            <button type="button" className="link" onClick={onOpenBooks}>
              Open the Books tab
            </button>
          )}
        </p>
      )}
    </div>
  );
}
