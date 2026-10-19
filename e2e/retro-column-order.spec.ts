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

  // During the retro: Edit Layout puts Start back first.
  await page.getByRole('button', { name: 'Edit Layout' }).click();
  await expect(page.getByRole('button', { name: 'Move the Stop column left' })).toBeDisabled();
  await page.getByRole('button', { name: 'Move the Start column left' }).click();
  await expect.poll(() => boardOrder(page)).toEqual(['Start', 'Stop']);
  await page.getByRole('button', { name: 'Done Editing' }).click();
  await expect(page.getByRole('button', { name: 'Move the Start column left' })).toHaveCount(0);

  // The server holds the new order: it survives a reload.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Brainstorm' })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => boardOrder(page)).toEqual(['Start', 'Stop']);
});
