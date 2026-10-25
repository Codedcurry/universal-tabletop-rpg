import { type Browser, type BrowserContext, type Page, expect, test } from '@playwright/test';

// Per-device display settings behind one ⚙ button on the map: graphics
// quality (lowered automatically when the device can't keep up), combat
// animation speed, and keeping the screen awake during a game.

const openContexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((context) => context.close()));
});

async function context(browser: Browser, options: Parameters<Browser['newContext']>[0] = {}) {
  const created = await browser.newContext(options);
  openContexts.push(created);
  return created;
}

/** Records screen wake lock requests and releases (browsers without a screen to keep on refuse them). */
const fakeWakeLock = () => {
  const log: string[] = [];
  (window as unknown as { wakeLog: string[] }).wakeLog = log;
  Object.defineProperty(navigator, 'wakeLock', {
    value: {
      request: async () => {
        log.push('request');
        return { release: async () => void log.push('release'), addEventListener: () => undefined };
      },
    },
  });
};

async function host(page: Page) {
  await page.goto('/');
  await page.getByLabel('Your name').fill('Dana');
  await page.getByRole('button', { name: 'Host a game' }).click();
  await page.getByRole('button', { name: 'New map' }).click();
  await page.getByRole('group', { name: 'New map' }).getByRole('button', { name: 'Create' }).click();
}

const settings = (page: Page) => page.getByRole('group', { name: 'Display settings' });
async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Display settings' }).click();
  await expect(settings(page)).toBeVisible();
}

test('display settings sit behind one button on the map', async ({ browser }) => {
  const dm = await (await context(browser)).newPage();
  await host(dm);
  await expect(settings(dm)).toBeHidden();
  await openSettings(dm);
  await expect(settings(dm).getByLabel('Graphics quality')).toBeVisible();
  await expect(settings(dm).getByLabel('Combat animations')).toHaveValue('normal');
  await expect(settings(dm).getByLabel('Keep mobile screens awake')).toBeChecked();
  await dm.keyboard.press('Escape');
  await expect(settings(dm)).toBeHidden();
});

test('people who ask for reduced motion start with combat and dice animations off', async ({ browser }) => {
  const dm = await (await context(browser, { reducedMotion: 'reduce' })).newPage();
  await host(dm);
  await openSettings(dm);
  await expect(settings(dm).getByLabel('Combat animations')).toHaveValue('off');
  await expect(dm.getByLabel('Dice animation')).toHaveValue('off');
});

test('with combat animations off, creatures move at once', async ({ browser }) => {
  const dm = await (await context(browser)).newPage();
  await host(dm);
  await openSettings(dm);
  await settings(dm).getByLabel('Combat animations').selectOption('off');
  await dm.getByRole('tab', { name: 'Encounter' }).click();
  const panel = dm.getByRole('tabpanel', { name: 'Encounter' });
  for (const [kind, side, fx] of [['Goblin', 'party', 0.3], ['Ogre', 'monsters', 0.7]] as const) {
    await panel.getByLabel('Add').selectOption({ label: kind });
    await panel.locator('.add-creature').getByLabel('Side').selectOption(side);
    await panel.getByRole('button', { name: 'Place on map' }).click();
    const box = (await dm.getByTestId('world-canvas').boundingBox())!;
    await dm.mouse.click(box.x + box.width * fx, box.y + box.height * 0.55);
  }
  await panel.getByLabel('Roll initiative').uncheck();
  await panel.getByRole('button', { name: 'Start fight' }).click();
  await expect(dm.getByRole('region', { name: 'Your turn' })).toContainText('Goblin');

  // Move the goblin one tile: no walk plays out.
  const canvas = dm.getByTestId('world-canvas');
  const before = await dm.getByTestId('token').filter({ hasText: 'Goblin' }).getAttribute('data-cell');
  const box = (await canvas.boundingBox())!;
  let moved = false;
  for (let dx = 0.04; dx < 0.2 && !moved; dx += 0.03) {
    await dm.mouse.click(box.x + box.width * (0.3 + dx), box.y + box.height * 0.55);
    moved = (await dm.getByTestId('token').filter({ hasText: 'Goblin' }).getAttribute('data-cell')) !== before;
  }
  expect(moved).toBe(true);
  await expect(canvas).not.toHaveAttribute('data-animating', 'true', { timeout: 150 });
});

test('the screen stays awake during a game, unless turned off', async ({ browser }) => {
  const created = await context(browser);
  await created.addInitScript(fakeWakeLock);
  const dm = await created.newPage();
  await host(dm);
  const log = () => dm.evaluate(() => (window as unknown as { wakeLog: string[] }).wakeLog);
  await expect.poll(log).toEqual(['request']);
  await openSettings(dm);
  await settings(dm).getByLabel('Keep mobile screens awake').uncheck();
  await expect.poll(log).toEqual(['request', 'release']);
  await dm.reload();
  await host(dm);
  await dm.waitForTimeout(300);
  expect(await log()).toEqual([]); // remembered: off
});

/** A context whose saved graphics setting is High, on a 2x screen. (Picking High by hand would count as overriding.) */
async function onHigh(browser: Browser) {
  const high = { name: 'graphics-quality', value: 'high' };
  return context(browser, { storageState: { cookies: [], origins: [{ origin: 'http://localhost:5174', localStorage: [high] }] }, deviceScaleFactor: 2 });
}

test('once graphics were lowered automatically, raising them by hand keeps them there', async ({ browser }) => {
  const created = await onHigh(browser);
  const dm = await created.newPage();
  await host(dm);
  const cdp = await created.newCDPSession(dm);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  const note = dm.getByRole('status').filter({ hasText: 'Graphics lowered' });
  const until = Date.now() + 25_000;
  for (let i = 0; Date.now() < until && !(await note.isVisible()); i++) await dm.keyboard.press(i % 2 === 0 ? 'e' : 'q');
  await expect(note).toBeVisible();
  await openSettings(dm);
  await settings(dm).getByLabel('Graphics quality').selectOption('high');
  await dm.keyboard.press('Escape');
  for (let i = 0; i < 12; i++) await dm.keyboard.press(i % 2 === 0 ? 'e' : 'q');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await expect(dm.getByLabel('Graphics quality')).toHaveValue('high');
});

test('graphics step down by themselves when the device can\'t keep up', async ({ browser }) => {
  const created = await onHigh(browser);
  const dm = await created.newPage();
  await host(dm);
  // A much slower device; keep the view turning so frames are drawn.
  const cdp = await created.newCDPSession(dm);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  const note = dm.getByRole('status').filter({ hasText: 'Graphics lowered' });
  const until = Date.now() + 25_000;
  for (let i = 0; Date.now() < until && !(await note.isVisible()); i++) {
    await dm.keyboard.press(i % 2 === 0 ? 'e' : 'q');
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await expect(note).toBeVisible();
  await openSettings(dm);
  await expect(settings(dm).getByLabel('Graphics quality')).not.toHaveValue('high');
});

test('tiles are pixel art by default, and can be switched to plain colors', async ({ browser }) => {
  const page = await (await context(browser)).newPage();
  await host(page);
  const canvas = page.getByTestId('world-canvas');
  await expect(canvas).toHaveAttribute('data-art', 'pixel');
  const pixel = await canvas.screenshot();
  const panel = await openSettings(page).then(() => settings(page));
  await expect(panel.getByLabel('Art style')).toHaveValue('pixel');
  await panel.getByLabel('Art style').selectOption('simple');
  await expect(canvas).toHaveAttribute('data-art', 'simple');
  await page.keyboard.press('Escape');
  await page.mouse.move(0, 0);
  await page.waitForTimeout(500);
  expect((await canvas.screenshot()).equals(pixel)).toBe(false);
});
