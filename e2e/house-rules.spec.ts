import { type Browser, type BrowserContext, type Page, expect, test } from '@playwright/test';

// Rulings: something the rules refuse (a Strike at a goblin across the map)
// is explained; a player asks the DM, who allows it once or makes it a house
// rule that everyone sees and that applies from then on.

const openContexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((context) => context.close()));
});

async function page(browser: Browser) {
  const created = await browser.newContext();
  openContexts.push(created);
  return created.newPage();
}

/** DM with a small hex map, Ana joined, the demo fight started (Ana in the west, goblins in the east). */
async function fight(browser: Browser) {
  const dm = await page(browser);
  await dm.goto('/');
  await dm.getByLabel('Your name').fill('Dana');
  await dm.getByRole('button', { name: 'Host a game' }).click();
  const link = (await dm.getByTestId('join-link').textContent()) ?? '';
  await dm.getByRole('button', { name: 'New map' }).click();
  const dialog = dm.getByRole('group', { name: 'New map' });
  await dialog.getByLabel('Width').fill('5');
  await dialog.getByLabel('Height').fill('4');
  await dialog.getByRole('button', { name: 'Create' }).click();

  const ana = await page(browser);
  await ana.goto(link);
  await ana.getByLabel('Your name').fill('Ana');
  await ana.getByRole('button', { name: 'Join' }).click();
  await expect(ana.getByTestId('status')).toHaveText(/connected/i);
  await dm.getByRole('button', { name: 'Start demo fight' }).click();
  await expect(ana.getByTestId('turn-banner')).toContainText('Round 1');
  return { dm, ana };
}

/** The DM ends turns until it is `name`'s. */
async function untilTurnOf(dm: Page, ana: Page, name: string) {
  for (let i = 0; i < 4; i++) {
    if ((await ana.getByTestId('turn-banner').textContent())?.includes(`${name}'s turn`)) return;
    await dm.getByRole('button', { name: 'End turn' }).click();
    await ana.waitForTimeout(150);
  }
  await expect(ana.getByTestId('turn-banner')).toContainText(`${name}'s turn`);
}

const token = (on: Page, name: string) => on.getByTestId('token').filter({ hasText: name });

/** Clicks a creature's tile on the map, found by pointing around until the tile info names its cell. */
async function clickTileOf(on: Page, name: string) {
  const cell = (await token(on, name).getAttribute('data-cell')) ?? '';
  const [q, r] = cell.split(',');
  const canvas = on.getByTestId('world-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  // Only the part of the map on screen can be pointed at.
  const bottom = Math.min(box.y + box.height, on.viewportSize()!.height);
  for (let row = 1; row < 16; row++) {
    for (let col = 1; col < 20; col++) {
      const x = box.x + (box.width * col) / 20;
      const y = box.y + ((bottom - box.y) * row) / 16;
      await on.mouse.move(x, y);
      if (((await on.getByTestId('tile-info').textContent()) ?? '').startsWith(`Tile (${q}, ${r})`)) {
        await on.mouse.down();
        await on.mouse.up();
        return;
      }
    }
  }
  throw new Error(`Couldn't find ${name}'s tile on the map`);
}

test('a player asks the DM to allow a Strike out of range; the DM makes it a house rule', async ({ browser }) => {
  const { dm, ana } = await fight(browser);
  await untilTurnOf(dm, ana, 'Ana');
  const bar = ana.getByRole('region', { name: 'Your turn' });
  await bar.getByRole('button', { name: 'Strike' }).click();
  await clickTileOf(ana, 'Goblin 1');

  const refusal = bar.getByRole('alert', { name: 'Not allowed' });
  await expect(refusal).toContainText(/Goblin 1 is out of range for Strike \(range 1\)/);
  await refusal.getByRole('button', { name: 'Ask the DM' }).click();
  await expect(refusal).toContainText('Asked the DM');

  const request = dm.getByRole('group', { name: 'Ana asks' });
  await expect(request).toContainText('Ana: Strike on Goblin 1');
  await request.getByRole('button', { name: /^Make it a house rule: Strike reaches \d+ more tiles?$/ }).click();
  await expect(request).toHaveCount(0);

  // It happened, and everyone sees the new house rule.
  await expect(ana.getByTestId('float-text').first()).toHaveText(/^(-\d+|Miss|0)$/);
  await expect(ana.getByTestId('log').getByText(/DM makes a house rule: Strike reaches \d+ more tiles?/)).toBeVisible();
  await dm.getByRole('tab', { name: 'Rules' }).click();
  const rules = dm.getByRole('tabpanel', { name: 'Rules' });
  const list = rules.getByRole('list', { name: 'House rules' });
  await expect(list).toContainText(/Strike reaches \d+ more tiles?/);
  await list.getByRole('button', { name: /^Drop house rule/ }).click();
  await expect(list).toHaveCount(0);
  await expect(ana.getByTestId('log').getByText(/DM drops a house rule: Strike reaches/)).toBeVisible();
});

test('the DM allows a monster something just this once, and can say no to a player', async ({ browser }) => {
  const { dm, ana } = await fight(browser);
  await untilTurnOf(dm, ana, 'Goblin 1');
  const bar = dm.getByRole('region', { name: 'Your turn' });
  await bar.getByRole('button', { name: 'Strike' }).click();
  await clickTileOf(dm, 'Ana');
  const refusal = bar.getByRole('alert', { name: 'Not allowed' });
  await expect(refusal).toContainText(/Ana is out of range for Strike \(range 1\)/);
  await refusal.getByRole('button', { name: 'Allow just this once' }).click();
  await expect(ana.getByTestId('log').getByText(/DM allows it just this once: Ana is out of range for Strike/)).toBeVisible();
  // Just once: no house rule.
  await dm.getByRole('tab', { name: 'Rules' }).click();
  await expect(dm.getByRole('tabpanel', { name: 'Rules' })).toContainText('None yet');

  // A player's request, refused.
  await untilTurnOf(dm, ana, 'Ana');
  const anaBar = ana.getByRole('region', { name: 'Your turn' });
  await anaBar.getByRole('button', { name: 'Strike' }).click();
  await clickTileOf(ana, 'Goblin 2');
  await anaBar.getByRole('button', { name: 'Ask the DM' }).click();
  await dm.getByRole('group', { name: 'Ana asks' }).getByRole('button', { name: 'No' }).click();
  await expect(ana.getByTestId('log').getByText(/DM says no to Ana: Goblin 2 is out of range for Strike/)).toBeVisible();
});
