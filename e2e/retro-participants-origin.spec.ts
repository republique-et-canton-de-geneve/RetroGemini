import { test, expect, Page, BrowserContext } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from './helpers/announcements';

/**
 * E2E coverage for the participants-panel and cross-column grouping features:
 * 1. Email invites show up as "Invited · waiting to join" in the panel
 * 2. A joined participant can be marked as "left" by the facilitator
 *    (badge shown, counters exclude them) and marked as returned
 * 3. Grouping a ticket into another column shows its origin column badge
 *    in the Group phase and keeps it visible in Discuss
 */

const TEAM_NAME = `E2E-Panel-${Date.now()}`;
const TEAM_PASSWORD = 'testpass123';
const PARTICIPANT_NAME = 'Alice Participant';
const INVITEE_EMAIL = 'zoe.waiting@example.com';

const waitForSync = (ms = 2000) => new Promise(r => setTimeout(r, ms));

test.describe('Participants panel & cross-column grouping', () => {
  let facilitatorContext: BrowserContext;
  let participantContext: BrowserContext;
  let facilitator: Page;
  let participant: Page;

  test.beforeAll(async ({ browser }) => {
    facilitatorContext = await browser.newContext();
    participantContext = await browser.newContext();
    facilitator = await facilitatorContext.newPage();
    participant = await participantContext.newPage();
  });

  test.afterAll(async () => {
    await facilitatorContext?.close();
    await participantContext?.close();
  });

  test('invited section, left-participant marking and origin column badge', async () => {
    // ---- Create team + retro ----
    await facilitator.goto('/');
    await facilitator.waitForLoadState('networkidle');
    await facilitator.getByRole('button', { name: '+ New Team' }).click();
    await facilitator.getByPlaceholder('e.g. Design Team').fill(TEAM_NAME);
    await facilitator.locator('input[type="password"]').fill(TEAM_PASSWORD);
    await facilitator.getByRole('button', { name: 'Create & Join' }).click();
    await expect(facilitator.getByText(`${TEAM_NAME} Dashboard`)).toBeVisible({ timeout: 10_000 });
    await dismissAnnouncementsIfPresent(facilitator);

    await facilitator.getByRole('button', { name: 'New Retrospective' }).click();
    await facilitator.locator('text=Start, Stop, Continue').first().click();
    await expect(facilitator.getByRole('heading', { name: 'Icebreaker' })).toBeVisible({ timeout: 10_000 });

    // ---- Invite by email: the invitee appears as "waiting to join" ----
    await facilitator.locator('button[title="Invite / Join"]').click();
    await expect(facilitator.getByText('Invite teammates')).toBeVisible();

    // EMAIL tab is the default: type an address and send
    await facilitator
      .getByPlaceholder('e.g. teammate@example.com, other@company.com')
      .fill(INVITEE_EMAIL);
    await facilitator.getByRole('button', { name: 'Send invites' }).click();
    // The invite link is created even when the SMTP send fails in CI
    await expect(facilitator.getByText('Invite links ready')).toBeVisible({ timeout: 10_000 });

    // Grab the generic invite link for the participant before closing. It is
    // generated asynchronously (the client fetches an invite credential from
    // the server), so wait until it is rendered.
    await facilitator.getByRole('button', { name: 'CODE & LINK' }).click();
    const linkElement = facilitator.locator('code').first();
    await expect(linkElement).toContainText('?join=', { timeout: 10_000 });
    const inviteUrl = (await linkElement.textContent()) ?? '';
    await facilitator.getByRole('button', { name: 'Done' }).click();

    // Participants panel now lists the invitee as waiting to join
    const invitedSection = facilitator.getByTestId('invited-section');
    await expect(invitedSection).toBeVisible({ timeout: 10_000 });
    await expect(invitedSection).toContainText('waiting to join (1)');
    await expect(invitedSection).toContainText('zoe.waiting');

    // ---- Participant joins via the invite link ----
    await participant.goto(inviteUrl);
    const joinHeading = participant.getByText(`Join ${TEAM_NAME}`);
    const icebreakerHeading = participant.getByRole('heading', { name: 'Icebreaker' });
    const entryMode = await Promise.race([
      joinHeading.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'JOIN' as const),
      icebreakerHeading.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'AUTO_JOIN' as const)
    ]);
    if (entryMode === 'JOIN') {
      const notInListButton = participant.getByRole('button', { name: "I'm not in the list" });
      if (await notInListButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await notInListButton.click();
      }
      await participant.getByPlaceholder('e.g. John Doe').fill(PARTICIPANT_NAME);
      await participant.getByRole('button', { name: 'Join Retrospective' }).click();
    }
    await expect(icebreakerHeading).toBeVisible({ timeout: 15_000 });
    await waitForSync();

    // The joined participant is listed; the invitee is still pending
    await expect(facilitator.getByText('Participants (2)')).toBeVisible({ timeout: 10_000 });
    await expect(facilitator.getByTestId('invited-section')).toContainText('waiting to join (1)');

    // ---- Facilitator marks the participant as having left ----
    const participantRow = facilitator
      .getByTestId('participant-row')
      .filter({ hasText: PARTICIPANT_NAME });
    await participantRow.hover();
    await participantRow.getByTestId('toggle-left-btn').click();
    await waitForSync();

    await expect(facilitator.getByText('Left the session')).toBeVisible({ timeout: 10_000 });
    // Header counter now only counts the facilitator
    await expect(facilitator.getByText('Participants (1)')).toBeVisible({ timeout: 10_000 });
    // The participant sees their own departed status in the panel too? The
    // panel is collapsed for participants by default, so we assert on the
    // facilitator side only.

    // ---- Mark them as returned ----
    await participantRow.hover();
    await participantRow.getByTestId('toggle-left-btn').click();
    await waitForSync();
    await expect(facilitator.getByText('Participants (2)')).toBeVisible({ timeout: 10_000 });
    await expect(facilitator.getByText('Left the session')).toHaveCount(0);

    // ---- Cross-column grouping: origin badge ----
    // Jump straight to Brainstorm using the phase navigation
    await facilitator.locator('.phase-nav-btn', { hasText: 'BRAINSTORM' }).click();
    await expect(facilitator.locator('span.font-bold').filter({ hasText: 'Brainstorm' })).toBeVisible({ timeout: 10_000 });

    const textareas = facilitator.locator('textarea[placeholder="Add an idea..."]');
    await textareas.nth(0).click();
    await textareas.nth(0).fill('Automate the deploys');
    await facilitator.keyboard.press('Enter');
    await waitForSync(800);
    await textareas.nth(1).click();
    await textareas.nth(1).fill('Manual release steps');
    await facilitator.keyboard.press('Enter');
    await waitForSync(800);

    // Group phase: drag the "Stop" ticket onto the "Start" ticket
    await facilitator.locator('.phase-nav-btn', { hasText: 'GROUP' }).click();
    await expect(facilitator.locator('span.font-bold').filter({ hasText: 'Group Ideas' })).toBeVisible({ timeout: 10_000 });

    const sourceCard = facilitator.getByText('Manual release steps');
    const targetCard = facilitator.getByText('Automate the deploys');
    await sourceCard.dragTo(targetCard);
    await waitForSync();

    // The moved ticket now displays its origin column
    const facilitatorBadge = facilitator.getByTestId('ticket-origin-badge');
    await expect(facilitatorBadge.first()).toBeVisible({ timeout: 10_000 });
    await expect(facilitatorBadge.first()).toContainText('from Stop');

    // The other participant sees the origin badge too
    await expect(participant.getByTestId('ticket-origin-badge').first()).toBeVisible({ timeout: 10_000 });
    await expect(participant.getByTestId('ticket-origin-badge').first()).toContainText('from Stop');

    // ---- The origin stays visible in the Discuss phase ----
    await facilitator.locator('.phase-nav-btn', { hasText: 'DISCUSS' }).click();
    await expect(facilitator.getByText('Discuss & Propose Actions')).toBeVisible({ timeout: 10_000 });
    await expect(facilitator.getByTestId('ticket-origin-badge').first()).toBeVisible({ timeout: 10_000 });
    await expect(facilitator.getByTestId('ticket-origin-badge').first()).toContainText('from Stop');
  });
});
