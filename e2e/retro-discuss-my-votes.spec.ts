import { test, expect, Page, BrowserContext } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from './helpers/announcements';

/**
 * E2E coverage for the "your votes" badge of the Discuss phase.
 *
 * The unit suite drives `DiscussPhase` with a hand-built topic list, so it
 * cannot see the seam this spec guards: that the votes really cast in the Vote
 * phase reach the Discuss cards, and that each participant is shown *their
 * own* vote counts rather than their teammate's.
 */

const TEAM_NAME = `E2E-MyVotes-${Date.now()}`;
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

test.describe('Discuss phase - your own vote count per topic', () => {
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

  test('each participant sees their own vote count on the topics they backed', async () => {
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

    // ---- Discuss: each card carries the reader's own vote count ----
    await facilitator.locator('.phase-nav-btn', { hasText: 'DISCUSS' }).click();
    await expect(facilitator.getByText('Discuss & Propose Actions')).toBeVisible({ timeout: 15_000 });

    // The facilitator backed two topics: 2 votes on one, 1 on the other.
    const facilitatorBadges = facilitator.getByTestId('topic-my-votes');
    await expect(facilitatorBadges).toHaveCount(2, { timeout: 15_000 });
    await expect(facilitatorBadges.first()).toContainText('Your 2 votes');
    await expect(facilitatorBadges.last()).toContainText('Your 1 vote');

    // The topic they never voted for carries no badge of theirs: the card is
    // on screen (it has votes from the other participant) but unmarked.
    const untouchedCard = facilitator
      .locator('xpath=//*[normalize-space(text())="Manual release steps every Friday"]/ancestor::div[contains(@class,"rounded-xl")][1]');
    await expect(untouchedCard).toBeVisible();
    await expect(untouchedCard.getByTestId('topic-my-votes')).toHaveCount(0);

    // ---- The participant sees their own counts, not the facilitator's ----
    const participantBadges = participant.getByTestId('topic-my-votes');
    await expect(participantBadges).toHaveCount(2, { timeout: 15_000 });
    await expect(participantBadges.first()).toContainText('Your 2 votes');
    await expect(participantBadges.last()).toContainText('Your 3 votes');

    // ---- The badge stays readable on a phone ----
    await participant.setViewportSize({ width: 390, height: 844 });
    await expect(participantBadges.first()).toBeVisible();
  });
});
