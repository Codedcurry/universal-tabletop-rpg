import { type Browser, type BrowserContext, type Route, expect, test } from '@playwright/test';

// A map from a book: the encounter's text goes to the DM's AI (here a
// stand-in for Ollama), which writes a map plan; it's previewed, then
// replaces the map (Undo brings the old one back). When the pages don't
// describe a place, the AI explains how to set the map up instead.

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

const shrine = {
  possible: true,
  layout: 'A shrine 8 by 6 tiles with a door on the south wall, and a yard below.',
  name: 'Drowned Shrine',
  grid: 'square',
  width: 12,
  height: 12,
  ground: 'grass',
  areas: [{ terrain: 'stone', x: 2, y: 1, w: 8, h: 6 }],
  walls: [
    { x1: 2, y1: 1, x2: 9, y2: 1 },
    { x1: 2, y1: 6, x2: 9, y2: 6 },
  ],
  doors: [{ x: 5, y: 6 }],
  objects: [{ kind: 'pillar', x: 4, y: 3 }, { kind: 'dead_tree', x: 5, y: 9 }],
};

async function fakeOllama(dm: import('@playwright/test').Page) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  await dm.route('http://localhost:11434/api/tags', (route: Route) => route.fulfill({ headers: cors, body: JSON.stringify({ models: [{ name: 'test-model' }] }) }));
  await dm.route('http://localhost:11434/api/chat', (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { messages: { content: string }[] };
    const prompt = body.messages[1]?.content ?? '';
    const answer = prompt.includes('SHRINE')
      ? shrine
      : { possible: false, reason: 'The page only describes a merchant.', guide: ['Make a small market square.', 'Put Grimsby behind a table.'] };
    return route.fulfill({ headers: cors, body: JSON.stringify({ message: { content: JSON.stringify(answer) } }) });
  });
}

const book = (text: string) => ({ name: 'adventure.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });

test('the DM makes a map from an encounter\'s text, previews it, uses it, and can undo it', async ({ browser }) => {
  const dm = await host(browser);
  await fakeOllama(dm);
  const before = await dm.getByTestId('map-summary').textContent();
  await dm.getByRole('tab', { name: 'Map' }).click();
  await dm.getByRole('button', { name: 'From a book (AI)' }).click();
  const maker = dm.getByRole('dialog', { name: 'Map from a book' });
  await expect(maker.getByRole('note', { name: 'About AI features' })).toBeVisible();
  await maker.getByRole('button', { name: 'Check connection' }).click();
  await expect(maker.getByLabel(/^Model/)).toHaveValue('test-model');
  await maker.getByLabel('Book file').setInputFiles(book('AREA 3: THE DROWNED SHRINE. A stone shrine 40 feet wide...'));
  // A text file: only its text can be read, not pictures.
  await expect(maker.getByRole('radio', { name: /^The map pictures/ })).toBeDisabled();
  await maker.getByRole('button', { name: 'Make the map' }).click();

  const result = maker.getByRole('region', { name: 'The map' });
  await expect(result).toContainText('Drowned Shrine');
  // On the current map's grid (hex), so it can be undone.
  await expect(result.getByRole('img', { name: 'Preview: a 12 by 12 hex map' })).toBeVisible();
  await maker.getByRole('button', { name: 'Use this map' }).click();
  await expect(maker).toHaveCount(0);
  await expect(dm.getByTestId('map-summary')).toContainText('hex map · 144 tiles');

  // Undo brings the old map back.
  await dm.getByRole('button', { name: 'Undo' }).click();
  await expect(dm.getByTestId('map-summary')).toHaveText(before ?? '');
});

test('when the pages don\'t describe a place, the AI explains how to set the map up', async ({ browser }) => {
  const dm = await host(browser);
  await fakeOllama(dm);
  await dm.getByRole('tab', { name: 'Map' }).click();
  await dm.getByRole('button', { name: 'From a book (AI)' }).click();
  const maker = dm.getByRole('dialog', { name: 'Map from a book' });
  await maker.getByRole('button', { name: 'Check connection' }).click();
  await maker.getByLabel('Book file').setInputFiles(book('GRIMSBY THE MERCHANT sells rope.'));
  await maker.getByRole('button', { name: 'Make the map' }).click();
  const guide = maker.getByRole('region', { name: 'How to set up this map' });
  await expect(guide).toContainText('No map from these pages: The page only describes a merchant.');
  await expect(guide.getByRole('listitem')).toHaveText(['Make a small market square.', 'Put Grimsby behind a table.']);
  await expect(maker.getByRole('button', { name: 'Use this map' })).toHaveCount(0);
});
