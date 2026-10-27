// A rulebook's text, page by page, read in the browser: a PDF through
// pdf.js (loaded only when needed), or a text file cut into page-sized parts.
// Scanned books (pictures of pages, no text) have nothing to read. PDF pages
// can also be drawn as pictures, for an AI that can see (a map).

import type { PDFPageProxy } from 'pdfjs-dist';

type PdfOps = Awaited<ReturnType<typeof loadPdfjs>>['OPS'];

/** Characters per "page" of a plain text file. */
const TEXT_PAGE = 3000;

/** A book's text, page by page; `onPage` hears how far a long PDF has got. */
export async function readBookPages(file: File, onPage?: (page: number, pages: number) => void): Promise<string[]> {
  if (isPdf(file)) return readPdf(file, onPage);
  const text = await file.text();
  // Form feeds mark pages, where a text file has them.
  if (text.includes('\f')) return text.split('\f');
  const pages: string[] = [];
  for (let at = 0; at < text.length; at += TEXT_PAGE) pages.push(text.slice(at, at + TEXT_PAGE));
  return pages;
}

/** pdf.js, loaded the first time a PDF is opened. */
async function loadPdfjs() {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

export const isPdf = (file: File) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

async function readPdf(file: File, onPage?: (page: number, pages: number) => void): Promise<string[]> {
  const pdfjs = await loadPdfjs();
  const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  let pdf;
  try {
    pdf = await loading.promise;
  } catch {
    throw new Error(`${file.name} isn't a PDF this browser can read`);
  }
  const pages: string[] = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    if (number % 10 === 0) onPage?.(number, pdf.numPages);
    const content = await (await pdf.getPage(number)).getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '')).join(''));
  }
  await loading.destroy();
  if (pages.every((page) => page.trim() === '')) throw new Error(`${file.name} has no text to read: it may be scanned pictures of pages`);
  return pages;
}

/** The longest side of a page picture, in pixels: enough to read a map, small enough for a local AI. */
const PICTURE_SIDE = 1280;
/** A picture on a map page covering at least this share of it is the map (the rest is text beside it). */
const MAP_PICTURE_SHARE = 0.15;
/** A map picture is drawn at most this many times the page's own size. */
const MAX_PAGE_SCALE = 4;

/** Pages of a PDF as pictures (PNG, base64 without the data: prefix), for an AI that can see. */
export async function renderPdfPages(file: File, from: number, to: number): Promise<string[]> {
  const pdfjs = await loadPdfjs();
  const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await loading.promise;
  const pictures: string[] = [];
  for (let number = Math.max(1, from); number <= Math.min(pdf.numPages, to); number++) {
    const page = await pdf.getPage(number);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: PICTURE_SIDE / Math.max(base.width, base.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport }).promise;
    pictures.push(canvas.toDataURL('image/png').split(',')[1] ?? '');
  }
  await loading.destroy();
  return pictures;
}

/** A map page: its picture (and pixels, to trace), and where its text sits (labels), in the picture's pixels. */
export interface MapPage {
  readonly picture: string;
  readonly pixels: ImageData;
  readonly words: readonly { readonly text: string; readonly x: number; readonly y: number }[];
}

type Matrix = readonly [number, number, number, number, number, number];
const times = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/** The biggest picture drawn on a page, as [x0, y0, x1, y1] in the page's own units; null if there's none. */
async function biggestPicture(page: PDFPageProxy, ops: PdfOps): Promise<[number, number, number, number] | null> {
  const list = await page.getOperatorList();
  let matrix: Matrix = [1, 0, 0, 1, 0, 0];
  const saved: Matrix[] = [];
  let best: { box: [number, number, number, number]; area: number } | null = null;
  list.fnArray.forEach((op, index) => {
    const args = list.argsArray[index] as unknown[];
    if (op === ops.save) saved.push(matrix);
    else if (op === ops.restore) matrix = saved.pop() ?? matrix;
    else if (op === ops.transform) matrix = times(matrix, args as unknown as Matrix);
    else if (op === ops.paintFormXObjectBegin) {
      saved.push(matrix);
      if (Array.isArray(args[0]) && args[0].length === 6) matrix = times(matrix, args[0] as unknown as Matrix);
    } else if (op === ops.paintFormXObjectEnd) matrix = saved.pop() ?? matrix;
    else if (op === ops.paintImageXObject || op === ops.paintInlineImageXObject || op === ops.paintImageXObjectRepeat) {
      // A picture fills the unit square, moved into place by the current matrix.
      const corners = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map(([u, v]) => [matrix[0] * u! + matrix[2] * v! + matrix[4], matrix[1] * u! + matrix[3] * v! + matrix[5]] as const);
      const xs = corners.map(([x]) => x);
      const ys = corners.map(([, y]) => y);
      const box: [number, number, number, number] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      const area = (box[2] - box[0]) * (box[3] - box[1]);
      if (!best || area > best.area) best = { box, area };
    }
  });
  return (best as { box: [number, number, number, number] } | null)?.box ?? null;
}

/**
 * One PDF page as a map: drawn as a picture, with its words' positions. When
 * the map is a picture on the page (with the areas' text around it), only
 * that picture is drawn, at a size to trace well.
 */
export async function readMapPage(file: File, number: number): Promise<MapPage> {
  const pdfjs = await loadPdfjs();
  const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const page = await (await loading.promise).getPage(number);
    const base = page.getViewport({ scale: 1 });
    const found = await biggestPicture(page, pdfjs.OPS);
    // The picture's corners on the page as drawn (y down), if it's a good share of the page.
    const shown = found ? [...base.convertToViewportPoint(found[0], found[1]), ...base.convertToViewportPoint(found[2], found[3])] : null;
    const [left, top, right, bottom] = shown ? [Math.min(shown[0], shown[2]), Math.min(shown[1], shown[3]), Math.max(shown[0], shown[2]), Math.max(shown[1], shown[3])] : [0, 0, base.width, base.height];
    const [x0, y0] = [Math.max(0, left), Math.max(0, top)];
    const [x1, y1] = [Math.min(base.width, right), Math.min(base.height, bottom)];
    const crop = shown !== null && (x1 - x0) * (y1 - y0) >= base.width * base.height * MAP_PICTURE_SHARE;
    const region = crop ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : { x: 0, y: 0, width: base.width, height: base.height };
    const scale = crop ? Math.min(MAX_PAGE_SCALE, (PICTURE_SIDE * 1.5) / Math.max(region.width, region.height)) : PICTURE_SIDE / Math.max(base.width, base.height);
    const viewport = page.getViewport({ scale, offsetX: -region.x * scale, offsetY: -region.y * scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(region.width * scale));
    canvas.height = Math.max(1, Math.round(region.height * scale));
    await page.render({ canvas, viewport }).promise;
    const content = await page.getTextContent();
    const words = content.items.flatMap((item) => {
      if (!('str' in item) || item.str.trim() === '') return [];
      // The middle of the text, in the picture's pixels.
      const [x, y] = viewport.convertToViewportPoint(item.transform[4] + item.width / 2, item.transform[5] + item.height / 2);
      return [{ text: item.str.trim(), x, y }];
    });
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    return { picture: canvas.toDataURL('image/png').split(',')[1] ?? '', pixels: ctx.getImageData(0, 0, canvas.width, canvas.height), words };
  } finally {
    await loading.destroy();
  }
}

export const isPicture = (file: File) => /^image\/(png|jpeg|webp|gif)$/.test(file.type) || /\.(png|jpe?g|webp|gif)$/i.test(file.name);

/** A map picture (a JPG or PNG) as a map page: no words on it to place. Big pictures are scaled down. */
export function readMapPicture(file: File): Promise<MapPage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const element = new Image();
    element.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, (PICTURE_SIDE * 1.5) / Math.max(element.naturalWidth, element.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(element.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(element.naturalHeight * scale));
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      ctx.drawImage(element, 0, 0, canvas.width, canvas.height);
      resolve({ picture: canvas.toDataURL('image/png').split(',')[1] ?? '', pixels: ctx.getImageData(0, 0, canvas.width, canvas.height), words: [] });
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`${file.name} isn't a picture this browser can show`));
    };
    element.src = url;
  });
}
