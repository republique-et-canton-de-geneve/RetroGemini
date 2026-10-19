import { test, expect, type Page } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from './helpers/announcements';

/**
 * Restoring one team from a stored backup, from the super-admin console, end to
 * end: a checkpoint is taken, the team is deleted, and the console brings it
 * back from the checkpoint alone — with its password and its backlog — while a
 * team created after the checkpoint is still there.
 *
 * The record a restore writes and the routes' refusals are covered by
 * `teamRestore.test.ts` and `superAdminTeamRestoreRoutes.test.ts`; what only a
 * browser shows is that the console, the login screen and the Dashboard agree.
 */

const STAMP = Date.now();
const RESTORED = `Restore-E2E-${STAMP}`;
const BYSTANDER = `Restore-E2E-${STAMP}-later`;
const PASSWORD = 'restore-e2e-password';
const ACTION = `Action kept by the backup ${STAMP}`;
const CHECKPOINT = `Before the incident ${STAMP}`;

const createTeam = async (page: Page, name: string, action?: string) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '+ New Team' }).click();
  await page.getByPlaceholder('e.g. Design Team').fill(name);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByLabel('Recovery Email').fill('facilitator@example.com');
  await page.getByRole('button', { name: 'Create & Join' }).click();
  await expect(page.getByText(`${name} Dashboard`)).toBeVisible({ timeout: 10_000 });
  await dismissAnnouncementsIfPresent(page);
  if (action) {
    await page.getByPlaceholder('What needs to be done?').fill(action);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByLabel(`Assignee for the action: ${action}`)).toBeVisible();
  }
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

test('restores one deleted team from a checkpoint and leaves the others alone', async ({ page }) => {
  test.setTimeout(120_000);

  await createTeam(page, RESTORED, ACTION);
  await openConsole(page);

  // A checkpoint, then the incident: the team is deleted. A team created after
  // the checkpoint must survive the restore.
  await page.getByRole('button', { name: 'Backups' }).click();
  await page.getByPlaceholder('Optional label (e.g. Before v10 upgrade)').fill(CHECKPOINT);
  await page.getByRole('button', { name: 'Create Checkpoint' }).click();
  const checkpointRow = page.getByRole('row').filter({ hasText: CHECKPOINT });
  await expect(checkpointRow).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: /Teams \(\d+\)/ }).click();
  await teamRow(page, RESTORED).getByRole('button', { name: 'Delete' }).click();
  const deleteDialog = page.getByRole('dialog', { name: `Delete ${RESTORED}` });
  await deleteDialog.getByLabel(/To confirm, type the team name/).fill(RESTORED);
  await deleteDialog.getByRole('button', { name: 'Delete the team' }).click();
  await expect(teamRow(page, RESTORED)).toHaveCount(0, { timeout: 10_000 });

  await page.getByRole('button', { name: 'Exit Admin Mode' }).click();
  await createTeam(page, BYSTANDER);
  await openConsole(page);

  // Restore that one team from the checkpoint.
  await page.getByRole('button', { name: 'Backups' }).click();
  await checkpointRow.getByRole('button', { name: 'Restore one team from this backup' }).click();
  const dialog = page.getByRole('dialog', { name: 'Restore one team' });
  await dialog.getByLabel('Search for a team').fill(RESTORED);
  const option = dialog.getByRole('radio', { name: new RegExp(RESTORED) });
  await expect(dialog.getByText('Deleted since')).toBeVisible({ timeout: 10_000 });
  await option.check();
  await expect(dialog.getByLabel('Name of the restored team')).toHaveValue(RESTORED);
  await dialog.getByRole('button', { name: `Restore ${RESTORED}` }).click();
  await expect(dialog).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText(`${RESTORED} was restored from the backup`)).toBeVisible();

  // Both teams are listed: the restored one, and the one the checkpoint never knew.
  await page.getByRole('button', { name: /Teams \(\d+\)/ }).click();
  await expect(teamRow(page, RESTORED)).toHaveCount(1);
  await expect(teamRow(page, BYSTANDER)).toHaveCount(1);

  // It opens with its password and holds its backlog.
  await page.getByRole('button', { name: 'Exit Admin Mode' }).click();
  await page.getByText(RESTORED, { exact: true }).click();
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Enter Workspace' }).click();
  await expect(page.getByText(`${RESTORED} Dashboard`)).toBeVisible({ timeout: 10_000 });
  await dismissAnnouncementsIfPresent(page);
  await expect(page.getByLabel(`Assignee for the action: ${ACTION}`)).toBeVisible();
});
