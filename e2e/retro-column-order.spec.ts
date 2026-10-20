import { test, expect, Page } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from './helpers/announcements';

/**
 * A retrospective's columns can be put in another order, before the retro
 * (the custom template editor) and during it (the facilitator's "Edit
 * Layout"). The order of `session.columns` is the order of the board for
 * everyone, so the move has to reach the server, not just the screen.
 */

const TEAM_PASSWORD = 'columnorder123456';

/** The column titles in board order, read from the headers or, in Edit Layout, their inputs. */
const boardOrder = (page: Page) =>
  page.locator('[data-group-columns-scroller] > [data-column-id]').evaluateAll((columns) =>
    columns.map((column) => {
      const title = column.querySelector<HTMLElement>('[data-column-title]');
      return title instanceof HTMLInputElement ? title.value : title?.textContent?.trim() ?? '';
    })
  );

test('the facilitator reorders columns before and during a retrospective', async ({ page }) => {
  const teamName = `Column-Order-${Date.now()}`;
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '+ New Team' }).click();
  await page.getByPlaceholder('e.g. Design Team').fill(teamName);
  await page.locator('input[type="password"]').fill(TEAM_PASSWORD);
  await page.getByLabel('Recovery Email').fill('facilitator@example.com');
  await page.getByRole('button', { name: 'Create & Join' }).click();
  await expect(page.getByText(`${teamName} Dashboard`)).toBeVisible({ timeout: 10_000 });
  await dismissAnnouncementsIfPresent(page);

  // Before the retro: the custom template starts as Start, Stop.
  await page.getByRole('button', { name: 'New Retrospective' }).click();
  await page.getByRole('button', { name: 'Create Custom Template' }).click();
  await expect(page.getByRole('button', { name: 'Move column 1 up' })).toBeDisabled();
  await page.getByRole('button', { name: 'Move column 1 down' }).click();
  // The keyboard stays on the column just moved, now second and at the edge.
  await expect(page.getByRole('button', { name: 'Move column 2 up' })).toBeFocused();
  await page.getByRole('button', { name: 'Start Retro' }).click();

  await expect(page.getByRole('heading', { name: 'Icebreaker' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'BRAINSTORM', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Brainstorm' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => boardOrder(page)).toEqual(['Stop', 'Start']);

  // During the retro: Edit Layout puts Start back first, and the keyboard
  // lands on the arrow that still applies.
  await page.getByRole('button', { name: 'Edit Layout' }).click();
  await expect(page.getByRole('button', { name: 'Move the Stop column left' })).toBeDisabled();
  await page.getByRole('button', { name: 'Move the Start column left' }).click();
  await expect.poll(() => boardOrder(page)).toEqual(['Start', 'Stop']);
  await expect(page.getByRole('button', { name: 'Move the Start column left' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Move the Start column right' })).toBeFocused();

  // Two presses in a row are two writes stamped with the same revision: the
  // server keeps the first and heals the second away unless this client
  // re-asserts its own order (the own-change ledger's column-order slice).
  await page.getByRole('button', { name: '+ Add Column' }).click();
  await expect.poll(() => boardOrder(page)).toEqual(['Start', 'Stop', 'New Column']);
  // Both presses before any acknowledgement can come back: on localhost a
  // press per keystroke lets the first write land first and hides the race
  // this guards. A microtask between them lets React render the first move (a
  // real user always gets that render) while no socket message, which needs a
  // task of its own, can arrive.
  await page.evaluate(async () => {
    const button = document.querySelector<HTMLButtonElement>('button[aria-label="Move the Start column right"]');
    button?.click();
    await Promise.resolve();
    button?.click();
  });
  await expect.poll(() => boardOrder(page)).toEqual(['Stop', 'New Column', 'Start']);
  // Once the server has answered both writes, the order stays put.
  await page.waitForTimeout(1_500);
  expect(await boardOrder(page)).toEqual(['Stop', 'New Column', 'Start']);
  await page.getByRole('button', { name: 'Done Editing' }).click();
  await expect(page.getByRole('button', { name: 'Move the Start column left' })).toHaveCount(0);

  // The server holds the new order: it survives a reload.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Brainstorm' })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => boardOrder(page)).toEqual(['Stop', 'New Column', 'Start']);
});

/**
 * A real browser drops the focus of whatever a moved node holds, and fires
 * `blur` (jsdom does not, so only a browser test sees it). React DOM covers it:
 * it ignores its own handlers during a commit and gives focus and the caret
 * back afterwards — but only because the board moves each column's node by its
 * key. Key the columns by position, or remount them, and someone typing a card
 * in a column the facilitator moves loses the field. A second tab of the
 * facilitator plays that participant: it never reordered anything, so it
 * simply receives the new order.
 */
test('someone typing a card keeps the field when the facilitator moves its column', async ({ page, context }) => {
  const teamName = `Column-Focus-${Date.now()}`;
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
  await expect.poll(() => boardOrder(page)).toEqual(['Start', 'Stop', 'Continue']);

  const writer = await context.newPage();
  await writer.goto(page.url());
  await expect(writer.getByRole('heading', { name: 'Brainstorm' })).toBeVisible({ timeout: 15_000 });
  await dismissAnnouncementsIfPresent(writer);
  const startColumn = writer.locator('[data-column-id]', { has: writer.locator('[data-column-title]', { hasText: /^Start$/ }) });
  const field = startColumn.locator('textarea[data-brainstorm-input]');
  await field.click();
  await writer.keyboard.type('half a sentence');

  // Start moves right: React moves Start's node on the writer's screen.
  await page.getByRole('button', { name: 'Edit Layout' }).click();
  await page.getByRole('button', { name: 'Move the Start column right' }).click();
  await expect.poll(() => boardOrder(writer)).toEqual(['Stop', 'Start', 'Continue']);

  await expect(field).toBeFocused();
  await expect(field).toHaveValue('half a sentence');
  await writer.keyboard.type(', finished');
  await expect(field).toHaveValue('half a sentence, finished');

  // Edit Layout belongs to Brainstorm: a phase change made in another tab
  // closes it here too, or the arrows would stay on the Group board.
  await expect(page.getByRole('button', { name: 'Move the Start column left' })).toBeVisible();
  await writer.getByRole('button', { name: 'GROUP', exact: true }).click();
  await expect.poll(() => page.getByRole('button', { name: /^Move the .+ column (left|right)$/ }).count(), { timeout: 15_000 }).toBe(0);
});
