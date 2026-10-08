import { test, expect, Page, BrowserContext } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from './helpers/announcements';

/**
 * The health check's timer, driven across two browsers. Health checks had no
 * timer; they now render the retrospective's (components/session/SessionTimer),
 * and what only a real browser pair can show is that it is one timer for the
 * whole session: the facilitator runs it, the participant sees the same
 * countdown, and either one can silence the alarm for both.
 *
 * Unit tests pin each rule (__tests__/sessionTimer*.test.ts*,
 * __tests__/healthCheckTimer.test.tsx); this spec is the sync over the real
 * socket and the real server guard, which refuses a participant's write of the
 * facilitator-only `timerInitial`.
 */

const TEAM_NAME = `E2E-HC-Timer-${Date.now()}`;
const TEAM_PASSWORD = 'testpass123456';
const PARTICIPANT_NAME = 'Tim Participant';

const display = (page: Page) => page.locator('header span.font-mono.font-bold.text-lg');

test.describe('Health check timer', () => {
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

  test('one countdown for the whole health check, reset by each phase', async () => {
    await facilitator.goto('/');
    await facilitator.waitForLoadState('networkidle');
    await facilitator.getByRole('button', { name: '+ New Team' }).click();
    await facilitator.getByPlaceholder('e.g. Design Team').fill(TEAM_NAME);
    await facilitator.locator('input[type="password"]').fill(TEAM_PASSWORD);
    await facilitator.getByRole('button', { name: 'Create & Join' }).click();
    await expect(facilitator.getByText(`${TEAM_NAME} Dashboard`)).toBeVisible({ timeout: 10_000 });
    await dismissAnnouncementsIfPresent(facilitator);

    await facilitator.getByRole('button', { name: 'Health Checks' }).click();
    await facilitator.getByText('START HEALTH CHECK').click();
    await facilitator.getByRole('button', { name: 'Start Health Check', exact: true }).click();
    await expect(facilitator.getByText('Rate each health dimension')).toBeVisible({ timeout: 10_000 });

    // A new health check starts stopped at the Survey's timebox.
    await expect(display(facilitator)).toHaveText('7:00');

    // Invite the participant.
    await facilitator.locator('button[title="Invite / Join"]').click();
    await facilitator.getByRole('button', { name: 'CODE & LINK' }).click();
    const linkElement = facilitator.locator('code').first();
    await expect(linkElement).toContainText('?join=', { timeout: 10_000 });
    const inviteUrl = (await linkElement.textContent()) ?? '';
    await facilitator.getByRole('button', { name: 'Done' }).click();

    await participant.goto(inviteUrl);
    await participant.waitForLoadState('networkidle');
    const joinHeading = participant.getByText(`Join ${TEAM_NAME}`);
    const surveyHeading = participant.getByText('Rate each health dimension');
    const entry = await Promise.race([
      joinHeading.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'JOIN' as const),
      surveyHeading.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'AUTO_JOIN' as const)
    ]);
    if (entry === 'JOIN') {
      const notInList = participant.getByRole('button', { name: "I'm not in the list" });
      if (await notInList.isVisible({ timeout: 2_000 }).catch(() => false)) await notInList.click();
      await participant.getByPlaceholder('e.g. John Doe').fill(PARTICIPANT_NAME);
      await participant.getByRole('button', { name: 'Join Retrospective' }).click();
    }
    await expect(surveyHeading).toBeVisible({ timeout: 15_000 });

    // The participant sees the time but does not run it.
    await expect(display(participant)).toHaveText('7:00');
    await expect(participant.getByRole('button', { name: 'Start timer' })).toHaveCount(0);

    // The facilitator starts it; both browsers count down the same run.
    await facilitator.getByRole('button', { name: 'Start timer' }).click();
    await expect(display(facilitator)).toHaveText(/^6:5\d$/, { timeout: 5_000 });
    await expect(display(participant)).toHaveText(/^6:5\d$/, { timeout: 5_000 });

    // Paused, both settle on the same value and stay there.
    await facilitator.getByRole('button', { name: 'Pause timer', exact: true }).click();
    await expect(facilitator.getByRole('button', { name: 'Start timer' })).toBeVisible();
    const paused = (await display(facilitator).textContent()) ?? '';
    await expect(display(participant)).toHaveText(paused, { timeout: 5_000 });
    await facilitator.waitForTimeout(1_500);
    await expect(display(facilitator)).toHaveText(paused);
    await expect(display(participant)).toHaveText(paused);

    // Set it from the keyboard: the time is a button, the editor takes focus,
    // and Enter saves.
    await facilitator.getByRole('button', { name: `Set the timer (${paused})` }).focus();
    await facilitator.keyboard.press('Enter');
    const minutes = facilitator.getByRole('textbox', { name: 'Minutes' });
    await expect(minutes).toBeFocused();
    await minutes.fill('0');
    await facilitator.getByRole('textbox', { name: 'Seconds' }).fill('3');
    await facilitator.keyboard.press('Enter');
    await expect(display(facilitator)).toHaveText('0:03');
    await expect(display(participant)).toHaveText('0:03', { timeout: 5_000 });

    // Let it run out: the alarm is pending in both browsers, and the
    // participant silences it for everyone.
    await facilitator.getByRole('button', { name: 'Start timer' }).click();
    const stopAlarm = participant.getByRole('button', { name: /^Time is up \(0:00\): stop the alarm$/ });
    await expect(stopAlarm).toBeVisible({ timeout: 10_000 });
    await expect(facilitator.getByRole('button', { name: /^Time is up \(0:00\): stop the alarm$/ })).toBeVisible({ timeout: 5_000 });
    await stopAlarm.click();
    await expect(facilitator.getByRole('button', { name: /^Time is up \(0:00\): stop the alarm$/ })).toHaveCount(0, { timeout: 5_000 });
    await expect(display(facilitator)).toHaveText('0:03');
    await expect(display(participant)).toHaveText('0:03');

    // Each phase starts at its own timebox, for everyone.
    await facilitator.getByRole('button', { name: 'Next: Discuss' }).click();
    await expect(display(facilitator)).toHaveText('8:00', { timeout: 5_000 });
    await expect(display(participant)).toHaveText('8:00', { timeout: 5_000 });
  });
});
