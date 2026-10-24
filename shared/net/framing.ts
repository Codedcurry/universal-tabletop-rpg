/**
 * PeerJS refuses any message of 16,300 bytes or more on a JSON channel, but a
 * big map or a session snapshot is far larger. Big messages are sent as
 * numbered frames that each fit, and reassembled on arrival.
 */

/** Every frame, as JSON, stays below this many bytes. */
export const FRAME_BYTE_LIMIT = 16_000;
/**
 * Characters of message text per frame. JSON escaping can grow one character
 * to at most 6 bytes (\u0001), so 2,500 characters always fit.
 */
const CHUNK_CHARS = 2_500;

interface Frame {
  readonly __frame: 1;
  /** Which message this frame belongs to (unique per sender). */
  readonly id: number;
  readonly index: number;
  readonly count: number;
  readonly data: string;
}

/** Bytes a string takes as UTF-8. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4; // a surrogate pair is one 4-byte character
        i++;
      } else {
        bytes += 3;
      }
    } else bytes += 3;
  }
  return bytes;
}

/** The message itself if it fits, otherwise frames to send in order. */
export function splitIntoFrames(message: unknown, id: number): unknown[] {
  const json = JSON.stringify(message);
  if (utf8Length(json) < FRAME_BYTE_LIMIT) return [message];
  const count = Math.ceil(json.length / CHUNK_CHARS);
  return Array.from({ length: count }, (_, index): Frame => ({
    __frame: 1,
    id,
    index,
    count,
    data: json.slice(index * CHUNK_CHARS, (index + 1) * CHUNK_CHARS),
  }));
}

interface Pending {
  readonly parts: (string | undefined)[];
  received: number;
}

export interface AssemblerOptions {
  /** Largest message accepted, in characters of JSON. Protects against hostile senders. */
  readonly maxMessageChars: number;
  /** Unfinished messages kept at once; the oldest is dropped to make room. */
  readonly maxPending?: number;
}

/** Reassembles framed messages from one sender. Ordinary messages pass straight through. */
export class FrameAssembler {
  private readonly pending = new Map<number, Pending>();
  private readonly maxCount: number;
  private readonly maxPending: number;

  constructor(options: AssemblerOptions) {
    this.maxCount = Math.ceil(options.maxMessageChars / CHUNK_CHARS);
    this.maxPending = options.maxPending ?? 4;
  }

  /** Returns a complete message, or null while frames are still arriving (or for bad frames). */
  receive(data: unknown): unknown {
    if (typeof data !== 'object' || data === null || (data as { __frame?: unknown }).__frame !== 1) return data;
    const { id, index, count, data: text } = data as Partial<Frame>;
    const valid =
      Number.isSafeInteger(id) &&
      Number.isInteger(count) &&
      Number.isInteger(index) &&
      (count as number) >= 1 &&
      (count as number) <= this.maxCount &&
      (index as number) >= 0 &&
      (index as number) < (count as number) &&
      typeof text === 'string' &&
      text.length <= CHUNK_CHARS;
    if (!valid) return null;

    let entry = this.pending.get(id as number);
    if (!entry || entry.parts.length !== count) {
      if (this.pending.size >= this.maxPending) {
        const oldest = this.pending.keys().next().value as number;
        this.pending.delete(oldest);
      }
      entry = { parts: new Array<string | undefined>(count as number), received: 0 };
      this.pending.set(id as number, entry);
    }
    if (entry.parts[index as number] === undefined) {
      entry.parts[index as number] = text;
      entry.received++;
    }
    if (entry.received < (count as number)) return null;

    this.pending.delete(id as number);
    try {
      return JSON.parse(entry.parts.join(''));
    } catch {
      return null;
    }
  }
}
