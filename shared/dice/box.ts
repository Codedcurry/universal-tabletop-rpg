import type { RollPlan } from './animation';
import { type DieShape, dieGeometry, dieShapeFor, relabel } from './polyhedra';

/**
 * Turning a roll into dice for the dice box: which shape to throw for each
 * die, which value the face on top must show, and each face's label once
 * relabelled for where it actually landed. A d100 is two d10s (tens and
 * ones), a coin is a coin, and a die with no real shape (a d7) is a cube
 * showing its value on every face.
 */

/** More than this many dice are counted, not thrown. */
export const BOX_LIMIT = 20;

export interface BoxPiece {
  readonly shape: DieShape | 'coin';
  /** The value (by the die's own numbering, 1 to sides) that must end up on top. */
  readonly wanted: number;
  /** How values are written: plain numbers, a d100's tens ("00"-"90") or ones ("0"-"9"), a coin's H/T, or one value all over. */
  readonly text: 'plain' | 'tens' | 'ones' | 'coin' | 'all';
  /** For "all": the value written on every face. */
  readonly value?: number;
  readonly dropped: boolean;
  readonly crit: 'max' | 'min' | null;
}

export function boxPieces(plan: RollPlan): { pieces: BoxPiece[]; extra: number } {
  const pieces: BoxPiece[] = [];
  for (const piece of plan.pieces) {
    const dropped = !piece.kept;
    const crit = piece.crit;
    if (piece.kind === 'coin') {
      pieces.push({ shape: 'coin', wanted: piece.face === 'heads' ? 1 : 2, text: 'coin', dropped, crit });
      continue;
    }
    const face = piece.face as number;
    if (piece.sides === 100) {
      // Read together: "00" + "0" is 100, "40" + "7" is 47, "00" + "7" is 7.
      const tens = Math.floor((face % 100) / 10);
      const ones = face % 10;
      pieces.push({ shape: 'd10', wanted: tens === 0 ? 10 : tens, text: 'tens', dropped, crit });
      pieces.push({ shape: 'd10', wanted: ones === 0 ? 10 : ones, text: 'ones', dropped, crit });
      continue;
    }
    const shape = dieShapeFor(piece.sides);
    if (shape) pieces.push({ shape, wanted: face, text: 'plain', dropped, crit });
    else pieces.push({ shape: 'd6', wanted: 1, text: 'all', value: face, dropped, crit });
  }
  return { pieces: pieces.slice(0, BOX_LIMIT), extra: Math.max(0, pieces.length - BOX_LIMIT) };
}

function write(piece: BoxPiece, value: number): string {
  if (value === 0) return '';
  switch (piece.text) {
    case 'plain':
      return String(value);
    case 'tens':
      return value === 10 ? '00' : `${value}0`;
    case 'ones':
      return value === 10 ? '0' : String(value);
    case 'coin':
      return value === 1 ? 'H' : 'T';
    case 'all':
      return String(piece.value);
  }
}

/**
 * The label on each face (for a d4, each corner) once `landed` (the face or
 * corner that ended up on top) is relabelled to show the wanted value.
 */
export function faceLabels(piece: BoxPiece, landed: number): string[] {
  const geometry = dieGeometry(piece.shape);
  const values = geometry.readBy === 'corner' ? (geometry.cornerValues as readonly number[]) : geometry.faceValues;
  const relabelled = piece.text === 'all' ? [...values] : relabel(values, landed, piece.wanted);
  return relabelled.map((value) => write(piece, value));
}
