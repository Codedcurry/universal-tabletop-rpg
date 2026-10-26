import { type Browser, type BrowserContext, type Page, type Route, expect, test } from '@playwright/test';

// The Books tab: the DM's books added once, their rules read together by the
// DM's AI (here a stand-in for Ollama) and reviewed change by change, and the
// maps found in them made in a click: traced from the page, furnished from
// the areas' descriptions, previewed, and used (Undo brings the old map back).

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

/** A small real PDF from each page's drawing commands (Helvetica as F1). */
function pdf(name: string, pages: string[]) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  pages.forEach((stream, i) => {
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
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(out, 'latin1') };
}

/** Lines of text down a page. */
const text = (lines: string[], color = '0 g') => lines.map((line, i) => `BT ${color} /F1 10 Tf 40 ${750 - i * 14} Td (${line}) Tj ET`).join('\n');
const filler = 'The stones are old and the air is cold, and something waits in the dark beyond.';

/** A map page: a 20-point grid, two walled rooms side by side, orange labels inside them. */
function mapPage(): string {
  const grid: string[] = ['0.85 G 0.6 w'];
  for (let x = 100; x <= 500; x += 20) grid.push(`${x} 200 m ${x} 600 l S`);
  for (let y = 200; y <= 600; y += 20) grid.push(`100 ${y} m 500 ${y} l S`);
  // Walls: squares 20 points, filled black. The rooms: columns 2-9 and 11-16, rows 3-10, walls around each.
  const square = (column: number, row: number) => `${100 + column * 20} ${600 - (row + 1) * 20} 20 20 re`;
  const walls: string[] = [];
  for (const [c0, c1] of [
    [2, 10],
    [10, 17],
  ] as const) {
    for (let c = c0; c <= c1; c++) walls.push(square(c, 3), square(c, 11));
    for (let r = 3; r <= 11; r++) walls.push(square(c0, r), square(c1, r));
  }
  const labels = 'BT 1 0.55 0 rg /F1 9 Tf 150 450 Td (Great Hall 1) Tj ET\nBT 1 0.55 0 rg /F1 9 Tf 330 450 Td (Vault 2) Tj ET';
  return `${grid.join('\n')}\n0 g\n${walls.join('\n')}\nf\n${labels}`;
}

const rulebook = () =>
  pdf('Gloom Rules [2.0].pdf', [text(['CORE RULES: Might is the only stat. Defense is 10.', ...Array.from({ length: 12 }, () => filler)])]);
const adventure = () =>
  pdf("The Gloom Vault.pdf", [
    text(['THE GLOOM VAULT', 'An adventure for brave fools.']),
    mapPage(),
    text([`1 GREAT HALL Long tables (dusty). ${filler}`, ...Array.from({ length: 10 }, () => filler)]),
    text([`2 VAULT A golden idol (on a plinth). ${filler}`, ...Array.from({ length: 10 }, () => filler)]),
  ]);

/** A stand-in for Ollama on this computer: one model, and answers by what each request asks. */
async function fakeOllama(page: Page, asked: string[]) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  await page.route('http://localhost:11434/api/tags', (route: Route) => route.fulfill({ headers: cors, body: JSON.stringify({ models: [{ name: 'test-model' }] }) }));
  await page.route('http://localhost:11434/api/chat', (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { messages: { content: string }[] };
    const [instructions, prompt] = [body.messages[0]?.content ?? '', body.messages[1]?.content ?? ''];
    asked.push(prompt.slice(0, 120));
    let answer: object = {};
    if (instructions.startsWith('You make a small 3D model')) {
      const bed = { name: 'Makeshift bed', blocks: false, blocksSight: false, parts: [{ shape: 'box', size: [0.7, 0.03, 0.9], color: '#8b5a3c' }] };
      return route.fulfill({ headers: cors, body: JSON.stringify({ message: { content: JSON.stringify(bed) } }) });
    }
    if (instructions.startsWith('You advise the game master')) {
      const ideas = { suggestions: [{ idea: 'The bats stir in the rafters.', why: 'Area 1 says they wake at noise.' }] };
      return route.fulfill({ headers: cors, body: JSON.stringify({ message: { content: JSON.stringify(ideas) } }) });
    }
    if (instructions.startsWith('You help the game master')) {
      return route.fulfill({ headers: cors, body: JSON.stringify({ message: { content: 'Narration: "Dust drifts down from the vaulted ceiling."' } }) });
    }
    if (instructions.startsWith('You furnish a battle map')) {
      answer = {
        layout: 'The idol in the middle of the vault, a table in the hall.',
        newObjects: [{ name: 'Golden idol', blocks: true, blocksSight: false, parts: [{ shape: 'cone', size: [0.4, 0.8, 0.4], color: '#e0b44c', glow: true }] }],
        objects: [
          { kind: 'Golden idol', area: '2', where: 'centre' },
          { kind: 'table', area: '1', where: 'centre' },
        ],
      };
    } else if (instructions.startsWith('You turn the description')) {
      answer = { possible: false, reason: 'That page describes no place.', guide: ['Make a small room.'] };
    } else {
      // The books are small: one section can hold pages of both.
      if (prompt.includes('CORE RULES')) {
        answer = { name: 'Gloom Rules', stats: [{ name: 'Might', short: 'might' }], defense: '10', abilities: [{ name: 'Bite', attackRoll: '1d20', effects: [{ damage: '1d4' }] }] };
      }
      if (prompt.includes('GREAT HALL')) answer = { ...answer, monsters: [{ name: 'Gloom Bat', abilities: ['Bite'], xp: 25 }] };
    }
    return route.fulfill({ headers: cors, body: JSON.stringify({ message: { content: JSON.stringify(answer) } }) });
  });
}

async function openBooks(dm: Page) {
  await dm.getByRole('tab', { name: 'Books' }).click();
  const books = dm.getByRole('tabpanel', { name: 'Books' });
  await expect(books.getByTestId('ai-notice')).toContainText('AI features need an AI model running on your own computer');
  await books.getByRole('button', { name: 'Check connection' }).click();
  await expect(books.getByLabel(/^Model/)).toHaveValue('test-model');
  await books.getByLabel('Add books').setInputFiles([rulebook(), adventure()]);
  await expect(books.getByRole('list', { name: 'Books' }).getByRole('listitem')).toHaveCount(2);
  return books;
}

test('the DM adds books once: their rules are read together and reviewed, and a map found in them is made and used', async ({ browser }) => {
  const dm = await host(browser);
  const asked: string[] = [];
  await fakeOllama(dm, asked);
  // The Rules tab points to the Books tab.
  await dm.getByRole('tab', { name: 'Rules' }).click();
  await dm.getByRole('tabpanel', { name: 'Rules' }).getByRole('button', { name: 'Read rules from your books (AI)' }).click();
  await expect(dm.getByRole('tab', { name: 'Books' })).toHaveAttribute('aria-selected', 'true');

  const books = await openBooks(dm);
  const list = books.getByRole('list', { name: 'Books' });
  await expect(list).toContainText('Gloom Rules · 1 pages');
  await expect(list).toContainText('The Gloom Vault · 4 pages · 1 map');

  // Rules, from both books together: the bat from the adventure uses the rulebook's Bite.
  await books.getByRole('button', { name: 'Read the rules from 2 books' }).click();
  const review = dm.getByRole('dialog', { name: 'Review the changes' });
  await expect(review.getByRole('group', { name: 'Add Monster: Gloom Bat', exact: true })).toContainText('abilities: Bite');
  expect(asked.some((prompt) => prompt.startsWith('Gloom Rules, page 1'))).toBe(true);
  await review.getByRole('button', { name: /^Apply \d+ changes$/ }).click();
  await expect(books.getByRole('status')).toContainText('Rules updated');

  // The map found: traced, furnished, previewed, used.
  const before = await dm.getByTestId('map-summary').textContent();
  const maps = books.getByRole('list', { name: 'Maps found' });
  await expect(maps).toContainText('1 Great Hall, 2 Vault');
  await maps.getByRole('button', { name: 'Make this map' }).click();
  const result = books.getByRole('region', { name: 'The map' });
  await expect(result).toContainText('Great Hall, Vault');
  await expect(result).toContainText('Made for this map: Golden idol.');
  await expect(result.getByRole('img', { name: /^Preview: a \d+ by \d+ square map$/ })).toBeVisible();
  await result.getByRole('button', { name: 'Use this map' }).click();
  await expect(dm.getByTestId('map-summary')).not.toHaveText(before ?? '');
  // The book's own art lies on the floor.
  await expect(dm.getByTestId('world-canvas')).toHaveAttribute('data-backdrop', 'on');

  // In the Map tab, Undo brings the old map back.
  await dm.getByRole('tab', { name: 'Map' }).click();
  await dm.getByRole('button', { name: 'Undo' }).click();
  await expect(dm.getByTestId('map-summary')).toHaveText(before ?? '');
});

test('a page with no map grid: the AI lays it out from the text, or explains how to set it up', async ({ browser }) => {
  const dm = await host(browser);
  await fakeOllama(dm, []);
  const books = await openBooks(dm);
  await books.getByLabel(/^Or a page of/).selectOption({ label: 'Gloom Rules' });
  await books.getByRole('button', { name: 'Make a map from this page' }).click();
  const guide = books.getByRole('region', { name: 'How to set up this map' });
  await expect(guide).toContainText('No map from that page: That page describes no place.');
  await expect(guide.getByRole('listitem')).toHaveText(['Make a small room.']);
});

test('without an AI running, the Books tab says how to set one up', async ({ browser }) => {
  const dm = await host(browser);
  await dm.route('http://localhost:11434/**', (route) => route.abort('connectionrefused'));
  await dm.getByRole('tab', { name: 'Books' }).click();
  const books = dm.getByRole('tabpanel', { name: 'Books' });
  await expect(books.getByRole('note', { name: 'About AI features' })).toContainText("This site doesn't provide one");
  await expect(books.getByText('ollama pull qwen2.5:14b')).toBeVisible();
  await books.getByRole('button', { name: 'Check connection' }).click();
  await expect(books.getByRole('status')).toContainText("Couldn't reach Ollama at http://localhost:11434. Is Ollama running?");
  await books.getByLabel('Add books').setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf') });
  await expect(books.getByRole('alert')).toContainText("broken.pdf isn't a PDF this browser can read");
});

test('the DM gets a narration suggestion from their AI, edits it, and sends it to everyone', async ({ browser }) => {
  const dm = await host(browser);
  const asked: string[] = [];
  await fakeOllama(dm, asked);
  const narration = dm.getByRole('region', { name: 'DM help' });
  // No AI set up yet: it says where to set it up.
  await narration.getByRole('button', { name: 'Suggest narration' }).click();
  await expect(narration).toContainText('Set up your AI in the Books tab first.');

  await openBooks(dm);
  await dm.getByLabel('Message').fill('The party enters the crypt.');
  await dm.getByRole('button', { name: 'Send' }).click();
  await narration.getByLabel(/^Tone/).selectOption('grim');
  await narration.getByRole('button', { name: 'Suggest narration' }).click();
  const suggestion = narration.getByLabel(/^Suggested narration/);
  await expect(suggestion).toHaveValue('Dust drifts down from the vaulted ceiling.');
  expect(asked.at(-1)).toContain('The latest lines of the game log');
  await suggestion.fill('Dust drifts down from the vaulted ceiling, and something stirs.');
  await narration.getByRole('button', { name: 'Send to everyone' }).click();
  await expect(dm.getByTestId('log').getByText('Dust drifts down from the vaulted ceiling, and something stirs.')).toBeVisible();
  await expect(suggestion).toHaveCount(0);

  // What next? A few ideas, with why.
  await narration.getByRole('button', { name: 'What next?' }).click();
  const ideas = narration.getByRole('group', { name: 'What you could do next' });
  await expect(ideas.getByRole('listitem')).toHaveText(['The bats stir in the rafters. Area 1 says they wake at noise.']);
});

test('the DM describes an object, their AI makes it, and it is added to the map, ready to place', async ({ browser }) => {
  const dm = await host(browser);
  await fakeOllama(dm, []);
  await openBooks(dm);
  await dm.getByRole('tab', { name: 'Map' }).click();
  await dm.getByRole('button', { name: 'Objects', exact: true }).click();
  const maker = dm.getByRole('group', { name: 'Make something new' });
  await maker.getByLabel('Describe something to make').fill('a makeshift bed: a rug on the floor');
  await maker.getByRole('button', { name: 'Make it (AI)' }).click();
  await expect(maker).toContainText('Makeshift bed · 1 part');
  await maker.getByRole('button', { name: 'Add to this map' }).click();
  // It's picked in the object tool, under the map's own.
  await expect(dm.getByRole('combobox', { name: /^Object/ })).toHaveValue('makeshift_bed');
  await expect(dm.locator(`optgroup[label="This map's own"] option[value="makeshift_bed"]`)).toBeAttached();
  // Undo takes it away again.
  await dm.getByRole('button', { name: 'Undo' }).click();
  await expect(dm.locator('option[value="makeshift_bed"]')).toHaveCount(0);
});

/** A battle map picture, as a JPG: a light grid, two walled rooms side by side. */
async function mapPicture(page: Page) {
  const dataUrl = await page.evaluate(() => {
    const square = 30;
    const canvas = document.createElement('canvas');
    canvas.width = 20 * square;
    canvas.height = 14 * square;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fdfdfd';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#d8d8d8';
    for (let x = 0; x <= canvas.width; x += square) ctx.strokeRect(x, 0, 0, canvas.height);
    for (let y = 0; y <= canvas.height; y += square) ctx.strokeRect(0, y, canvas.width, 0);
    ctx.fillStyle = '#202020';
    for (const [c0, c1] of [[2, 9], [9, 16]] as const) {
      for (let c = c0; c <= c1; c++) for (const r of [2, 10]) ctx.fillRect(c * square, r * square, square, square);
      for (let r = 2; r <= 10; r++) for (const c of [c0, c1]) ctx.fillRect(c * square, r * square, square, square);
    }
    return canvas.toDataURL('image/jpeg', 0.92);
  });
  return { name: 'cellar map.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64') };
}

test('the DM adds a JPG map picture: traced and furnished from their own description', async ({ browser }) => {
  const dm = await host(browser);
  const asked: string[] = [];
  await fakeOllama(dm, asked);
  await dm.getByRole('tab', { name: 'Books' }).click();
  const books = dm.getByRole('tabpanel', { name: 'Books' });
  await books.getByRole('button', { name: 'Check connection' }).click();
  await expect(books.getByLabel(/^Model/)).toHaveValue('test-model');
  await books.getByLabel('Add books').setInputFiles(await mapPicture(dm));
  await expect(books.getByRole('list', { name: 'Books' })).toContainText('cellar map · map picture');
  await books.getByLabel(/^Describe the encounter/).fill('A wine cellar: a golden idol in the east room, a table in the west.');
  await books.getByRole('list', { name: 'Maps found' }).getByRole('button', { name: 'Make this map' }).click();
  const result = books.getByRole('region', { name: 'The map' });
  await expect(result).toContainText('cellar map');
  await expect(result).toContainText('Made for this map: Golden idol.');
  expect(asked.at(-1)).toContain('The map (');
  await result.getByRole('button', { name: 'Use this map' }).click();
  await expect(dm.getByTestId('map-summary')).toContainText('square map');
});
