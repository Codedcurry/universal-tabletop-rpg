import { readFile } from 'node:fs/promises';
import { type Browser, type BrowserContext, expect, test } from '@playwright/test';

// The DM's rules editor: the game system as forms, checked as it's typed,
// applied to the game (creatures in play are fitted to it), and saved to a
// file and loaded back.

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

test('the DM edits the rules: a new ability for goblins, a mistake caught, and a goblin in play fitted to the change', async ({ browser }) => {
  const { dm, ana } = await table(browser);
  // A goblin on the map first.
  await dm.getByRole('tab', { name: 'Encounter' }).click();
  const encounter = dm.getByRole('tabpanel', { name: 'Encounter' });
  await encounter.getByLabel('Add').selectOption({ label: 'Goblin' });
  await encounter.getByRole('button', { name: 'Place on map' }).click();
  const box = (await dm.getByTestId('world-canvas').boundingBox())!;
  await dm.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await dm.getByRole('tab', { name: 'Rules' }).click();
  const rules = dm.getByRole('tabpanel', { name: 'Rules' });
  await expect(rules.getByTestId('rules-summary')).toContainText('3 stats · 5 abilities');
  await rules.getByRole('button', { name: 'Edit rules' }).click();
  const editor = dm.getByRole('dialog', { name: 'Rules editor' });
  await expect(editor).toContainText('Creatures already on the map keep only');

  // A new ability: its card opens, named as it's typed.
  await editor.getByRole('tab', { name: 'Abilities' }).click();
  const abilities = editor.getByRole('tabpanel', { name: 'Abilities' });
  await abilities.getByRole('button', { name: 'Add an ability' }).click();
  const bolt = abilities.getByRole('group', { name: 'Ability New ability' });
  await bolt.getByLabel(/^Name/).fill('Fire Bolt');
  const fireBolt = abilities.getByRole('group', { name: 'Ability Fire Bolt' });
  await fireBolt.getByLabel(/^Range/).fill('5');
  await fireBolt.getByLabel(/^Animation/).selectOption('spell');

  // A broken formula: shown by the field and in the list, and Apply waits.
  await fireBolt.getByLabel(/^Amount/).fill('2d6 +');
  await expect(editor.getByRole('alert')).toContainText('1 problem to fix');
  await expect(editor.getByRole('alert')).toContainText('Abilities › Fire Bolt › effect 1 › amount');
  await expect(editor.getByRole('tab', { name: /Abilities \(1 to fix\)/ })).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Apply to game' })).toBeDisabled();
  await fireBolt.getByLabel(/^Amount/).fill('2d6');
  await expect(editor.getByRole('alert')).toHaveCount(0);

  // Shoot goes; goblins get Fire Bolt.
  await abilities.getByRole('group', { name: 'Ability Shoot' }).locator('summary').click();
  await abilities.getByRole('button', { name: 'Remove ability Shoot' }).click();
  await editor.getByRole('tab', { name: 'Monsters' }).click();
  const goblin = editor.getByRole('group', { name: 'Monster Goblin' });
  await goblin.locator('summary').click();
  await goblin.getByLabel('Fire Bolt').check();

  // A stat's formula name changes, and formulas follow.
  await editor.getByRole('tab', { name: 'Stats' }).click();
  const strength = editor.getByRole('group', { name: 'Stat Strength' });
  await strength.getByLabel(/^Formula name/).fill('might');
  await strength.getByLabel(/^Formula name/).press('Enter');
  await expect(editor.getByRole('group', { name: 'Value Strength modifier' }).getByLabel(/^Formula$/)).toHaveValue('floor((@might - 10) / 2)');

  await editor.getByRole('button', { name: 'Apply to game' }).click();
  await expect(editor).toHaveCount(0);
  // The goblin loses Shoot, and keeps its strength under the new name.
  await expect(rules.getByRole('status')).toHaveText('Rules updated. Goblin loses ability shoot.');
  await expect(rules.getByTestId('rules-summary')).toContainText('3 stats · 5 abilities');
  await expect(ana.getByTestId('log').getByText('DM updates the rules (Skirmish): Goblin loses ability shoot')).toBeVisible();
});

test('the DM saves the rules to a file and loads a changed copy, looked over before use', async ({ browser }, testInfo) => {
  const { dm } = await table(browser);
  await dm.getByRole('tab', { name: 'Rules' }).click();
  const rules = dm.getByRole('tabpanel', { name: 'Rules' });

  const downloading = dm.waitForEvent('download');
  await rules.getByRole('button', { name: 'Save rules to a file' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('skirmish.system.json');
  const saved = JSON.parse(await readFile((await download.path())!, 'utf8')) as { name: string; monsters: { name: string }[] };
  expect(saved.monsters.map((monster) => monster.name)).toEqual(['Goblin', 'Ogre']);

  // A homebrew copy, loaded back: it opens in the editor first.
  saved.name = 'Homebrew Skirmish';
  await rules.getByLabel('Load rules from a file').setInputFiles({ name: 'homebrew.system.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
  const editor = dm.getByRole('dialog', { name: 'Rules editor' });
  await expect(editor).toContainText('Load Homebrew Skirmish');
  await editor.getByRole('button', { name: 'Apply to game' }).click();
  await expect(rules).toContainText('Homebrew Skirmish');

  // Not a rules file: a plain message.
  await rules.getByLabel('Load rules from a file').setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"hello": 1}') });
  await expect(rules.getByRole('alert')).toContainText("notes.json isn't a game system this tool can read");
  void testInfo;
});

test('the DM starts a new system from a blank one', async ({ browser }) => {
  const { dm } = await table(browser);
  await dm.getByRole('tab', { name: 'Rules' }).click();
  const rules = dm.getByRole('tabpanel', { name: 'Rules' });
  await rules.getByRole('button', { name: 'New system' }).click();
  const editor = dm.getByRole('dialog', { name: 'Rules editor' });
  await editor.getByLabel(/^System name/).fill('Moonfall');
  await editor.getByRole('button', { name: 'Apply to game' }).click();
  await expect(rules).toContainText('Moonfall');
  await expect(rules.getByTestId('rules-summary')).toContainText('1 stats · 1 abilities');
  // Its monster is there to add.
  await dm.getByRole('tab', { name: 'Encounter' }).click();
  await expect(dm.getByRole('tabpanel', { name: 'Encounter' }).getByLabel('Add')).toContainText('Monster');
});
