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
  const art = dm.getByRole('tabpanel', { name: 'Art' });

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
