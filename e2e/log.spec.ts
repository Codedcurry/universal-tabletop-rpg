import { type Browser, type BrowserContext, type Page, expect, test } from '@playwright/test';

// The chat log: All / General / Player chat / Game log tabs, timestamps,
// roll breakdowns on tap, and a collapsible drawer on phones.

const openContexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((context) => context.close()));
});

async function open(browser: Browser, options: Parameters<Browser['newContext']>[0] = {}) {
  const context = await browser.newContext(options);
  openContexts.push(context);
  return context.newPage();
}

async function table(browser: Browser, playerOptions: Parameters<Browser['newContext']>[0] = {}) {
  const dm = await open(browser);
  await dm.goto('/');
  await dm.getByLabel('Your name').fill('Dana');
  await dm.getByRole('button', { name: 'Host a game' }).click();
  const link = (await dm.getByTestId('join-link').textContent()) ?? '';
  const ana = await open(browser, playerOptions);
  await ana.goto(link);
  await ana.getByLabel('Your name').fill('Ana');
  await ana.getByRole('button', { name: 'Join' }).click();
  await expect(ana.getByTestId('status')).toHaveText(/connected/i);
  return { dm, ana };
}

const tab = (page: Page, name: string) => page.getByRole('tab', { name });
const entries = (page: Page) => page.getByRole('tabpanel').getByRole('listitem');

test('tabs sort the log: General, Player chat, Game log, and All', async ({ browser }) => {
  const { dm, ana } = await table(browser);
  await ana.getByLabel('Message').fill('hello table');
  await ana.getByRole('button', { name: 'Send' }).click();
  await dm.getByRole('button', { name: 'Start demo fight' }).click();
  await expect(ana.getByTestId('turn-banner')).toContainText('Round 1');
  await ana.getByLabel('Dice to roll').fill('d20');
  await ana.getByRole('button', { name: 'Roll', exact: true }).click();

  await tab(ana, 'Player chat').click();
  await expect(entries(ana)).toHaveCount(1);
  await expect(entries(ana)).toContainText('hello table');

  await tab(ana, 'General').click();
  await expect(entries(ana).filter({ hasText: 'Ana joined' })).toHaveCount(1);
  await expect(entries(ana).filter({ hasText: 'Round 1' })).toHaveCount(1);
  await expect(entries(ana).filter({ hasText: 'hello table' })).toHaveCount(0);

  await tab(ana, 'Game log').click();
  await expect(entries(ana).filter({ hasText: 'The fight begins' })).toHaveCount(1);
  await expect(entries(ana).filter({ hasText: 'rolled d20' })).toHaveCount(1);
  await expect(entries(ana).filter({ hasText: 'hello table' })).toHaveCount(0);
  await expect(entries(ana).filter({ hasText: 'Ana joined' })).toHaveCount(0);

  await tab(ana, 'All').click();
  for (const text of ['hello table', 'Ana joined', 'The fight begins', 'rolled d20']) {
    await expect(entries(ana).filter({ hasText: text }).first()).toBeVisible();
  }
});

test('entries are timestamped and colored by type', async ({ browser }) => {
  const { ana } = await table(browser);
  const first = entries(ana).first();
  await expect(first.locator('time')).toHaveAttribute('datetime', /^\d{4}-\d\d-\d\dT/);
  await expect(first).toHaveAttribute('data-kind', 'system');
});

test("a roll's full breakdown opens on tap", async ({ browser }) => {
  const { ana } = await table(browser);
  await ana.getByLabel('Dice to roll').fill('4d6kh3+2');
  await ana.getByRole('button', { name: 'Roll', exact: true }).click();
  const rollEntry = ana.locator('[data-kind="roll"]').last();
  const details = rollEntry.getByTestId('roll-breakdown');
  await expect(details).toBeHidden();
  await rollEntry.getByRole('button', { name: /rolled 4d6kh3\+2/ }).click();
  await expect(details).toBeVisible();
  await expect(details).toContainText('[');
});

test('on a phone, the log is a drawer that starts closed', async ({ browser }) => {
  const { ana } = await table(browser, { viewport: { width: 375, height: 700 }, hasTouch: true, isMobile: true });
  const toggle = ana.getByRole('button', { name: /^Log/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(ana.getByRole('tabpanel')).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(ana.getByRole('tabpanel')).toBeVisible();
  await expect(entries(ana).first()).toContainText('Ana joined');
});
