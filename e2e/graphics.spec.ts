import { type Browser, type BrowserContext, type Page, expect, test } from '@playwright/test';

// 2.5D polish: bloom, depth of field, soft shadows, glows. Each viewer picks
// how much with a Graphics setting next to the camera controls; phones start
// on Low. Every setting must keep the map working: picking tiles, name tags
// over the right creatures, even on high-DPI screens.

// The real defaults, not the Low setting other tests start with.
test.use({ storageState: { cookies: [], origins: [] } });

const openContexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((context) => context.close()));
});

/** The DM with a map; with `creatures`, two of them placed from the Encounter tab. */
async function host(browser: Browser, options: Parameters<Browser['newContext']>[0] = {}, creatures = true) {
  const context = await browser.newContext(options);
  openContexts.push(context);
  const dm = await context.newPage();
  const errors: string[] = [];
  dm.on('pageerror', (error) => errors.push(error.message));
  dm.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await dm.goto('/');
  await dm.getByLabel('Your name').fill('Dana');
  await dm.getByRole('button', { name: 'Host a game' }).click();
  await dm.getByRole('button', { name: 'New map' }).click();
  await dm.getByRole('group', { name: 'New map' }).getByRole('button', { name: 'Create' }).click();
  if (creatures) {
    await dm.getByRole('tab', { name: 'Encounter' }).click();
    const panel = dm.getByRole('tabpanel', { name: 'Encounter' });
    for (const [kind, side, fx] of [['Goblin', 'party', 0.35], ['Ogre', 'monsters', 0.65]] as const) {
      await panel.getByLabel('Add').selectOption({ label: kind });
      await panel.locator('.add-creature').getByLabel('Side').selectOption(side);
      await panel.getByRole('button', { name: 'Place on map' }).click();
      const box = (await dm.getByTestId('world-canvas').boundingBox())!;
      await dm.mouse.click(box.x + box.width * fx, box.y + box.height * 0.55);
    }
    await expect(dm.getByTestId('token')).toHaveCount(2);
  }
  return { dm, errors };
}

// Under ⚙ on the map (the label finds it even while the panel is closed).
const graphics = (page: Page) => page.getByLabel('Graphics quality');

/** Opens ⚙ and picks a graphics quality. */
async function pick(page: Page, quality: string) {
  const panel = page.getByRole('group', { name: 'Display settings' });
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Display settings' }).click();
  await graphics(page).selectOption(quality);
  await page.keyboard.press('Escape');
}

test('desktops start on High, and the choice is remembered', async ({ browser }) => {
  const { dm, errors } = await host(browser);
  await expect(graphics(dm)).toHaveValue('high');
  for (const quality of ['medium', 'low', 'high']) {
    await pick(dm, quality);
    await dm.waitForTimeout(300);
  }
  await pick(dm, 'medium');
  await dm.reload();
  await dm.getByLabel('Your name').fill('Dana');
  await dm.getByRole('button', { name: 'Host a game' }).click();
  await dm.getByRole('button', { name: 'New map' }).click();
  await dm.getByRole('group', { name: 'New map' }).getByRole('button', { name: 'Create' }).click();
  await expect(graphics(dm)).toHaveValue('medium');
  expect(errors).toEqual([]);
});

test('phones start on Low', async ({ browser }) => {
  const { dm } = await host(browser, { viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true }, false);
  await expect(graphics(dm)).toHaveValue('low');
  const overflow = await dm.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('on a high-DPI screen, name tags sit over their creatures and tiles are picked right, at every setting', async ({
  browser,
}) => {
  const { dm, errors } = await host(browser, { deviceScaleFactor: 2 });
  for (const quality of ['high', 'medium', 'low']) {
    await pick(dm, quality);
    await dm.waitForTimeout(300);
    const tag = dm.getByTestId('token').first();
    const cell = await tag.getAttribute('data-cell');
    const box = (await tag.boundingBox())!;
    // Below a name tag stands its creature: the tile under it shows up as the pointer moves down.
    const seen: string[] = [];
    for (let dy = 0; dy <= 160; dy += 10) {
      await dm.mouse.move(box.x + box.width / 2, box.y + box.height + dy);
      const match = ((await dm.getByTestId('tile-info').textContent()) ?? '').match(/^Tile \((-?\d+), (-?\d+)\)/);
      if (match) seen.push(`${match[1]},${match[2]}`);
    }
    expect(seen, `${quality}: tiles under the tag of the creature on ${cell}`).toContain(cell);
  }
  expect(errors).toEqual([]);
});
