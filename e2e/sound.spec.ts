import { type BrowserContext, type Page, expect, test } from '@playwright/test';

// Sound: synthesized effects (clicks, dice, combat) and optional background
// music, each with its own volume under ⚙ on the map. Tests can't hear, so
// they count the sound nodes the page creates.

const openContexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((context) => context.close()));
});

/** Counts sound sources started (oscillators and noise), tagged effects or music by the engine. */
const countSounds = () => {
  const counts = { started: 0 };
  (window as unknown as { soundCounts: typeof counts }).soundCounts = counts;
  for (const name of ['OscillatorNode', 'AudioBufferSourceNode'] as const) {
    const proto = (window as unknown as Record<string, { prototype: { start(...args: unknown[]): void } }>)[name]?.prototype;
    if (!proto) continue;
    const start = proto.start;
    proto.start = function (...args: unknown[]) {
      counts.started++;
      return start.apply(this, args);
    };
  }
};

const started = (page: Page) => page.evaluate(() => (window as unknown as { soundCounts: { started: number } }).soundCounts.started);

async function host(page: Page) {
  await page.goto('/');
  await page.getByLabel('Your name').fill('Dana');
  await page.getByRole('button', { name: 'Host a game' }).click();
  await page.getByRole('button', { name: 'New map' }).click();
  await page.getByRole('group', { name: 'New map' }).getByRole('button', { name: 'Create' }).click();
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Display settings' }).click();
  return page.getByRole('group', { name: 'Display settings' });
}

test('sound effects play on clicks and dice, and the volume setting silences them', async ({ browser }) => {
  const context = await browser.newContext();
  openContexts.push(context);
  await context.addInitScript(countSounds);
  const page = await context.newPage();
  await host(page);

  const settings = await openSettings(page);
  await expect(settings.getByLabel('Sound effects')).toHaveValue('60');
  await expect(settings.getByLabel('Music')).toHaveValue('0');
  await page.keyboard.press('Escape');

  const before = await started(page);
  await page.getByRole('button', { name: 'Raise' }).click();
  await page.getByRole('button', { name: 'Add d20' }).click();
  await page.getByRole('button', { name: 'Roll', exact: true }).click();
  await expect.poll(() => started(page)).toBeGreaterThan(before + 3);

  // Effects at 0: silence.
  await (await openSettings(page)).getByLabel('Sound effects').fill('0');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2500); // let the roll's sounds finish
  const quiet = await started(page);
  await page.getByRole('button', { name: 'Lower' }).click();
  await page.getByRole('button', { name: 'Add d20' }).click();
  await page.getByRole('button', { name: 'Roll', exact: true }).click();
  await page.waitForTimeout(1500);
  expect(await started(page)).toBe(quiet);

  // Remembered on this device.
  await page.reload();
  await host(page);
  await expect((await openSettings(page)).getByLabel('Sound effects')).toHaveValue('0');
});

test('music plays only when turned up', async ({ browser }) => {
  const context = await browser.newContext();
  openContexts.push(context);
  await context.addInitScript(countSounds);
  const page = await context.newPage();
  await host(page);
  // Effects off, so only music could make sound.
  const settings = await openSettings(page);
  await settings.getByLabel('Sound effects').fill('0');
  await page.waitForTimeout(1500);
  const silent = await started(page);
  await page.waitForTimeout(1500);
  expect(await started(page)).toBe(silent);

  await settings.getByLabel('Music').fill('50');
  await expect.poll(() => started(page), { timeout: 8000 }).toBeGreaterThan(silent + 3);
});
