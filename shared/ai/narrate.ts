import type { AiProvider, StopSignal } from './provider';

/**
 * Narration suggestions for the DM: what just happened (the latest lines of
 * the game log) and where (the scene's description from the DM's book, if
 * the map came from one) turned into a line or two to read out or send.
 * Only ever a suggestion: the DM edits it, sends it, or drops it.
 */

export const NARRATION_TONES = ['vivid', 'grim', 'light-hearted', 'epic'] as const;
export type NarrationTone = (typeof NARRATION_TONES)[number];

/** How many of the latest log lines go with the request. */
export const NARRATION_LINES = 10;

export const NARRATION_INSTRUCTIONS = `You help the game master of a tabletop RPG narrate. You get the latest lines of the game log (attacks, damage, moves, chat) and, sometimes, the scene's description from the adventure.
Write 1 to 3 short sentences of narration describing the most recent action as a scene the players can picture: sights, sounds, how it looks and feels. Write it in the present tense, to be read aloud to the players.
- Describe only what the log says happened, and keep its outcome (a miss is a miss, someone down is down). Never invent new events, rolls, numbers, or decisions for the players.
- No game terms (HP, rolls, defense, turns), no headings, no quotation marks around the whole thing. Reply with the narration only.`;

/** A reply tidied into plain narration: no quotes around it, no "Narration:" label, no markdown. */
export function tidyNarration(reply: string): string {
  return reply
    .trim()
    .replace(/^(?:narration|gm|dm)\s*:\s*/i, '')
    .replace(/^["“'](.*)["”']$/s, '$1')
    .replace(/[*_#`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Asks the DM's AI for narration of what just happened. */
export async function suggestNarration(
  provider: AiProvider,
  options: { recent: readonly string[]; scene?: string; tone?: NarrationTone; signal?: StopSignal },
): Promise<string> {
  const lines = options.recent.slice(-NARRATION_LINES);
  if (lines.length === 0) throw new Error('Nothing has happened yet to narrate');
  const scene = options.scene?.trim();
  const reply = await provider.complete({
    system: NARRATION_INSTRUCTIONS,
    prompt: [
      scene ? `The scene, from the adventure:\n${scene.slice(0, 3000)}\n` : '',
      `The latest lines of the game log (the last is what just happened):\n${lines.map((line) => `- ${line}`).join('\n')}`,
      `\nTone: ${options.tone ?? 'vivid'}.`,
    ].join('\n'),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const text = tidyNarration(reply);
  if (text === '') throw new Error("The AI didn't suggest anything: try again");
  return text;
}
