import { type Page, expect, test } from '@playwright/test';

// CLAUDE.md: check every feature on a phone-sized screen as it's built.
// A small phone viewport, with touch. Nothing may scroll sideways.

const phone = { viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true };

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function screenshot(page: Page, name: string) {
  const dir = process.env.SCREENSHOT_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

test('home, DM, and player screens fit a phone', async ({ browser }) => {
  const dmContext = await browser.newContext(phone);
  const dm = await dmContext.newPage();
  await dm.goto('/');
  await expectNoSidewaysScroll(dm);
  await screenshot(dm, 'phone-home');

  await dm.getByLabel('Your name').fill('Dana');
  await dm.getByRole('button', { name: 'Host a game' }).click();
  const link = (await dm.getByTestId('join-link').textContent()) ?? '';

  const anaContext = await browser.newContext(phone);
  const ana = await anaContext.newPage();
  await ana.goto(link);
  await ana.getByLabel('Your name').fill('Ana');
  await ana.getByRole('button', { name: 'Join' }).click();
  await expect(ana.getByTestId('status')).toHaveText(/connected/i);

  await dm.getByRole('button', { name: 'Generate' }).click();
  await dm.getByRole('group', { name: 'Generate a map' }).getByRole('button', { name: 'Create' }).click();
  await expect(ana.getByTestId('map-summary')).toContainText('tiles');
  await expect(ana.getByTestId('world-canvas')).toBeVisible();

  await dm.getByRole('button', { name: 'Start demo fight' }).click();
  await expect(ana.getByTestId('turn-banner')).toContainText('Round 1');
  await ana.getByLabel('Dice to roll').fill('4d6kh3 + 2 coins');
  await ana.getByRole('button', { name: 'Roll' }).click();
  await expect(ana.locator('[data-kind="roll"]')).toHaveCount(1);

  await expectNoSidewaysScroll(dm);
  await expectNoSidewaysScroll(ana);
  await screenshot(dm, 'phone-dm');
  await screenshot(ana, 'phone-player');
  await Promise.all([dmContext.close(), anaContext.close()]);
});
