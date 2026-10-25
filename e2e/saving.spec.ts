import { readFile } from 'node:fs/promises';
import { type Browser, type BrowserContext, type Page, expect, test } from '@playwright/test';

// Saving: the DM's game is kept in the browser as it changes, so a reload
// carries on (players rejoin their own seats); saved games are listed on
// the home screen; and a whole game can be saved to a file and loaded back.

const openContexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((context) => context.close()));
});

async function context(browser: Browser) {
  const created = await browser.newContext();
  openContexts.push(created);
  return created;
}

async function hostWithMap(page: Page) {
  await page.goto('/');
  await page.getByLabel('Your name').fill('Dana');
  await page.getByRole('button', { name: 'Host a game' }).click();
  await page.getByRole('button', { name: 'New map' }).click();
  const dialog = page.getByRole('group', { name: 'New map' });
  await dialog.getByLabel('Width').fill('7');
  await dialog.getByLabel('Height').fill('5');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByTestId('map-summary')).toContainText('35 tiles');
  await savedSoon(page);
  return (await page.getByTestId('room-code').textContent()) ?? '';
}

/** The game saves itself within about a second of a change. */
async function savedSoon(page: Page) {
  await page.waitForTimeout(1200);
  await expect(page.getByTestId('save-status')).toContainText('Saved');
}

const chat = async (page: Page, text: string) => {
  await page.getByLabel('Message').fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
};

test('a reloaded DM page carries on the same game, and players get their seats back', async ({ browser }) => {
  const dm = await (await context(browser)).newPage();
  const code = await hostWithMap(dm);
  const ana = await (await context(browser)).newPage();
  await ana.goto(`/?room=${code}`);
  await ana.getByLabel('Your name').fill('Ana');
  await ana.getByRole('button', { name: 'Join' }).click();
  await expect(ana.getByTestId('status')).toHaveText(/connected/i);
  await chat(dm, 'Remember the cove');
  await expect(ana.getByTestId('log')).toContainText('Remember the cove');
  await savedSoon(dm);

  await dm.reload();
  // Back in the same room, same game, without doing anything.
  await expect(dm.getByTestId('room-code')).toHaveText(code, { timeout: 20_000 });
  await expect(dm.getByTestId('map-summary')).toContainText('35 tiles');
  await expect(dm.getByTestId('log')).toContainText('Remember the cove');
  // Ana's page reconnects by itself, to the same seat.
  await expect(ana.getByTestId('status')).toHaveText(/connected/i, { timeout: 30_000 });
  await chat(ana, 'Still here');
  await expect(dm.getByTestId('log')).toContainText('Ana: Still here');
});

test('saved games are listed on the home screen, to resume or delete', async ({ browser }) => {
  const created = await context(browser);
  const first = await created.newPage();
  const code = await hostWithMap(first);
  await first.close();

  const page = await created.newPage();
  await page.goto('/');
  const saved = page.getByRole('region', { name: 'Saved games' });
  await expect(saved.getByRole('listitem')).toHaveCount(1);
  await expect(saved.getByRole('listitem')).toContainText(code);
  await expect(saved.getByRole('listitem')).toContainText('35 tiles');
  await saved.getByRole('button', { name: `Resume ${code}` }).click();
  await expect(page.getByTestId('room-code')).toHaveText(code, { timeout: 20_000 });
  await expect(page.getByTestId('map-summary')).toContainText('35 tiles');

  // (This tab now carries the game on by itself; another tab shows the home screen.)
  const home = await created.newPage();
  await home.goto('/');
  await home.getByRole('region', { name: 'Saved games' }).getByRole('button', { name: `Delete ${code}` }).click();
  // No undo, so it asks first.
  await home.getByRole('region', { name: 'Saved games' }).getByRole('button', { name: `Yes, delete ${code}` }).click();
  await expect(home.getByRole('region', { name: 'Saved games' })).toHaveCount(0);
});

test('a game saves to a file and loads back, and a broken file is refused', async ({ browser }) => {
  const dm = await (await context(browser)).newPage();
  await hostWithMap(dm);
  await dm.getByRole('tab', { name: 'Session' }).click();
  const downloadPromise = dm.waitForEvent('download');
  await dm.getByRole('button', { name: 'Save game file' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  const path = await download.path();
  expect(JSON.parse(await readFile(path, 'utf8')).format).toBe('universal-tabletop-rpg/game');

  // On another computer (a fresh browser): load it from the home screen.
  const other = await (await context(browser)).newPage();
  await other.goto('/');
  await other.getByLabel('Your name').fill('Dana');
  await other.getByLabel('Load game file').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"nope":1}') });
  await expect(other.getByRole('alert')).toContainText(/saved game/i);
  await other.getByLabel('Load game file').setInputFiles(path);
  await expect(other.getByTestId('map-summary')).toContainText('35 tiles', { timeout: 20_000 });
  // The original game is still open, so this copy carries on in a new room, and says so.
  await expect(other.getByTestId('host-notice')).toContainText('new room');
});
