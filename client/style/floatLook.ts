import { type FloatFont, type FloatStyle, floatKindOf } from '@shared/style/floats';

// Puts the DM's number style on a floating number (over a creature, or in the
// Art tab's preview): its colour, size, lettering, and outline. How it moves is
// `floatMotion`, run each frame.

/** The usual size of each kind of number, in pixels (before the style's size). */
const BASE_SIZE: Readonly<Record<string, number>> = { damage: 22, heal: 22, miss: 18, status: 16, xp: 18 };

const FONTS: Readonly<Record<FloatFont, { family: string; weight: string; style?: string; spacing?: string }>> = {
  bold: { family: 'inherit', weight: '800' },
  serif: { family: "Georgia, 'Times New Roman', serif", weight: '600', style: 'italic' },
  pixel: { family: "ui-monospace, 'Courier New', monospace", weight: '900', spacing: '0.06em' },
  comic: { family: "'Comic Sans MS', 'Chalkboard SE', 'Comic Neue', 'Segoe Print', cursive", weight: '900' },
  mono: { family: "ui-monospace, SFMono-Regular, Consolas, monospace", weight: '800', spacing: '0.1em' },
};

export function styleFloat(element: HTMLElement, style: FloatStyle, kind: string): void {
  const look = floatKindOf(kind);
  const font = FONTS[style.font];
  element.style.color = style.colors[look];
  element.style.fontSize = `${Math.round((BASE_SIZE[look] ?? 18) * style.size)}px`;
  element.style.fontFamily = font.family;
  element.style.fontWeight = font.weight;
  element.style.fontStyle = font.style ?? 'normal';
  element.style.letterSpacing = font.spacing ?? 'normal';
  // Pixel lettering gets a hard, blocky outline; the others a soft one.
  element.style.textShadow = !style.outline
    ? '0 1px 2px rgba(0, 0, 0, 0.6)'
    : style.font === 'pixel'
      ? '2px 0 #000, -2px 0 #000, 0 2px #000, 0 -2px #000, 2px 2px #000'
      : '0 2px 3px #000, 0 0 2px #000, 0 0 1px #000';
}
