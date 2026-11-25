import { test, expect, type Page } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from './helpers/announcements';

/**
 * The Dashboard's Actions tab, measured where jsdom cannot (45.3).
 *
 *  - Its fields at rest. The dashboard's field recipe (`dashboardLook.ts` →
 *    `FIELD_BOX`) gave a field made read-only the page's grey with
 *    `read-only:`, and `:read-only` matches every element that cannot be typed
 *    in: every select and every file input drawn with the recipe was painted at
 *    rest in the look of a draft locked while it is sent. The form's assignee
 *    select is one of them. The rule itself is held by
 *    `__tests__/dashboardLook.test.tsx` and `__tests__/fieldEdgeContrast.test.ts`;
 *    this measures what Chromium paints.
 *  - Its rows on a phone. A row holds the done toggle, the action's text and
 *    its assignee, and wraps on a phone so that the assignee goes under the
 *    text rather than squeeze it. Below about 338px the text did not fit
 *    beside the toggle either, and the toggle took a line of its own above its
 *    action (at 320px, the width `e2e/jira.spec.ts` measures this tab at).
 */

const TEAM_PASSWORD = 'actions-tab-e2e-password';
const WHITE = 'rgb(255, 255, 255)';

/** Phones (an iPhone SE, a small Android, two common ones), the `sm` breakpoint and a computer. */
const WIDTHS = [320, 360, 375, 390, 414, 640, 1280];
/** From here a row is one line (`sm:flex-nowrap`). */
const SM = 640;

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
  // A Dashboard tab is named by its label alone: the icon beside it is aria-hidden.
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await expect(page.getByPlaceholder('What needs to be done?')).toBeVisible();
};

const addAction = async (page: Page, text: string) => {
  await page.getByPlaceholder('What needs to be done?').fill(text);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator(`input[value="${text}"]`)).toBeVisible({ timeout: 10_000 });
};

/** Every action row of the list: the boxes of its done toggle, its text field and its assignee, and how far it scrolls sideways. */
const rowsLayout = (page: Page) =>
  page.evaluate(async () => {
    await document.fonts.ready;
    const box = (element: Element | null) => {
      if (!element) throw new Error('an action row lacks one of its controls');
      const { top, bottom, left, right } = element.getBoundingClientRect();
      return { top, bottom, left, right };
    };
    return [...document.querySelectorAll<HTMLInputElement>('input[aria-label="Action text"]')].map((field) => {
      const row = field.closest('div.group');
      if (!row) throw new Error(`no row around "${field.value}"`);
      return {
        text: field.value,
        toggle: box(row.querySelector('button[aria-label^="Mark action as"]')),
        field: box(field),
        assignee: box(row.querySelector('select')),
        sideways: row.scrollWidth - row.clientWidth,
      };
    });
  });

/** Two boxes share a line when they overlap vertically. */
const sameLine = (a: { top: number; bottom: number }, b: { top: number; bottom: number }) =>
  a.top < b.bottom && b.top < a.bottom;

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

  test('keeps each done toggle on its action’s line, and on a phone puts the assignee under the text', async ({ page }) => {
    await openActionsTab(page, `E2E-Actions-Rows-${Date.now()}`);
    const actions = ['Write the release checklist', 'Book a weekly release review', 'Archive the old wiki pages'];
    for (const text of actions) await addAction(page, text);
    // One assigned, one done: every state a row draws.
    await page.getByLabel(`Assignee for the action: ${actions[1]}`).selectOption({ index: 1 });
    await page.locator('div.group', { has: page.locator(`input[value="${actions[2]}"]`) }).getByRole('button', { name: 'Mark action as done' }).click();
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Mark action as not done' })).toHaveCount(1);

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      const rows = await rowsLayout(page);
      expect(rows.map((row) => row.text).sort()).toEqual([...actions].sort());
      for (const row of rows) {
        const where = `"${row.text}" at ${width}px`;
        expect(sameLine(row.toggle, row.field), `the done toggle is on its own line, above the text, ${where}`).toBe(true);
        expect(row.toggle.right, `the done toggle is not before the text, ${where}`).toBeLessThanOrEqual(row.field.left + 0.5);
        expect(row.sideways, `the row scrolls sideways, ${where}`).toBeLessThanOrEqual(0);
        if (width < SM) expect(row.assignee.top, `the assignee is not under the text, ${where}`).toBeGreaterThanOrEqual(row.field.bottom - 0.5);
        else expect(sameLine(row.assignee, row.field), `the assignee is not on the text's line, ${where}`).toBe(true);
      }
    }
  });
});
