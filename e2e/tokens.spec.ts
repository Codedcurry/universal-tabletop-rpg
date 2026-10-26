import { type Browser, type BrowserContext, type Page, expect, test } from '@playwright/test';

// Creatures on the map: tokens with name tags and HP bars, the combat bar,
// moving by clicking tiles, attacking by picking an ability then a target,
// and floating damage numbers, all in sync between DM and players.

const openContexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((context) => context.close()));
});

async function context(browser: Browser, options: Parameters<Browser['newContext']>[0] = {}) {
  const created = await browser.newContext(options);
  openContexts.push(created);
  return created;
}

/** DM with a small hex map (everyone within Shoot range); Ana joined; a demo fight started. */
async function fight(browser: Browser, playerOptions: Parameters<Browser['newContext']>[0] = {}) {
  const dm = await (await context(browser)).newPage();
  await dm.goto('/');
  await dm.getByLabel('Your name').fill('Dana');
  await dm.getByRole('button', { name: 'Host a game' }).click();
  const link = (await dm.getByTestId('join-link').textContent()) ?? '';
  await dm.getByRole('button', { name: 'New map' }).click();
  const dialog = dm.getByRole('group', { name: 'New map' });
  await dialog.getByLabel('Width').fill('5');
  await dialog.getByLabel('Height').fill('4');
  await dialog.getByRole('button', { name: 'Create' }).click();

  const ana = await (await context(browser, playerOptions)).newPage();
  await ana.goto(link);
  await ana.getByLabel('Your name').fill('Ana');
  await ana.getByRole('button', { name: 'Join' }).click();
  await expect(ana.getByTestId('status')).toHaveText(/connected/i);
  await expect(ana.getByTestId('map-summary')).toContainText('20 tiles');

  await dm.getByRole('button', { name: 'Start demo fight' }).click();
  await expect(ana.getByTestId('turn-banner')).toContainText('Round 1');
  return { dm, ana };
}

/** The DM ends monsters' turns until it is Ana's turn. */
async function untilAnasTurn(dm: Page, ana: Page) {
  for (let i = 0; i < 4; i++) {
    if ((await ana.getByTestId('turn-banner').textContent())?.includes("Ana's turn")) return;
    await dm.getByRole('button', { name: 'End turn' }).click();
    await ana.waitForTimeout(150);
  }
  await expect(ana.getByTestId('turn-banner')).toContainText("Ana's turn");
}

const token = (page: Page, name: string) => page.getByTestId('token').filter({ hasText: name });

test('creatures appear on the map with name tags and HP bars, for DM and players', async ({ browser }) => {
  const { dm, ana } = await fight(browser);
  for (const page of [dm, ana]) {
    await expect(page.getByTestId('token')).toHaveCount(3);
    await expect(token(page, 'Goblin 1').getByRole('meter')).toHaveAccessibleName('Goblin 1: 8 of 8 HP');
    await expect(token(page, 'Ana').getByRole('meter')).toHaveAccessibleName('Ana: 9 of 9 HP');
  }
});

test('on your turn, the combat bar shows HP, XP, moves, and abilities', async ({ browser }) => {
  const { dm, ana } = await fight(browser);
  await untilAnasTurn(dm, ana);
  const bar = ana.getByRole('region', { name: 'Your turn' });
  await expect(bar.getByRole('meter', { name: 'HP' })).toHaveAccessibleDescription('9 of 9');
  await expect(bar.getByRole('meter', { name: 'XP' })).toHaveAccessibleDescription('0 of 300 to level 2');
  await expect(bar.getByTestId('movement-left')).toHaveText('6 moves left');
  for (const ability of ['Strike', 'Shoot', 'Mend', 'Second Wind']) {
    await expect(bar.getByRole('button', { name: ability })).toBeVisible();
  }
  await expect(bar.getByRole('button', { name: 'End turn' })).toBeVisible();
});

test('a player moves by clicking a highlighted tile, and everyone sees it', async ({ browser }) => {
  const { dm, ana } = await fight(browser);
  await untilAnasTurn(dm, ana);
  const start = await token(ana, 'Ana').getAttribute('data-cell');

  // Scan the view for a free tile one or two steps from Ana, then click it.
  const [aq, ar] = (start ?? '0,0').split(',').map(Number) as [number, number];
  const occupied = new Set(await ana.getByTestId('token').evaluateAll((tags) => tags.map((t) => (t as HTMLElement).dataset.cell)));
  const hexDistance = (q: number, r: number) => (Math.abs(q - aq) + Math.abs(r - ar) + Math.abs(q + r - aq - ar)) / 2;
  const box = (await ana.getByTestId('world-canvas').boundingBox())!;
  let moved = false;
  for (let row = 1; row < 10 && !moved; row++) {
    for (let col = 1; col < 14 && !moved; col++) {
      const px = box.x + (box.width * col) / 14;
      const py = box.y + (box.height * row) / 10;
      await ana.mouse.move(px, py);
      const match = ((await ana.getByTestId('tile-info').textContent()) ?? '').match(/^Tile \((-?\d+), (-?\d+)\)/);
      if (!match) continue;
      const [q, r] = [Number(match[1]), Number(match[2])];
      const distance = hexDistance(q, r);
      if (distance >= 1 && distance <= 2 && !occupied.has(`${q},${r}`)) {
        await ana.mouse.down();
        await ana.mouse.up();
        moved = true;
      }
    }
  }
  expect(moved).toBe(true);
  await expect(token(ana, 'Ana')).not.toHaveAttribute('data-cell', start ?? '');
  const now = await token(ana, 'Ana').getAttribute('data-cell');
  await expect(token(dm, 'Ana')).toHaveAttribute('data-cell', now ?? '');
  await expect(ana.getByTestId('movement-left')).not.toHaveText('6 moves left');
});

test('the DM styles the floating numbers; players see them in that style', async ({ browser }) => {
  const { dm, ana } = await fight(browser);
  await dm.getByRole('tab', { name: 'Art' }).click();
  await dm.getByRole('tab', { name: 'Numbers' }).click();
  const numbers = dm.getByRole('tabpanel', { name: 'Numbers' });
  const use = numbers.getByRole('button', { name: 'Use for everyone' });
  await expect(use).toBeDisabled();
  await numbers.getByRole('group', { name: 'Presets' }).getByRole('button', { name: 'Comic' }).click();
  await expect(numbers.getByTestId('numbers-preview').getByText('-12')).toHaveCSS('font-size', '30px');
  await numbers.getByLabel('Motion').selectOption('shake');
  await use.click();
  await expect(use).toBeDisabled();

  await untilAnasTurn(dm, ana);
  const bar = ana.getByRole('region', { name: 'Your turn' });
  await bar.getByRole('button', { name: 'Shoot' }).click();
  await ana.getByRole('button', { name: /^Target Goblin/ }).first().click();
  for (const page of [ana, dm]) {
    const float = page.getByTestId('float-text').first();
    await expect(float).toHaveText(/^(-\d+|Miss|0)$/);
    await expect(float).toHaveCSS('font-family', /Comic/);
  }
});

test('attacking: pick an ability, then a target; damage numbers float up and HP bars drop', async ({ browser }) => {
  const { dm, ana } = await fight(browser);
  await untilAnasTurn(dm, ana);
  const bar = ana.getByRole('region', { name: 'Your turn' });

  await bar.getByRole('button', { name: 'Shoot' }).click();
  const target = ana.getByRole('button', { name: /^Target Goblin/ }).first();
  await expect(target).toBeVisible();
  const goblin = ((await target.textContent()) ?? '').match(/Goblin \d/)?.[0] ?? '';
  await target.click();

  // A number (or "Miss") floats up over the goblin on both screens.
  for (const page of [ana, dm]) {
    await expect(page.getByTestId('float-text').first()).toHaveText(/^(-\d+|Miss|0)$/);
  }
  const shown = (await ana.getByTestId('float-text').first().textContent()) ?? '';
  if (shown.startsWith('-')) {
    const hp = 8 - Number(shown.slice(1));
    for (const page of [ana, dm]) {
      await expect(token(page, goblin).getByRole('meter')).toHaveAccessibleName(
        hp > 0 ? `${goblin}: ${hp} of 8 HP` : `${goblin}: down`,
      );
    }
  }
  // The action is spent: abilities are disabled until next turn.
  await expect(bar.getByRole('button', { name: 'Shoot' })).toBeDisabled();
});

test("players can't act on someone else's turn, and the DM plays monsters from the map", async ({ browser }) => {
  const { dm, ana } = await fight(browser);
  const banner = (await ana.getByTestId('turn-banner').textContent()) ?? '';
  if (!banner.includes("Ana's turn")) {
    await expect(ana.getByRole('region', { name: 'Your turn' })).toHaveCount(0);
    // The DM's tools switched from the Map tab to the encounter when the fight started, and the DM sees the monster's bar.
    await expect(dm.getByRole('tab', { name: 'Encounter' })).toHaveAttribute('aria-selected', 'true');
    await expect(dm.getByRole('region', { name: 'Your turn' })).toBeVisible();
  }
});

test('on a phone, the combat bar sits at the bottom with large buttons', async ({ browser }) => {
  const { dm, ana } = await fight(browser, { viewport: { width: 375, height: 700 }, hasTouch: true, isMobile: true });
  await untilAnasTurn(dm, ana);
  const bar = ana.getByRole('region', { name: 'Your turn' });
  const box = (await bar.boundingBox())!;
  expect(box.y + box.height).toBeGreaterThan(700 - 4);
  for (const button of await bar.getByRole('button').all()) {
    const size = (await button.boundingBox())!;
    expect(size.height).toBeGreaterThanOrEqual(44);
  }
  const overflow = await ana.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('highlights match the action (move, attack, help), and the creature acting is clearly marked', async ({ browser }) => {
  const { dm, ana } = await fight(browser);
  await untilAnasTurn(dm, ana);
  const canvas = ana.getByTestId('world-canvas');
  await expect(canvas).toHaveAttribute('data-highlight', 'move');
  const bar = ana.getByRole('region', { name: 'Your turn' });
  await bar.getByRole('button', { name: 'Shoot' }).click();
  await expect(canvas).toHaveAttribute('data-highlight', 'harm');
  await expect(bar.getByText(/red/i)).toBeVisible();
  await bar.getByRole('button', { name: 'Mend' }).click();
  await expect(canvas).toHaveAttribute('data-highlight', 'help');

  for (const page of [dm, ana]) {
    await expect(token(page, 'Ana')).toHaveAttribute('data-active', 'true');
    await expect(token(page, 'Ana').getByTestId('turn-marker')).toBeVisible();
    await expect(token(page, 'Goblin 1')).toHaveAttribute('data-active', 'false');
    await expect(token(page, 'Goblin 1').getByTestId('turn-marker')).toBeHidden();
  }
  await bar.getByRole('button', { name: 'End turn' }).click();
  await expect(token(ana, 'Ana')).toHaveAttribute('data-active', 'false');
});

test("every ability shows its range on the map: previewed on hover, and pickable even with nobody in reach", async ({ browser }) => {
  const { dm, ana } = await fight(browser);
  await untilAnasTurn(dm, ana);
  const canvas = ana.getByTestId('world-canvas');
  const bar = ana.getByRole('region', { name: 'Your turn' });
  const reach = async () => Number((await canvas.getAttribute('data-reach')) ?? 0);
  await expect(bar.getByRole('button', { name: 'Shoot' })).toContainText('range 6');
  await expect(bar.getByRole('button', { name: 'Strike' })).toContainText('range 1');

  await bar.getByRole('button', { name: 'Strike' }).hover();
  await expect(canvas).toHaveAttribute('data-reach', /^[1-9]/);
  const strikeReach = await reach();
  await bar.getByRole('button', { name: 'Shoot' }).hover();
  await expect.poll(reach).toBeGreaterThan(strikeReach);
  await ana.mouse.move(0, 0);
  await expect(canvas).not.toHaveAttribute('data-reach');

  // The goblins stand far off: Strike reaches nobody, but can still be picked to see its range.
  await bar.getByRole('button', { name: 'Strike' }).click();
  await expect(canvas).toHaveAttribute('data-reach', String(strikeReach));
  await expect(bar.getByText(/nobody is in range/i)).toBeVisible();
  await bar.getByRole('button', { name: 'Shoot' }).click();
  await expect(bar.getByText(/nobody is in range/i)).toHaveCount(0);
  await expect(canvas).toHaveAttribute('data-highlight', 'harm');
});
