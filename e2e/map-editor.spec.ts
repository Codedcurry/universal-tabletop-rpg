import { readFile } from 'node:fs/promises';
import { type Browser, type BrowserContext, type Page, expect, test } from '@playwright/test';

// The DM edits the map in a real 3D view; players see every change live.
// Both sides report the map in text (summary, hovered tile), so tests can
// compare them. The camera centers on the map, so the canvas center points
// at the same tile on every screen.

// Every browser context a test opens is closed afterwards, so idle sessions
// from earlier tests don't keep running (and slowing everything down).
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

async function newMap(page: Page, grid: 'Hex' | 'Square', width: number, height: number) {
  await page.getByRole('button', { name: 'New map' }).click();
  const dialog = page.getByRole('group', { name: 'New map' });
  await dialog.getByLabel('Grid').selectOption({ label: grid });
  await dialog.getByLabel('Width').fill(String(width));
  await dialog.getByLabel('Height').fill(String(height));
  await dialog.getByRole('button', { name: 'Create' }).click();
}

const summary = (page: Page) => page.getByTestId('map-summary');
const tileInfo = (page: Page) => page.getByTestId('tile-info');

async function canvasCenter(page: Page) {
  const box = await page.getByTestId('world-canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Clicks the middle of the 3D view (left button). */
async function clickCenter(page: Page) {
  const { x, y } = await canvasCenter(page);
  await page.mouse.click(x, y);
}

async function hoverCenter(page: Page) {
  const { x, y } = await canvasCenter(page);
  await page.mouse.move(x - 2, y);
  await page.mouse.move(x, y);
}

test('the DM shapes a map and players see every change live, with undo and redo', async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');

  await newMap(dm.page, 'Hex', 9, 7);
  await expect(summary(dm.page)).toHaveText('hex map · 63 tiles · 0 walls · heights 0–0');
  await expect(summary(ana.page)).toHaveText('hex map · 63 tiles · 0 walls · heights 0–0');

  await dm.page.getByRole('button', { name: 'Raise' }).click();
  await clickCenter(dm.page);
  await expect(summary(dm.page)).toHaveText('hex map · 63 tiles · 0 walls · heights 0–1');
  await expect(summary(ana.page)).toHaveText('hex map · 63 tiles · 0 walls · heights 0–1');

  await hoverCenter(dm.page);
  await hoverCenter(ana.page);
  await expect(tileInfo(dm.page)).toContainText('height 1');
  await expect(tileInfo(ana.page)).toHaveText((await tileInfo(dm.page).textContent()) ?? '');

  await dm.page.getByRole('button', { name: 'Undo' }).click();
  await expect(summary(ana.page)).toHaveText('hex map · 63 tiles · 0 walls · heights 0–0');
  await dm.page.getByRole('button', { name: 'Redo' }).click();
  await expect(summary(ana.page)).toHaveText('hex map · 63 tiles · 0 walls · heights 0–1');
});

test('walls go on the nearest edge and can be removed', async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');
  await newMap(dm.page, 'Square', 8, 8);

  await dm.page.getByRole('button', { name: 'Wall', exact: true }).click();
  await clickCenter(dm.page);
  await expect(summary(ana.page)).toContainText('1 wall ');
  await dm.page.getByRole('button', { name: 'Remove wall' }).click();
  await clickCenter(dm.page);
  await expect(summary(ana.page)).toContainText('0 walls');
});

test('generated maps sync to players and repeat exactly from a seed', async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');

  const generate = async (seed: number) => {
    await dm.page.getByRole('button', { name: 'Generate' }).click();
    const dialog = dm.page.getByRole('group', { name: 'Generate a map' });
    await dialog.getByLabel('Terrain').selectOption({ label: 'Hills' });
    await dialog.getByLabel('Seed').fill(String(seed));
    await dialog.getByLabel('Width').fill('20');
    await dialog.getByLabel('Height').fill('16');
    await dialog.getByRole('button', { name: 'Create' }).click();
  };

  await generate(7);
  await expect(summary(dm.page)).toContainText('320 tiles');
  if (process.env.SCREENSHOT_DIR) {
    await dm.page.waitForTimeout(500);
    await dm.page.getByTestId('world-canvas').screenshot({ path: `${process.env.SCREENSHOT_DIR}/desktop-map.png` });
  }
  await expect(summary(ana.page)).toHaveText((await summary(dm.page).textContent()) ?? '');
  await hoverCenter(dm.page);
  const firstLook = await tileInfo(dm.page).textContent();

  await generate(8);
  await generate(7);
  await hoverCenter(dm.page);
  await hoverCenter(ana.page);
  await expect(tileInfo(dm.page)).toHaveText(firstLook ?? '');
  await expect(tileInfo(ana.page)).toHaveText(firstLook ?? '');
});

test('maps export to a file and import back; bad files are refused', async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');
  await newMap(dm.page, 'Hex', 9, 7);
  await dm.page.getByRole('button', { name: 'Raise' }).click();
  await clickCenter(dm.page);
  await expect(summary(dm.page)).toContainText('heights 0–1');

  const downloadPromise = dm.page.waitForEvent('download');
  await dm.page.getByRole('button', { name: 'Export' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  const saved = JSON.parse(await readFile(path, 'utf8'));
  expect(saved.tiles).toHaveLength(63);

  await newMap(dm.page, 'Square', 4, 4);
  await expect(summary(ana.page)).toContainText('16 tiles');

  await dm.page.getByLabel('Import map file').setInputFiles(path);
  await expect(summary(ana.page)).toHaveText('hex map · 63 tiles · 0 walls · heights 0–1');

  await dm.page.getByLabel('Import map file').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"tiles": "nope"}'),
  });
  await expect(dm.page.getByRole('alert')).toContainText(/map/i);
  await expect(summary(ana.page)).toHaveText('hex map · 63 tiles · 0 walls · heights 0–1');
});

test('a full-size 100 x 100 map reaches players, far over the 16 KB message limit', async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');
  await newMap(dm.page, 'Square', 100, 100);
  const full = 'square map · 10000 tiles · 0 walls · heights 0–0';
  await expect(summary(ana.page)).toHaveText(full, { timeout: 30_000 });

  // A late joiner gets the whole map in their first snapshot too.
  const ben = await join(browser, dm.link, 'Ben');
  await expect(summary(ben.page)).toHaveText(full, { timeout: 30_000 });
});

/**
 * Share of the 3D view's pixels that differ from the empty background, read
 * from a real screenshot. Picking can work even when nothing is drawn, so
 * this checks what a person would actually see.
 */
async function drawnFraction(page: Page): Promise<number> {
  const png = (await page.getByTestId('world-canvas').screenshot()).toString('base64');
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d') as CanvasRenderingContext2D;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    // The view's empty background (placeholder style pack), not a corner pixel: corners are rounded.
    const [br, bg, bb] = [0x14, 0x12, 0x1c];
    let drawn = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const diff = Math.abs((pixels[i] as number) - br) + Math.abs((pixels[i + 1] as number) - bg) + Math.abs((pixels[i + 2] as number) - bb);
      if (diff > 30) drawn++;
    }
    return drawn / (pixels.length / 4);
  }, png);
}

test('the map is really drawn on screen, for the DM and for players', async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');
  await newMap(dm.page, 'Hex', 12, 10);
  await expect(summary(ana.page)).toContainText('120 tiles');
  await expect.poll(() => drawnFraction(dm.page), { timeout: 10_000 }).toBeGreaterThan(0.15);
  await expect.poll(() => drawnFraction(ana.page), { timeout: 10_000 }).toBeGreaterThan(0.15);

  // A bigger generated map, whose first tile sits far from the camera's view.
  await dm.page.getByRole('button', { name: 'Generate' }).click();
  const dialog = dm.page.getByRole('group', { name: 'Generate a map' });
  await dialog.getByLabel('Grid').selectOption({ label: 'Square' });
  await dialog.getByLabel('Width').fill('40');
  await dialog.getByLabel('Height').fill('30');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(summary(ana.page)).toContainText('1200 tiles');
  await expect.poll(() => drawnFraction(dm.page), { timeout: 10_000 }).toBeGreaterThan(0.15);
  await expect.poll(() => drawnFraction(ana.page), { timeout: 10_000 }).toBeGreaterThan(0.15);
});

test('the camera moves: zoom and pan for the DM, turn for players', async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');
  await newMap(dm.page, 'Hex', 12, 10);
  await expect(summary(ana.page)).toContainText('120 tiles');
  await expect.poll(() => drawnFraction(dm.page), { timeout: 10_000 }).toBeGreaterThan(0.15);

  const view = (page: Page) => page.getByTestId('world-canvas').screenshot();
  /** The view once it has stopped changing, so each step measures only its own effect. */
  const settled = async (page: Page) => {
    let previous = await view(page);
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(250);
      const next = await view(page);
      if (next.equals(previous)) return next;
      previous = next;
    }
    throw new Error('the view never stopped moving');
  };
  const { x, y } = await canvasCenter(dm.page);

  // Wheel zoom (DM).
  let before = await settled(dm.page);
  await dm.page.mouse.move(x, y);
  await dm.page.mouse.wheel(0, 600);
  await expect.poll(async () => (await view(dm.page)).equals(before), { timeout: 5_000 }).toBe(false);

  // Right-drag pans in edit mode, and must not edit the map.
  before = await settled(dm.page);
  await dm.page.mouse.move(x, y);
  await dm.page.mouse.down({ button: 'right' });
  await dm.page.mouse.move(x + 150, y + 40, { steps: 8 });
  await dm.page.mouse.up({ button: 'right' });
  await expect.poll(async () => (await view(dm.page)).equals(before), { timeout: 5_000 }).toBe(false);
  await expect(summary(dm.page)).toContainText('heights 0–0');

  // Middle-drag turns the view in edit mode, and must not edit the map either.
  before = await settled(dm.page);
  await dm.page.mouse.move(x, y);
  await dm.page.mouse.down({ button: 'middle' });
  await dm.page.mouse.move(x + 200, y, { steps: 8 });
  await dm.page.mouse.up({ button: 'middle' });
  await expect.poll(async () => (await view(dm.page)).equals(before), { timeout: 5_000 }).toBe(false);
  await expect(summary(dm.page)).toContainText('heights 0–0');

  // Players turn the view with a left-drag.
  const center = await canvasCenter(ana.page);
  before = await settled(ana.page);
  await ana.page.mouse.move(center.x, center.y);
  await ana.page.mouse.down();
  await ana.page.mouse.move(center.x + 200, center.y, { steps: 8 });
  await ana.page.mouse.up();
  await expect.poll(async () => (await view(ana.page)).equals(before), { timeout: 5_000 }).toBe(false);
});

test('scrolling over the map zooms it without moving the page, for DM and players', async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');
  await newMap(dm.page, 'Hex', 12, 10);
  await expect(summary(ana.page)).toContainText('120 tiles');

  for (const page of [dm.page, ana.page]) {
    // Make sure the page can scroll both ways, with the map in view.
    await page.getByTestId('world-canvas').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 40));
    const scrollBefore = await page.evaluate(() => window.scrollY);
    const shotBefore = await page.getByTestId('world-canvas').screenshot();
    const { x, y } = await canvasCenter(page);
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, 400);
    await page.mouse.wheel(0, -150);
    await expect
      .poll(async () => (await page.getByTestId('world-canvas').screenshot()).equals(shotBefore), { timeout: 5_000 })
      .toBe(false);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  }
});

test('"Add tiles" builds onto empty space beyond the edge, by click and by brush', async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');
  await newMap(dm.page, 'Square', 5, 5);
  await expect(summary(ana.page)).toContainText('25 tiles');
  await dm.page.getByRole('button', { name: 'Add tiles' }).click();

  const box = (await dm.page.getByTestId('world-canvas').boundingBox())!;
  const middleY = box.y + box.height / 2;
  const beyondRight = box.x + box.width - 6; // past the map's right edge

  // One click in empty space adds one tile there.
  await dm.page.mouse.click(beyondRight, middleY);
  await expect(summary(ana.page)).toContainText('26 tiles');

  // Brushing from inside the map out into empty space adds a run of tiles.
  await dm.page.mouse.move(box.x + box.width / 2, middleY - 30);
  await dm.page.mouse.down();
  await dm.page.mouse.move(beyondRight, middleY - 30, { steps: 25 });
  await dm.page.mouse.up();
  await expect.poll(async () => Number((await summary(ana.page).textContent())?.match(/(\d+) tiles/)?.[1])).toBeGreaterThan(26);

  // Other tools ignore empty space.
  const count = await summary(dm.page).textContent();
  await dm.page.getByRole('button', { name: 'Raise' }).click();
  await dm.page.mouse.click(box.x + 6, box.y + 6);
  await expect(summary(dm.page)).toHaveText(count ?? '');
});

test('Ring draws a hollow outline, and Fill stays inside it', async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');
  await newMap(dm.page, 'Hex', 9, 7);
  await expect(summary(ana.page)).toContainText('63 tiles');
  const box = (await dm.page.getByTestId('world-canvas').boundingBox())!;
  const { x, y } = await canvasCenter(dm.page);

  // A stone ring two tiles out from the middle. Find, by hovering, the point
  // two tiles to the right, rather than guessing a pixel distance.
  const cellAt = async (px: number) => {
    await dm.page.mouse.move(px, y);
    const match = (await tileInfo(dm.page).textContent())?.match(/Tile \((-?\d+), (-?\d+)\)/);
    return match ? { q: Number(match[1]), r: Number(match[2]) } : null;
  };
  const middle = (await cellAt(x))!;
  let ringX = x;
  for (let px = x; px < box.x + box.width; px += 4) {
    const cell = await cellAt(px);
    if (cell && cell.r === middle.r && cell.q === middle.q + 2) {
      ringX = px;
      break;
    }
  }
  expect(ringX).toBeGreaterThan(x);
  await dm.page.getByRole('button', { name: 'Paint' }).click();
  await dm.page.getByLabel('Terrain').selectOption('stone');
  await dm.page.getByLabel('Shape').selectOption({ label: 'Ring' });
  await dm.page.mouse.move(x, y);
  await dm.page.mouse.down();
  await dm.page.mouse.move(ringX, y, { steps: 10 });
  await dm.page.mouse.up();

  // Fill the middle with sand.
  await dm.page.getByLabel('Terrain').selectOption('sand');
  await dm.page.getByLabel('Shape').selectOption({ label: 'Fill' });
  await dm.page.mouse.click(x, y);

  const terrainAt = async (page: Page, px: number, py: number) => {
    await page.mouse.move(px - 2, py);
    await page.mouse.move(px, py);
    return tileInfo(page).textContent();
  };
  await expect.poll(() => terrainAt(dm.page, x, y)).toContain('sand');
  // Sweeping left from the middle: sand inside, then the stone ring, then grass
  // beyond it. Grass outside the ring means the fill didn't leak.
  const seen: string[] = [];
  for (let dx = 0; dx <= box.width * 0.48; dx += box.width * 0.015) {
    const info = (await terrainAt(dm.page, x - dx, y)) ?? '';
    const terrain = info.match(/· (grass|stone|sand)/)?.[1];
    if (terrain && seen.at(-1) !== terrain) seen.push(terrain);
  }
  expect(seen).toEqual(['sand', 'stone', 'grass']);
  // Players see the same.
  const center = await canvasCenter(ana.page);
  await expect.poll(() => terrainAt(ana.page, center.x, center.y)).toContain('sand');
});

test('an existing map switches between hex and square grids, keeping its layout', async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');
  await newMap(dm.page, 'Hex', 9, 7);
  await dm.page.getByRole('button', { name: 'Raise' }).click();
  await clickCenter(dm.page);
  await expect(summary(ana.page)).toHaveText('hex map · 63 tiles · 0 walls · heights 0–1');

  await dm.page.getByRole('button', { name: 'Switch to square grid' }).click();
  await expect(summary(ana.page)).toHaveText('square map · 63 tiles · 0 walls · heights 0–1');
  await dm.page.getByRole('button', { name: 'Switch to hex grid' }).click();
  await expect(summary(ana.page)).toHaveText('hex map · 63 tiles · 0 walls · heights 0–1');
});

test('Fill with "Add tiles" fills an enclosed empty area, and explains when an area is open', async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');
  await newMap(dm.page, 'Hex', 9, 7);
  const box = (await dm.page.getByTestId('world-canvas').boundingBox())!;
  const { x, y } = await canvasCenter(dm.page);

  // Punch a hole in the middle of the map: tiles all around it, so it's enclosed.
  await dm.page.getByRole('button', { name: 'Remove tiles' }).click();
  await dm.page.mouse.click(x, y);
  await expect(summary(ana.page)).toContainText('62 tiles');

  // Fill the hole back in.
  await dm.page.getByRole('button', { name: 'Add tiles' }).click();
  await dm.page.getByLabel('Shape').selectOption({ label: 'Fill' });
  await dm.page.mouse.click(x, y);
  await expect(summary(ana.page)).toContainText('63 tiles');

  // Empty space outside the map isn't enclosed: nothing is added, and the DM is told why.
  await dm.page.mouse.click(box.x + box.width - 6, y);
  await expect(dm.page.getByRole('alert')).toContainText(/enclosed/i);
  await expect(summary(ana.page)).toContainText('63 tiles');
});

test('the camera stays put while editing, and Re-center view brings the map back', async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');
  await newMap(dm.page, 'Hex', 9, 7);
  await expect(summary(ana.page)).toContainText('63 tiles');
  const box = (await dm.page.getByTestId('world-canvas').boundingBox())!;
  const spot = { x: box.x + box.width * 0.35, y: box.y + box.height * 0.5 };
  const hover = async (page: Page, px: number, py: number) => {
    await page.mouse.move(px - 2, py);
    await page.mouse.move(px, py);
    return tileInfo(page).textContent();
  };
  const before = await hover(dm.page, spot.x, spot.y);

  // Removing and adding tiles elsewhere must not move the camera.
  await dm.page.getByRole('button', { name: 'Remove tiles' }).click();
  await clickCenter(dm.page);
  await expect(summary(ana.page)).toContainText('62 tiles');
  expect(await hover(dm.page, spot.x, spot.y)).toBe(before);
  await dm.page.getByRole('button', { name: 'Add tiles' }).click();
  await dm.page.mouse.click(box.x + box.width - 6, box.y + box.height / 2);
  await expect(summary(ana.page)).toContainText('63 tiles');
  expect(await hover(dm.page, spot.x, spot.y)).toBe(before);

  // After zooming away, Re-center view frames the (now wider) map again, the same way each time.
  const view = (page: Page) => page.getByTestId('world-canvas').screenshot();
  await ana.page.getByRole('button', { name: 'Re-center view' }).click();
  await ana.page.mouse.move(0, 0);
  await ana.page.waitForTimeout(500);
  const centered = await view(ana.page);
  const center = await canvasCenter(ana.page);
  await ana.page.mouse.move(center.x, center.y);
  await ana.page.mouse.wheel(0, 800);
  await expect.poll(async () => (await view(ana.page)).equals(centered)).toBe(false);
  await ana.page.getByRole('button', { name: 'Re-center view' }).click();
  await ana.page.mouse.move(0, 0);
  await expect.poll(async () => (await view(ana.page)).equals(centered), { timeout: 5_000 }).toBe(true);
});

test('a drag in progress can be cancelled with right-click or Esc, and nothing changes', async ({ browser }) => {
  const dm = await host(browser);
  const ana = await join(browser, dm.link, 'Ana');
  await newMap(dm.page, 'Hex', 9, 7);
  await expect(summary(ana.page)).toContainText('63 tiles');
  const box = (await dm.page.getByTestId('world-canvas').boundingBox())!;
  const { x, y } = await canvasCenter(dm.page);
  const beyondRight = box.x + box.width - 6;

  // Brushing Add tiles out into empty space adds tiles live; right-click undoes the whole stroke.
  await dm.page.getByRole('button', { name: 'Add tiles' }).click();
  await dm.page.mouse.move(x, y);
  await dm.page.mouse.down();
  await dm.page.mouse.move(beyondRight, y, { steps: 20 });
  await expect(dm.page.getByText('Right-click or Esc to cancel')).toBeVisible();
  await expect.poll(async () => Number((await summary(dm.page).textContent())?.match(/(\d+) tiles/)?.[1])).toBeGreaterThan(63);
  await dm.page.mouse.down({ button: 'right' });
  await dm.page.mouse.up({ button: 'right' });
  await dm.page.mouse.up();
  await expect(summary(ana.page)).toContainText('63 tiles');
  await expect(dm.page.getByText('Right-click or Esc to cancel')).toHaveCount(0);
  // A cancelled stroke leaves nothing to undo.
  await expect(dm.page.getByRole('button', { name: 'Undo' })).toBeDisabled();

  // Esc cancels a rectangle being dragged: it is never applied.
  await dm.page.getByLabel('Shape').selectOption({ label: 'Rectangle' });
  await dm.page.mouse.move(x, y);
  await dm.page.mouse.down();
  await dm.page.mouse.move(beyondRight, y + 40, { steps: 10 });
  await dm.page.keyboard.press('Escape');
  await dm.page.mouse.up();
  await expect(summary(ana.page)).toContainText('63 tiles');

  // Raise with the brush, cancelled: heights go back.
  await dm.page.getByRole('button', { name: 'Raise' }).click();
  await dm.page.getByLabel('Shape').selectOption({ label: 'Brush' });
  await dm.page.mouse.move(x - 100, y);
  await dm.page.mouse.down();
  await dm.page.mouse.move(x + 100, y, { steps: 10 });
  await expect(summary(dm.page)).toContainText('heights 0–1');
  await dm.page.mouse.down({ button: 'right' });
  await dm.page.mouse.up({ button: 'right' });
  await dm.page.mouse.up();
  await expect(summary(ana.page)).toContainText('heights 0–0');
});

test('on a touch screen, a second finger (or the Cancel button) cancels a drag', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true });
  openContexts.push(context);
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('Your name').fill('Dana');
  await page.getByRole('button', { name: 'Host a game' }).click();
  await newMap(page, 'Hex', 9, 7);
  await page.getByRole('button', { name: 'Add tiles' }).click();
  const box = (await page.getByTestId('world-canvas').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const cdp = await context.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: { x: number; y: number; id: number }[]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });

  // One finger drags out into empty space, adding tiles.
  await touch('touchStart', [{ x, y, id: 0 }]);
  for (let step = 1; step <= 15; step++) await touch('touchMove', [{ x: x + (step / 15) * (box.width / 2 - 8), y, id: 0 }]);
  await expect.poll(async () => Number((await summary(page).textContent())?.match(/(\d+) tiles/)?.[1])).toBeGreaterThan(63);
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(page.getByText('Tap with a second finger to cancel')).toBeVisible();

  // A second finger touches down: the stroke is cancelled.
  const end = { x: x + box.width / 2 - 8, y, id: 0 };
  await touch('touchStart', [end, { x: x - 200, y: y + 50, id: 1 }]);
  await touch('touchEnd', []);
  await expect(summary(page)).toContainText('63 tiles');
  await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
});
