import { test, expect, type Page } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from './helpers/announcements';

/**
 * The Dashboard's Actions tab, measured where jsdom cannot (45.3).
 *
 * Its fields at rest. The dashboard's field recipe (`dashboardLook.ts` →
 * `FIELD_BOX`) gave a field made read-only the page's grey with `read-only:`,
 * and `:read-only` matches every element that cannot be typed in: every select
 * and every file input drawn with the recipe was painted at rest in the look
 * of a draft locked while it is sent. The form's assignee select is one of
 * them. The rule itself is held by `__tests__/dashboardLook.test.tsx` and
 * `__tests__/fieldEdgeContrast.test.ts`; this measures what Chromium paints.
 */

const TEAM_PASSWORD = 'actions-tab-e2e-password';
const WHITE = 'rgb(255, 255, 255)';

const openActionsTab = async (page: Page, teamName: string) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '+ New Team' }).click();
  await page.getByPlaceholder('e.g. Design Team').fill(teamName);
  await page.locator('input[type="password"]').fill(TEAM_PASSWORD);
  await page.getByLabel('Recovery Email').fill('facilitator@example.com');
  await page.getByRole('button', { name: 'Create & Join' }).click();
  await expect(page.getByText(`${teamName} Dashboard`)).toBeVisible({ timeout: 10_000 });
  await dismissAnnouncementsIfPresent(page);
  // A Dashboard tab's accessible name starts with its icon's ligature, so it is found by its class and words.
  await page.locator('.dash-tab', { hasText: 'Actions' }).click();
  await expect(page.getByPlaceholder('What needs to be done?')).toBeVisible();
};

test.describe('the Dashboard’s Actions tab', () => {
  test('draws its fields white at rest, its select included', async ({ page }) => {
    await openActionsTab(page, `E2E-Actions-Fields-${Date.now()}`);
    const text = page.getByPlaceholder('What needs to be done?');
    const assignee = page.getByLabel('Assignee for the new action');
    // What the old fill keyed on: Chromium reads every select as read-only.
    expect(await assignee.evaluate((element) => element.matches(':read-only'))).toBe(true);
    for (const [what, field] of [['the new action’s text', text], ['its assignee', assignee]] as const) {
      // Polled: the recipe carries `transition`, so a colour can be read mid-way.
      await expect.poll(() => field.evaluate((element) => getComputedStyle(element).backgroundColor), { message: `${what} at rest` }).toBe(WHITE);
    }
  });
});
