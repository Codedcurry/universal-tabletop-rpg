// A rulebook's text, page by page, read in the browser: a PDF through
// pdf.js (loaded only when needed), or a text file cut into page-sized parts.
// Scanned books (pictures of pages, no text) have nothing to read. PDF pages
// can also be drawn as pictures, for an AI that can see (a map).

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

/** One PDF page as a map: drawn as a picture, with its words' positions. */
export async function readMapPage(file: File, number: number): Promise<MapPage> {
  const pdfjs = await loadPdfjs();
  const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const page = await (await loading.promise).getPage(number);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: PICTURE_SIDE / Math.max(base.width, base.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
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
