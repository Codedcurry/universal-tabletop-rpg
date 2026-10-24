import { type Browser, type BrowserContext, type Page, expect, test } from '@playwright/test';

// The camera system: snapping 2.5D view (N/E/S/W), top-down, free camera,
// world bounds, the DM's "focus everyone here", and touch twist.

const openContexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((context) => context.close()));
});

async function host(browser: Browser) {
  const context = await browser.newContext();
  openContexts.push(context);
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('Your name').fill('Dana');
  await page.getByRole('button', { name: 'Host a game' }).click();
  const link = (await page.getByTestId('join-link').textContent()) ?? '';
  await page.getByRole('button', { name: 'New map' }).click();
  const dialog = page.getByRole('group', { name: 'New map' });
  await dialog.getByLabel('Width').fill('9');
  await dialog.getByLabel('Height').fill('7');
  await dialog.getByRole('button', { name: 'Create' }).click();
  return { context, page, link };
}

async function join(browser: Browser, link: string, name: string, options: { hasTouch?: boolean } = {}) {
  const context = await browser.newContext(options);
  openContexts.push(context);
  const page = await context.newPage();
  await page.goto(link);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Join' }).click();
  await expect(page.getByTestId('status')).toHaveText(/connected/i);
  await expect(page.getByTestId('map-summary')).toContainText('63 tiles');
  return { context, page };
}

const heading = (page: Page) => page.getByTestId('camera-heading');
const canvas = (page: Page) => page.getByTestId('world-canvas');
/** A picture of the map alone: the camera buttons float over it (and show focus outlines), so they're masked. */
const picture = (page: Page) =>
  canvas(page).screenshot({ mask: [page.getByRole('toolbar', { name: 'Camera' })] });

async function center(page: Page) {
  const box = (await canvas(page).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

/** The view once it has stopped moving. */
async function settled(page: Page): Promise<Buffer> {
  let previous = await picture(page);
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(150);
    const next = await picture(page);
    if (next.equals(previous)) return next;
    previous = next;
  }
  throw new Error('the view never stopped moving');
}

async function tileAtCenter(page: Page) {
  const { x, y } = await center(page);
  await page.mouse.move(x - 2, y);
  await page.mouse.move(x, y);
  return page.getByTestId('tile-info').textContent();
}

test('Q/E and the turn buttons rotate the view a quarter turn around the same spot', async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');
  await expect(heading(ana.page)).toHaveText('Facing north');
  const north = await settled(ana.page);
  const middle = await tileAtCenter(ana.page);

  await ana.page.keyboard.press('e');
  await expect(heading(ana.page)).toHaveText('Facing east');
  const east = await settled(ana.page);
  expect(east.equals(north)).toBe(false);
  expect(await tileAtCenter(ana.page)).toBe(middle);

  await ana.page.getByRole('button', { name: 'Turn left' }).click();
  await expect(heading(ana.page)).toHaveText('Facing north');
  await ana.page.mouse.move(0, 0);
  expect((await settled(ana.page)).equals(north)).toBe(true);

  await ana.page.keyboard.press('q');
  await expect(heading(ana.page)).toHaveText('Facing west');
  await ana.page.getByRole('button', { name: 'Turn right' }).click();
  await ana.page.getByRole('button', { name: 'Turn right' }).click();
  await expect(heading(ana.page)).toHaveText('Facing east');
});

test('top-down view looks straight down, stays north-up, and switches back', async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');
  const angled = await settled(ana.page);

  await ana.page.getByRole('button', { name: 'Top-down view' }).click();
  await expect(heading(ana.page)).toHaveText('Top-down · north up');
  expect((await settled(ana.page)).equals(angled)).toBe(false);
  await expect(ana.page.getByRole('button', { name: 'Turn left' })).toBeDisabled();
  await ana.page.keyboard.press('e');
  await expect(heading(ana.page)).toHaveText('Top-down · north up');

  await ana.page.getByRole('button', { name: 'Top-down view' }).click();
  await expect(heading(ana.page)).toHaveText('Facing north');
});

test('free camera orbits by hand and snaps to the nearest direction when turned off', async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');
  const north = await settled(ana.page);
  const { x, y, box } = await center(ana.page);

  await ana.page.getByRole('button', { name: 'Free camera' }).click();
  await expect(heading(ana.page)).toHaveText('Free camera');
  // A small orbit: less than an eighth of a turn.
  await ana.page.mouse.move(x, y);
  await ana.page.mouse.down();
  await ana.page.mouse.move(x + box.width * 0.04, y, { steps: 5 });
  await ana.page.mouse.up();
  expect((await settled(ana.page)).equals(north)).toBe(false);

  await ana.page.getByRole('button', { name: 'Free camera' }).click();
  await expect(heading(ana.page)).toHaveText('Facing north');
  await ana.page.mouse.move(0, 0);
  expect((await settled(ana.page)).equals(north)).toBe(true);

  // A big orbit ends up facing a different direction.
  await ana.page.getByRole('button', { name: 'Free camera' }).click();
  await ana.page.mouse.move(x, y);
  await ana.page.mouse.down();
  await ana.page.mouse.move(x + box.width * 0.45, y, { steps: 15 });
  await ana.page.mouse.up();
  await settled(ana.page);
  await ana.page.getByRole('button', { name: 'Free camera' }).click();
  await expect(heading(ana.page)).not.toHaveText('Facing north');
  await expect(heading(ana.page)).toHaveText(/^Facing (east|south|west)$/);
});

test("the camera can't wander off the map", async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');
  const { x, y, box } = await center(ana.page);
  // Drag the view far off to one side, several times.
  for (let i = 0; i < 4; i++) {
    await ana.page.mouse.move(x, y);
    await ana.page.mouse.down();
    await ana.page.mouse.move(x - box.width * 0.45, y + box.height * 0.4, { steps: 10 });
    await ana.page.mouse.up();
  }
  await settled(ana.page);
  expect(await tileAtCenter(ana.page)).toMatch(/^Tile \(/);
});

test('the DM can point everyone at a spot with "Focus everyone here"', async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');
  const { x, y, box } = await center(dm.page);

  // The DM pans (right-drag) to look somewhere else.
  await dm.page.mouse.move(x, y);
  await dm.page.mouse.down({ button: 'right' });
  await dm.page.mouse.move(x + box.width * 0.25, y + box.height * 0.2, { steps: 10 });
  await dm.page.mouse.up({ button: 'right' });
  await settled(dm.page);
  const dmSpot = await tileAtCenter(dm.page);
  expect(dmSpot).not.toBe(await tileAtCenter(ana.page));

  await dm.page.getByRole('button', { name: 'Focus everyone here' }).click();
  await expect.poll(async () => {
    await settled(ana.page);
    return tileAtCenter(ana.page);
  }).toBe(dmSpot);
});

test('a two-finger twist turns the view on a touch screen', async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana', { hasTouch: true });
  await expect(heading(ana.page)).toHaveText('Facing north');
  const { x, y } = await center(ana.page);
  const cdp = await ana.context.newCDPSession(ana.page);
  const fingers = (angle: number) => [
    { x: x - 80 * Math.cos(angle), y: y - 80 * Math.sin(angle), id: 0 },
    { x: x + 80 * Math.cos(angle), y: y + 80 * Math.sin(angle), id: 1 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(0) });
  for (let step = 1; step <= 12; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers((step / 12) * 0.8) }); // ~45 degrees: one quarter turn
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(heading(ana.page)).toHaveText(/^Facing (east|west)$/);
});

test('facing north, the map reads normally: east to the right, row 0 at the far edge', async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');
  const { x, y, box } = await center(ana.page);
  const cellAt = async (px: number, py: number) => {
    await ana.page.mouse.move(px, py);
    // "Tile (q, r) ..." or "(q, r) is outside the map": either way, the cell.
    const match = (await ana.page.getByTestId('tile-info').textContent())?.match(/\((-?\d+), (-?\d+)\)/);
    return { q: Number(match?.[1]), r: Number(match?.[2]) };
  };
  const middle = await cellAt(x, y);
  const right = await cellAt(x + box.width * 0.15, y);
  const up = await cellAt(x, y - box.height * 0.1);
  expect(right.r).toBe(middle.r);
  expect(right.q).toBeGreaterThan(middle.q);
  expect(up.r).toBeLessThan(middle.r);
});

test('a few wheel notches zoom a long way', async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');
  const { x, y, box } = await center(ana.page);
  const columnAt = async (px: number) => {
    await ana.page.mouse.move(px, y);
    return Number((await ana.page.getByTestId('tile-info').textContent())?.match(/\((-?\d+),/)?.[1]);
  };
  const before = (await columnAt(x + box.width * 0.3)) - (await columnAt(x));
  await ana.page.mouse.move(x, y);
  for (let i = 0; i < 3; i++) await ana.page.mouse.wheel(0, -100);
  await settled(ana.page);
  const after = (await columnAt(x + box.width * 0.3)) - (await columnAt(x));
  // Zoomed in: the same distance on screen now spans far fewer tiles.
  expect(after).toBeLessThanOrEqual(Math.floor(before * 0.7));
});

test('dragging grabs the map: the ground under the pointer follows it, zoomed in or out', async ({ browser }) => {
  const dm = await host(browser);
  // A big world, so the view has room to move.
  await dm.page.getByRole('button', { name: 'New map' }).click();
  const dialog = dm.page.getByRole('group', { name: 'New map' });
  await dialog.getByLabel('Width').fill('40');
  await dialog.getByLabel('Height').fill('30');
  await dialog.getByRole('button', { name: 'Create' }).click();
  const context = await browser.newContext();
  openContexts.push(context);
  const page = await context.newPage();
  await page.goto(dm.link);
  await page.getByLabel('Your name').fill('Ana');
  await page.getByRole('button', { name: 'Join' }).click();
  await expect(page.getByTestId('map-summary')).toContainText('1200 tiles');

  const cellAt = async (px: number, py: number) => {
    await page.mouse.move(px - 1, py);
    await page.mouse.move(px, py);
    const match = (await page.getByTestId('tile-info').textContent())?.match(/\((-?\d+), (-?\d+)\)/);
    return { q: Number(match?.[1]), r: Number(match?.[2]) };
  };
  const { x, y, box } = await center(page);
  // Short drags that keep the view inside the world (the camera stops at its edge).
  const left = { x: x - box.width * 0.08, y };
  const right = { x: x + box.width * 0.08, y };

  for (const zoom of ['zoomed out', 'zoomed in']) {
    if (zoom === 'zoomed in') {
      await page.mouse.move(x, y);
      for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -100);
    }
    // Right, then back left.
    const [from, to] = zoom === 'zoomed out' ? [left, right] : [right, left];
    await settled(page);
    const grabbed = await cellAt(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
    await page.mouse.move(0, 0);
    await settled(page);
    const under = await cellAt(to.x, to.y);
    // The same tile (give or take one, for the glide).
    expect(Math.abs(under.q - grabbed.q), `${zoom}: grabbed ${JSON.stringify(grabbed)}, now under ${JSON.stringify(under)}`).toBeLessThanOrEqual(1);
    expect(Math.abs(under.r - grabbed.r), zoom).toBeLessThanOrEqual(1);
  }
});
