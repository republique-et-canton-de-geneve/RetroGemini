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
