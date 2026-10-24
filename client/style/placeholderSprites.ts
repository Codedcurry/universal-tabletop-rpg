import type { SpriteDirection } from '@shared/camera';

// Placeholder character art drawn in code, until real sprite sheets arrive
// with style packs (step 13). Each figure has only an idle frame per
// direction, so every action uses the fallback motions.

export const SPRITE_WIDTH = 16;
export const SPRITE_HEIGHT = 24;

/** Team colors: the player's party, monsters, anyone else. */
export function teamColor(side: string): string {
  if (side === 'party') return '#4a7fd6';
  if (side === 'monsters') return '#c84a3a';
  return '#4aa86a';
}

function shade(hex: string, amount: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number) => Math.max(0, Math.min(255, ((value >> shift) & 255) + amount));
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

/** A 16 x 24 pixel figure facing `direction` (as seen on screen). */
export function drawFigure(context: CanvasRenderingContext2D, direction: SpriteDirection, color: string): void {
  const px = (x: number, y: number, w: number, h: number, fill: string) => {
    context.fillStyle = fill;
    context.fillRect(x, y, w, h);
  };
  context.clearRect(0, 0, SPRITE_WIDTH, SPRITE_HEIGHT);
  const skin = '#f1c9a0';
  const hair = '#5a3a22';
  const outline = '#1d1a26';

  // Legs and boots.
  px(5, 19, 2, 4, '#3b3346');
  px(9, 19, 2, 4, '#3b3346');
  px(4, 22, 3, 2, outline);
  px(9, 22, 3, 2, outline);
  // Body (tunic) with an outline and a belt.
  px(3, 10, 10, 10, outline);
  px(4, 11, 8, 8, color);
  px(4, 16, 8, 1, shade(color, -60));
  // Arms.
  px(2, 11, 2, 6, shade(color, -30));
  px(12, 11, 2, 6, shade(color, -30));
  // Head.
  px(4, 2, 8, 8, outline);
  px(5, 3, 6, 6, skin);
  px(5, 2, 6, 2, hair);

  switch (direction) {
    case 'down': // facing the viewer
      px(6, 5, 1, 1, outline);
      px(9, 5, 1, 1, outline);
      px(7, 7, 2, 1, '#c07a5a');
      break;
    case 'up': // seen from behind: all hair
      px(5, 3, 6, 6, hair);
      break;
    case 'left':
      px(5, 3, 2, 6, hair);
      px(5, 5, 1, 1, outline);
      px(4, 6, 1, 1, skin);
      break;
    case 'right':
      px(9, 3, 2, 6, hair);
      px(10, 5, 1, 1, outline);
      px(11, 6, 1, 1, skin);
      break;
  }
}

/** A round top-down token: team-colored ring with the creature's initial. */
export function drawRoundToken(context: CanvasRenderingContext2D, size: number, name: string, color: string): void {
  context.clearRect(0, 0, size, size);
  const r = size / 2;
  context.beginPath();
  context.arc(r, r, r - 2, 0, Math.PI * 2);
  context.fillStyle = '#1f1b2b';
  context.fill();
  context.lineWidth = size * 0.1;
  context.strokeStyle = color;
  context.stroke();
  context.fillStyle = '#ece8f4';
  context.font = `bold ${Math.round(size * 0.45)}px system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText((name.trim()[0] ?? '?').toUpperCase(), r, r + size * 0.03);
}
