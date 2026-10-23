import { test, expect, type Page } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from './helpers/announcements';
import { audit } from './helpers/axe';

/**
 * Restoring one team from a stored backup, from the super-admin console, end to
 * end: a checkpoint is taken, the team is deleted, and the console brings it
 * back from the checkpoint alone — with its password and its backlog — while a
 * team created after the checkpoint is still there.
 *
 * The record a restore writes and the routes' refusals are covered by
 * `teamRestore.test.ts` and `superAdminTeamRestoreRoutes.test.ts`; what only a
 * browser shows is that the console, the login screen and the Dashboard agree.
 *
 * The second half restores from a **file**: a backup is downloaded from the
 * table, its row and its teams are deleted, and the file is imported in the
 * Backups tab — it becomes a row marked "imported" — then two teams are
 * restored from it, one after the other. The import's server side is
 * `superAdminBackupImportRoutes.test.ts` and the two-pod case
 * `superAdminTeamRestoreRoutes.test.ts`; what only a browser shows is a real
 * blob download, a real file input and the card's accessibility (its own axe
 * run, `admin-backup-import-card`).
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

test('restores one deleted team from a checkpoint and leaves the others alone', async ({ page }, testInfo) => {
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
  // The dialog with a deleted team chosen and its name prefilled, scoped like
  // the import card below.
  await page.mouse.move(0, 0);
  await audit(page, testInfo, 'admin-team-restore-dialog', { scope: dialog });
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

const deleteTeamFromConsole = async (page: Page, name: string) => {
  await teamRow(page, name).getByRole('button', { name: 'Delete' }).click();
  const deleteDialog = page.getByRole('dialog', { name: `Delete ${name}` });
  await deleteDialog.getByLabel(/To confirm, type the team name/).fill(name);
  await deleteDialog.getByRole('button', { name: 'Delete the team' }).click();
  await expect(teamRow(page, name)).toHaveCount(0, { timeout: 10_000 });
};

const restoreFromDialog = async (page: Page, name: string) => {
  const dialog = page.getByRole('dialog', { name: 'Restore one team' });
  await dialog.getByLabel('Search for a team').fill(name);
  await expect(dialog.getByText('Deleted since')).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('radio', { name: new RegExp(name) }).check();
  await expect(dialog.getByLabel('Name of the restored team')).toHaveValue(name);
  await dialog.getByRole('button', { name: `Restore ${name}` }).click();
  await expect(dialog).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText(`${name} was restored from the backup`)).toBeVisible();
};

test('imports a downloaded backup file and restores two teams from it', async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  const stamp = Date.now();
  const teamA = `Import-E2E-${stamp}-A`;
  const teamB = `Import-E2E-${stamp}-B`;
  const action = `Action kept by the file ${stamp}`;
  const source = `File source ${stamp}`;

  await createTeam(page, teamA, action);
  await createTeam(page, teamB);
  await openConsole(page);

  // A checkpoint, downloaded from its row: the file the admin will import.
  await page.getByRole('button', { name: 'Backups' }).click();
  await page.getByPlaceholder('Optional label (e.g. Before v10 upgrade)').fill(source);
  await page.getByRole('button', { name: 'Create Checkpoint' }).click();
  const sourceRow = page.getByRole('row').filter({ hasText: source });
  await expect(sourceRow).toBeVisible({ timeout: 10_000 });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    sourceRow.getByRole('button', { name: 'Download backup' }).click()
  ]);
  const fileName = download.suggestedFilename();
  expect(fileName).toMatch(/^retrogemini-backup-.*\.json\.gz$/);
  const filePath = testInfo.outputPath(fileName);
  await download.saveAs(filePath);

  // The row goes, then both teams: only the file is left to restore from.
  page.once('dialog', (dialog) => dialog.accept());
  await sourceRow.getByRole('button', { name: 'Delete backup' }).click();
  await expect(sourceRow).toHaveCount(0, { timeout: 10_000 });
  await page.getByRole('button', { name: /Teams \(\d+\)/ }).click();
  await deleteTeamFromConsole(page, teamA);
  await deleteTeamFromConsole(page, teamB);

  // Import it.
  await page.getByRole('button', { name: 'Backups' }).click();
  const importCard = page.getByRole('region', { name: 'Import a backup file' });
  await importCard.getByLabel('Backup file', { exact: true }).setInputFiles(filePath);
  // Audited idle with its file chosen — before the click that changes it. The
  // button is white on teal-700: teal-600 measures 3.66:1 and fails here.
  await audit(page, testInfo, 'admin-backup-import-card', { scope: importCard });
  await importCard.getByRole('button', { name: 'Import the file' }).click();
  await expect(importCard.getByRole('status')).toContainText(`"${fileName}" was imported.`, { timeout: 15_000 });

  // The team-restore dialog opens on the new row by itself.
  const dialog = page.getByRole('dialog', { name: 'Restore one team' });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByText(`From the backup "${fileName}"`, { exact: false })).toBeVisible();
  await restoreFromDialog(page, teamA);

  // The row is there, marked imported and named after the file; a second team
  // comes back from the same row.
  const importedRow = page.getByRole('row').filter({ hasText: fileName });
  await expect(importedRow).toHaveCount(1);
  // Not `exact`: the badge's text is its icon's ligature and its label
  // ("uploadimported"), and an exact query compares the whole of it.
  await expect(importedRow.getByText('imported')).toBeVisible();
  await importedRow.getByRole('button', { name: 'Restore one team from this backup' }).click();
  await restoreFromDialog(page, teamB);

  await page.getByRole('button', { name: /Teams \(\d+\)/ }).click();
  await expect(teamRow(page, teamA)).toHaveCount(1);
  await expect(teamRow(page, teamB)).toHaveCount(1);

  // Deleted when done.
  await page.getByRole('button', { name: 'Backups' }).click();
  page.once('dialog', (confirmDialog) => confirmDialog.accept());
  await importedRow.getByRole('button', { name: 'Delete backup' }).click();
  await expect(importedRow).toHaveCount(0, { timeout: 10_000 });

  // A opens with its password and holds its backlog.
  await page.getByRole('button', { name: 'Exit Admin Mode' }).click();
  await page.getByText(teamA, { exact: true }).click();
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Enter Workspace' }).click();
  await expect(page.getByText(`${teamA} Dashboard`)).toBeVisible({ timeout: 10_000 });
  await dismissAnnouncementsIfPresent(page);
  await expect(page.getByLabel(`Assignee for the action: ${action}`)).toBeVisible();
});

test('refuses a file that is not a backup, on the field, and adds no row', async ({ page }) => {
  await openConsole(page);
  await page.getByRole('button', { name: 'Backups' }).click();
  const importCard = page.getByRole('region', { name: 'Import a backup file' });
  await expect(importCard).toBeVisible();

  const input = importCard.getByLabel('Backup file', { exact: true });
  await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await importCard.getByRole('button', { name: 'Import the file' }).click();

  const alert = importCard.getByRole('alert');
  await expect(alert).toHaveText(/This file is not a backup archive/);
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  const errorId = await alert.getAttribute('id');
  expect(await input.getAttribute('aria-describedby')).toContain(errorId!);
  // An imported row would be labelled with the file name.
  await expect(page.getByRole('row').filter({ hasText: 'notes.txt' })).toHaveCount(0);
});
