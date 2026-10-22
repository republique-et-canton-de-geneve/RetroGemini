import { test, expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from './helpers/announcements';
import { audit } from './helpers/axe';

/**
 * The super-admin console in the axe audit (audit H42): the whole page, once
 * per tab, at zero serious or critical rules.
 *
 * The console was the one screen family no audit walked whole, and it showed:
 * 182 color-contrast nodes on 2026-10-20 — muted grey on its grey page, mid-tone
 * buttons, a per-team action in amber-600. The fix was by surface, not by
 * sweep (AGENTS.md): `text-slate-500` is fine on the console's white cards and
 * stays there; it went one step darker only where it lands on the grey page or
 * a tinted panel. This spec is what keeps that true.
 *
 * Every state is audited with real data behind it: a team with a feedback, and
 * a retrospective kept live in a second browser so the Live tab has a session
 * card to show. The settings cards are opened up (the AI fields, an info
 * message preview, a restore file chosen) and then discarded by a reload.
 *
 * **Nothing here may change the server for the specs that follow.** The page
 * carries one-click whole-store actions — "Upload & Restore" once a file is
 * chosen, a row's restore, "Clear" logs — so every console call is checked
 * against an allowlist: the reads the tabs make, and the three backup writes
 * the Backups state means to make. Anything else is aborted and recorded, and
 * the test fails on it. An allowlist fails closed: a new console write route is
 * blocked until someone decides it belongs here.
 */

const STAMP = Date.now();
const TEAM = `Console-A11y-${STAMP}`;
const PASSWORD = 'console-a11y-password';
const FEEDBACK_TITLE = `Console audit feedback ${STAMP}`;
const CHECKPOINT = `Console audit checkpoint ${STAMP}`;
const SUPER_ADMIN_PASSWORD = 'e2e-super-admin-password';

const ALLOWED_CONSOLE_CALLS = new Set([
  // Reads
  'verify',
  'validate-session',
  'teams',
  'feedbacks',
  'active-sessions',
  'logs',
  'backups/list',
  'ai-settings',
  'jira-settings',
  'admin-email',
  // The Backups state's own writes: a checkpoint, protected, then removed.
  'backups/create',
  'backups/update',
  'backups/delete',
]);

let teamContext: BrowserContext | undefined;
let adminContext: BrowserContext | undefined;

test.afterAll(async () => {
  await teamContext?.close();
  await adminContext?.close();
});

const openConsole = async (page: Page) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Super Admin Access' }).click();
  await page.getByLabel('Super Admin Password').fill(SUPER_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Access Admin Panel' }).click();
  await expect(page.getByRole('heading', { name: /Super Admin Dashboard/ })).toBeVisible({ timeout: 10_000 });
};

const teamRow = (page: Page, name: string) =>
  page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) });

/** Every console audit runs with the pointer off the page, so no `hover:` colour is measured. */
const auditConsole = async (page: Page, testInfo: TestInfo, screen: string, options?: Parameters<typeof audit>[3]) => {
  await page.mouse.move(0, 0);
  await audit(page, testInfo, screen, options);
};

test('audits every tab of the super-admin console with axe-core', async ({ browser }, testInfo) => {
  // ---- The data the tabs show: a team, a feedback, a live session --------
  teamContext = await browser.newContext();
  const teamPage = await teamContext.newPage();
  await teamPage.goto('/');
  await teamPage.waitForLoadState('networkidle');
  await teamPage.getByRole('button', { name: '+ New Team' }).click();
  await teamPage.getByPlaceholder('e.g. Design Team').fill(TEAM);
  await teamPage.locator('input[type="password"]').fill(PASSWORD);
  await teamPage.getByLabel('Recovery Email').fill('facilitator@example.com');
  await teamPage.getByRole('button', { name: 'Create & Join' }).click();
  await expect(teamPage.getByText(`${TEAM} Dashboard`)).toBeVisible({ timeout: 15_000 });
  await dismissAnnouncementsIfPresent(teamPage);

  await teamPage.getByRole('button', { name: 'Feedback Hub' }).click();
  await teamPage.getByRole('button', { name: /New Feedback/i }).click();
  await teamPage.getByLabel('Title').fill(FEEDBACK_TITLE);
  await teamPage.getByLabel('Description').fill('Filed so the console has a card to show.');
  const created = teamPage.waitForResponse((response) => response.url().endsWith('/api/feedbacks/create'));
  await teamPage.getByRole('button', { name: 'Submit' }).click();
  expect((await created).status()).toBe(200);

  // Left open on the Icebreaker: the session stays live for the Live tab.
  await teamPage.locator('.dash-tab', { hasText: 'Actions' }).click();
  await teamPage.getByRole('button', { name: 'New Retrospective' }).click();
  await teamPage.locator('text=Start, Stop, Continue').first().click();
  await expect(teamPage.getByRole('heading', { name: 'Icebreaker' })).toBeVisible({ timeout: 15_000 });

  // ---- The console, behind the allowlist --------------------------------
  adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  const blocked: string[] = [];
  await admin.route('**/api/super-admin/**', (route) => {
    const call = new URL(route.request().url()).pathname.replace(/^\/api\/super-admin\//, '');
    if (ALLOWED_CONSOLE_CALLS.has(call)) return route.continue();
    blocked.push(call);
    return route.abort();
  });

  // 1. Teams.
  await openConsole(admin);
  await expect(teamRow(admin, TEAM)).toHaveCount(1, { timeout: 10_000 });
  await auditConsole(admin, testInfo, 'admin-console-teams');

  // 2. A team's inline editor (opening it writes nothing).
  await teamRow(admin, TEAM).getByRole('button', { name: 'Rename' }).click();
  await expect(admin.getByPlaceholder('Team name')).toBeVisible();
  await auditConsole(admin, testInfo, 'admin-console-team-edit');
  await admin.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(admin.getByPlaceholder('Team name')).toHaveCount(0);

  // 3. The settings cards opened up, nothing saved: turning AI *on* only shows
  //    its fields (only turning it off posts), the message preview is local,
  //    and a chosen restore file only enables "Upload & Restore" — never
  //    clicked. The reload throws all of it away.
  const enableAi = admin.getByRole('button', { name: 'Enable AI features' });
  if (await enableAi.count()) await enableAi.click();
  await expect(admin.getByLabel(/API URL/)).toBeVisible();
  await admin.getByPlaceholder(/Scheduled maintenance/).fill('Maintenance on Sunday, 2-4 AM.');
  await expect(admin.locator('p', { hasText: 'Maintenance on Sunday, 2-4 AM.' })).toBeVisible();
  await admin.getByLabel('Backup file to restore').setInputFiles({
    name: 'not-restored.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{}'),
  });
  await expect(admin.getByRole('button', { name: 'Upload & Restore' })).toBeEnabled();
  await auditConsole(admin, testInfo, 'admin-console-settings-open');
  await admin.reload();
  await expect(admin.getByRole('heading', { name: /Super Admin Dashboard/ })).toBeVisible({ timeout: 10_000 });
  await expect(admin.getByRole('button', { name: 'Upload & Restore' })).toBeDisabled();

  // 4. Feedback, and the comment dialog over it.
  await admin.getByRole('button', { name: /Feedback \(\d+\)/ }).click();
  const feedbackHeading = admin.getByRole('heading', { name: FEEDBACK_TITLE, exact: true });
  await expect(feedbackHeading).toBeVisible({ timeout: 10_000 });
  await auditConsole(admin, testInfo, 'admin-console-feedbacks');
  await feedbackHeading.locator('xpath=..').getByRole('button', { name: 'Add Comment' }).click();
  const commentDialog = admin.getByRole('dialog', { name: 'Add Comment' });
  await expect(commentDialog).toBeVisible();
  await auditConsole(admin, testInfo, 'admin-console-comment-dialog', { scope: commentDialog });
  await admin.keyboard.press('Escape');
  await expect(commentDialog).toHaveCount(0);

  // 5. Live, with the team's retrospective running in the other browser.
  await admin.getByRole('button', { name: /Live Sessions/ }).click();
  await expect(admin.getByText(`Team: ${TEAM}`)).toBeVisible({ timeout: 15_000 });
  await auditConsole(admin, testInfo, 'admin-console-live');

  // 6. Logs. Never "Clear": it is an audited action (`logs.clear`), it empties
  //    the ring the later specs read, and it is not on the allowlist anyway.
  //    What the table shows depends on what was logged; every branch of the
  //    level and source badges was fixed by reading the source as well.
  await admin.getByRole('button', { name: /Server Logs/ }).click();
  await expect(admin.getByRole('table')).toBeVisible({ timeout: 10_000 });
  await auditConsole(admin, testInfo, 'admin-console-logs');

  // 7. Backups, with a protected and an unprotected row — then cleaned up.
  await admin.getByRole('button', { name: 'Backups' }).click();
  await admin.getByPlaceholder('Optional label (e.g. Before v10 upgrade)').fill(CHECKPOINT);
  await admin.getByRole('button', { name: 'Create Checkpoint' }).click();
  const checkpointRow = admin.getByRole('row').filter({ hasText: CHECKPOINT });
  await expect(checkpointRow).toBeVisible({ timeout: 15_000 });
  await checkpointRow.getByTitle('Click to protect from auto-cleanup').click();
  await expect(checkpointRow.getByTitle('Protected from auto-cleanup')).toBeVisible({ timeout: 10_000 });
  await expect(admin.getByTitle('Click to protect from auto-cleanup').first()).toBeVisible();
  await auditConsole(admin, testInfo, 'admin-console-backups');
  await checkpointRow.getByTitle('Protected from auto-cleanup').click();
  await expect(checkpointRow.getByTitle('Click to protect from auto-cleanup')).toBeVisible({ timeout: 10_000 });
  admin.once('dialog', (dialog) => dialog.accept());
  await checkpointRow.getByRole('button', { name: 'Delete backup' }).click();
  await expect(checkpointRow).toHaveCount(0, { timeout: 10_000 });

  expect(blocked, 'console calls outside the allowlist were attempted (and aborted)').toEqual([]);
});
