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

test('the DM picks a world look, and every player sees the world in it', async ({ browser }) => {
  const { dm, ana } = await table(browser);
  await expect(ana.getByTestId('world-canvas')).toHaveAttribute('data-look', 'placeholder');
  await dm.getByRole('tab', { name: 'Art' }).click();
  await dm.getByRole('tab', { name: 'World look' }).click();
  const looks = dm.getByRole('radiogroup', { name: 'World look' });
  await expect(looks.getByRole('radio', { name: 'Classic' })).toHaveAttribute('aria-checked', 'true');
  await looks.getByRole('radio', { name: 'Winter' }).click();
  await expect(looks.getByRole('radio', { name: 'Winter' })).toHaveAttribute('aria-checked', 'true');
  for (const page of [dm, ana]) await expect(page.getByTestId('world-canvas')).toHaveAttribute('data-look', 'winter');
  await looks.getByRole('radio', { name: 'Classic' }).click();
  await expect(ana.getByTestId('world-canvas')).toHaveAttribute('data-look', 'placeholder');
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

  // It can be edited in the frame picker: its frames are found on the sheet, by view.
  await art.getByRole('button', { name: 'Edit goblin art' }).click();
  const picker = dm.getByRole('dialog', { name: 'Pick frames' });
  await expect(picker.getByRole('button', { name: /^Remove frame/ })).toHaveCount(2);
  await expect(picker.getByRole('combobox', { name: /^View/ })).toContainText('front view (facing you) (2)');
  await expect(picker.getByRole('combobox', { name: /^View/ })).toContainText('back view (2)');
  await picker.getByRole('button', { name: 'Cancel' }).click();
  await expect(picker).toHaveCount(0);

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

  // A front view of idle: its own frames, counted under the view.
  await picker.getByRole('combobox', { name: /^Animation/ }).selectOption('idle');
  await picker.getByRole('combobox', { name: /^View/ }).selectOption('front');
  await expect(picker).toContainText('Drag a box around the idle frames (front view (facing you))');
  await expect(frames).toHaveCount(0);
  await picker.getByRole('button', { name: 'Sprite 5' }).click();
  await expect(picker.getByRole('combobox', { name: /^View/ })).toContainText('front view (facing you) (1)');

  // Idle plays slower.
  await picker.getByLabel('idle speed (frames a second)').fill('4');

  // The token: any sprite, framed by dragging and zooming.
  await picker.getByRole('button', { name: 'Choose token frame' }).click();
  await expect(picker).toContainText('Click the sprite to use for the token');
  await picker.getByRole('button', { name: 'Sprite 3' }).click();
  await expect(picker).toContainText('Drag a box around');
  await expect(frames).toHaveCount(1); // the token pick didn't add a frame
  const token = picker.getByRole('img', { name: 'Round token' });
  const framing = () => token.evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
  const before = await framing();
  const spot = (await token.boundingBox())!;
  await dm.mouse.move(spot.x + 64, spot.y + 64);
  await dm.mouse.down();
  await dm.mouse.move(spot.x + 30, spot.y + 90, { steps: 5 });
  await dm.mouse.up();
  await expect.poll(framing).not.toBe(before);
  const moved = await framing();
  await picker.getByLabel('Token zoom').fill('200');
  await expect.poll(framing).not.toBe(moved);

  await picker.getByRole('button', { name: 'Use for Goblin' }).click();
  await expect(picker).toHaveCount(0);
  await expect(ana.getByTestId('token').filter({ hasText: 'Goblin' })).toHaveAttribute('data-art', 'custom');

  // Editing opens it as it was left: frames, views, and speeds; a victory frame is added.
  await art.getByRole('button', { name: 'Edit goblin art' }).click();
  await expect(picker).toContainText('5 sprites found');
  await expect(frames).toHaveCount(1);
  await expect(picker.getByRole('combobox', { name: /^View/ })).toContainText('front view (facing you) (1)');
  await expect(picker.getByLabel('idle speed (frames a second)')).toHaveValue('4');
  await picker.getByRole('combobox', { name: /^Animation/ }).selectOption('walk');
  await expect(frames).toHaveCount(2);
  await expect(frames.nth(1)).toHaveText(/#4/);
  await picker.getByRole('combobox', { name: /^Animation/ }).selectOption('victory');
  await picker.getByRole('button', { name: 'Sprite 5' }).click();
  await expect(picker).toContainText('animations: idle, walk, victory');
  await picker.getByRole('button', { name: 'Use for Goblin' }).click();
  await expect(picker).toHaveCount(0);
  await art.getByRole('button', { name: 'Edit goblin art' }).click();
  await picker.getByRole('combobox', { name: /^Animation/ }).selectOption('victory');
  await expect(frames).toHaveCount(1);
});

/** A picture, like a drawing or a photo cut-out: a figure on a plain white background. */
async function drawing(page: Page, color: string) {
  const dataUrl = await page.evaluate((fill) => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 200;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 120, 200);
    ctx.fillStyle = fill;
    ctx.fillRect(30, 60, 60, 120); // body
    ctx.fillStyle = '#f2c9a0';
    ctx.beginPath();
    ctx.arc(60, 40, 24, 0, Math.PI * 2); // head
    ctx.fill();
    ctx.fillStyle = '#333';
    ctx.fillRect(34, 180, 18, 16); // legs
    ctx.fillRect(68, 180, 18, 16);
    return canvas.toDataURL('image/png');
  }, color);
  return { name: 'hero.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64') };
}

test('the DM makes a character from one picture: pixel art, a back view, and a token', async ({ browser }) => {
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
  await art.getByLabel('Make from one picture').setInputFiles(await drawing(dm, '#3a6ad0'));

  const maker = dm.getByRole('dialog', { name: 'Make a character' });
  const front = maker.getByRole('img', { name: 'Pixel art, front' });
  await expect(front).toBeVisible();
  // 48 pixels tall by default; outlined, so 2 more.
  await expect(front).toHaveAttribute('height', '50');
  // The white background is gone: the corner is clear.
  const corner = () => front.evaluate((canvas) => (canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data[3]);
  expect(await corner()).toBe(0);
  await maker.getByLabel(/^Height/).fill('32');
  await expect(front).toHaveAttribute('height', '34');
  await maker.getByLabel('Outline').uncheck();
  await expect(front).toHaveAttribute('height', '32');

  await maker.getByLabel('Back view picture').setInputFiles(await drawing(dm, '#2a4a90'));
  await expect(maker.getByRole('img', { name: 'Pixel art, back' })).toBeVisible();
  await maker.getByRole('combobox', { name: /^Facing/ }).selectOption('up');
  await expect(maker.getByRole('img', { name: 'Preview of the idle animation facing up' })).toBeVisible();
  await expect(maker.getByRole('img', { name: 'Round token' })).toBeVisible();

  await maker.getByRole('button', { name: 'Use for Goblin' }).click();
  await expect(maker).toHaveCount(0);
  await expect(ana.getByTestId('token').filter({ hasText: 'Goblin' })).toHaveAttribute('data-art', 'custom');
  // Like any character, it can be edited in the frame picker.
  await art.getByRole('button', { name: 'Edit goblin art' }).click();
  await expect(dm.getByRole('dialog', { name: 'Pick frames' }).getByRole('button', { name: /^Remove frame/ })).toHaveCount(2);
});

/** The colour of one pixel of a frame in the pixel editor (x, y in frame pixels). */
async function paintedPixel(canvas: import('@playwright/test').Locator, x: number, y: number, frameSize: number) {
  return canvas.evaluate(
    (element, [px, py, size]) => {
      const c = element as HTMLCanvasElement;
      const zoom = c.width / size!;
      return [...c.getContext('2d')!.getImageData(Math.floor((px! + 0.5) * zoom), Math.floor((py! + 0.5) * zoom), 1, 1).data];
    },
    [x, y, frameSize],
  );
}

test('the DM touches up a character in the pixel editor: one frame or every frame, with undo', async ({ browser }) => {
  const { dm } = await table(browser);
  await dm.getByRole('tab', { name: 'Art' }).click();
  await dm.getByRole('tab', { name: 'Characters' }).click();
  const art = dm.getByRole('tabpanel', { name: 'Characters' });
  await art.getByLabel('Character').selectOption({ label: 'Goblin (every goblin)' });
  await art.getByLabel('Import sprite sheet').setInputFiles(await spriteSheet(dm));
  await art.getByRole('group', { name: 'New sprite sheet' }).getByRole('button', { name: 'Use for Goblin' }).click();

  await art.getByRole('button', { name: 'Paint goblin art' }).click();
  const editor = dm.getByRole('dialog', { name: 'Paint' });
  // Idle and walk: 8 frames each (4 directions x 2).
  await expect(editor.getByRole('group', { name: 'Frames' }).getByRole('button')).toHaveCount(16);
  const canvas = editor.getByRole('img', { name: 'idle 1, down, to paint' });
  expect(await paintedPixel(canvas, 16, 20, 32)).toEqual([221, 51, 51, 255]); // the red body

  // A green dot in every frame.
  await editor.getByLabel('Colour', { exact: true }).fill('#00ff00');
  await editor.getByLabel('Paint on').selectOption('all');
  const spot = (await canvas.boundingBox())!;
  await dm.mouse.click(spot.x + (16.5 / 32) * spot.width, spot.y + (20.5 / 32) * spot.height);
  expect(await paintedPixel(canvas, 16, 20, 32)).toEqual([0, 255, 0, 255]);
  await editor.getByRole('button', { name: 'walk 1, down' }).click();
  const walk = editor.getByRole('img', { name: 'walk 1, down, to paint' });
  expect(await paintedPixel(walk, 16, 20, 32)).toEqual([0, 255, 0, 255]);

  // Undo and redo.
  await editor.getByRole('button', { name: 'Undo' }).click();
  expect(await paintedPixel(walk, 16, 20, 32)).toEqual([51, 102, 204, 255]); // blue again
  await editor.getByRole('button', { name: 'Redo' }).click();
  expect(await paintedPixel(walk, 16, 20, 32)).toEqual([0, 255, 0, 255]);

  // Replace colour, in this animation only: walk's blue turns green, idle's red stays.
  await editor.getByRole('button', { name: 'Replace colour' }).click();
  await editor.getByLabel('Paint on').selectOption('animation');
  await dm.mouse.click(spot.x + (10.5 / 32) * spot.width, spot.y + (25.5 / 32) * spot.height);
  expect(await paintedPixel(walk, 10, 25, 32)).toEqual([0, 255, 0, 255]);
  await editor.getByRole('button', { name: 'idle 1, down' }).click();
  expect(await paintedPixel(canvas, 10, 25, 32)).toEqual([221, 51, 51, 255]);

  // Saved, it stays painted.
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toHaveCount(0);
  await art.getByRole('button', { name: 'Paint goblin art' }).click();
  expect(await paintedPixel(editor.getByRole('img', { name: 'idle 1, down, to paint' }), 16, 20, 32)).toEqual([0, 255, 0, 255]);
});

/** One frame image: a figure leaning by `lean` pixels. */
async function frameFile(page: Page, lean: number, name: string) {
  const dataUrl = await page.evaluate((x) => {
    const canvas = document.createElement('canvas');
    canvas.width = 20;
    canvas.height = 30;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#c33';
    ctx.fillRect(6 + x, 2, 8, 26);
    return canvas.toDataURL('image/png');
  }, lean);
  return { name, mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64') };
}

test('the DM imports separate frame images, laid out in name order for the frame picker', async ({ browser }) => {
  const { dm } = await table(browser);
  await dm.getByRole('tab', { name: 'Art' }).click();
  await dm.getByRole('tab', { name: 'Characters' }).click();
  const art = dm.getByRole('tabpanel', { name: 'Characters' });
  await art.getByLabel('Character').selectOption({ label: 'Goblin (every goblin)' });
  await art
    .getByLabel('Pick frames from any sheet')
    .setInputFiles([await frameFile(dm, 2, 'walk_10.png'), await frameFile(dm, 0, 'walk_2.png'), await frameFile(dm, -2, 'walk_1.png')]);
  const picker = dm.getByRole('dialog', { name: 'Pick frames' });
  await expect(picker).toContainText('3 sprites found');
  // In name order (walk_1, walk_2, walk_10): leaning left, upright, leaning right.
  const boxes = await Promise.all([1, 2, 3].map((n) => picker.getByRole('button', { name: `Sprite ${n}` }).boundingBox()));
  expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
  expect(boxes[1]!.x).toBeLessThan(boxes[2]!.x);
  await picker.getByRole('button', { name: 'Sprite 1' }).click();
  await picker.getByRole('button', { name: 'Use for Goblin' }).click();
  await expect(art.getByRole('button', { name: 'Edit goblin art' })).toBeVisible();
});
