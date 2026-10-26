import { type Browser, type BrowserContext, type Page, type Route, expect, test } from '@playwright/test';

// Importing a rulebook with the DM's own AI: a PDF's text is read in the
// browser and sent to the AI (here a stand-in for Ollama), and what it finds
// opens in the rules editor to check before it's used.

const openContexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((context) => context.close()));
});

async function host(browser: Browser) {
  const context = await browser.newContext();
  openContexts.push(context);
  const dm = await context.newPage();
  await dm.goto('/');
  await dm.getByLabel('Your name').fill('Dana');
  await dm.getByRole('button', { name: 'Host a game' }).click();
  await dm.getByRole('button', { name: 'New map' }).click();
  await dm.getByRole('group', { name: 'New map' }).getByRole('button', { name: 'Create' }).click();
  return dm;
}

/** A small real PDF, one line of text per page. */
function pdf(pages: string[]): { name: string; mimeType: string; buffer: Buffer } {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  pages.forEach((text, i) => {
    const stream = `BT /F1 12 Tf 50 750 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { name: 'gloom-rules.pdf', mimeType: 'application/pdf', buffer: Buffer.from(out, 'latin1') };
}

/** A stand-in for Ollama on this computer: one model, and answers from what each request's text says. */
async function fakeOllama(page: Page, prompts: string[]) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  await page.route('http://localhost:11434/api/tags', (route: Route) => route.fulfill({ headers: cors, body: JSON.stringify({ models: [{ name: 'test-model' }] }) }));
  await page.route('http://localhost:11434/api/chat', (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { model: string; messages: { content: string }[] };
    const prompt = body.messages[1]?.content ?? '';
    prompts.push(`${body.model}: ${prompt}`);
    const found = prompt.includes('CORE RULES')
      ? {
          name: 'Gloom Rules',
          stats: [{ name: 'Might', short: 'might', default: 10 }],
          defense: '10',
          abilities: [{ name: 'Bite', range: 1, target: 'enemy', attackRoll: '1d20 + @might', effects: [{ damage: '1d4' }] }],
          monsters: [{ name: 'Gloom Bat', level: 1, abilities: ['Bite'], xp: 25 }],
        }
      : {};
    return route.fulfill({ headers: cors, body: JSON.stringify({ message: { content: `Here is what I found:\n\`\`\`json\n${JSON.stringify(found)}\n\`\`\`` } }) });
  });
}

test('the DM imports a rulebook PDF with their AI, then checks and applies what it found', async ({ browser }) => {
  const dm = await host(browser);
  const prompts: string[] = [];
  await fakeOllama(dm, prompts);

  await dm.getByRole('tab', { name: 'Rules' }).click();
  const rules = dm.getByRole('tabpanel', { name: 'Rules' });
  // Next to the button: AI features need a local AI model.
  await expect(rules.getByTestId('ai-notice')).toContainText('AI features need an AI model running on your own computer');
  await rules.getByRole('button', { name: 'Import from a rulebook (AI)' }).click();
  const importer = dm.getByRole('dialog', { name: 'Import a rulebook' });
  // The notice again, and the guide to running one, open while no model is chosen.
  await expect(importer.getByRole('note', { name: 'About AI features' })).toContainText('This site doesn\x27t provide one');
  await expect(importer.getByText('ollama pull qwen2.5:14b')).toBeVisible();
  await expect(importer.getByText('ollama serve', { exact: true })).toBeVisible();

  // Ollama is the default; checking finds its model.
  await importer.getByRole('button', { name: 'Check connection' }).click();
  await expect(importer).toContainText('Connected: 1 model');
  await expect(importer.getByLabel(/^Model/)).toHaveValue('test-model');

  // The book: two pages of a PDF, read in the browser.
  await importer.getByLabel('Rulebook file').setInputFiles(pdf(['CORE RULES: Might is the only stat.', 'BESTIARY: The Gloom Bat bites for 1d4.']));
  await expect(importer).toContainText('gloom-rules.pdf: 2 pages');
  await importer.getByRole('button', { name: 'Read the book' }).click();

  // What the AI found opens in the rules editor, to check.
  const editor = dm.getByRole('dialog', { name: 'Rules editor' });
  await expect(editor).toContainText('Imported: Gloom Rules');
  await expect(editor).toContainText('Read from your book by AI: check everything');
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toMatch(/^test-model: Pages 1–2 of the book:/);
  expect(prompts[0]).toContain('BESTIARY: The Gloom Bat bites for 1d4.');
  await editor.getByRole('tab', { name: 'Monsters' }).click();
  await expect(editor.getByRole('group', { name: 'Monster Gloom Bat' })).toBeVisible();
  await editor.getByRole('button', { name: 'Apply to game' }).click();
  await expect(rules).toContainText('Gloom Rules');
  await expect(rules.getByTestId('rules-summary')).toContainText('1 stats · 1 abilities');
});

test('without an AI running, the importer says how to set one up', async ({ browser }) => {
  const dm = await host(browser);
  await dm.route('http://localhost:11434/**', (route) => route.abort('connectionrefused'));
  await dm.getByRole('tab', { name: 'Rules' }).click();
  await dm.getByRole('tabpanel', { name: 'Rules' }).getByRole('button', { name: 'Import from a rulebook (AI)' }).click();
  const importer = dm.getByRole('dialog', { name: 'Import a rulebook' });
  await importer.getByRole('button', { name: 'Check connection' }).click();
  await expect(importer.getByRole('status')).toContainText("Couldn't reach Ollama at http://localhost:11434. Is Ollama running?");
  await expect(importer.getByRole('status')).toContainText('Start it with "ollama serve"');
  await expect(importer.getByRole('status')).toContainText('OLLAMA_ORIGINS');
  // A book that isn't a PDF this browser can read says so.
  await importer.getByLabel('Rulebook file').setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf') });
  await expect(importer.getByRole('alert')).toContainText("broken.pdf isn't a PDF this browser can read");
});
