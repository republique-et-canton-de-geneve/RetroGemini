import { test, expect, Page } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from './helpers/announcements';

/**
 * A field report, with a screen recording: a Starfish retro (five columns) on
 * a 1920px screen showed four columns and a scrollbar at the bottom of the
 * board. Neither the facilitator nor the participants saw the fifth column,
 * "Start Doing", and its cards went unread.
 *
 * Two promises, and both need a real layout engine — jsdom measures every
 * element at zero, so no unit test can hold them:
 *  - on that screen, the five columns fit (they share the width instead of
 *    taking 24rem each);
 *  - where they cannot fit, every column is named above the board, the ones
 *    off screen are marked, and one click brings each into view.
 */

const TEAM_PASSWORD = 'wideboard123456';

const createTeamAndStarfish = async (page: Page) => {
  const teamName = `Wide-Board-${Date.now()}`;
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '+ New Team' }).click();
  await page.getByPlaceholder('e.g. Design Team').fill(teamName);
  await page.locator('input[type="password"]').fill(TEAM_PASSWORD);
  await page.getByLabel('Recovery Email').fill('facilitator@example.com');
  await page.getByRole('button', { name: 'Create & Join' }).click();
  await expect(page.getByText(`${teamName} Dashboard`)).toBeVisible({ timeout: 10_000 });
  await dismissAnnouncementsIfPresent(page);

  await page.getByRole('button', { name: 'New Retrospective' }).click();
  await page.locator('text=Starfish').first().click();
  await expect(page.getByRole('heading', { name: 'Icebreaker' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'BRAINSTORM', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Brainstorm' })).toBeVisible({ timeout: 10_000 });
};

/** How many pixels of each column lie outside the board's visible width. */
const columnsOutsideBoard = (page: Page) =>
  page.evaluate(() => {
    const board = document.querySelector('[data-group-columns-scroller]') as HTMLElement;
    const bounds = board.getBoundingClientRect();
    return Array.from(board.querySelectorAll<HTMLElement>(':scope > [data-column-id]')).map((column) => {
      const rect = column.getBoundingClientRect();
      return Math.max(0, bounds.left - rect.left) + Math.max(0, rect.right - bounds.right);
    });
  });

const inViewStates = (page: Page) =>
  page.locator('[data-testid^="board-column-chip-"]').evaluateAll((chips) =>
    chips.map((chip) => chip.getAttribute('data-in-view'))
  );

test.describe('A board with five columns', () => {
  // The navigator scrolls instantly under reduced motion, so each step below
  // waits on the board's state, never on an animation's duration.
  test.use({ reducedMotion: 'reduce' });

  test('fits them on a wide screen, and names the hidden ones where they cannot fit', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 910 });
    await createTeamAndStarfish(page);

    const columns = page.locator('[data-group-columns-scroller] > [data-column-id]');
    await expect(columns).toHaveCount(5);
    // The facilitator's participants panel is open, as in the recording.
    await expect(page.getByRole('button', { name: 'Invite Team' })).toBeVisible();
    expect(await columnsOutsideBoard(page)).toEqual([0, 0, 0, 0, 0]);
    await expect(page.getByTestId('board-column-navigator')).toHaveCount(0);

    // A laptop: five columns no longer fit beside the participants panel.
    await page.setViewportSize({ width: 1280, height: 900 });
    const navigator = page.getByRole('navigation', { name: 'Board columns' });
    await expect(navigator).toBeVisible();
    const chips = navigator.locator('[data-testid^="board-column-chip-"]');
    await expect(chips).toHaveCount(5);
    await expect(chips.nth(0)).toHaveAttribute('data-in-view', 'true');
    await expect(chips.nth(4)).toHaveAttribute('data-in-view', 'false');
    await expect(chips.nth(4)).toContainText('Start Doing');
    await expect(navigator.getByRole('button', { name: 'Show the previous columns' })).toBeDisabled();

    // One click on the hidden column's name brings it in, whole.
    await chips.nth(4).click();
    await expect(chips.nth(4)).toHaveAttribute('data-in-view', 'true');
    await expect.poll(async () => (await columnsOutsideBoard(page))[4]).toBe(0);
    await expect(chips.nth(0)).toHaveAttribute('data-in-view', 'false');

    // And the arrows walk back to the first one.
    const previous = navigator.getByRole('button', { name: 'Show the previous columns' });
    await expect(previous).toBeEnabled();
    for (let step = 0; step < 5 && (await chips.nth(0).getAttribute('data-in-view')) !== 'true'; step++) {
      const before = await inViewStates(page);
      await previous.click();
      await expect.poll(() => inViewStates(page)).not.toEqual(before);
    }
    await expect(chips.nth(0)).toHaveAttribute('data-in-view', 'true');
    await expect(previous).toBeDisabled();
    await expect(navigator.getByRole('button', { name: 'Show the next columns' })).toBeEnabled();
  });
});

/**
 * The other half of the same complaint, from the facilitator's side: with
 * three columns on a 1920px screen, the columns stopped at 24rem each and a
 * third of the board stood empty on the right. Columns now take the whole
 * width, and a column wide enough for two cards shows them side by side.
 */

/** Pixels between the last column's right edge and the end of the board's content box. */
const emptyBandRightOfColumns = (page: Page) =>
  page.evaluate(() => {
    const board = document.querySelector('[data-group-columns-scroller]') as HTMLElement;
    const columns = board.querySelectorAll<HTMLElement>(':scope > [data-column-id]');
    const last = columns[columns.length - 1].getBoundingClientRect();
    const contentRight = board.getBoundingClientRect().right - parseFloat(getComputedStyle(board).paddingRight);
    return contentRight - last.right;
  });

const addIdea = async (page: Page, columnIndex: number, text: string) => {
  const input = page.locator('[data-group-columns-scroller] > [data-column-id]').nth(columnIndex).locator('textarea');
  await input.fill(text);
  await input.press('Enter');
  await expect(page.getByText(text, { exact: true })).toBeVisible();
};

test.describe('A board with three columns', () => {
  test('takes the whole width, and a wide column shows its cards side by side', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 910 });
    const teamName = `Full-Board-${Date.now()}`;
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: '+ New Team' }).click();
    await page.getByPlaceholder('e.g. Design Team').fill(teamName);
    await page.locator('input[type="password"]').fill(TEAM_PASSWORD);
    await page.getByLabel('Recovery Email').fill('facilitator@example.com');
    await page.getByRole('button', { name: 'Create & Join' }).click();
    await expect(page.getByText(`${teamName} Dashboard`)).toBeVisible({ timeout: 10_000 });
    await dismissAnnouncementsIfPresent(page);
    await page.getByRole('button', { name: 'New Retrospective' }).click();
    await page.locator('text=Start, Stop, Continue').first().click();
    await expect(page.getByRole('heading', { name: 'Icebreaker' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'BRAINSTORM', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Brainstorm' })).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('[data-group-columns-scroller] > [data-column-id]')).toHaveCount(3);
    // The screenshot from the field: three 24rem columns and an empty band of
    // about 500px to their right. Now the third column reaches the board's edge.
    expect(await emptyBandRightOfColumns(page)).toBeLessThanOrEqual(2);

    // A wider screen gives each column room for two cards: they sit side by
    // side, in reading order, instead of one very wide card under the other.
    await page.setViewportSize({ width: 2560, height: 1000 });
    await addIdea(page, 0, 'First idea on a wide board');
    await addIdea(page, 0, 'Second idea on a wide board');
    const first = await page.getByText('First idea on a wide board', { exact: true }).boundingBox();
    const second = await page.getByText('Second idea on a wide board', { exact: true }).boundingBox();
    expect(first && second).toBeTruthy();
    expect(Math.abs(first!.y - second!.y)).toBeLessThanOrEqual(2);
    expect(second!.x).toBeGreaterThan(first!.x + first!.width);
    expect(await emptyBandRightOfColumns(page)).toBeLessThanOrEqual(2);

    // On the 1920px screen each of the three columns holds one card per row:
    // two cards there would be too narrow to read.
    await page.setViewportSize({ width: 1920, height: 910 });
    await expect.poll(async () => {
      const a = await page.getByText('First idea on a wide board', { exact: true }).boundingBox();
      const b = await page.getByText('Second idea on a wide board', { exact: true }).boundingBox();
      return !!a && !!b && b.y > a.y + a.height;
    }).toBe(true);
  });
});
