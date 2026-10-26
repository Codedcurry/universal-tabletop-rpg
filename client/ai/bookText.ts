// A rulebook's text, page by page, read in the browser: a PDF through
// pdf.js (loaded only when needed), or a text file cut into page-sized parts.
// Scanned books (pictures of pages, no text) have nothing to read.

/** Characters per "page" of a plain text file. */
const TEXT_PAGE = 3000;

export async function readBookPages(file: File): Promise<string[]> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) return readPdf(file);
  const text = await file.text();
  // Form feeds mark pages, where a text file has them.
  if (text.includes('\f')) return text.split('\f');
  const pages: string[] = [];
  for (let at = 0; at < text.length; at += TEXT_PAGE) pages.push(text.slice(at, at + TEXT_PAGE));
  return pages;
}

async function readPdf(file: File): Promise<string[]> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  let pdf;
  try {
    pdf = await loading.promise;
  } catch {
    throw new Error(`${file.name} isn't a PDF this browser can read`);
  }
  const pages: string[] = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    const content = await (await pdf.getPage(number)).getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '')).join(''));
  }
  await loading.destroy();
  if (pages.every((page) => page.trim() === '')) throw new Error(`${file.name} has no text to read: it may be scanned pictures of pages`);
  return pages;
}
