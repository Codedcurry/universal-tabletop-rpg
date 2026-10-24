import { type Browser, type BrowserContext, type Page, expect, test } from '@playwright/test';

// Each participant gets its own browser context: separate storage, separate
// WebRTC peer, exactly like separate devices.

// Every browser context a test opens is closed afterwards, so idle sessions
// from earlier tests don't keep running (and slowing everything down).
const openContexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((context) => context.close()));
});

async function host(browser: Browser, name = 'Dana') {
  const context = await browser.newContext();
  openContexts.push(context);
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Host a game' }).click();
  await expect(page.getByTestId('room-code')).toHaveText(/^[A-Z2-9]{6}$/);
  const link = (await page.getByTestId('join-link').textContent()) ?? '';
  return { context, page, link };
}

async function join(browser: Browser, link: string, name: string) {
  const context = await browser.newContext();
  openContexts.push(context);
  const page = await context.newPage();
  await page.goto(link);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Join' }).click();
  await expect(page.getByTestId('status')).toHaveText(/connected/i);
  return { context, page };
}

async function say(page: Page, text: string, to?: string) {
  if (to) await page.getByRole('combobox', { name: /^To\b/ }).selectOption({ label: to });
  await page.getByLabel('Message').fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
}

const log = (page: Page) => page.getByTestId('log');

test('a player joins with the room link and both sides see each other', async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');
  await expect(dm.page.getByTestId('players')).toContainText('Ana');
  await expect(ana.page.getByTestId('players')).toContainText('Ana');
  await expect(ana.page.getByTestId('dm-title')).toHaveText('DM');
  await expect(log(dm.page)).toContainText('Ana joined');
});

test("the DM's chosen title reaches players", async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');
  await dm.page.getByLabel('Your title').fill('Keeper');
  await dm.page.getByLabel('Your title').press('Enter');
  await expect(ana.page.getByTestId('dm-title')).toHaveText('Keeper');
});

test('chat reaches everyone, and whispers only their target', async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');
  const ben = await join(browser, dm.link, 'Ben');

  await say(ana.page, 'hello table');
  await expect(log(dm.page)).toContainText('hello table');
  await expect(log(ben.page)).toContainText('hello table');

  await say(dm.page, 'the gem is fake', 'Ana');
  await say(dm.page, 'public after', 'Everyone');
  await expect(log(ben.page)).toContainText('public after');
  await expect(log(ana.page)).toContainText('the gem is fake');
  await expect(log(ben.page)).not.toContainText('the gem is fake');
});

test('everyone sees the same dice roll', async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');
  const ben = await join(browser, dm.link, 'Ben');

  await ana.page.getByLabel('Dice to roll').fill('4d6kh3+2');
  await ana.page.getByRole('button', { name: 'Roll' }).click();

  const lastRoll = (page: Page) => page.locator('[data-kind="roll"]').last();
  await expect(lastRoll(ana.page)).toContainText('4d6kh3+2');
  const text = await lastRoll(ana.page).textContent();
  await expect(lastRoll(dm.page)).toHaveText(text ?? '');
  await expect(lastRoll(ben.page)).toHaveText(text ?? '');
});

test('combat turns stay in sync, and players act only on their own turn', async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');
  await dm.page.getByRole('button', { name: 'Start demo fight' }).click();
  const banner = (page: Page) => page.getByTestId('turn-banner');
  await expect(banner(ana.page)).toContainText('Round 1');

  let anaActed = false;
  for (let step = 0; step < 10; step++) {
    const text = (await banner(dm.page).textContent()) ?? '';
    if (text.includes('Round 2')) break;
    if (text.includes("Ana's turn")) {
      await ana.page.getByRole('button', { name: 'End turn' }).click();
      anaActed = true;
    } else {
      await expect(ana.page.getByRole('button', { name: 'End turn' })).toHaveCount(0);
      await dm.page.getByRole('button', { name: 'End turn' }).click();
    }
    await expect(banner(ana.page)).not.toHaveText(text);
    await expect(banner(dm.page)).toHaveText((await banner(ana.page).textContent()) ?? '');
  }
  expect(anaActed).toBe(true);
  await expect(banner(ana.page)).toContainText('Round 2');
  await expect(banner(dm.page)).toContainText('Round 2');
});

test('a reload keeps the same seat', async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');
  await ana.page.reload();
  await expect(ana.page.getByTestId('status')).toHaveText(/connected/i);
  await expect(log(dm.page)).toContainText('Ana reconnected');
  await expect(dm.page.getByTestId('player')).toHaveCount(1);
});

test('players pause when the DM leaves', async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');
  await dm.context.close();
  await expect(ana.page.getByTestId('status')).toHaveText(/paused/i, { timeout: 30_000 });
});

test('physical dice: one clearly labeled box per die, checked before rolling', async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');
  await dm.page.getByLabel('Who rolls dice').selectOption({ label: 'Players use real dice' });

  await expect(ana.page.getByText(/roll your real dice/i)).toBeVisible();
  await ana.page.getByLabel('Dice to roll').fill('2d6 + 1 coin');
  const roll = ana.page.getByRole('button', { name: 'Roll' });
  await expect(roll).toBeDisabled();

  await ana.page.getByLabel('Die 1 of 2 · d6').fill('7');
  await expect(ana.page.getByText('Enter 1 to 6')).toBeVisible();
  await expect(roll).toBeDisabled();

  await ana.page.getByLabel('Die 1 of 2 · d6').fill('3');
  await ana.page.getByLabel('Die 2 of 2 · d6').fill('5');
  await ana.page.getByLabel('Coin 1 of 1').selectOption({ label: 'Heads' });
  await expect(roll).toBeEnabled();
  await roll.click();

  const lastRoll = (page: Page) => page.locator('[data-kind="roll"]').last();
  await expect(lastRoll(dm.page)).toContainText('= 9');
  await expect(lastRoll(dm.page)).toContainText('physical dice');
  // The boxes clear for the next roll.
  await expect(ana.page.getByLabel('Die 1 of 2 · d6')).toHaveValue('');
});

test('chat and dice are separate, clearly labeled sections', async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');
  const chat = ana.page.getByRole('region', { name: 'Chat' });
  const dice = ana.page.getByRole('region', { name: 'Roll dice' });
  await expect(chat.getByLabel('Message')).toBeVisible();
  await expect(chat.getByLabel('Dice to roll')).toHaveCount(0);
  await expect(dice.getByLabel('Dice to roll')).toBeVisible();
  await expect(dice.getByLabel('Message')).toHaveCount(0);
});
