import { test, expect, Page, BrowserContext } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from './helpers/announcements';

/**
 * E2E coverage for the personal vote recap of the Discuss phase.
 *
 * The unit suite drives `DiscussPhase` with a hand-built topic list, so it
 * cannot see the seam this spec guards: that the votes really cast in the Vote
 * phase reach the recap, that each participant sees *their own* votes and not
 * their teammate's, and that a topic nobody else backed is flagged as such.
 */

const TEAM_NAME = `E2E-Recap-${Date.now()}`;
const TEAM_PASSWORD = 'testpass123456';
const PARTICIPANT_NAME = 'Alice Participant';

const waitForSync = (ms = 1500) => new Promise((r) => setTimeout(r, ms));

/** The vote card carrying a given topic: the closest ancestor holding a "+" button. */
const voteCard = (page: Page, text: string) =>
  page.locator(
    `xpath=//*[normalize-space(text())="${text}"]/ancestor::div[.//span[normalize-space(text())="add"]][1]`
  );

const addVotes = async (page: Page, text: string, times: number) => {
  const plus = voteCard(page, text).locator('span.material-symbols-outlined:text-is("add")');
  for (let i = 0; i < times; i++) {
    await plus.click();
    await waitForSync(400);
  }
};

test.describe('Discuss phase - personal vote recap', () => {
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

  test('each participant sees where their own votes went', async () => {
    // ---- Team + retro ----
    await facilitator.goto('/');
    await facilitator.waitForLoadState('networkidle');
    await facilitator.getByRole('button', { name: '+ New Team' }).click();
    await facilitator.getByPlaceholder('e.g. Design Team').fill(TEAM_NAME);
    await facilitator.locator('input[type="password"]').fill(TEAM_PASSWORD);
    await facilitator.getByRole('button', { name: 'Create & Join' }).click();
    await expect(facilitator.getByText(`${TEAM_NAME} Dashboard`)).toBeVisible({ timeout: 15_000 });
    await dismissAnnouncementsIfPresent(facilitator);

    await facilitator.getByRole('button', { name: 'New Retrospective' }).click();
    await facilitator.locator('text=Start, Stop, Continue').first().click();
    await expect(facilitator.getByRole('heading', { name: 'Icebreaker' })).toBeVisible({ timeout: 15_000 });

    // ---- A second participant joins through the invite link ----
    await facilitator.locator('button[title="Invite / Join"]').click();
    await facilitator.getByRole('button', { name: 'CODE & LINK' }).click();
    const linkElement = facilitator.locator('code').first();
    await expect(linkElement).toContainText('?join=', { timeout: 15_000 });
    const inviteUrl = (await linkElement.textContent()) ?? '';
    await facilitator.getByRole('button', { name: 'Done' }).click();

    await participant.goto(inviteUrl);
    const joinHeading = participant.getByText(`Join ${TEAM_NAME}`);
    const icebreakerHeading = participant.getByRole('heading', { name: 'Icebreaker' });
    const entryMode = await Promise.race([
      joinHeading.waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'JOIN' as const),
      icebreakerHeading.waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'AUTO_JOIN' as const)
    ]);
    if (entryMode === 'JOIN') {
      const notInListButton = participant.getByRole('button', { name: "I'm not in the list" });
      if (await notInListButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await notInListButton.click();
      }
      await participant.getByPlaceholder('e.g. John Doe').fill(PARTICIPANT_NAME);
      await participant.getByRole('button', { name: 'Join Retrospective' }).click();
    }
    await expect(icebreakerHeading).toBeVisible({ timeout: 20_000 });

    // ---- Brainstorm: three topics across three columns ----
    await facilitator.locator('.phase-nav-btn', { hasText: 'BRAINSTORM' }).click();
    const textareas = facilitator.locator('textarea[placeholder="Add an idea..."]');
    const ideas: [number, string][] = [
      [0, 'Automate the deploy pipeline'],
      [1, 'Manual release steps every Friday'],
      [2, 'Keep the Wednesday demo']
    ];
    for (const [column, text] of ideas) {
      await textareas.nth(column).click();
      await textareas.nth(column).fill(text);
      await facilitator.keyboard.press('Enter');
      await waitForSync(600);
    }

    // ---- Vote: the facilitator backs two topics, one of them alone ----
    await facilitator.locator('.phase-nav-btn', { hasText: 'VOTE' }).click();
    await waitForSync();
    await addVotes(facilitator, 'Automate the deploy pipeline', 2);
    await addVotes(facilitator, 'Keep the Wednesday demo', 1);
    await waitForSync();

    await addVotes(participant, 'Automate the deploy pipeline', 2);
    await addVotes(participant, 'Manual release steps every Friday', 3);
    await waitForSync(2500);

    // ---- Discuss: the recap reflects the votes each user actually cast ----
    await facilitator.locator('.phase-nav-btn', { hasText: 'DISCUSS' }).click();
    await expect(facilitator.getByText('Discuss & Propose Actions')).toBeVisible({ timeout: 15_000 });

    const facilitatorRecap = facilitator.getByTestId('my-votes-recap');
    await expect(facilitatorRecap).toBeVisible({ timeout: 15_000 });
    await expect(facilitatorRecap).toContainText('3 votes');
    await expect(facilitatorRecap).toContainText('2 topics');
    await expect(facilitatorRecap).toContainText('Automate the deploy pipeline');
    await expect(facilitatorRecap).toContainText('Keep the Wednesday demo');
    // The topic the facilitator never voted for stays out of their recap
    await expect(facilitatorRecap).not.toContainText('Manual release steps every Friday');
    // Their solo topic is flagged, the shared one is not
    await expect(facilitatorRecap.getByTestId('my-votes-recap-only-mine')).toHaveCount(1);

    // The cards carry the same personal marks
    await expect(facilitator.getByTestId('topic-my-votes')).toHaveCount(2);
    await expect(facilitator.getByTestId('topic-my-votes').first()).toContainText('Your 2 votes');
    await expect(facilitator.getByTestId('topic-only-mine')).toHaveCount(1);

    // ---- The participant sees their own votes, not the facilitator's ----
    const participantRecap = participant.getByTestId('my-votes-recap');
    await expect(participantRecap).toBeVisible({ timeout: 15_000 });
    await expect(participantRecap).toContainText('5 votes');
    await expect(participantRecap).toContainText('2 topics');
    await expect(participantRecap).toContainText('Manual release steps every Friday');
    await expect(participantRecap).not.toContainText('Keep the Wednesday demo');
    await expect(participant.getByTestId('topic-my-votes')).toHaveCount(2);

    // ---- The recap collapses so the topic list can take the whole screen ----
    await participant.setViewportSize({ width: 390, height: 844 });
    const toggle = participant.getByTestId('my-votes-recap-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(participant.getByTestId('my-votes-recap-row')).toHaveCount(0);
    // The headline survives the collapse
    await expect(participantRecap).toContainText('5 votes');
  });
});
