import type { AiProvider, AiRequest } from '@shared/ai';

// The AIs the DM can plug in: Ollama or LM Studio running on their own
// computer (free, private), or any OpenAI-compatible service with their own
// key (free tiers included). Settings, the key included, stay on this
// device: they're never sent to players or saved with the game.

export type AiKind = 'ollama' | 'lmstudio' | 'openai';

export interface AiSettings {
  readonly kind: AiKind;
  /** The service's address (its API base). */
  readonly baseUrl: string;
  readonly model: string;
  /** Only for other services. */
  readonly apiKey: string;
}

export const AI_KINDS: readonly { id: AiKind; label: string; baseUrl: string }[] = [
  { id: 'ollama', label: 'Ollama, on this computer', baseUrl: 'http://localhost:11434' },
  { id: 'lmstudio', label: 'LM Studio, on this computer', baseUrl: 'http://localhost:1234/v1' },
  { id: 'openai', label: 'Another service (OpenAI-compatible, your own key)', baseUrl: 'https://api.groq.com/openai/v1' },
];

const STORAGE_KEY = 'ttrpg.ai';

export const DEFAULT_AI: AiSettings = { kind: 'ollama', baseUrl: AI_KINDS[0]!.baseUrl, model: '', apiKey: '' };

export function loadAiSettings(): AiSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<AiSettings> | null;
    if (!saved || !AI_KINDS.some((kind) => kind.id === saved.kind)) return DEFAULT_AI;
    return { ...DEFAULT_AI, ...saved };
  } catch {
    return DEFAULT_AI;
  }
}

export function saveAiSettings(settings: AiSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing: the settings last until the page closes.
  }
}

const base = (settings: AiSettings) => settings.baseUrl.replace(/\/+$/, '');

/** A plain message for a request that failed: most often the AI isn't running, or doesn't allow this site. */
function unreachable(settings: AiSettings, error: unknown): Error {
  if (error instanceof DOMException && error.name === 'AbortError') return error;
  const name = AI_KINDS.find((kind) => kind.id === settings.kind)?.label.split(',')[0] ?? 'The AI';
  const fix =
    settings.kind === 'ollama'
      ? `Is Ollama running? It must also allow this site: set OLLAMA_ORIGINS to ${location.origin} and restart it.`
      : settings.kind === 'lmstudio'
        ? 'Is LM Studio\'s server running, with "Enable CORS" on?'
        : 'Check the address and your key.';
  return new Error(`Couldn't reach ${name} at ${base(settings)}. ${fix}`);
}

async function call(settings: AiSettings, path: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${base(settings)}${path}`, init);
  } catch (error) {
    throw unreachable(settings, error);
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error(`The AI answered ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return response.json();
}

const headers = (settings: AiSettings): Record<string, string> =>
  settings.kind === 'openai' && settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' } : {};

/** The models the AI has, to pick from. */
export async function listModels(settings: AiSettings): Promise<string[]> {
  if (settings.kind === 'ollama') {
    const data = (await call(settings, '/api/tags')) as { models?: { name?: string }[] };
    return (data.models ?? []).flatMap((model) => (model.name ? [model.name] : []));
  }
  const data = (await call(settings, '/models', { headers: headers(settings) })) as { data?: { id?: string }[] };
  return (data.data ?? []).flatMap((model) => (model.id ? [model.id] : []));
}

/** The AI as a provider for the app's features. */
export function makeProvider(settings: AiSettings): AiProvider {
  const messages = (request: AiRequest) => [
    { role: 'system', content: request.system },
    { role: 'user', content: request.prompt },
  ];
  const signal = (request: AiRequest) => (request.signal ? { signal: request.signal as AbortSignal } : {});
  if (settings.kind === 'ollama') {
    return {
      label: `Ollama: ${settings.model}`,
      async complete(request) {
        // A plain-text body keeps it a "simple" request (no CORS preflight); Ollama reads it as JSON anyway.
        const data = (await call(settings, '/api/chat', {
          method: 'POST',
          body: JSON.stringify({
            model: settings.model,
            messages: messages(request),
            stream: false,
            ...(request.json ? { format: 'json' } : {}),
            options: { temperature: 0.1, num_ctx: 8192 },
          }),
          ...signal(request),
        })) as { message?: { content?: string } };
        return data.message?.content ?? '';
      },
    };
  }
  return {
    label: `${settings.kind === 'lmstudio' ? 'LM Studio' : base(settings)}: ${settings.model}`,
    async complete(request) {
      const data = (await call(settings, '/chat/completions', {
        method: 'POST',
        headers: headers(settings),
        body: JSON.stringify({ model: settings.model, messages: messages(request), temperature: 0.1 }),
        ...signal(request),
      })) as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content ?? '';
    },
  };
}
