import type { CustomObject } from '../map';
import { readJsonReply } from './bookImport';
import { madeObjects } from './mapPlan';
import type { AiProvider, StopSignal } from './provider';

/**
 * An object the DM describes in their own words ("a makeshift bed: a rug on
 * the floor"), made by their AI from simple shapes, for the map they're
 * building: no book needed.
 */

export const OBJECT_INSTRUCTIONS = `You make a small 3D model of an object for a tabletop RPG battle map, from the game master's description, out of simple shapes.
Reply with ONE JSON object and nothing else:
{"name": "Makeshift bed", "blocks": false, "blocksSight": false, "parts": [{"shape": "box", "size": [0.7, 0.04, 0.9], "color": "#8b5a3c"}, {"shape": "box", "size": [0.3, 0.08, 0.2], "at": [0, 0.04, -0.3], "color": "#d8cbb0"}]}
- 1 to 8 parts. shape is box, cylinder, cone, or sphere; size is [width, height, depth] in tiles (1 = a whole 5-foot tile; a person is about 0.4 wide and 1 tall; a flat rug is about 0.03 tall); "at" is where the part's bottom middle sits, [across, up, along] from the tile's centre (stack parts by raising "at"); color is #rrggbb, true to the description; "glow": true for magic, flames, and crystals.
- "blocks": whether it fills the tile so no one can stand there (a wardrobe yes, a rug no); "blocksSight": whether it's tall enough to hide what's behind it.
- "name": short, in the game master's words.`;

/** Asks the DM's AI to make an object from a description. */
export async function makeObject(provider: AiProvider, description: string, options: { signal?: StopSignal; taken?: readonly string[] } = {}): Promise<CustomObject> {
  const wanted = description.trim();
  if (wanted === '') throw new Error('Describe the object first');
  const reply = await provider.complete({
    system: OBJECT_INSTRUCTIONS,
    prompt: `Make this: ${wanted.slice(0, 500)}`,
    json: true,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const [object] = madeObjects([readJsonReply(reply) ?? {}]);
  if (!object) throw new Error("The AI's object couldn't be read: try again, or describe it differently");
  // Not the id of one the map already has.
  let id = object.id;
  for (let n = 2; options.taken?.includes(id); n++) id = `${object.id}_${n}`;
  return { ...object, id };
}
