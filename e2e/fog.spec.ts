import { type Browser, type BrowserContext, type Page, expect, test } from '@playwright/test';

// DM controls: fog of war (players see only what their creatures see) and
// notes on tiles that only the DM can read.

const openContexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((context) => context.close()));
});

async function open(browser: Browser) {
  const context = await browser.newContext();
  openContexts.push(context);
  return context.newPage();
}

/** DM with a long map, Ana joined. */
async function table(browser: Browser) {
  const dm = await open(browser);
  await dm.goto('/');
  await dm.getByLabel('Your name').fill('Dana');
  await dm.getByRole('button', { name: 'Host a game' }).click();
  const link = (await dm.getByTestId('join-link').textContent()) ?? '';
  const ana = await open(browser);
  await ana.goto(link);
  await ana.getByLabel('Your name').fill('Ana');
  await ana.getByRole('button', { name: 'Join' }).click();
  await expect(ana.getByTestId('status')).toHaveText(/connected/i);
  await dm.getByRole('button', { name: 'New map' }).click();
  const dialog = dm.getByRole('group', { name: 'New map' });
  await dialog.getByLabel('Grid').selectOption({ label: 'Square' });
  await dialog.getByLabel('Width').fill('30');
  await dialog.getByLabel('Height').fill('5');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(ana.getByTestId('map-summary')).toContainText('150 tiles');
  return { dm, ana };
}

const encounter = (page: Page) => page.getByRole('tabpanel', { name: 'Encounter' });
const token = (page: Page, name: string) => page.getByTestId('token').filter({ hasText: name });

async function place(page: Page, kind: string, fx: number) {
  await encounter(page).getByLabel('Add').selectOption({ label: kind });
  await encounter(page).getByRole('button', { name: 'Place on map' }).click();
  const box = (await page.getByTestId('world-canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * 0.5);
}

test("with fog of war, players see only what their characters see; the DM sees everything", async ({ browser }) => {
  const { dm, ana } = await table(browser);
  await dm.getByRole('tab', { name: 'Encounter' }).click();
  await place(dm, 'Ana (player)', 0.12);
  await place(dm, 'Goblin', 0.9);
  await expect(token(ana, 'Goblin')).toBeVisible();

  await dm.getByRole('tab', { name: 'Session' }).click();
  await dm.getByLabel('Fog of war').check();
  await expect(ana.getByTestId('world-canvas')).toHaveAttribute('data-fog', 'on');
  await expect(token(ana, 'Ana')).toBeVisible();
  await expect(token(ana, 'Goblin')).toBeHidden(); // far beyond Ana's sight
  await expect(token(dm, 'Goblin')).toBeVisible();
  const seen = Number(await ana.getByTestId('world-canvas').getAttribute('data-visible-tiles'));
  expect(seen).toBeGreaterThan(10);
  expect(seen).toBeLessThan(150);

  await dm.getByLabel('Fog of war').uncheck();
  await expect(ana.getByTestId('world-canvas')).not.toHaveAttribute('data-fog', 'on');
  await expect(token(ana, 'Goblin')).toBeVisible();
});

test('DM notes on tiles are for the DM alone', async ({ browser }) => {
  const { dm, ana } = await table(browser);
  await dm.getByRole('button', { name: 'Notes', exact: true }).click();
  const box = (await dm.getByTestId('world-canvas').boundingBox())!;
  const at = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 };
  await dm.mouse.click(at.x, at.y);
  const editor = dm.getByRole('group', { name: /^Note on tile/ });
  await editor.getByLabel('Note').fill('A trapdoor to the tunnels');
  await editor.getByRole('button', { name: 'Save note' }).click();

  await dm.mouse.move(at.x - 1, at.y);
  await dm.mouse.move(at.x, at.y);
  await expect(dm.getByTestId('tile-info')).toContainText('Note: A trapdoor to the tunnels');
  const anaBox = (await ana.getByTestId('world-canvas').boundingBox())!;
  await ana.mouse.move(anaBox.x + anaBox.width * 0.5, anaBox.y + anaBox.height * 0.5);
  await expect(ana.getByTestId('tile-info')).toHaveText(/^Tile /);
  expect(await ana.content()).not.toContain('trapdoor');
});
