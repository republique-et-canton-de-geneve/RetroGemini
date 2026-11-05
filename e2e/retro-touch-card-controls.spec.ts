import { test, expect, devices, Page, Locator } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from './helpers/announcements';

/**
 * A card's edit, delete and comment controls on a screen with nothing to
 * hover. They wait for the pointer on a computer (`[@media(hover:hover)]:
 * opacity-0`), and a phone has no pointer: there they are always in view. On
 * both, the edit control, at the end of the first line, must not lie over the
 * text (a float under it ends the line before it — Session.tsx →
 * `ticket-edit-room`): on a computer it used to appear over the last words of
 * the line as soon as the pointer was on the card.
 *
 * jsdom applies no media query and measures every element at zero, so only a
 * browser can hold this; `sessionOpenBoard.test.tsx` pins the classes.
 */

const TEAM_NAME = `E2E-Touch-${Date.now()}`;
const TEAM_PASSWORD = 'touchcards123456';
// One unbroken token: `overflow-wrap` breaks it at the very edge of each line,
// so the first line always reaches the corner the edit control sits in.
const LONG_CARD = 'https://ci.example.com/pipelines/deploy-friday-failures-again-and-again-and-again';

const columns = (page: Page) => page.locator('[data-group-columns-scroller] > [data-column-id]');
const card = (page: Page, text: string) => page.locator('div.group', { hasText: text });

const rectsOverlap = (a: DOMRect | { left: number; right: number; top: number; bottom: number }, b: typeof a) =>
  a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

/** Every line box of the card's text, and the box of its edit control. */
const measureCard = async (target: Locator) =>
  target.evaluate((cardEl) => {
    const text = cardEl.querySelector<HTMLElement>('.whitespace-pre-wrap');
    const edit = cardEl.querySelector<HTMLElement>('button[aria-label="Edit ticket"]');
    if (!text || !edit) return null;
    const node = [...text.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim());
    if (!node) return null;
    const range = document.createRange();
    range.selectNodeContents(node);
    const toBox = (r: DOMRect) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    return {
      lines: [...range.getClientRects()].map(toBox),
      edit: toBox(edit.getBoundingClientRect()),
      editOpacity: getComputedStyle(edit).opacity,
    };
  });

const opacityOf = (target: Locator) => target.evaluate((el) => getComputedStyle(el).opacity);

/** Sets the board's anonymity from its settings, and closes them. */
const setAnonymous = async (page: Page, anonymous: boolean) => {
  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Board settings' });
  const box = settings.getByRole('checkbox', { name: 'Anonymous' });
  // A click, not `uncheck()`: the box stays checked until the dialog that
  // asks first is answered.
  await box.click();
  if (!anonymous) await page.getByRole('button', { name: 'Show the authors' }).click();
  await expect(box).toBeChecked({ checked: anonymous });
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(settings).toBeHidden();
};

test('a card shows its controls on a phone, and its edit control lies over none of its text', async ({ browser }) => {
  const { defaultBrowserType: _ignored, ...phone } = devices['Pixel 7'];
  const phoneContext = await browser.newContext({ ...phone, locale: 'en-US' });
  const page = await phoneContext.newPage();
  try {
    // The emulated phone must really be a screen with nothing to hover, or
    // this test would measure the computer's layout and prove nothing.
    await page.goto('/');
    expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);

    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: '+ New Team' }).click();
    await page.getByPlaceholder('e.g. Design Team').fill(TEAM_NAME);
    await page.locator('input[type="password"]').fill(TEAM_PASSWORD);
    await page.getByLabel('Recovery Email').fill('facilitator@example.com');
    await page.getByRole('button', { name: 'Create & Join' }).click();
    await expect(page.getByText(`${TEAM_NAME} Dashboard`)).toBeVisible({ timeout: 15_000 });
    await dismissAnnouncementsIfPresent(page);

    await page.getByRole('button', { name: 'New Retrospective' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Open board', exact: true }).click();
    await dialog.getByTestId('retro-template-lean_coffee').click();
    await expect(page.getByRole('heading', { level: 2, name: 'Open board' })).toBeVisible({ timeout: 15_000 });
    // Named authors, so the avatar takes the corner beside the edit control.
    await setAnonymous(page, false);

    const field = columns(page).nth(0).getByPlaceholder('Add an idea...');
    await field.fill(LONG_CARD);
    await page.keyboard.press('Enter');
    const longCard = card(page, LONG_CARD);
    await expect(longCard).toBeVisible();

    const named = await measureCard(longCard);
    expect(named, 'the long card and its edit control').not.toBeNull();
    expect(named!.editOpacity).toBe('1');
    expect(named!.lines.length).toBeGreaterThan(1);
    expect(named!.lines.filter((line) => rectsOverlap(line, named!.edit))).toEqual([]);
    expect(await opacityOf(longCard.getByRole('button', { name: 'Delete ticket' }))).toBe('1');
    expect(await opacityOf(longCard.getByTestId('ticket-comment-btn').locator('..'))).toBe('1');

    // Anonymous again: no avatar, the edit control takes the corner.
    await setAnonymous(page, true);
    const anonymous = await measureCard(longCard);
    expect(anonymous).not.toBeNull();
    expect(anonymous!.lines.filter((line) => rectsOverlap(line, anonymous!.edit))).toEqual([]);
  } finally {
    await phoneContext.close();
  }
});

// Review finding (pass 4 of 42.1): a tap the board acts on lays the board out
// again under the finger, and the browser then sent the mouse events it
// emulates for a tap to whatever control came there: a grouping tap deleted a
// card with no confirmation, added a vote or opened an editor, and took the
// focus off the new group's title. A tap that is acted on sends no click.
test('a tap that groups two cards on a phone clicks nothing else, and leaves the new group to be named', async ({ browser }) => {
  const { defaultBrowserType: _ignored, ...phone } = devices['Pixel 7'];
  const phoneContext = await browser.newContext({ ...phone, locale: 'en-US' });
  const page = await phoneContext.newPage();
  // The session writes this page sends, counted where the test says.
  const sent: string[] = [];
  page.on('websocket', (socket) => socket.on('framesent', ({ payload }) => {
    const text = typeof payload === 'string' ? payload : payload.toString();
    if (text.includes('"update-session"')) sent.push(text);
  }));
  try {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: '+ New Team' }).click();
    await page.getByPlaceholder('e.g. Design Team').fill(`${TEAM_NAME}-tap`);
    await page.locator('input[type="password"]').fill(TEAM_PASSWORD);
    await page.getByLabel('Recovery Email').fill('facilitator@example.com');
    await page.getByRole('button', { name: 'Create & Join' }).click();
    await expect(page.getByText(`${TEAM_NAME}-tap Dashboard`)).toBeVisible({ timeout: 15_000 });
    await dismissAnnouncementsIfPresent(page);

    await page.getByRole('button', { name: 'New Retrospective' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Open board', exact: true }).click();
    await dialog.getByTestId('retro-template-lean_coffee').click();
    await expect(page.getByRole('heading', { level: 2, name: 'Open board' })).toBeVisible({ timeout: 15_000 });

    const texts = ['Flaky deploys', 'Slow rollbacks', 'Late release notes'];
    const field = columns(page).nth(0).getByPlaceholder('Add an idea...');
    for (const text of texts) {
      await field.fill(text);
      await page.keyboard.press('Enter');
      await expect(card(page, text)).toBeVisible();
    }

    await expect(field).toBeFocused();
    await card(page, 'Flaky deploys').tap();
    await expect(page.getByRole('button', { name: /Selected for grouping/ })).toBeVisible();
    // The tap takes the focus out of the field, as the mousedown it cancels
    // did: the phone's keyboard closes over the board (review finding, pass 5
    // of 42.1).
    await expect(field).not.toBeFocused();
    await page.evaluate(() => {
      const clicks: string[] = [];
      (window as unknown as { tapClicks: string[] }).tapClicks = clicks;
      document.addEventListener('click', (event) => {
        const target = event.target as HTMLElement;
        clicks.push(target.getAttribute('aria-label') ?? target.tagName);
      }, true);
    });

    await card(page, 'Slow rollbacks').tap();
    await expect(page.locator('.group-container')).toHaveCount(1);
    // Past the moment a browser sends the click it emulates for a tap.
    await page.waitForTimeout(500);

    expect(await page.evaluate(() => (window as unknown as { tapClicks: string[] }).tapClicks)).toEqual([]);
    await expect(page.locator('input[data-group-title-id]')).toBeFocused();
    for (const text of texts) await expect(card(page, text)).toHaveCount(1);

    // Review finding (pass 5 of 42.1): a card's editor left open through the
    // taps lost what was typed in it when one of them broke up its group.
    await card(page, 'Flaky deploys').getByRole('button', { name: 'Edit ticket' }).tap();
    const editor = card(page, 'Flaky deploys').locator('textarea');
    await expect(editor).toBeFocused();
    await editor.press('End');
    await page.keyboard.type(' in staging');
    // Holding its partner leaves the editor and writes what it held, alone
    // and at once: a hold writes nothing of its own, and held for a later
    // write the text rode one that could lose (review finding, pass 7 of 42.1).
    sent.length = 0;
    await card(page, 'Slow rollbacks').tap();
    await expect(page.locator('textarea:not([placeholder])')).toHaveCount(0);
    await expect(page.getByText('Flaky deploys in staging', { exact: true })).toBeVisible();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toContain('Flaky deploys in staging');
    // Past the server's answer: the drop below is a write of its own.
    await page.waitForTimeout(500);
    // Dropped on the loose card, the partner leaves the edited card alone.
    await card(page, 'Late release notes').tap();
    const group = page.locator('.group-container');
    await expect(group).toHaveCount(1);
    await expect(group.getByText('Late release notes', { exact: true })).toBeVisible();
    await expect(group.getByText('Slow rollbacks', { exact: true })).toBeVisible();
    await expect(group.getByText('Flaky deploys in staging', { exact: true })).toHaveCount(0);
    await expect.poll(() => sent.length).toBe(2);
    // Still there once the server has answered the drop: nothing was refused
    // and healed away.
    await page.waitForTimeout(500);
    await expect(page.getByText('Flaky deploys in staging', { exact: true })).toBeVisible();
    await expect(group).toHaveCount(1);
    expect(sent).toHaveLength(2);

    // A tap on a group's own blank area is claimed the same way (review
    // finding, pass 6 of 42.1): with a card held and another one's editor
    // typed in, it leaves the editor and drops the card, in one write.
    await card(page, 'Flaky deploys in staging').tap();
    await expect(page.getByRole('button', { name: /Selected for grouping/ })).toBeVisible();
    await card(page, 'Slow rollbacks').getByRole('button', { name: 'Edit ticket' }).tap();
    const inGroup = card(page, 'Slow rollbacks').locator('textarea');
    await expect(inGroup).toBeFocused();
    await inGroup.press('End');
    await page.keyboard.type(' again');
    sent.length = 0;
    const box = (await group.boundingBox())!;
    await group.tap({ position: { x: box.width - 6, y: box.height - 6 } });
    await expect(group.getByText('Flaky deploys in staging', { exact: true })).toBeVisible();
    await expect(page.getByText('Slow rollbacks again', { exact: true })).toBeVisible();
    await expect(page.locator('textarea:not([placeholder])')).toHaveCount(0);
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toContain('Slow rollbacks again');
    await page.waitForTimeout(500);
    await expect(page.getByText('Slow rollbacks again', { exact: true })).toBeVisible();
    await expect(group.getByText('Flaky deploys in staging', { exact: true })).toBeVisible();
  } finally {
    await phoneContext.close();
  }
});

// Review findings (pass 7 of 42.1): a card's editor closed at the press that
// left it, and the card grew back by the rows it hides while edited, pushing
// everything under it down. The release, and the click, landed beside the
// control pressed: its own vote, the next card's, the column's "Move selected
// card here". jsdom lays nothing out, so only a browser can hold this.
for (const device of ['computer', 'phone'] as const) {
  test(`a press that leaves a card's editor lands on the control pressed, on a ${device}`, async ({ browser }) => {
    const { defaultBrowserType: _ignored, ...phone } = devices['Pixel 7'];
    const context = await browser.newContext(device === 'phone' ? { ...phone, locale: 'en-US' } : { locale: 'en-US', viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const press = (target: Locator) => (device === 'phone' ? target.tap() : target.click());
    try {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: '+ New Team' }).click();
      await page.getByPlaceholder('e.g. Design Team').fill(`${TEAM_NAME}-press-${device}`);
      await page.locator('input[type="password"]').fill(TEAM_PASSWORD);
      await page.getByLabel('Recovery Email').fill('facilitator@example.com');
      await page.getByRole('button', { name: 'Create & Join' }).click();
      await expect(page.getByText(`${TEAM_NAME}-press-${device} Dashboard`)).toBeVisible({ timeout: 15_000 });
      await dismissAnnouncementsIfPresent(page);
      await page.getByRole('button', { name: 'New Retrospective' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Open board', exact: true }).click();
      await dialog.getByTestId('retro-template-lean_coffee').click();
      await expect(page.getByRole('heading', { level: 2, name: 'Open board' })).toBeVisible({ timeout: 15_000 });

      // Newest first: the card written last sits on top of its column.
      const field = columns(page).nth(0).getByPlaceholder('Add an idea...');
      for (const text of ['Late release notes', 'Too many meetings']) {
        await field.fill(text);
        await page.keyboard.press('Enter');
        await expect(card(page, text)).toBeVisible();
      }
      const voteOn = (text: string) => card(page, text).getByRole('button', { name: /add a vote to this ticket/ });
      const edit = async (text: string, typed: string) => {
        await press(card(page, text).getByRole('button', { name: 'Edit ticket' }));
        const editor = card(page, text).locator('textarea');
        await expect(editor).toBeFocused();
        await editor.press('End');
        await page.keyboard.type(typed);
      };

      // Its own vote.
      await edit('Too many meetings', ' on Mondays');
      await press(voteOn('Too many meetings'));
      await expect(card(page, 'Too many meetings on Mondays').getByRole('button', { name: /^1 vote/ })).toBeVisible();
      // The vote of the card under it.
      await edit('Too many meetings on Mondays', ' again');
      await press(voteOn('Late release notes'));
      await expect(card(page, 'Late release notes').getByRole('button', { name: /^1 vote/ })).toBeVisible();
      await expect(page.getByText('Too many meetings on Mondays again', { exact: true })).toBeVisible();

      // The column's "Move selected card here", under the edited card.
      await columns(page).nth(1).getByPlaceholder('Add an idea...').fill('Slow rollbacks');
      await page.keyboard.press('Enter');
      await expect(card(page, 'Slow rollbacks')).toBeVisible();
      // Held through its keyboard control, the same on both screens.
      await page.getByRole('button', { name: /Pick up the ticket Slow rollbacks/ }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('button', { name: /Selected for grouping/ })).toBeVisible();
      await edit('Late release notes', ' too');
      await press(columns(page).nth(0).getByRole('button', { name: /Move selected card here/ }));
      await expect(columns(page).nth(0).getByText('Slow rollbacks', { exact: true })).toBeVisible();
      await expect(page.getByText('Late release notes too', { exact: true })).toBeVisible();
      // And all of it after the server answered.
      await page.waitForTimeout(500);
      await expect(columns(page).nth(0).getByText('Slow rollbacks', { exact: true })).toBeVisible();
      await expect(card(page, 'Late release notes too').getByRole('button', { name: /^1 vote/ })).toBeVisible();
    } finally {
      await context.close();
    }
  });
}

// Review findings (pass 8 of 42.1): a drag ends with no release, at a
// dragend sent to the element dragged — which the drop removes when it moves
// its card, so the press never ended: for 10 s the editor stayed drawn, and a
// click into it closed it. And the card being edited could not be dragged by
// the press that took the focus out of its editor: it selected text instead.
test('a drag from a card\u2019s editor moves the card dragged in one write, and the card edited too', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const sent: string[] = [];
  page.on('websocket', (socket) => socket.on('framesent', ({ payload }) => {
    const text = typeof payload === 'string' ? payload : payload.toString();
    if (text.includes('"update-session"')) sent.push(text);
  }));
  try {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: '+ New Team' }).click();
    await page.getByPlaceholder('e.g. Design Team').fill(`${TEAM_NAME}-drag`);
    await page.locator('input[type="password"]').fill(TEAM_PASSWORD);
    await page.getByLabel('Recovery Email').fill('facilitator@example.com');
    await page.getByRole('button', { name: 'Create & Join' }).click();
    await expect(page.getByText(`${TEAM_NAME}-drag Dashboard`)).toBeVisible({ timeout: 15_000 });
    await dismissAnnouncementsIfPresent(page);
    await page.getByRole('button', { name: 'New Retrospective' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Open board', exact: true }).click();
    await dialog.getByTestId('retro-template-lean_coffee').click();
    await expect(page.getByRole('heading', { level: 2, name: 'Open board' })).toBeVisible({ timeout: 15_000 });
    // The facilitator's screen sends its state once, half a second after the
    // session opens: past that, every write counted is this test's own.
    await page.waitForTimeout(700);

    const field = columns(page).nth(0).getByPlaceholder('Add an idea...');
    for (const text of ['Late release notes', 'Too many meetings']) {
      await field.fill(text);
      await page.keyboard.press('Enter');
      await expect(card(page, text)).toBeVisible();
    }
    const editors = page.locator('[data-ticket-id] textarea');
    const edit = async (text: string, typed: string) => {
      await card(page, text).getByRole('button', { name: 'Edit ticket' }).click();
      await expect(editors).toBeFocused();
      await editors.press('End');
      await page.keyboard.type(typed);
    };
    // Dragged with the mouse, from a point of the element, to an empty part
    // of the other column.
    const dragToOtherColumn = async (from: { x: number; y: number }) => {
      const target = (await columns(page).nth(1).boundingBox())!;
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 20, from.y + 20, { steps: 4 });
      await page.mouse.move(target.x + target.width / 2, target.y + target.height - 40, { steps: 8 });
      await page.mouse.up();
    };

    // Another card, from an open editor: its move and the text in one write.
    await edit('Too many meetings', ' on Mondays');
    const before = sent.length;
    const other = (await card(page, 'Late release notes').boundingBox())!;
    await dragToOtherColumn({ x: other.x + other.width / 2, y: other.y + 12 });
    await expect(columns(page).nth(1).getByText('Late release notes', { exact: true })).toBeVisible();
    await expect(editors).toHaveCount(0, { timeout: 1_000 });
    await expect(page.getByText('Too many meetings on Mondays', { exact: true })).toBeVisible();
    await page.waitForTimeout(500);
    expect(sent.length - before).toBe(1);
    expect(sent.at(-1)).toContain('Too many meetings on Mondays');

    // The card edited, by its own edge, outside its field.
    await edit('Too many meetings on Mondays', ' again');
    const edited = (await card(page, 'Too many meetings on Mondays').boundingBox())!;
    await dragToOtherColumn({ x: edited.x + edited.width - 4, y: edited.y + edited.height - 4 });
    await expect(columns(page).nth(1).getByText('Too many meetings on Mondays again', { exact: true })).toBeVisible();
    await expect(editors).toHaveCount(0, { timeout: 1_000 });
  } finally {
    await context.close();
  }
});

test('on a computer the same controls wait for the pointer', async ({ page }) => {
  expect(await page.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(true);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '+ New Team' }).click();
  await page.getByPlaceholder('e.g. Design Team').fill(`${TEAM_NAME}-desk`);
  await page.locator('input[type="password"]').fill(TEAM_PASSWORD);
  await page.getByLabel('Recovery Email').fill('facilitator@example.com');
  await page.getByRole('button', { name: 'Create & Join' }).click();
  await expect(page.getByText(`${TEAM_NAME}-desk Dashboard`)).toBeVisible({ timeout: 15_000 });
  await dismissAnnouncementsIfPresent(page);

  await page.getByRole('button', { name: 'New Retrospective' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Open board', exact: true }).click();
  await dialog.getByTestId('retro-template-lean_coffee').click();
  await expect(page.getByRole('heading', { level: 2, name: 'Open board' })).toBeVisible({ timeout: 15_000 });

  const field = columns(page).nth(0).getByPlaceholder('Add an idea...');
  await field.fill('Flaky deploys');
  await page.keyboard.press('Enter');
  const shortCard = card(page, 'Flaky deploys');
  await expect(shortCard).toBeVisible();
  // Away from the card, so nothing hovers it.
  await page.mouse.move(0, 0);

  const edit = shortCard.getByRole('button', { name: 'Edit ticket' });
  const remove = shortCard.getByRole('button', { name: 'Delete ticket' });
  const comment = shortCard.getByTestId('ticket-comment-btn').locator('..');
  expect(await opacityOf(edit)).toBe('0');
  expect(await opacityOf(remove)).toBe('0');
  expect(await opacityOf(comment)).toBe('0');

  await shortCard.hover();
  await expect.poll(() => opacityOf(edit)).toBe('1');
  await expect.poll(() => opacityOf(remove)).toBe('1');

  // Under the pointer, the edit control covers none of the text: it used to
  // appear over the last words of the first line. Anonymous (a board's
  // default), then with the author's avatar beside it.
  await field.fill(LONG_CARD);
  await page.keyboard.press('Enter');
  const longCard = card(page, LONG_CARD);
  await expect(longCard).toBeVisible();
  for (const anonymous of [true, false]) {
    if (!anonymous) await setAnonymous(page, false);
    await longCard.hover();
    await expect.poll(() => opacityOf(longCard.getByRole('button', { name: 'Edit ticket' }))).toBe('1');
    const hovered = await measureCard(longCard);
    expect(hovered, 'the long card and its edit control').not.toBeNull();
    expect(hovered!.lines.length).toBeGreaterThan(1);
    expect(hovered!.lines.filter((line) => rectsOverlap(line, hovered!.edit)), `anonymous: ${anonymous}`).toEqual([]);
  }
});
