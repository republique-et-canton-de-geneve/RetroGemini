import { test, expect, Page, BrowserContext } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from './helpers/announcements';

/**
 * Decision D3b — changing the team password signs out every session opened
 * before, on every route and on the live-session socket, without cutting off
 * the facilitator who changed it.
 *
 * Two people: the facilitator F (two pages of one browser context, so two tabs
 * sharing one saved session) and a participant P who joined through the
 * invitation link. F changes the password from the Dashboard of the second
 * tab, and:
 *
 *  - P's open retrospective is cut: the banner says why, editing stops, and
 *    "Log in again" lands on the login screen with the reason;
 *  - F's first tab, still in the retrospective, is cut too for a moment, then
 *    adopts the new token the second tab stored and is live again — the
 *    revoked banner may flash first, so the test waits for "Live" rather than
 *    asserting the banner never shows;
 *  - F's second tab reloads and is still signed in (the new token was saved);
 *  - the invitation link from before the change no longer opens the team.
 *
 * The unit and socket suites hold each rule on its own
 * (`sessionRevocationRoutes`, `socketSessionRevocation`,
 * `sessionRevocationClient`, `appSessionRevoked`); this is the one place the
 * real browser, the real server and the real socket run them together.
 */

const TEAM_NAME = `E2E-Revocation-${Date.now()}`;
const OLD_PASSWORD = 'revocation-old-password';
const NEW_PASSWORD = 'revocation-new-password';
const PARTICIPANT_NAME = 'Pat Revoked';

const addCard = async (page: Page, text: string) => {
  const field = page.locator('textarea[placeholder="Add an idea..."]').first();
  await field.click();
  await field.fill(text);
  await page.keyboard.press('Enter');
};

test.describe('Session revocation on a password change', () => {
  let facilitatorContext: BrowserContext;
  let participantContext: BrowserContext;
  let lateContext: BrowserContext;
  let facilitator: Page;
  let participant: Page;

  test.beforeAll(async ({ browser }) => {
    facilitatorContext = await browser.newContext();
    participantContext = await browser.newContext();
    lateContext = await browser.newContext();
    facilitator = await facilitatorContext.newPage();
    participant = await participantContext.newPage();
  });

  test.afterAll(async () => {
    await facilitatorContext?.close();
    await participantContext?.close();
    await lateContext?.close();
  });

  test('signs out every session opened before the change, but not the facilitator who made it', async () => {
    test.setTimeout(180_000);

    // ---- The team, a retrospective in Brainstorm, and a participant ----
    await facilitator.goto('/');
    await facilitator.waitForLoadState('networkidle');
    await facilitator.getByRole('button', { name: '+ New Team' }).click();
    await facilitator.getByPlaceholder('e.g. Design Team').fill(TEAM_NAME);
    await facilitator.locator('input[type="password"]').fill(OLD_PASSWORD);
    await facilitator.getByLabel('Recovery Email').fill('facilitator@example.com');
    await facilitator.getByRole('button', { name: 'Create & Join' }).click();
    await expect(facilitator.getByText(`${TEAM_NAME} Dashboard`)).toBeVisible({ timeout: 10_000 });
    await dismissAnnouncementsIfPresent(facilitator);

    await facilitator.getByRole('button', { name: 'New Retrospective' }).click();
    await facilitator.locator('text=Start, Stop, Continue').first().click();
    await expect(facilitator.getByRole('heading', { name: 'Icebreaker' })).toBeVisible({ timeout: 10_000 });

    await facilitator.locator('button[title="Invite / Join"]').click();
    await expect(facilitator.getByText('Invite teammates')).toBeVisible();
    await facilitator.getByRole('button', { name: 'CODE & LINK' }).click();
    const linkElement = facilitator.locator('code').first();
    await expect(linkElement).toContainText('?join=', { timeout: 10_000 });
    const inviteUrl = (await linkElement.textContent()) ?? '';
    await facilitator.getByRole('button', { name: 'Done' }).click();

    await participant.goto(inviteUrl);
    await participant.waitForLoadState('networkidle');
    const notInList = participant.getByRole('button', { name: "I'm not in the list" });
    if (await notInList.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await notInList.click();
    }
    const nameField = participant.getByPlaceholder('e.g. John Doe');
    if (await nameField.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await nameField.fill(PARTICIPANT_NAME);
      await participant.getByRole('button', { name: 'Join Retrospective' }).click();
    }
    await expect(participant.getByRole('heading', { name: 'Icebreaker' })).toBeVisible({ timeout: 15_000 });

    await facilitator.getByRole('button', { name: 'Start Session' }).click();
    await expect(facilitator.getByText('Happiness Check')).toBeVisible({ timeout: 5_000 });
    await facilitator.getByRole('button', { name: 'Next Phase' }).click();
    await expect(facilitator.getByText('Review Open Actions')).toBeVisible({ timeout: 5_000 });
    await facilitator.getByRole('button', { name: 'Next Phase' }).click();
    await expect(facilitator.getByRole('heading', { name: 'Brainstorm' })).toBeVisible({ timeout: 5_000 });
    await expect(participant.getByRole('heading', { name: 'Brainstorm' })).toBeVisible({ timeout: 5_000 });

    await addCard(participant, 'Written before the change');
    await expect(facilitator.getByText('Written before the change')).toBeVisible({ timeout: 10_000 });

    // ---- The facilitator changes the password from a second tab ----
    const settingsTab = await facilitatorContext.newPage();
    await settingsTab.goto('/');
    // The saved session restores into the retrospective: leave it first.
    await settingsTab.getByRole('button', { name: 'Leave the retrospective' }).click();
    await expect(settingsTab.getByText(`${TEAM_NAME} Dashboard`)).toBeVisible({ timeout: 10_000 });
    await dismissAnnouncementsIfPresent(settingsTab);
    await settingsTab.getByRole('button', { name: 'Settings' }).click();
    // A restored tab holds a token, not the password, so it asks for it.
    await settingsTab.getByPlaceholder('Current password').fill(OLD_PASSWORD);
    await settingsTab.getByPlaceholder(/^New password/).fill(NEW_PASSWORD);
    await settingsTab.getByPlaceholder('Confirm new password').fill(NEW_PASSWORD);
    await settingsTab.getByRole('button', { name: 'Change Password' }).click();
    await expect(settingsTab.getByText("Password changed. The team's other sessions have been closed.")).toBeVisible({ timeout: 10_000 });

    // ---- The participant is signed out, and told why ----
    const banner = participant.getByRole('alert').filter({ hasText: 'The team password was changed' });
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(participant.locator('textarea[placeholder="Add an idea..."]').first()).toBeDisabled();
    await participant.getByRole('button', { name: 'Log in again' }).click();
    await expect(
      participant.getByRole('status').filter({ hasText: 'The team password was changed, so you were signed out.' })
    ).toBeVisible({ timeout: 10_000 });

    // ---- The facilitator's first tab follows the change and keeps working ----
    await expect(facilitator.getByTitle('Real-time sync active')).toBeVisible({ timeout: 10_000 });
    await addCard(facilitator, 'Written after the change');
    await expect(facilitator.getByText('Written after the change')).toBeVisible({ timeout: 10_000 });

    // ---- The new token was saved: a reload stays signed in ----
    await settingsTab.reload();
    await expect(settingsTab.getByText(`${TEAM_NAME} Dashboard`)).toBeVisible({ timeout: 10_000 });

    // ---- The invitation link from before the change is dead ----
    const late = await lateContext.newPage();
    await late.goto(inviteUrl);
    await expect(late.getByText('Failed to join team - invalid invite link')).toBeVisible({ timeout: 15_000 });
  });
});
