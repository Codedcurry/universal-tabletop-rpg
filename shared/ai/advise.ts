import { readJsonReply } from './bookImport';
import type { AiProvider, StopSignal } from './provider';

/**
 * "What next?" for the DM: their AI reads what's happened (the log), the
 * creatures' state, and the adventure's text for where the party is, and
 * suggests a few things the DM could do now (a monster reacts, an NPC
 * turns up, a clue to point at), each with why. Only ever suggestions.
 */

export interface DmSuggestion {
  /** What to do, in a line. */
  readonly idea: string;
  /** Why now: what in the book or the game makes it fit. */
  readonly why: string;
}

export const ADVICE_INSTRUCTIONS = `You advise the game master of a tabletop RPG on what to do next. You get the adventure's text for where the party is (when there is one), the creatures in play, and the latest lines of the game log.
Suggest 3 things the game master could do now to keep the game moving and true to the adventure: how monsters or people here react, someone or something that could turn up, a clue, danger, or choice to put in front of the players, or how to pace the scene.
- Ground each in the adventure's text where you can (name the area, creature, or detail it comes from). Never decide what the players do.
- Reply with ONE JSON object and nothing else: {"suggestions": [{"idea": "What to do, in one sentence.", "why": "Why it fits now, in one sentence."}]}`;

/** The suggestions in a reply (up to 5), or none if it can't be read. */
export function readSuggestions(reply: string): DmSuggestion[] {
  const data = readJsonReply(reply);
  const list = Array.isArray(data?.suggestions) ? data.suggestions : [];
  return list
    .flatMap((entry): DmSuggestion[] => {
      if (typeof entry !== 'object' || entry === null) return [];
      const { idea, why } = entry as Record<string, unknown>;
      return typeof idea === 'string' && idea.trim() ? [{ idea: idea.trim(), why: typeof why === 'string' ? why.trim() : '' }] : [];
    })
    .slice(0, 5);
}

/** Asks the DM's AI what they could do next. */
export async function suggestNext(
  provider: AiProvider,
  options: { recent: readonly string[]; creatures?: readonly string[]; scene?: string; signal?: StopSignal },
): Promise<DmSuggestion[]> {
  const scene = options.scene?.trim();
  const reply = await provider.complete({
    system: ADVICE_INSTRUCTIONS,
    prompt: [
      scene ? `The adventure, where the party is:\n${scene.slice(0, 6000)}\n` : 'There is no adventure text: the game master is running their own.\n',
      options.creatures?.length ? `Creatures in play:\n${options.creatures.map((line) => `- ${line}`).join('\n')}\n` : '',
      options.recent.length > 0 ? `The latest lines of the game log:\n${options.recent.slice(-15).map((line) => `- ${line}`).join('\n')}` : 'Nothing has happened yet: the scene is just starting.',
    ].join('\n'),
    json: true,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const suggestions = readSuggestions(reply);
  if (suggestions.length === 0) throw new Error("The AI's suggestions couldn't be read: try again");
  return suggestions;
}
