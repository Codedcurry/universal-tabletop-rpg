import { type Browser, type BrowserContext, type Page, expect, test } from '@playwright/test';

// The dice panel: quick dice buttons and a tray, re-roll, a speed setting,
// and the roll animation everyone sees (with big moments for crits).

const openContexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((context) => context.close()));
});

async function open(browser: Browser) {
  const context = await browser.newContext();
  openContexts.push(context);
  return context.newPage();
}

async function table(browser: Browser) {
  const dm = await open(browser);
  await dm.goto('/');
  await dm.getByLabel('Your name').fill('Dana');
  await dm.getByRole('button', { name: 'Host a game' }).click();
  const link = (await dm.getByTestId('join-link').textContent()) ?? '';
  const join = async (name: string) => {
    const page = await open(browser);
    await page.goto(link);
    await page.getByLabel('Your name').fill(name);
    await page.getByRole('button', { name: 'Join' }).click();
    await expect(page.getByTestId('status')).toHaveText(/connected/i);
    return page;
  };
  return { dm, ana: await join('Ana'), ben: await join('Ben') };
}

const dicePanel = (page: Page) => page.getByRole('region', { name: 'Roll dice' });
const animation = (page: Page) => page.getByTestId('dice-roll');
const lastRollTotal = async (page: Page) =>
  (await page.locator('[data-kind="roll"] .roll-total').last().textContent()) ?? '';

test('tap dice into the tray, roll them, and watch them land on the logged total', async ({ browser }) => {
  const { ana } = await table(browser);
  const panel = dicePanel(ana);
  await panel.getByRole('button', { name: 'Add d6' }).click();
  await panel.getByRole('button', { name: 'Add d6' }).click();
  await panel.getByRole('button', { name: 'Add d20' }).click();
  await panel.getByRole('button', { name: 'Add coin' }).click();
  await expect(panel.getByLabel('Dice to roll')).toHaveValue('2d6 + 1d20 + 1 coin');

  await panel.getByRole('button', { name: 'Roll', exact: true }).click();
  await expect(animation(ana)).toBeVisible();
  await expect(animation(ana).getByTestId('rolling-die')).toHaveCount(4);
  await expect(animation(ana).getByTestId('roll-total')).toHaveText(await lastRollTotal(ana));
  await expect(animation(ana)).toBeHidden({ timeout: 5_000 });
  // The tray empties after a throw.
  await expect(panel.getByLabel('Dice to roll')).toHaveValue('');
});

test('everyone sees the same roll animation', async ({ browser }) => {
  const { ana, ben } = await table(browser);
  await dicePanel(ana).getByRole('button', { name: 'Add d20' }).click();
  await dicePanel(ana).getByRole('button', { name: 'Roll', exact: true }).click();
  await expect(animation(ben)).toBeVisible();
  await expect(animation(ben)).toHaveAccessibleName(/^Ana rolled 1d20/);
  await expect(animation(ben).getByTestId('roll-total')).toHaveText(await lastRollTotal(ana));
});

test('tapping skips straight to the result', async ({ browser }) => {
  const { ana } = await table(browser);
  await dicePanel(ana).getByRole('button', { name: 'Add d20' }).click();
  await dicePanel(ana).getByRole('button', { name: 'Roll', exact: true }).click();
  await animation(ana).click();
  await expect(animation(ana)).toBeHidden({ timeout: 300 });
});

test('re-roll repeats the last roll', async ({ browser }) => {
  const { ana } = await table(browser);
  const panel = dicePanel(ana);
  await expect(panel.getByRole('button', { name: 'Re-roll' })).toBeDisabled();
  await panel.getByLabel('Dice to roll').fill('3d8+2');
  await panel.getByRole('button', { name: 'Roll', exact: true }).click();
  await expect(ana.locator('[data-kind="roll"]')).toHaveCount(1);
  await panel.getByRole('button', { name: 'Re-roll' }).click();
  await expect(ana.locator('[data-kind="roll"]')).toHaveCount(2);
  await expect(ana.locator('[data-kind="roll"]').last()).toContainText('3d8+2');
});

test('the animation speed can be turned down or off', async ({ browser }) => {
  const { ana } = await table(browser);
  const panel = dicePanel(ana);
  await panel.getByLabel('Dice animation').selectOption({ label: 'Off' });
  await panel.getByRole('button', { name: 'Add d20' }).click();
  await panel.getByRole('button', { name: 'Roll', exact: true }).click();
  // No tumbling: the total is there straight away.
  await expect(animation(ana).getByTestId('roll-total')).toBeVisible({ timeout: 300 });
});

test('a natural 20 is a big moment', async ({ browser }) => {
  const { dm, ana } = await table(browser);
  // Physical dice, so the test can choose the face.
  await dm.getByRole('tab', { name: 'Session' }).click();
  await dm.getByLabel('Who rolls dice').selectOption({ label: 'Players use real dice' });
  const panel = dicePanel(ana);
  await panel.getByLabel('Dice to roll').fill('1d20');
  await panel.getByLabel('Die 1 of 1 · d20').fill('20');
  await panel.getByRole('button', { name: 'Roll', exact: true }).click();
  await expect(animation(ana)).toHaveAttribute('data-big-moment', 'max');
  await expect(animation(dm)).toHaveAttribute('data-big-moment', 'max');
});

test("a hidden DM roll animates only for the DM", async ({ browser }) => {
  const { dm, ana } = await table(browser);
  const panel = dicePanel(dm);
  await panel.getByRole('button', { name: 'Add d20' }).click();
  await panel.getByLabel('Hidden').check();
  await panel.getByRole('button', { name: 'Roll', exact: true }).click();
  await expect(animation(dm)).toBeVisible();
  await ana.waitForTimeout(800);
  await expect(animation(ana)).toHaveCount(0);
});

test('the dice buttons stay inside the dice panel at any window width', async ({ browser }) => {
  const page = await open(browser);
  await page.goto('/');
  await page.getByLabel('Your name').fill('Dana');
  await page.getByRole('button', { name: 'Host a game' }).click();
  for (const width of [375, 520, 700, 900, 1000, 1100, 1300, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    const panel = (await dicePanel(page).boundingBox())!;
    for (const button of await dicePanel(page).getByRole('group', { name: 'Add dice to the tray' }).getByRole('button').all()) {
      const box = (await button.boundingBox())!;
      expect(box.x, `width ${width}`).toBeGreaterThanOrEqual(panel.x);
      expect(box.x + box.width, `width ${width}`).toBeLessThanOrEqual(panel.x + panel.width + 0.5);
    }
  }
});

test('the dice box can be opened any time, and stays open while pinned', async ({ browser }) => {
  const { ana } = await table(browser);
  const panel = dicePanel(ana);
  const toggle = panel.getByRole('button', { name: 'Dice box' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(animation(ana)).toBeVisible();
  await expect(animation(ana)).toContainText('No rolls yet');

  await panel.getByRole('button', { name: 'Add d20' }).click();
  await panel.getByRole('button', { name: 'Roll', exact: true }).click();
  await expect(animation(ana).getByTestId('roll-total')).toHaveText(await lastRollTotal(ana));
  await ana.waitForTimeout(3000); // well past when it would close by itself
  await expect(animation(ana)).toBeVisible();

  // Closing it unpins it; reopening shows the last roll, at rest.
  await animation(ana).getByRole('button', { name: 'Close dice' }).click();
  await expect(animation(ana)).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(animation(ana).getByTestId('roll-total')).toHaveText(await lastRollTotal(ana));
});
