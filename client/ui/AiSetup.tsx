import { useState } from 'react';
import { AI_KINDS, type AiKind, type AiSettings, listModels } from '../ai/providers';

// The DM's AI, as every AI feature sets it up: which AI (Ollama or LM Studio
// on this computer, or a cloud service with their own key), its address,
// the model, and a check that it answers. The settings are saved on this
// device by whoever owns them (see ../ai/providers).

export function AiSetup({
  settings,
  onChange,
  disabled = false,
  modelHint = 'e.g. qwen2.5:14b',
}: {
  settings: AiSettings;
  onChange: (patch: Partial<AiSettings>) => void;
  disabled?: boolean;
  /** An example model for the model box. */
  modelHint?: string;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const change = onChange;

  async function check() {
    setStatus({ ok: true, text: 'Checking…' });
    try {
      const found = await listModels(settings);
      setModels(found);
      // A text model first: picture models ("vl", "vision", "llava") are worse at reading rules.
      const text = found.find((model) => !/vl|vision|llava/i.test(model)) ?? found[0];
      if (!settings.model && text) change({ model: text });
      setStatus(found.length > 0 ? { ok: true, text: `Connected: ${found.length} model${found.length === 1 ? '' : 's'}` } : { ok: false, text: 'Connected, but it has no models yet: download one first.' });
    } catch (caught) {
      setStatus({ ok: false, text: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  return (
    <fieldset className="panel" disabled={disabled}>
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
          <input list="ai-models" value={settings.model} placeholder={modelHint} onChange={(event) => change({ model: event.target.value })} />
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
    </fieldset>
  );
}
