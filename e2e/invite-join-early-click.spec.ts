import { test, expect, Page, BrowserContext } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from './helpers/announcements';

/**
 * The invite-join screen must keep a choice made on its very first frame.
 *
 * TeamLogin initialises that screen (member picker, nothing selected) and used
 * to undo the user's first choice on it twice over: the reset ran one task
 * after the commit that shows the screen, and it re-ran every time the team was
 * re-imported, which happens several times on load (StrictMode, App
 * re-renders). A slow phone hits that window; a test clicking through
 * Playwright's actionability checks never does.
 *
 * So the click here is made from a MutationObserver installed before the page
 * loads, which runs right after the commit that first shows the button —
 * exactly that window, on every run, under the browser's real scheduler. Each
 * half of the fix alone still fails this test; `__tests__/teamLoginJoinChoice
 * .test.tsx` holds the cheap guard for each half.
 */

const TEAM_NAME = `E2E-EarlyClick-${Date.now()}`;
const TEAM_PASSWORD = 'testpass123456';
const PARTICIPANT_NAME = 'Early Clicker';
// Inviting someone by email adds them to the team, which is what makes the
// generic invite link open the member picker rather than a bare name field.
const INVITEE_EMAIL = 'pat.picker@example.com';

test.describe('Invite join — earliest click', () => {
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

  test("keeps the name field when \"I'm not in the list\" is tapped on the first frame", async () => {
    // ---- Team, retro, and a participant member so the picker is offered ----
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

    await facilitator.locator('button[title="Invite / Join"]').click();
    await expect(facilitator.getByText('Invite teammates')).toBeVisible();
    await facilitator
      .getByPlaceholder('e.g. teammate@example.com, other@company.com')
      .fill(INVITEE_EMAIL);
    await facilitator.getByRole('button', { name: 'Send invites' }).click();
    // The invite link is created even when the SMTP send fails in CI
    await expect(facilitator.getByText('Invite links ready')).toBeVisible({ timeout: 10_000 });
    await facilitator.getByRole('button', { name: 'CODE & LINK' }).click();
    const linkElement = facilitator.locator('code').first();
    await expect(linkElement).toContainText('?join=', { timeout: 10_000 });
    const inviteUrl = (await linkElement.textContent()) ?? '';
    await facilitator.getByRole('button', { name: 'Done' }).click();

    // ---- Participant: tap "I'm not in the list" the instant it exists ----
    await participantContext.addInitScript(() => {
      const state = window as unknown as { __earlyClick?: string };
      state.__earlyClick = 'waiting';
      const observer = new MutationObserver(() => {
        const button = Array.from(document.querySelectorAll('button')).find((candidate) =>
          candidate.textContent?.includes("I'm not in the list")
        );
        if (!button) return;
        observer.disconnect();
        state.__earlyClick = 'clicked';
        button.click();
      });
      // The document node itself: an init script runs before <html> exists.
      observer.observe(document, { childList: true, subtree: true });
    });

    await participant.goto(inviteUrl);
    await expect
      .poll(() => participant.evaluate(() => (window as unknown as { __earlyClick?: string }).__earlyClick), {
        timeout: 15_000,
      })
      .toBe('clicked');

    // The click must stick: the name field is offered and the picker is gone.
    const nameField = participant.getByPlaceholder('e.g. John Doe');
    await expect(nameField).toBeVisible();
    await expect(participant.getByRole('group', { name: 'Select Your Name' })).toHaveCount(0);

    // And the participant can actually get in.
    await nameField.fill(PARTICIPANT_NAME);
    await participant.getByRole('button', { name: 'Join Retrospective' }).click();
    await expect(participant.getByRole('heading', { name: 'Icebreaker' })).toBeVisible({ timeout: 15_000 });
    await expect(facilitator.getByText('Participants (2)')).toBeVisible({ timeout: 10_000 });
  });
});
