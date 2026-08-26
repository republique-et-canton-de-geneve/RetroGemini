import { test, expect } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from './helpers/announcements';

/**
 * Lot L23, the half a unit test cannot prove — asked for by Codex on PR #437,
 * and worth having for a reason neither of us expected: **writing it disproved
 * the justification it was meant to confirm.**
 *
 * The claim was that adding the shared `name` to the feedback type radios made
 * the arrow keys work, because without it the two inputs were not one radio
 * group. Measured in Chromium, that is wrong twice over: an arrow key checks
 * and focuses the next radio whether or not they share a name, and in this form
 * React's controlled `checked` then unchecks the other one — so the *selection*
 * behaves either way and no assertion about it can tell the two apart.
 *
 * What the shared `name` actually buys is the **tab stop**. A real radio group
 * is one stop entered at the selected option, with the arrows choosing inside
 * it; two ungrouped radios are two stops, so a keyboard user tabs through every
 * option instead of past them, and a screen reader loses the "1 of 2" position.
 * That is the property asserted below, and it is the only one that fails when
 * the attribute is removed.
 *
 * **jsdom cannot see any of this** — it implements neither radio-group
 * navigation nor roving tab order — which is why the unit suite pins the `name`
 * attribute itself and this file proves what the attribute is for.
 */

const TEAM_NAME = `Radio-E2E-${Date.now()}`;
const TEAM_PASSWORD = 'testpass123456';

test('the feedback type radios are one tab stop, not two', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: '+ New Team' }).click();
  await expect(page.getByRole('heading', { name: 'Create New Team' })).toBeVisible();
  await page.getByLabel('Team Name').fill(TEAM_NAME);
  await page.getByLabel('Create Password').fill(TEAM_PASSWORD);
  await page.getByRole('button', { name: 'Create & Join' }).click();
  await expect(page.getByText(`${TEAM_NAME} Dashboard`)).toBeVisible({ timeout: 10_000 });

  await dismissAnnouncementsIfPresent(page);

  await page.getByRole('button', { name: 'Feedback Hub' }).click();
  await page.getByRole('button', { name: /New Feedback/i }).click();

  const group = page.getByRole('radiogroup', { name: 'Type' });
  await expect(group).toBeVisible();

  const bug = group.getByRole('radio').first();
  const feature = group.getByRole('radio').last();
  await expect(bug).toBeChecked();

  // Enter the group, then leave it with one Tab. Ungrouped, the second Tab
  // lands on the other radio instead — the assertion that fails without the
  // shared `name`.
  await bug.focus();
  await page.keyboard.press('Tab');
  await expect(feature).not.toBeFocused();

  // Inside the group the arrows choose, and the choice actually takes effect.
  await bug.focus();
  await page.keyboard.press('ArrowRight');
  await expect(feature).toBeChecked();
  await expect(bug).not.toBeChecked();

  await page.keyboard.press('ArrowLeft');
  await expect(bug).toBeChecked();
});
