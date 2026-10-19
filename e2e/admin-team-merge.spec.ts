import { test, expect, type Page } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from './helpers/announcements';

/**
 * Merging two teams from the super-admin console, end to end: the merged team
 * holds what both teams held, its facilitator can log in with the password the
 * console kept, and the original teams are then deleted from the console.
 *
 * The planner and the routes are covered by `teamMerge.test.ts` and
 * `superAdminTeamMergeRoutes.test.ts`; what only a browser shows is that the
 * console, the login screen and the Dashboard agree on the result.
 */

const STAMP = Date.now();
const PRIMARY = `Merge-E2E-${STAMP}-A`;
const SECONDARY = `Merge-E2E-${STAMP}-B`;
const MERGED = `Merge-E2E-${STAMP}-AB`;
const PRIMARY_PASSWORD = 'merge-primary-pass';
const SECONDARY_PASSWORD = 'merge-secondary-pass';
const PRIMARY_ACTION = `Action written in ${PRIMARY}`;
const SECONDARY_ACTION = `Action written in ${SECONDARY}`;

const createTeamWithAction = async (page: Page, name: string, password: string, action: string) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '+ New Team' }).click();
  await page.getByPlaceholder('e.g. Design Team').fill(name);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Create & Join' }).click();
  await expect(page.getByText(`${name} Dashboard`)).toBeVisible({ timeout: 10_000 });
  await dismissAnnouncementsIfPresent(page);

  await page.getByPlaceholder('What needs to be done?').fill(action);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByLabel(`Assignee for the action: ${action}`)).toBeVisible();

  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page.getByRole('heading', { name: 'Your Teams' })).toBeVisible({ timeout: 10_000 });
};

const openConsole = async (page: Page) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Super Admin Access' }).click();
  await page.getByLabel('Super Admin Password').fill('e2e-super-admin-password');
  await page.getByRole('button', { name: 'Access Admin Panel' }).click();
  await expect(page.getByRole('heading', { name: /Super Admin Dashboard/ })).toBeVisible({ timeout: 10_000 });
};

const teamRow = (page: Page, name: string) =>
  page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) });

test('merges two teams into a new one, then deletes the originals', async ({ page }) => {
  test.setTimeout(120_000);

  await createTeamWithAction(page, PRIMARY, PRIMARY_PASSWORD, PRIMARY_ACTION);
  await createTeamWithAction(page, SECONDARY, SECONDARY_PASSWORD, SECONDARY_ACTION);

  await openConsole(page);
  await page.getByRole('button', { name: 'Merge two teams' }).click();
  const mergeDialog = page.getByRole('dialog', { name: 'Merge two teams' });
  await mergeDialog.getByLabel('Main team').selectOption({ label: PRIMARY });
  await mergeDialog.getByLabel('Team to add to it').selectOption({ label: SECONDARY });
  await mergeDialog.getByRole('button', { name: 'Preview the merge' }).click();

  // One backlog action from each team, two in the merged one.
  const summary = mergeDialog.getByTestId('team-merge-summary');
  await expect(summary).toBeVisible({ timeout: 10_000 });
  await expect(summary.getByRole('row', { name: /Backlog actions/ }).getByRole('cell')).toHaveText(['1', '1', '2']);

  await mergeDialog.getByLabel('Name of the new team').fill(MERGED);
  await mergeDialog.getByLabel(`Keep the password of ${PRIMARY}`).check();
  await mergeDialog.getByRole('button', { name: 'Create the merged team' }).click();
  await expect(mergeDialog).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText(`Team "${MERGED}" created.`, { exact: false })).toBeVisible();

  // The console says where each team came from and went.
  await expect(teamRow(page, MERGED)).toContainText(`Merged from ${PRIMARY}, ${SECONDARY}`);
  await expect(teamRow(page, MERGED)).not.toContainText('(not verified)');
  await expect(teamRow(page, PRIMARY)).toContainText(`Merged into ${MERGED}`);

  // Delete both originals; nothing changed since the merge, so no reason to acknowledge.
  for (const name of [PRIMARY, SECONDARY]) {
    await teamRow(page, name).getByRole('button', { name: 'Delete' }).click();
    const deleteDialog = page.getByRole('dialog', { name: `Delete ${name}` });
    await expect(deleteDialog).toContainText(`merged into ${MERGED}: its feedbacks will move there`);
    await deleteDialog.getByLabel(/To confirm, type the team name/).fill(name);
    await deleteDialog.getByRole('button', { name: 'Delete the team' }).click();
    await expect(deleteDialog).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText(`Team "${name}" deleted.`)).toBeVisible();
    await expect(teamRow(page, name)).toHaveCount(0);
  }

  // The merged team opens with the password the console kept, and holds both actions.
  await page.getByRole('button', { name: 'Exit Admin Mode' }).click();
  await expect(page.getByRole('heading', { name: 'Your Teams' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(PRIMARY, { exact: true })).toHaveCount(0);
  await page.getByText(MERGED, { exact: true }).click();
  await page.locator('input[type="password"]').fill(PRIMARY_PASSWORD);
  await page.getByRole('button', { name: 'Enter Workspace' }).click();
  await expect(page.getByText(`${MERGED} Dashboard`)).toBeVisible({ timeout: 10_000 });
  await dismissAnnouncementsIfPresent(page);
  await expect(page.getByLabel(`Assignee for the action: ${PRIMARY_ACTION}`)).toBeVisible();
  await expect(page.getByLabel(`Assignee for the action: ${SECONDARY_ACTION}`)).toBeVisible();
});
