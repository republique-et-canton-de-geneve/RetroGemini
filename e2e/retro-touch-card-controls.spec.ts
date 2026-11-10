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

/**
 * Opens the vote from the board's settings, and closes them: a board starts
 * with voting off and its counts hidden.
 */
const openTheVote = async (page: Page) => {
  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Board settings' });
  await settings.getByRole('checkbox', { name: 'Disable voting' }).uncheck();
  await settings.getByRole('checkbox', { name: 'Hide vote count' }).uncheck();
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(settings).toBeHidden();
};

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
    // Named authors, as a board starts, so the avatar takes the corner beside
    // the edit control.

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
      await openTheVote(page);

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

// Review finding (pass 10 of 42.1): a board's group is draggable, and its
// title field is inside it, so a press that selected the title's words started
// a drag of the group instead (Firefox, in addition, put no caret there).
test('a press in a group’s title selects its words, and drags no group', async ({ browser }) => {
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
    await page.getByPlaceholder('e.g. Design Team').fill(`${TEAM_NAME}-title`);
    await page.locator('input[type="password"]').fill(TEAM_PASSWORD);
    await page.getByLabel('Recovery Email').fill('facilitator@example.com');
    await page.getByRole('button', { name: 'Create & Join' }).click();
    await expect(page.getByText(`${TEAM_NAME}-title Dashboard`)).toBeVisible({ timeout: 15_000 });
    await dismissAnnouncementsIfPresent(page);
    await page.getByRole('button', { name: 'New Retrospective' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Open board', exact: true }).click();
    await dialog.getByTestId('retro-template-lean_coffee').click();
    await expect(page.getByRole('heading', { level: 2, name: 'Open board' })).toBeVisible({ timeout: 15_000 });
    // The facilitator's screen sends its state once, half a second after the
    // session opens: past that, every write counted is this test's own, and
    // none of the setup's loses its race to it.
    await page.waitForTimeout(700);

    const field = columns(page).nth(0).getByPlaceholder('Add an idea...');
    for (const text of ['Late release notes', 'Too many meetings']) {
      await field.fill(text);
      await page.keyboard.press('Enter');
      await expect(card(page, text)).toBeVisible();
    }
    // Grouped with the keyboard, then named.
    await page.getByRole('button', { name: /Pick up the ticket Late release notes/ }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: /group the selected ticket with Too many meetings/ }).focus();
    await page.keyboard.press('Enter');
    const title = page.locator('.group-container input[data-group-title-id]');
    await expect(title).toBeFocused({ timeout: 10_000 });
    await title.fill('Delivery problems');
    await title.press('Enter');
    await page.waitForTimeout(700);
    const before = sent.length;

    // Pressed near the start of the title, dragged along it, released.
    const box = (await title.boundingBox())!;
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 30, box.y + box.height / 2, { steps: 4 });
    await page.mouse.move(box.x + 70, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();

    await expect(title).toBeFocused();
    const selected = await title.evaluate((input: HTMLInputElement) => input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0));
    expect(selected.length).toBeGreaterThan(0);
    expect('Delivery problems'.startsWith(selected)).toBe(true);
    await expect(page.getByRole('button', { name: /move the selected group to/ })).toHaveCount(0);
    await expect(columns(page).nth(0).locator('.group-container')).toHaveCount(1);
    await page.waitForTimeout(500);
    expect(sent.length - before).toBe(0);

    // Anywhere else, the group is still picked up by the pointer.
    await expect(page.locator('.group-container')).toHaveAttribute('draggable', 'true');

    // Review finding (pass 11 of 42.1): a word of the title moved by a drag
    // within it was two writes from one revision — its deletion, then its
    // insertion — and the server kept the deletion alone: the word was gone
    // for everyone. A title takes no words dragged from a field.
    await title.press('End');
    await page.keyboard.press('Shift+Control+ArrowLeft');
    expect(await title.evaluate((input: HTMLInputElement) => input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0))).toBe('problems');
    const word = await title.evaluate((input: HTMLInputElement) => {
      const context = document.createElement('canvas').getContext('2d')!;
      context.font = getComputedStyle(input).font;
      const box = input.getBoundingClientRect();
      const start = context.measureText('Delivery ').width;
      const end = context.measureText('Delivery problems').width;
      return { x: box.left + (start + end) / 2, y: box.top + box.height / 2, left: box.left };
    });
    const moved = sent.length;
    await page.mouse.move(word.x, word.y);
    await page.mouse.down();
    await page.mouse.move(word.x - 10, word.y, { steps: 4 });
    await page.mouse.move(word.left + 1, word.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    await expect(title).toHaveValue('Delivery problems');
    expect(sent.length - moved).toBe(0);
  } finally {
    await context.close();
  }
});

// Review finding (pass 11 of 42.1): a double click on a word of a group's
// title, with a card above it open for editing. The first click closed the
// editor, the card grew back by the rows the editor hides, and the second
// press landed on what came under the pointer: the card's Delete (asking
// nothing), its vote, its comments. jsdom lays nothing out.
test('a double click whose first click closes an editor presses nothing the layout moved under it', async ({ browser }) => {
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
    await page.getByPlaceholder('e.g. Design Team').fill(`${TEAM_NAME}-dblclick`);
    await page.locator('input[type="password"]').fill(TEAM_PASSWORD);
    await page.getByLabel('Recovery Email').fill('facilitator@example.com');
    await page.getByRole('button', { name: 'Create & Join' }).click();
    await expect(page.getByText(`${TEAM_NAME}-dblclick Dashboard`)).toBeVisible({ timeout: 15_000 });
    await dismissAnnouncementsIfPresent(page);
    await page.getByRole('button', { name: 'New Retrospective' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Open board', exact: true }).click();
    await dialog.getByTestId('retro-template-lean_coffee').click();
    await expect(page.getByRole('heading', { level: 2, name: 'Open board' })).toBeVisible({ timeout: 15_000 });
    // The vote under the pointer is what the second press must not press.
    await openTheVote(page);
    await page.waitForTimeout(700);

    const field = columns(page).nth(0).getByPlaceholder('Add an idea...');
    for (const text of ['Late release notes', 'Too many meetings']) {
      await field.fill(text);
      await page.keyboard.press('Enter');
      await expect(card(page, text)).toBeVisible();
    }
    await page.getByRole('button', { name: /Pick up the ticket Late release notes/ }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: /group the selected ticket with Too many meetings/ }).focus();
    await page.keyboard.press('Enter');
    const title = page.locator('.group-container input[data-group-title-id]');
    await expect(title).toBeFocused({ timeout: 10_000 });
    await title.fill('Delivery problems');
    await title.press('Enter');
    // Newest first: written last, it sits above the group, and its four lines
    // are two rows of an editor.
    const long = 'Release notes are written the evening before, nobody reads them, and support learns about every change from the customers who call to ask';
    await field.fill(long);
    await page.keyboard.press('Enter');
    await expect(card(page, long)).toBeVisible();
    const above = (await card(page, long).boundingBox())!;
    expect(above.y).toBeLessThan((await title.boundingBox())!.y);
    await card(page, long).getByRole('button', { name: 'Edit ticket' }).click();
    const editor = page.locator('[data-ticket-id] textarea');
    await expect(editor).toBeFocused();
    // The end of the text, not of its first line.
    await editor.press('Control+End');
    await page.keyboard.type(' too');
    await page.waitForTimeout(700);
    const before = sent.length;

    // A person's double click: two presses on the first word, a moment
    // apart. Playwright's own sends the second before the first has ended.
    const box = (await title.boundingBox())!;
    await page.mouse.move(box.x + 12, box.y + box.height / 2);
    await page.mouse.down({ clickCount: 1 });
    await page.mouse.up({ clickCount: 1 });
    await page.waitForTimeout(150);
    await page.mouse.down({ clickCount: 2 });
    await page.mouse.up({ clickCount: 2 });
    await page.waitForTimeout(700);

    await expect(editor).toHaveCount(0);
    await expect(card(page, `${long} too`)).toBeVisible();
    await expect(page.locator('[data-ticket-id]')).toHaveCount(3);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(card(page, `${long} too`).getByRole('button', { name: /^0 votes/ })).toBeVisible();
    expect(sent.length - before).toBe(1);
    expect(sent.at(-1)).toContain(`${long} too`);
    await expect(title).toBeFocused();
  } finally {
    await context.close();
  }
});

// Review finding (pass 12 of 42.1): the first tap of a double tap picked the
// card up and took the focus out of the editor above it, which closed. The
// card grew back under the finger, and the second tap acted on it: grouped it
// with the card picked up, or pressed one of its controls.
// Review finding (pass 13 of 42.1): a tap that does nothing still belongs to
// the sequence. Measured from the first tap only, the third tap of a triple
// tap at an ordinary pace, past half a second from the first, grouped the
// card that grew back, for everyone.
for (const { taps, gap } of [{ taps: 2, gap: 120 }, { taps: 3, gap: 300 }]) test(`${taps} taps ${gap} ms apart, the first closing an editor, do nothing the layout moved under them`, async ({ browser }) => {
  const { defaultBrowserType: _ignored, ...phone } = devices['Pixel 7'];
  const context = await browser.newContext({ ...phone, locale: 'en-US' });
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
    await page.getByPlaceholder('e.g. Design Team').fill(`${TEAM_NAME}-tap${taps}`);
    await page.locator('input[type="password"]').fill(TEAM_PASSWORD);
    await page.getByLabel('Recovery Email').fill('facilitator@example.com');
    await page.getByRole('button', { name: 'Create & Join' }).click();
    await expect(page.getByText(`${TEAM_NAME}-tap${taps} Dashboard`)).toBeVisible({ timeout: 15_000 });
    await dismissAnnouncementsIfPresent(page);
    await page.getByRole('button', { name: 'New Retrospective' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Open board', exact: true }).click();
    await dialog.getByTestId('retro-template-lean_coffee').click();
    await expect(page.getByRole('heading', { level: 2, name: 'Open board' })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(700);

    const field = columns(page).nth(0).getByPlaceholder('Add an idea...');
    await field.fill('Late release notes');
    await page.keyboard.press('Enter');
    // Newest first: written last, it sits above the other card.
    const long = 'Release notes are written the evening before, nobody reads them, and support learns about every change from the customers who call to ask';
    await field.fill(long);
    await page.keyboard.press('Enter');
    await expect(card(page, long)).toBeVisible();
    await card(page, long).getByRole('button', { name: 'Edit ticket' }).tap();
    const editor = page.locator('[data-ticket-id] textarea');
    await expect(editor).toBeFocused();
    await editor.press('Control+End');
    await page.keyboard.type(' too');
    await page.waitForTimeout(700);
    const before = sent.length;

    // Near the top of the card below: the editor closing pushes it down.
    const below = (await card(page, 'Late release notes').boundingBox())!;
    const at = { x: below.x + below.width / 2, y: below.y + 6 };
    for (let n = 0; n < taps; n += 1) {
      if (n > 0) await page.waitForTimeout(gap);
      await page.touchscreen.tap(at.x, at.y);
    }
    await page.waitForTimeout(700);

    await expect(editor).toHaveCount(0);
    await expect(card(page, `${long} too`)).toBeVisible();
    await expect(page.locator('[data-ticket-id]')).toHaveCount(2);
    await expect(page.locator('.group-container')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Selected for grouping: Late release notes/ })).toBeVisible();
    expect(sent.length - before).toBe(1);
    expect(sent.at(-1)).toContain(`${long} too`);
  } finally {
    await context.close();
  }
});

/**
 * Creates a team and opens a Lean Coffee board on it, its vote open when the
 * test presses a vote (a board starts with voting off); answers what the page
 * sends.
 */
const startOpenBoard = async (page: Page, teamName: string, { withVote = false } = {}) => {
  const sent: string[] = [];
  page.on('websocket', (socket) => socket.on('framesent', ({ payload }) => {
    const text = typeof payload === 'string' ? payload : payload.toString();
    if (text.includes('"update-session"')) sent.push(text);
  }));
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '+ New Team' }).click();
  await page.getByPlaceholder('e.g. Design Team').fill(teamName);
  await page.locator('input[type="password"]').fill(TEAM_PASSWORD);
  await page.getByLabel('Recovery Email').fill('facilitator@example.com');
  await page.getByRole('button', { name: 'Create & Join' }).click();
  await expect(page.getByText(`${teamName} Dashboard`)).toBeVisible({ timeout: 15_000 });
  await dismissAnnouncementsIfPresent(page);
  await page.getByRole('button', { name: 'New Retrospective' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Open board', exact: true }).click();
  await dialog.getByTestId('retro-template-lean_coffee').click();
  await expect(page.getByRole('heading', { level: 2, name: 'Open board' })).toBeVisible({ timeout: 15_000 });
  if (withVote) await openTheVote(page);
  await page.waitForTimeout(700);
  return sent;
};

/** The control under a point, and the card it belongs to. */
const controlAt = (page: Page, at: { x: number; y: number }) => page.evaluate(({ x, y }) => {
  const control = document.elementFromPoint(x, y)?.closest('button');
  return { label: control?.getAttribute('aria-label') ?? null, card: control?.closest('[data-ticket-id]')?.textContent ?? null };
}, at);

// Review finding (pass 14 of 42.1): the taps above whose mouse the board
// could stop are taps it claims, for which Chromium emulates no mouse: the
// half of the rule that judges the mouse of a tap was held by jsdom alone —
// whose events carry Date.now(), the very clock a mistake would read. A tap on
// a group's title is the title's: the browser emulates the mouse for it, and
// for every tap on a control after it. 430 ms after each lift, past the
// browser's own count of taps.
test('taps after one on a group’s title that closes an editor press nothing the layout moved under them, past the browser’s count', async ({ browser }) => {
  const { defaultBrowserType: _ignored, ...phone } = devices['Pixel 7'];
  const context = await browser.newContext({ ...phone, locale: 'en-US' });
  // The font CI renders in (it has no Inter), so that a run here lays the
  // board out as CI does: the points below are measured, never assumed.
  await context.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = "body { font-family: 'DejaVu Sans', sans-serif !important; }";
      document.head.appendChild(style);
    });
  });
  // Before the board's own listeners: a press it stops goes no further.
  await context.addInitScript(() => {
    const seen: Array<{ type: string; at: number; detail: number }> = [];
    (window as unknown as { __taps: typeof seen }).__taps = seen;
    for (const type of ['touchend', 'mousedown']) {
      window.addEventListener(type, (e) => seen.push({ type, at: e.timeStamp, detail: (e as MouseEvent).detail ?? 0 }), true);
    }
  });
  const page = await context.newPage();
  try {
    const sent = await startOpenBoard(page, `${TEAM_NAME}-tapmouse`, { withVote: true });
    const field = columns(page).nth(0).getByPlaceholder('Add an idea...');
    for (const text of ['Late release notes', 'Too many meetings']) {
      await field.fill(text);
      await page.keyboard.press('Enter');
      await expect(card(page, text)).toBeVisible();
    }
    await page.getByRole('button', { name: /Pick up the ticket Late release notes/ }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: /group the selected ticket with Too many meetings/ }).focus();
    await page.keyboard.press('Enter');
    const title = page.locator('.group-container input[data-group-title-id]');
    await expect(title).toBeFocused({ timeout: 10_000 });
    await title.fill('Delivery problems');
    await title.press('Enter');
    // Newest first: written last, it sits above the group.
    const long = 'Release notes are written the evening before, nobody reads them, and support learns about every change from the customers who call to ask';
    await field.fill(long);
    await page.keyboard.press('Enter');
    await expect(card(page, long)).toBeVisible();
    const editor = page.locator('[data-ticket-id] textarea');
    const rectOf = (target: Locator) => target.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
    const openEditor = async (text: string, typed: string) => {
      await card(page, text).getByRole('button', { name: 'Edit ticket' }).tap();
      await expect(editor).toBeFocused();
      await editor.press('Control+End');
      await page.keyboard.type(typed);
    };

    // Where to tap: first on the title while the editor is open, then, a few
    // pixels away, on a control of the card once the editor has closed and the
    // card grown back — the closest pair of points between the two, so that
    // the next taps are a fingertip from the first whatever the font lays out.
    await openEditor(long, ' too');
    const titleRect = await rectOf(title);
    await editor.evaluate((el) => (el as HTMLElement).blur());
    await expect(editor).toHaveCount(0);
    const pair = await card(page, `${long} too`).evaluate((cardEl, t) => {
      const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
      const inset = (r: { left: number; right: number; top: number; bottom: number }) => ({ left: r.left + 3, right: r.right - 3, top: r.top + 3, bottom: r.bottom - 3 });
      const titleIn = inset(t);
      return [...cardEl.querySelectorAll('button')]
        .map((control) => inset(control.getBoundingClientRect()))
        .filter((c) => c.right > c.left && c.bottom > c.top)
        .map((c) => {
          const first = { x: clamp((c.left + c.right) / 2, titleIn.left, titleIn.right), y: clamp((c.top + c.bottom) / 2, titleIn.top, titleIn.bottom) };
          const next = { x: clamp(first.x, c.left, c.right), y: clamp(first.y, c.top, c.bottom) };
          return { first, next, distance: Math.hypot(next.x - first.x, next.y - first.y) };
        })
        .sort((a, b) => a.distance - b.distance)[0];
    }, titleRect);
    // Inside the board's fingertip (24 px), with room to spare.
    expect(pair.distance).toBeLessThanOrEqual(18);
    const { first, next: at } = pair;
    // The editor took its Edit off the page when it opened: a tap on the Edit
    // that came back, at the same point within half a second of the first, is
    // the next of a double tap on another element, and presses nothing
    // (doubleGestureGuard). A person closes the editor with a gesture of their
    // own, which starts over; the test closed it with none.
    await page.waitForTimeout(600);
    await openEditor(`${long} too`, ' again');
    expect(await rectOf(title)).toEqual(titleRect);
    await page.waitForTimeout(700);
    const before = sent.length;
    await page.evaluate(() => { (window as unknown as { __taps: unknown[] }).__taps.length = 0; });

    // Each next tap 430 ms after the lift before it, on the page's own clock:
    // past the browser's count (about 400 ms from a lift to the next touch),
    // inside the board's half second. A wait in the test would add the time
    // the first tap's write takes to answer.
    const tapAfterLift = async (ms: number) => {
      await page.evaluate((target) => new Promise<void>((resolve) => {
        const seen = (window as unknown as { __taps: Array<{ type: string; at: number }> }).__taps;
        const lift = [...seen].reverse().find((t) => t.type === 'touchend');
        setTimeout(resolve, Math.max(0, target - (performance.now() - (lift?.at ?? 0))));
      }), ms);
      await page.touchscreen.tap(at.x, at.y);
    };
    await page.touchscreen.tap(first.x, first.y);
    await tapAfterLift(430);
    await tapAfterLift(430);
    await page.waitForTimeout(700);

    // The browser emulated the mouse for each tap, and counted none after the
    // first as the next (detail 1): only the board's half second stops them.
    const taps = await page.evaluate(() => (window as unknown as { __taps: Array<{ type: string; at: number; detail: number }> }).__taps);
    const presses = taps.filter((t) => t.type === 'mousedown');
    const lifts = taps.filter((t) => t.type === 'touchend');
    expect(presses.map((t) => t.detail)).toEqual([1, 1, 1]);
    expect(lifts).toHaveLength(3);
    for (const n of [1, 2]) expect(presses[n].at - lifts[n - 1].at).toBeLessThanOrEqual(500);

    const edited = `${long} too again`;
    // What the later taps reached: a control of the card that grew back.
    expect((await controlAt(page, at)).card).toContain(edited);
    await expect(editor).toHaveCount(0);
    await expect(card(page, edited)).toBeVisible();
    await expect(page.locator('[data-ticket-id]')).toHaveCount(3);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(card(page, edited).getByRole('button', { name: /^0 votes/ })).toBeVisible();
    expect(sent.length - before).toBe(1);
    expect(sent.at(-1)).toContain(edited);
    await expect(title).toBeFocused();
  } finally {
    await context.close();
  }
});

// Review finding (pass 14 of 42.1): a Delete asks nothing, and the card below
// comes up into the place of the one it deletes, its own Delete under the
// finger or the pointer. A double tap, or a double click, deleted two cards
// for everyone.
for (const device of ['phone', 'computer'] as const) test(`a double ${device === 'phone' ? 'tap' : 'click'} on a card’s Delete deletes that card alone, on a ${device}`, async ({ browser }) => {
  const { defaultBrowserType: _ignored, ...phone } = devices['Pixel 7'];
  const context = await browser.newContext(device === 'phone'
    ? { ...phone, locale: 'en-US' }
    : { locale: 'en-US', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    const sent = await startOpenBoard(page, `${TEAM_NAME}-dbldelete-${device}`);
    const field = columns(page).nth(0).getByPlaceholder('Add an idea...');
    for (const text of ['First card', 'Second card', 'Third card']) {
      await field.fill(text);
      await page.keyboard.press('Enter');
      await expect(card(page, text)).toBeVisible();
    }
    await field.blur();
    await page.waitForTimeout(700);
    const before = sent.length;

    // Newest first: the third card is on top, the second right under it.
    const remove = card(page, 'Third card').getByRole('button', { name: 'Delete ticket' });
    if (device === 'computer') await card(page, 'Third card').hover();
    const box = (await remove.boundingBox())!;
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    if (device === 'phone') {
      await page.touchscreen.tap(at.x, at.y);
      await page.waitForTimeout(120);
      await page.touchscreen.tap(at.x, at.y);
    } else {
      await page.mouse.move(at.x, at.y);
      await page.mouse.down({ clickCount: 1 });
      await page.mouse.up({ clickCount: 1 });
      await page.waitForTimeout(120);
      await page.mouse.down({ clickCount: 2 });
      await page.mouse.up({ clickCount: 2 });
    }
    await page.waitForTimeout(700);

    // The second reached the Delete of the card that came up.
    expect(await controlAt(page, at)).toEqual({ label: 'Delete ticket', card: expect.stringContaining('Second card') });
    await expect(page.locator('[data-ticket-id]')).toHaveCount(2);
    await expect(card(page, 'Second card')).toBeVisible();
    expect(sent.length - before).toBe(1);
  } finally {
    await context.close();
  }
});

// The simple rule's stated cost (AGENTS.md → The double-gesture guard): taps
// less than half a second apart are one gesture, each counted from the one
// before, as a browser counts them. A facilitator clearing cards at two taps a
// second deletes the first, and the next once the pace pauses — though the
// browser counts none of those taps as the next of a double tap.
test('taps at a steady pace on the Delete that comes up under the finger delete one card, and the next after a pause, on a phone', async ({ browser }) => {
  const { defaultBrowserType: _ignored, ...phone } = devices['Pixel 7'];
  const context = await browser.newContext({ ...phone, locale: 'en-US' });
  await context.addInitScript(() => {
    const seen: Array<{ type: string; at: number; detail: number }> = [];
    (window as unknown as { __taps: typeof seen }).__taps = seen;
    for (const type of ['touchend', 'mousedown']) {
      window.addEventListener(type, (e) => seen.push({ type, at: e.timeStamp, detail: (e as MouseEvent).detail ?? 0 }), { capture: true });
    }
  });
  const page = await context.newPage();
  try {
    const sent = await startOpenBoard(page, `${TEAM_NAME}-steadydelete`);
    const field = columns(page).nth(0).getByPlaceholder('Add an idea...');
    for (const text of ['Card 1', 'Card 2', 'Card 3', 'Card 4', 'Card 5']) {
      await field.fill(text);
      await page.keyboard.press('Enter');
      await expect(card(page, text)).toBeVisible();
    }
    await field.blur();
    await page.waitForTimeout(700);
    const before = sent.length;
    await page.evaluate(() => { (window as unknown as { __taps: unknown[] }).__taps.length = 0; });

    // Newest first: the fifth card is on top, each one under it the same height.
    const box = (await card(page, 'Card 5').getByRole('button', { name: 'Delete ticket' }).boundingBox())!;
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // Each next tap 450 ms after the lift before it, on the page's own clock:
    // past the browser's count, inside the board's half second.
    const tapAfterLift = async (ms: number) => {
      await page.evaluate((target) => new Promise<void>((resolve) => {
        const seen = (window as unknown as { __taps: Array<{ type: string; at: number }> }).__taps;
        const lift = [...seen].reverse().find((t) => t.type === 'touchend');
        setTimeout(resolve, Math.max(0, target - (performance.now() - (lift?.at ?? 0))));
      }), ms);
      await page.touchscreen.tap(at.x, at.y);
    };
    await page.touchscreen.tap(at.x, at.y);
    for (let n = 0; n < 3; n += 1) await tapAfterLift(450);
    await page.waitForTimeout(200);
    // The first deleted the card under the finger; the three after it, each
    // the next of the one before, nothing.
    await expect(page.locator('[data-ticket-id]')).toHaveCount(4);
    await tapAfterLift(900);
    await page.waitForTimeout(700);

    const taps = await page.evaluate(() => (window as unknown as { __taps: Array<{ type: string; at: number; detail: number }> }).__taps);
    const presses = taps.filter((t) => t.type === 'mousedown');
    const lifts = taps.filter((t) => t.type === 'touchend');
    expect(presses.map((t) => t.detail)).toEqual([1, 1, 1, 1, 1]);
    for (const n of [1, 2, 3]) expect(presses[n].at - lifts[n - 1].at).toBeLessThanOrEqual(500);
    expect(presses[4].at - lifts[3].at).toBeGreaterThan(500);
    // After the pause, the next card under the finger.
    await expect(page.locator('[data-ticket-id]')).toHaveCount(3);
    for (const text of ['Card 1', 'Card 2', 'Card 3']) await expect(card(page, text)).toBeVisible();
    expect(sent.length - before).toBe(2);
  } finally {
    await context.close();
  }
});

// Review finding (pass 16 of 42.1): a Delete is not the only control a press
// takes off the page with its own click. An editor's Cancel goes with its
// editor, and the row's Delete, which asks nothing, comes back where it was: a
// double click, or a double tap, on the Cancel of a comment's editor deleted
// the comment being edited, for everyone.
for (const device of ['phone', 'computer'] as const) test(`a double ${device === 'phone' ? 'tap' : 'click'} on the Cancel of a comment’s editor deletes no comment, on a ${device}`, async ({ browser }) => {
  const { defaultBrowserType: _ignored, ...phone } = devices['Pixel 7'];
  const context = await browser.newContext(device === 'phone'
    ? { ...phone, locale: 'en-US' }
    : { locale: 'en-US', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    const sent = await startOpenBoard(page, `${TEAM_NAME}-cmtcancel-${device}`);
    const field = columns(page).nth(0).getByPlaceholder('Add an idea...');
    await field.fill('Card with remarks');
    await page.keyboard.press('Enter');
    await expect(card(page, 'Card with remarks')).toBeVisible();
    await field.blur();
    await card(page, 'Card with remarks').getByTestId('ticket-comment-btn').click();
    const dialog = page.getByRole('dialog');
    for (const text of ['First remark', 'Second remark']) {
      await dialog.getByTestId('add-comment-input').fill(text);
      await dialog.getByTestId('submit-comment-btn').click();
      await expect(dialog.getByText(text)).toBeVisible();
    }
    await page.waitForTimeout(700);

    // The first remark's Delete is drawn where its editor's Cancel was: the
    // point pressed lies in both, measured, never assumed.
    const deleteBox = (await dialog.getByRole('button', { name: 'Delete comment' }).first().boundingBox())!;
    if (device === 'computer') await dialog.getByText('First remark').hover();
    await dialog.getByRole('button', { name: 'Edit comment' }).first().click();
    const cancelBox = (await dialog.getByRole('button', { name: 'Cancel editing comment' }).boundingBox())!;
    const left = Math.max(deleteBox.x, cancelBox.x);
    const right = Math.min(deleteBox.x + deleteBox.width, cancelBox.x + cancelBox.width);
    const top = Math.max(deleteBox.y, cancelBox.y);
    const bottom = Math.min(deleteBox.y + deleteBox.height, cancelBox.y + cancelBox.height);
    expect(right - left).toBeGreaterThan(2);
    expect(bottom - top).toBeGreaterThan(2);
    const at = { x: (left + right) / 2, y: (top + bottom) / 2 };
    const before = sent.length;

    if (device === 'phone') {
      await page.touchscreen.tap(at.x, at.y);
      await page.waitForTimeout(150);
      await page.touchscreen.tap(at.x, at.y);
    } else {
      await page.mouse.move(at.x, at.y);
      await page.mouse.down({ clickCount: 1 });
      await page.mouse.up({ clickCount: 1 });
      await page.waitForTimeout(150);
      await page.mouse.down({ clickCount: 2 });
      await page.mouse.up({ clickCount: 2 });
    }
    await page.waitForTimeout(700);

    await expect(dialog.getByRole('button', { name: 'Cancel editing comment' })).toHaveCount(0);
    await expect(dialog.getByText('First remark')).toBeVisible();
    await expect(dialog.getByText('Second remark')).toBeVisible();
    expect(sent.length - before).toBe(0);
    // The second reached the Delete of the remark whose editor closed.
    expect((await controlAt(page, at)).label).toBe('Delete comment');
  } finally {
    await context.close();
  }
});

// Review finding (pass 17 of 42.1): a dialog's backdrop is no control, and it
// goes with its own click: the first tap of a double tap closed the comments
// dialog, and the second pressed what lay under the backdrop — a card's
// Delete, which asks nothing. Past the browser's count (430 ms after the lift,
// each emulated mouse says 1), only what lies under the point, laid out by a
// real browser, says the board moved there (underMoved): jsdom has no layout.
test('a double tap past the browser’s count on a dialog’s backdrop deletes no card under it', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 }, hasTouch: true });
  await context.addInitScript(() => {
    const seen: Array<{ type: string; at: number; detail: number }> = [];
    (window as unknown as { __taps: typeof seen }).__taps = seen;
    for (const type of ['touchend', 'mousedown']) {
      window.addEventListener(type, (e) => seen.push({ type, at: e.timeStamp, detail: (e as MouseEvent).detail ?? 0 }), { capture: true });
    }
  });
  const page = await context.newPage();
  try {
    const sent = await startOpenBoard(page, `${TEAM_NAME}-backdrop`);
    const field = columns(page).nth(0).getByPlaceholder('Add an idea...');
    for (const text of ['First card', 'Second card']) {
      await field.fill(text);
      await page.keyboard.press('Enter');
      await expect(card(page, text)).toBeVisible();
    }
    await field.blur();
    await card(page, 'First card').getByTestId('ticket-comment-btn').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(700);

    // A card's Delete that the backdrop covers, outside the dialog's panel.
    const box = (await card(page, 'Second card').getByRole('button', { name: 'Delete ticket' }).boundingBox())!;
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const panel = (await dialog.boundingBox())!;
    expect(at.x < panel.x || at.x > panel.x + panel.width || at.y < panel.y || at.y > panel.y + panel.height).toBe(true);
    const before = sent.length;
    await page.evaluate(() => { (window as unknown as { __taps: unknown[] }).__taps.length = 0; });

    await page.touchscreen.tap(at.x, at.y);
    await page.evaluate((target) => new Promise<void>((resolve) => {
      const seen = (window as unknown as { __taps: Array<{ type: string; at: number }> }).__taps;
      const lift = [...seen].reverse().find((t) => t.type === 'touchend');
      setTimeout(resolve, Math.max(0, target - (performance.now() - (lift?.at ?? 0))));
    }), 430);
    await page.touchscreen.tap(at.x, at.y);
    await page.waitForTimeout(700);

    const taps = await page.evaluate(() => (window as unknown as { __taps: Array<{ type: string; at: number; detail: number }> }).__taps);
    const presses = taps.filter((t) => t.type === 'mousedown');
    const lifts = taps.filter((t) => t.type === 'touchend');
    expect(presses.map((t) => t.detail)).toEqual([1, 1]);
    expect(presses[1].at - lifts[0].at).toBeLessThanOrEqual(500);
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-ticket-id]')).toHaveCount(2);
    expect(sent.length - before).toBe(0);
    // The second tap reached the Delete the backdrop had covered.
    expect((await controlAt(page, at)).label).toBe('Delete ticket');
  } finally {
    await context.close();
  }
});

// Review finding (pass 19 of 42.1): a vote draws its dots and the cross that
// takes it back beside the thumb, which stays where it is. The next tap a few
// pixels off, past the browser's count, pressed the cross, and the vote meant
// was taken back. What lies under a point only a browser can say: jsdom lays
// nothing out.
test('a double tap past the browser’s count on a card’s vote keeps the vote, the cross it drew beside the thumb under the second touch', async ({ browser }) => {
  const { defaultBrowserType: _ignored, ...phone } = devices['Pixel 7'];
  const context = await browser.newContext({ ...phone, locale: 'en-US' });
  await context.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = "body { font-family: 'DejaVu Sans', sans-serif !important; }";
      document.head.appendChild(style);
    });
  });
  await context.addInitScript(() => {
    const seen: Array<{ type: string; at: number; detail: number }> = [];
    (window as unknown as { __taps: typeof seen }).__taps = seen;
    for (const type of ['touchend', 'mousedown']) {
      window.addEventListener(type, (e) => seen.push({ type, at: e.timeStamp, detail: (e as MouseEvent).detail ?? 0 }), true);
    }
  });
  const page = await context.newPage();
  try {
    const sent = await startOpenBoard(page, `${TEAM_NAME}-thumb`, { withVote: true });
    const field = columns(page).nth(0).getByPlaceholder('Add an idea...');
    await field.fill('Voted card');
    await page.keyboard.press('Enter');
    await expect(card(page, 'Voted card')).toBeVisible();
    await field.blur();
    await page.waitForTimeout(700);

    const takeBack = card(page, 'Voted card').getByRole('button', { name: 'Take back one of your votes on this ticket' });
    await expect(takeBack).toHaveCount(0);
    const thumb = (await card(page, 'Voted card').getByTestId('vote-add').boundingBox())!;
    const first = { x: thumb.x + thumb.width * 0.2, y: thumb.y + thumb.height / 2 };
    const before = sent.length;
    await page.evaluate(() => { (window as unknown as { __taps: unknown[] }).__taps.length = 0; });

    await page.touchscreen.tap(first.x, first.y);
    await expect(takeBack).toBeVisible();
    // The point of the cross nearest the first touch, a pixel inside it: a
    // finger that drifted toward the icon.
    const cross = (await takeBack.boundingBox())!;
    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
    const second = { x: clamp(first.x, cross.x + 1, cross.x + cross.width - 1), y: clamp(first.y, cross.y + 1, cross.y + cross.height - 1) };
    expect(Math.hypot(second.x - first.x, second.y - first.y)).toBeLessThanOrEqual(24);
    await page.evaluate((target) => new Promise<void>((resolve) => {
      const seen = (window as unknown as { __taps: Array<{ type: string; at: number }> }).__taps;
      const lift = [...seen].reverse().find((t) => t.type === 'touchend');
      setTimeout(resolve, Math.max(0, target - (performance.now() - (lift?.at ?? 0))));
    }), 430);
    await page.touchscreen.tap(second.x, second.y);
    await page.waitForTimeout(700);

    const taps = await page.evaluate(() => (window as unknown as { __taps: Array<{ type: string; at: number; detail: number }> }).__taps);
    const presses = taps.filter((t) => t.type === 'mousedown');
    const lifts = taps.filter((t) => t.type === 'touchend');
    expect(presses.map((t) => t.detail)).toEqual([1, 1]);
    expect(presses[1].at - lifts[0].at).toBeLessThanOrEqual(500);
    // The vote, and nothing after it: the cross the second touch reached
    // came there with the first.
    expect(sent.length - before).toBe(1);
    await expect(takeBack).toBeVisible();
    expect((await controlAt(page, second)).label).toBe('Take back one of your votes on this ticket');
  } finally {
    await context.close();
  }
});

// The scenario that showed the heuristic's last hole (HARDENING_STATUS.md →
// H54 → B): two taps half a second apart on a card's Comments. The first
// opened the dialog; the second, past the browser's count, reached the
// dialog's backdrop and closed it again. It is not what the first tap pressed.
test('a double tap past the browser’s count on a card’s Comments leaves its dialog open, on a phone', async ({ browser }) => {
  const { defaultBrowserType: _ignored, ...phone } = devices['Pixel 7'];
  const context = await browser.newContext({ ...phone, locale: 'en-US' });
  await context.addInitScript(() => {
    const seen: Array<{ type: string; at: number; detail: number }> = [];
    (window as unknown as { __taps: typeof seen }).__taps = seen;
    for (const type of ['touchend', 'mousedown']) {
      window.addEventListener(type, (e) => seen.push({ type, at: e.timeStamp, detail: (e as MouseEvent).detail ?? 0 }), true);
    }
  });
  const page = await context.newPage();
  try {
    await startOpenBoard(page, `${TEAM_NAME}-comments`);
    const field = columns(page).nth(0).getByPlaceholder('Add an idea...');
    await field.fill('Card with comments');
    await page.keyboard.press('Enter');
    await expect(card(page, 'Card with comments')).toBeVisible();
    await field.blur();
    await page.waitForTimeout(700);
    const box = (await card(page, 'Card with comments').getByTestId('ticket-comment-btn').boundingBox())!;
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.evaluate(() => { (window as unknown as { __taps: unknown[] }).__taps.length = 0; });

    await page.touchscreen.tap(at.x, at.y);
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.evaluate((target) => new Promise<void>((resolve) => {
      const seen = (window as unknown as { __taps: Array<{ type: string; at: number }> }).__taps;
      const lift = [...seen].reverse().find((t) => t.type === 'touchend');
      setTimeout(resolve, Math.max(0, target - (performance.now() - (lift?.at ?? 0))));
    }), 450);
    await page.touchscreen.tap(at.x, at.y);
    await page.waitForTimeout(700);

    const presses = (await page.evaluate(() => (window as unknown as { __taps: Array<{ type: string; detail: number }> }).__taps))
      .filter((t) => t.type === 'mousedown');
    expect(presses.map((t) => t.detail)).toEqual([1, 1]);
    await expect(page.getByRole('dialog')).toBeVisible();
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
  // appear over the last words of the first line. With the author's avatar
  // beside it (a board starts with its authors named), then anonymous.
  await field.fill(LONG_CARD);
  await page.keyboard.press('Enter');
  const longCard = card(page, LONG_CARD);
  await expect(longCard).toBeVisible();
  for (const anonymous of [false, true]) {
    if (anonymous) await setAnonymous(page, true);
    await longCard.hover();
    await expect.poll(() => opacityOf(longCard.getByRole('button', { name: 'Edit ticket' }))).toBe('1');
    const hovered = await measureCard(longCard);
    expect(hovered, 'the long card and its edit control').not.toBeNull();
    expect(hovered!.lines.length).toBeGreaterThan(1);
    expect(hovered!.lines.filter((line) => rectsOverlap(line, hovered!.edit)), `anonymous: ${anonymous}`).toEqual([]);
  }
});
