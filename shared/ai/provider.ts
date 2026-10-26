/**
 * The one interface every AI goes through (a local model, a free API tier,
 * or the user's own key), so features don't care which is plugged in.
 * Nothing here is billed to anyone but the user, and nothing is sent
 * anywhere the user didn't choose.
 */
export interface AiProvider {
  /** For messages ("Ollama: llama3.1"). */
  readonly label: string;
  /** One reply to one request. Rejects on a network or model error, or when `signal` aborts. */
  complete(request: AiRequest): Promise<string>;
}

export interface AiRequest {
  /** How the model should behave: the instructions. */
  readonly system: string;
  /** What to work on. */
  readonly prompt: string;
  /** Ask for a JSON reply, where the provider supports it. */
  readonly json?: boolean;
  readonly signal?: StopSignal;
}

/** Enough of an AbortSignal to stop work (the shared code is built without browser types; pass a real one). */
export interface StopSignal {
  readonly aborted: boolean;
  throwIfAborted(): void;
}
