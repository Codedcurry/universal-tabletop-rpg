import { type Browser, type BrowserContext, type Page, expect, test } from '@playwright/test';

// The DM's own art: tile textures imported in the Art tab, previewed with
// size warnings, shown to every player, and reset back to the pack's.

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
  await dm.getByRole('button', { name: 'New map' }).click();
  await dm.getByRole('group', { name: 'New map' }).getByRole('button', { name: 'Create' }).click();
  const ana = await open(browser);
  await ana.goto(link);
  await ana.getByLabel('Your name').fill('Ana');
  await ana.getByRole('button', { name: 'Join' }).click();
  await expect(ana.getByTestId('status')).toHaveText(/connected/i);
  return { dm, ana };
}

/** A small PNG drawn in the page, as a file to upload. */
async function png(page: Page, width: number, height: number) {
  const dataUrl = await page.evaluate(
    ([w, h]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w!;
      canvas.height = h!;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#d33';
      ctx.fillRect(0, 0, w!, h!);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w! / 2, h! / 2);
      return canvas.toDataURL('image/png');
    },
    [width, height],
  );
  return { name: `tile-${width}x${height}.png`, mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64') };
}

test('the DM imports a tile texture, previews it, and every player sees it', async ({ browser }) => {
  const { dm, ana } = await table(browser);
  await dm.getByRole('tab', { name: 'Art' }).click();
  const art = dm.getByRole('tabpanel', { name: 'Tiles' });

  // A badly sized one first: it warns, and can be cancelled.
  await art.getByLabel('Import grass tile').setInputFiles(await png(dm, 30, 20));
  const preview = art.getByRole('group', { name: 'New grass tile' });
  await expect(preview).toContainText(/square/i);
  await preview.getByRole('button', { name: 'Cancel' }).click();
  await expect(preview).toHaveCount(0);

  await art.getByLabel('Import grass tile').setInputFiles(await png(dm, 16, 16));
  await expect(preview.getByRole('img')).toBeVisible();
  await expect(preview).not.toContainText(/square/i);
  await preview.getByRole('button', { name: 'Use for grass' }).click();
  await expect(dm.getByTestId('world-canvas')).toHaveAttribute('data-custom-tiles', 'grass');
  await expect(ana.getByTestId('world-canvas')).toHaveAttribute('data-custom-tiles', 'grass');

  await art.getByRole('button', { name: 'Reset grass tile' }).click();
  await expect(ana.getByTestId('world-canvas')).toHaveAttribute('data-custom-tiles', '');
});

/** A sprite sheet drawn in the page: 32-pixel frames, 2 across; idle (red) and walk (blue), 4 rows each. */
async function spriteSheet(page: Page) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    for (let row = 0; row < 8; row++) {
      for (let column = 0; column < 2; column++) {
        ctx.fillStyle = row < 4 ? '#d33' : '#36c';
        ctx.fillRect(column * 32 + 8, row * 32 + 4 + column * 2, 16, 26);
        ctx.fillStyle = '#fdd';
        ctx.fillRect(column * 32 + 11, row * 32 + 6, 10, 8); // a face
      }
    }
    return canvas.toDataURL('image/png');
  });
  return { name: 'goblin-sheet.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64') };
}

test('the DM imports a character sprite sheet: sliced, previewed, with a round token, and players see it', async ({ browser }) => {
  const { dm, ana } = await table(browser);
  // A goblin on the map.
  await dm.getByRole('tab', { name: 'Encounter' }).click();
  const encounter = dm.getByRole('tabpanel', { name: 'Encounter' });
  await encounter.getByLabel('Add').selectOption({ label: 'Goblin' });
  await encounter.getByRole('button', { name: 'Place on map' }).click();
  const box = (await dm.getByTestId('world-canvas').boundingBox())!;
  await dm.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(ana.getByTestId('token').filter({ hasText: 'Goblin' })).toHaveAttribute('data-art', 'pack');

  await dm.getByRole('tab', { name: 'Art' }).click();
  await dm.getByRole('tab', { name: 'Characters' }).click();
  const art = dm.getByRole('tabpanel', { name: 'Characters' });
  await art.getByLabel('Character').selectOption({ label: 'Goblin (every goblin)' });
  await art.getByLabel('Import sprite sheet').setInputFiles(await spriteSheet(dm));
  const preview = art.getByRole('group', { name: 'New sprite sheet' });
  await expect(preview).toContainText('32-pixel frames');
  await expect(preview).toContainText('idle, walk');
  await expect(preview.getByRole('img', { name: /preview/i })).toBeVisible();
  await expect(preview.getByRole('img', { name: 'Round token' })).toBeVisible();
  await preview.getByRole('combobox', { name: /^Animation/ }).selectOption('walk');
  await preview.getByRole('button', { name: 'Use for Goblin' }).click();

  await expect(ana.getByTestId('token').filter({ hasText: 'Goblin' })).toHaveAttribute('data-art', 'custom');
  await art.getByRole('button', { name: 'Reset goblin art' }).click();
  await expect(ana.getByTestId('token').filter({ hasText: 'Goblin' })).toHaveAttribute('data-art', 'pack');
});

/** A free-form battle sheet: five sprites of different sizes scattered on a solid background, one holding a spear out. */
async function battleSheet(page: Page) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 60;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0f0';
    ctx.fillRect(0, 0, 120, 60);
    const body = (x: number, y: number, w: number, h: number) => {
      ctx.fillStyle = '#d33';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#fdd';
      ctx.fillRect(x + 2, y + 2, w - 4, 6); // a face
    };
    body(4, 4, 12, 22);
    body(24, 6, 14, 20);
    body(48, 2, 12, 24);
    body(80, 4, 12, 22);
    ctx.fillStyle = '#aaa';
    ctx.fillRect(66, 12, 13, 2); // a spear, held out to the left of the fourth
    body(10, 32, 16, 24);
    return canvas.toDataURL('image/png');
  });
  return { name: 'battle-sheet.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64') };
}

test('the DM picks frames from a free-form sheet in a pop-up window, by box or by click', async ({ browser }) => {
  const { dm, ana } = await table(browser);
  await dm.getByRole('tab', { name: 'Encounter' }).click();
  const encounter = dm.getByRole('tabpanel', { name: 'Encounter' });
  await encounter.getByLabel('Add').selectOption({ label: 'Goblin' });
  await encounter.getByRole('button', { name: 'Place on map' }).click();
  const box = (await dm.getByTestId('world-canvas').boundingBox())!;
  await dm.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(ana.getByTestId('token').filter({ hasText: 'Goblin' })).toHaveAttribute('data-art', 'pack');

  await dm.getByRole('tab', { name: 'Art' }).click();
  await dm.getByRole('tab', { name: 'Characters' }).click();
  const art = dm.getByRole('tabpanel', { name: 'Characters' });
  await art.getByLabel('Character').selectOption({ label: 'Goblin (every goblin)' });
  await art.getByLabel('Pick frames from any sheet').setInputFiles(await battleSheet(dm));
  // A window pops up, asking for the idle frames first.
  const picker = dm.getByRole('dialog', { name: 'Pick frames' });
  await expect(picker).toContainText('Drag a box around the idle frames');
  // Found on the solid background; the spear belongs to its sprite.
  await expect(picker).toContainText('5 sprites found');
  await expect(picker.getByRole('button', { name: /^Sprite \d+$/ })).toHaveCount(5);
  const frames = picker.getByRole('button', { name: /^Remove frame/ });

  // Clicking adds one frame at a time.
  await picker.getByRole('button', { name: 'Sprite 1' }).click();
  await expect(frames).toHaveCount(1);

  // Next, walk: a box dragged around sprites 2 to 4 adds them, left to right.
  await picker.getByRole('button', { name: 'Next: walk' }).click();
  await expect(picker).toContainText('Drag a box around the walk frames');
  await expect(frames).toHaveCount(0);
  const second = (await picker.getByRole('button', { name: 'Sprite 2' }).boundingBox())!;
  const fourth = (await picker.getByRole('button', { name: 'Sprite 4' }).boundingBox())!;
  await dm.mouse.move(second.x - 4, Math.min(second.y, fourth.y) - 4);
  await dm.mouse.down();
  await dm.mouse.move(fourth.x + fourth.width + 4, Math.max(second.y + second.height, fourth.y + fourth.height) + 4, { steps: 8 });
  await dm.mouse.up();
  await expect(frames).toHaveCount(3);
  await expect(frames.nth(0)).toHaveText(/#2/);
  await expect(frames.nth(1)).toHaveText(/#3/);
  await expect(frames.nth(2)).toHaveText(/#4/);
  await picker.getByRole('button', { name: 'Remove frame 2' }).click();
  await expect(frames).toHaveCount(2);
  await expect(picker).toContainText('animations: idle, walk');
  await expect(picker.getByRole('img', { name: /preview/i })).toBeVisible();
  await expect(picker.getByRole('img', { name: 'Round token' })).toBeVisible();

  await picker.getByRole('button', { name: 'Use for Goblin' }).click();
  await expect(picker).toHaveCount(0);
  await expect(ana.getByTestId('token').filter({ hasText: 'Goblin' })).toHaveAttribute('data-art', 'custom');
});
