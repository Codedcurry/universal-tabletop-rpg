import { type Browser, type BrowserContext, type Page, expect, test } from '@playwright/test';

// The DM's page: tools grouped in tabs (Encounter, Map, Session) that can be
// hidden, and the encounter controls: place, rename, edit, move, and remove
// creatures, before or during a fight.

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
  const ana = await open(browser);
  await ana.goto(link);
  await ana.getByLabel('Your name').fill('Ana');
  await ana.getByRole('button', { name: 'Join' }).click();
  await expect(ana.getByTestId('status')).toHaveText(/connected/i);
  // A small map, from the Map tab.
  await dm.getByRole('tab', { name: 'Map' }).click();
  await dm.getByRole('button', { name: 'New map' }).click();
  const dialog = dm.getByRole('group', { name: 'New map' });
  await dialog.getByLabel('Width').fill('7');
  await dialog.getByLabel('Height').fill('5');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(ana.getByTestId('map-summary')).toContainText('35 tiles');
  return { dm, ana };
}

const tools = (page: Page) => page.getByRole('complementary', { name: 'DM tools' });
const encounter = (page: Page) => page.getByRole('tabpanel', { name: 'Encounter' });
const token = (page: Page, name: string) => page.getByTestId('token').filter({ hasText: name });

/** Clicks a free map tile some way across the view (fraction of the canvas width). */
async function clickMapAt(page: Page, fx: number, fy = 0.55) {
  const box = (await page.getByTestId('world-canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

/** Finds and clicks a map tile that no creature stands on, by scanning the view. */
async function clickFreeTile(page: Page) {
  const occupied = new Set(await page.getByTestId('token').evaluateAll((tags) => tags.map((t) => (t as HTMLElement).dataset.cell)));
  const box = (await page.getByTestId('world-canvas').boundingBox())!;
  for (let row = 3; row < 9; row++) {
    for (let col = 2; col < 12; col++) {
      const x = box.x + (box.width * col) / 14;
      const y = box.y + (box.height * row) / 10;
      await page.mouse.move(x, y);
      const match = ((await page.getByTestId('tile-info').textContent()) ?? '').match(/^Tile \((-?\d+), (-?\d+)\)/);
      if (match && !occupied.has(`${match[1]},${match[2]}`)) {
        await page.mouse.click(x, y);
        return;
      }
    }
  }
  throw new Error('no free tile found');
}

/** Adds a creature from the Encounter tab and places it with a click on the map. */
async function addAndPlace(page: Page, kind: string, fx: number) {
  const panel = encounter(page);
  await panel.getByLabel('Add').selectOption({ label: kind });
  await panel.getByRole('button', { name: 'Place on map' }).click();
  await expect(page.getByText(/^Click a tile to place/)).toBeVisible();
  await clickMapAt(page, fx);
}

test('the DM tools are grouped in tabs, and can be hidden', async ({ browser }) => {
  const { dm } = await table(browser);
  await expect(tools(dm).getByRole('tab')).toHaveText(['Encounter', 'Map', 'Session']);

  // Map-making controls live only on the Map tab.
  await dm.getByRole('tab', { name: 'Map' }).click();
  await expect(dm.getByRole('button', { name: 'Raise' })).toBeVisible();
  await dm.getByRole('tab', { name: 'Session' }).click();
  await expect(dm.getByRole('button', { name: 'Raise' })).toBeHidden();
  await expect(dm.getByLabel('Your title')).toBeVisible();

  await dm.getByRole('button', { name: 'Hide DM tools' }).click();
  await expect(tools(dm).getByRole('tablist')).toBeHidden();
  await expect(dm.getByTestId('world-canvas')).toBeVisible();
  await dm.getByRole('button', { name: 'Show DM tools' }).click();
  await expect(tools(dm).getByRole('tablist')).toBeVisible();
});

test('the DM places monsters and players before the fight, and players see them', async ({ browser }) => {
  const { dm, ana } = await table(browser);
  await dm.getByRole('tab', { name: 'Encounter' }).click();
  await addAndPlace(dm, 'Ana (player)', 0.25);
  await addAndPlace(dm, 'Goblin', 0.7);
  await expect(token(ana, 'Ana')).toBeVisible();
  await expect(token(ana, 'Goblin')).toBeVisible();
  // No fight yet: nobody gets a turn.
  await expect(ana.getByRole('region', { name: 'Your turn' })).toHaveCount(0);

  await encounter(dm).getByRole('button', { name: 'Start fight' }).click();
  await expect(ana.getByTestId('turn-banner')).toContainText('Round 1');
});

test('the DM renames, edits, moves, and removes creatures, before or during a fight', async ({ browser }) => {
  const { dm, ana } = await table(browser);
  await dm.getByRole('tab', { name: 'Encounter' }).click();
  await addAndPlace(dm, 'Ana (player)', 0.25);
  await addAndPlace(dm, 'Goblin', 0.7);

  // Clicking a creature on the map selects it for editing.
  await clickMapAt(dm, 0.7);
  const editor = encounter(dm).getByRole('group', { name: /^Edit / });
  await expect(editor).toHaveAccessibleName('Edit Goblin');
  await editor.getByLabel('Name').fill('Grizzle');
  await editor.getByLabel('HP').fill('3');
  await editor.getByLabel('Strength').fill('12');
  await editor.getByRole('button', { name: 'Save changes' }).click();
  await expect(token(ana, 'Grizzle').getByRole('meter')).toHaveAccessibleName('Grizzle: 3 of 8 HP');
  await expect(ana.getByTestId('log')).toContainText('DM renames Goblin to Grizzle');

  // During the fight too.
  await encounter(dm).getByRole('button', { name: 'Start fight' }).click();
  await expect(ana.getByTestId('turn-banner')).toContainText('Round 1');
  const before = await token(ana, 'Grizzle').getAttribute('data-cell');
  await encounter(dm).getByRole('group', { name: 'Edit Grizzle' }).getByRole('button', { name: 'Move on map' }).click();
  await clickFreeTile(dm);
  await expect(token(ana, 'Grizzle')).not.toHaveAttribute('data-cell', before ?? '');

  await encounter(dm).getByRole('group', { name: 'Edit Grizzle' }).getByRole('button', { name: 'Remove' }).click();
  await expect(token(ana, 'Grizzle')).toHaveCount(0);
  await expect(ana.getByTestId('turn-banner')).toContainText('Fight over');
});

test('the DM adds a creature in the middle of a fight', async ({ browser }) => {
  const { dm, ana } = await table(browser);
  await dm.getByRole('tab', { name: 'Encounter' }).click();
  await addAndPlace(dm, 'Ana (player)', 0.25);
  await addAndPlace(dm, 'Goblin', 0.7);
  await encounter(dm).getByRole('button', { name: 'Start fight' }).click();
  await expect(ana.getByTestId('turn-order').getByRole('listitem')).toHaveCount(2);
  await addAndPlace(dm, 'Ogre', 0.55);
  await expect(ana.getByTestId('turn-order').getByRole('listitem')).toHaveCount(3);
  await expect(token(ana, 'Ogre')).toBeVisible();
});

/** Drags a roster row by its handle onto another row (upper half: before it). */
async function dragRow(page: Page, name: string, onto: string) {
  const roster = encounter(page).getByRole('list', { name: 'Turn order' });
  const handle = (await roster.getByRole('button', { name: `Reorder ${name}` }).boundingBox())!;
  const target = (await roster.getByRole('listitem').filter({ hasText: onto }).boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, target.y + 4, { steps: 8 });
  await page.mouse.up();
}

test('the DM drags creatures in the list to change the turn order, before and during a fight', async ({ browser }) => {
  const { dm, ana } = await table(browser);
  await dm.getByRole('tab', { name: 'Encounter' }).click();
  await addAndPlace(dm, 'Ana (player)', 0.25);
  await addAndPlace(dm, 'Goblin', 0.7);
  await addAndPlace(dm, 'Ogre', 0.55);
  const roster = encounter(dm).getByRole('list', { name: 'Turn order' }).getByRole('listitem');
  await expect(roster).toHaveText([/^⠿1Ana/, /^⠿2Goblin/, /^⠿3Ogre/]);
  // The list says plainly that it is the turn order, and how it gets decided.
  const note = encounter(dm).getByTestId('turn-order-note');
  await expect(note).toContainText('rolled when the fight starts');

  await dragRow(dm, 'Ogre', 'Ana');
  await expect(roster).toHaveText([/Ogre/, /Ana/, /Goblin/]);
  await expect(ana.getByTestId('turn-order').getByRole('listitem')).toHaveText([/Ogre/, /Ana/, /Goblin/]);
  // Arranging the list by hand means the fight should run in that order.
  await expect(encounter(dm).getByLabel('Roll initiative')).not.toBeChecked();
  await expect(note).toContainText('in this order, top first');

  // The keyboard works too.
  const goblinHandle = encounter(dm).getByRole('button', { name: 'Reorder Goblin' });
  await goblinHandle.focus();
  await goblinHandle.press('ArrowUp');
  await expect(roster).toHaveText([/Ogre/, /Goblin/, /Ana/]);
  await expect(goblinHandle).toBeFocused();

  await encounter(dm).getByRole('button', { name: 'Start fight' }).click();
  await expect(ana.getByTestId('turn-banner')).toContainText("Ogre's turn");
  await expect(note).toContainText('keeps their turn');

  // Mid-fight: whoever is acting keeps their turn.
  await dragRow(dm, 'Ana', 'Ogre');
  await expect(ana.getByTestId('turn-order').getByRole('listitem')).toHaveText([/Ana/, /Ogre/, /Goblin/]);
  await expect(ana.getByTestId('turn-banner')).toContainText("Ogre's turn");
  await expect(ana.getByTestId('log')).toContainText('DM changes the turn order: Ana, Ogre, Goblin');
});

test('the DM decides who controls which creature, and can play the players\' characters', async ({ browser }) => {
  const { dm, ana } = await table(browser);
  await dm.getByRole('tab', { name: 'Encounter' }).click();
  await addAndPlace(dm, 'Ana (player)', 0.25);
  await addAndPlace(dm, 'Goblin', 0.7);

  // Hand the goblin to Ana.
  await clickMapAt(dm, 0.7);
  const editor = encounter(dm).getByRole('group', { name: 'Edit Goblin' });
  await expect(editor.getByLabel('Controlled by')).toHaveValue('');
  await editor.getByLabel('Controlled by').selectOption({ label: 'Ana' });
  await editor.getByRole('button', { name: 'Save changes' }).click();

  // In the listed order: Ana first, then the goblin.
  await encounter(dm).getByLabel('Roll initiative').uncheck();
  await encounter(dm).getByRole('button', { name: 'Start fight' }).click();
  const anaBar = ana.getByRole('region', { name: 'Your turn' });
  await expect(anaBar).toContainText('Ana');

  // The DM takes over the players' characters.
  await dm.getByRole('tab', { name: 'Session' }).click();
  const own = dm.getByLabel('Players control their own characters');
  await expect(own).toBeChecked();
  await own.uncheck();
  await expect(anaBar).toHaveCount(0);
  await expect(ana.getByTestId('control-note')).toContainText('DM is playing your character');
  await expect(dm.getByRole('region', { name: 'Your turn' })).toContainText('Ana');
  await own.check();
  await expect(anaBar).toContainText('Ana');
  await expect(ana.getByTestId('control-note')).toHaveCount(0);

  // Ana's turn ends; the goblin is hers to play too.
  await anaBar.getByRole('button', { name: 'End turn' }).click();
  await expect(anaBar).toContainText('Goblin');
});
