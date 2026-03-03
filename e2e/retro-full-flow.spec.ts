import { test, expect, Page, BrowserContext } from '@playwright/test';

/**
 * Full retrospective E2E flow:
 * 1. Create team
 * 2. Create "Start, Stop, Continue" retro
 * 3. Invite participant (second browser context)
 * 4. Icebreaker: verify sync when facilitator changes question
 * 5. Welcome: vote happiness, reveal, verify both counted
 * 6. Brainstorm: add tickets, Reveal Cards toggle, Color by Topic
 * 7. Group: drag to group, verify sync both sides
 * 8. Vote: test voting + 1-vote-per-item
 * 9. Discuss: propose action, vote on proposal, accept
 * 10. Review: verify action present, assign to participant
 * 11. Close: both vote ROTI, reveal results
 */

const TEAM_NAME = `E2E-Team-${Date.now()}`;
const TEAM_PASSWORD = 'testpass123';
const PARTICIPANT_NAME = 'Alice Participant';

// Helper: wait for WebSocket sync to propagate (session-update event)
const waitForSync = (ms = 2000) => new Promise(r => setTimeout(r, ms));

test.describe('Full Retrospective Flow', () => {
  let facilitatorContext: BrowserContext;
  let participantContext: BrowserContext;
  let facilitator: Page;
  let participant: Page;

  test.beforeAll(async ({ browser }) => {
    facilitatorContext = await browser.newContext({
      recordVideo: {
        dir: 'test-results/videos/facilitator',
      },
    });
    participantContext = await browser.newContext({
      recordVideo: {
        dir: 'test-results/videos/participant',
      },
    });
    facilitator = await facilitatorContext.newPage();
    participant = await participantContext.newPage();
  });

  test.afterAll(async () => {
    await facilitatorContext?.close();
    await participantContext?.close();
  });

  test('Complete retro session with facilitator and participant', async () => {
    // ================================================================
    // STEP 1: Create Team
    // ================================================================
    await facilitator.goto('/');
    await facilitator.waitForLoadState('networkidle');

    // Click "+ New Team"
    await facilitator.getByRole('button', { name: '+ New Team' }).click();
    await expect(facilitator.getByRole('heading', { name: 'Create New Team' })).toBeVisible();

    // Fill team creation form
    await facilitator.getByPlaceholder('e.g. Design Team').fill(TEAM_NAME);
    // Password placeholder uses Unicode bullet dots
    await facilitator.locator('input[type="password"]').fill(TEAM_PASSWORD);

    // Submit
    await facilitator.getByRole('button', { name: 'Create & Join' }).click();

    // Should land on dashboard
    await expect(facilitator.getByText(`${TEAM_NAME} Dashboard`)).toBeVisible({ timeout: 10_000 });

    // Dismiss "What's New" announcement modal if it appears
    const gotItButton = facilitator.getByRole('button', { name: 'Got it!' });
    if (await gotItButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await gotItButton.click();
      await facilitator.waitForTimeout(500);
    }

    // ================================================================
    // STEP 2: Create "Start, Stop, Continue" Retro
    // ================================================================
    await facilitator.getByRole('button', { name: 'New Retrospective' }).click();
    await expect(facilitator.getByRole('heading', { name: 'Start New Retrospective' })).toBeVisible();

    // Click the "Start, Stop, Continue" template
    await facilitator.locator('text=Start, Stop, Continue').first().click();

    // Should be in session at ICEBREAKER phase
    await expect(facilitator.getByRole('heading', { name: 'Icebreaker' })).toBeVisible({ timeout: 10_000 });

    // ================================================================
    // STEP 3: Get invite link and open participant browser
    // ================================================================
    // Open invite modal
    await facilitator.locator('button[title="Invite / Join"]').click();
    await expect(facilitator.getByText('Invite teammates')).toBeVisible();

    // Switch to CODE & LINK tab
    await facilitator.getByRole('button', { name: 'CODE & LINK' }).click();
    await facilitator.waitForTimeout(1000);

    // Get the invite link from the code element
    const linkElement = facilitator.locator('code').first();
    const inviteUrl = await linkElement.textContent() ?? '';
    expect(inviteUrl).toContain('?join=');

    // Close the modal
    await facilitator.getByRole('button', { name: 'Done' }).click();

    // Navigate participant to the invite URL
    await participant.goto(inviteUrl);
    await participant.waitForLoadState('networkidle');

    // Participant should see the Join view
    await expect(participant.getByText(`Join ${TEAM_NAME}`)).toBeVisible({ timeout: 10_000 });

    // Participant enters their name (if member list shown, click "I'm not in the list" first)
    const notInListButton = participant.getByRole('button', { name: "I'm not in the list" });
    if (await notInListButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await notInListButton.click();
    }
    await participant.getByPlaceholder('e.g. John Doe').fill(PARTICIPANT_NAME);
    await participant.getByRole('button', { name: 'Join Retrospective' }).click();

    // Participant should be in the session at ICEBREAKER phase
    await expect(participant.getByRole('heading', { name: 'Icebreaker' })).toBeVisible({ timeout: 10_000 });

    // ================================================================
    // STEP 4: Icebreaker - Verify sync when facilitator changes question
    // ================================================================
    const facilitatorIcebreakerInput = facilitator.getByTestId('icebreaker-question-input');
    const participantIcebreakerDisplay = participant.getByTestId('icebreaker-question-display');

    // Facilitator clicks "Random" to get a new icebreaker question
    await facilitator.getByRole('button', { name: 'Random' }).click();

    // Get the question shown on facilitator side and ensure participant receives the same value
    const facilitatorQuestion = await facilitatorIcebreakerInput.inputValue();
    expect(facilitatorQuestion.length).toBeGreaterThan(0);
    await expect(participantIcebreakerDisplay).toHaveText(facilitatorQuestion, { timeout: 10_000 });

    // Facilitator types a custom question and verify real-time sync to participant
    const customQuestion = `bonjour from facilitator ${Date.now()}`;
    await facilitatorIcebreakerInput.fill(customQuestion);
    await expect(facilitatorIcebreakerInput).toHaveValue(customQuestion);
    await expect(participantIcebreakerDisplay).toHaveText(customQuestion, { timeout: 10_000 });

    // Facilitator edits the question again and ensure participant reflects the latest value
    const updatedCustomQuestion = `${customQuestion} (updated)`;
    await facilitatorIcebreakerInput.fill(updatedCustomQuestion);
    await expect(participantIcebreakerDisplay).toHaveText(updatedCustomQuestion, { timeout: 10_000 });
    await expect(participantIcebreakerDisplay).not.toHaveText(customQuestion, { timeout: 10_000 });

    // Facilitator starts the session (advances to WELCOME)
    await facilitator.getByRole('button', { name: 'Start Session' }).click();

    // ================================================================
    // STEP 5: Welcome Phase - Vote happiness, reveal, verify both counted
    // ================================================================
    await expect(facilitator.getByText('Happiness Check')).toBeVisible({ timeout: 5_000 });
    await expect(participant.getByText('Happiness Check')).toBeVisible({ timeout: 5_000 });

    // Facilitator votes happiness (score 4 - partly sunny emoji)
    // The 5 emoji buttons have class text-6xl and are ordered scores 1-5
    const facilitatorEmojiButtons = facilitator.locator('button.text-6xl');
    await facilitatorEmojiButtons.nth(3).click(); // Score 4

    // Participant votes happiness (score 5 - sun emoji)
    const participantEmojiButtons = participant.locator('button.text-6xl');
    await participantEmojiButtons.nth(4).click(); // Score 5

    await waitForSync();

    // Verify vote count shows 2/2 voted
    await expect(facilitator.getByText('2 / 2 voted')).toBeVisible({ timeout: 5_000 });

    // Facilitator reveals results
    await facilitator.getByRole('button', { name: 'Reveal Results' }).click();
    await waitForSync();

    // Both should see the results with "2 / 2 participants voted"
    await expect(facilitator.getByText('2 / 2 participants voted')).toBeVisible({ timeout: 5_000 });
    await expect(participant.getByText('2 / 2 participants voted')).toBeVisible({ timeout: 5_000 });

    // Move to next phase (OPEN_ACTIONS)
    await facilitator.getByRole('button', { name: 'Next Phase' }).click();

    // ================================================================
    // STEP 5b: Open Actions Phase - Skip (no previous actions)
    // ================================================================
    await expect(facilitator.getByText('Review Open Actions')).toBeVisible({ timeout: 5_000 });
    await facilitator.getByRole('button', { name: 'Next Phase' }).click();

    // ================================================================
    // STEP 6: Brainstorm Phase
    // ================================================================
    await expect(facilitator.locator('span.font-bold').filter({ hasText: 'Brainstorm' })).toBeVisible({ timeout: 5_000 });
    await expect(participant.locator('span.font-bold').filter({ hasText: 'Brainstorm' })).toBeVisible({ timeout: 5_000 });

    // Add tickets as facilitator in "Start" column (first textarea)
    const facilitatorTextareas = facilitator.locator('textarea[placeholder="Add an idea..."]');
    await facilitatorTextareas.nth(0).click();
    await facilitatorTextareas.nth(0).fill('Keep doing daily standups');
    await facilitator.keyboard.press('Enter');
    await waitForSync(800);

    // Add ticket in "Stop" column (second textarea)
    await facilitatorTextareas.nth(1).click();
    await facilitatorTextareas.nth(1).fill('Stop long meetings');
    await facilitator.keyboard.press('Enter');
    await waitForSync(800);

    // Add ticket as participant in "Start" column (first textarea)
    const participantTextareas = participant.locator('textarea[placeholder="Add an idea..."]');
    await participantTextareas.nth(0).click();
    await participantTextareas.nth(0).fill('Start code reviews');
    await participant.keyboard.press('Enter');
    await waitForSync(800);

    // Add ticket in "Continue" column (third textarea)
    await participantTextareas.nth(2).click();
    await participantTextareas.nth(2).fill('Continue pair programming');
    await participant.keyboard.press('Enter');
    await waitForSync();

    // REVEAL CARDS toggle test
    const revealLabel = facilitator.locator('label').filter({ hasText: 'Reveal cards' });
    const revealCheckbox = revealLabel.locator('input[type="checkbox"]');
    await revealCheckbox.check();
    await waitForSync();

    // Verify participant can see facilitator's tickets (not blurred)
    await expect(participant.getByText('Keep doing daily standups')).toBeVisible({ timeout: 5_000 });
    await expect(participant.getByText('Stop long meetings')).toBeVisible({ timeout: 5_000 });

    // Uncheck to hide cards again
    await revealCheckbox.uncheck();
    await waitForSync();

    // When unrevealed, tickets from other users have the ticket-blur class
    const blurredTickets = participant.locator('.ticket-blur');
    const blurCount = await blurredTickets.count();
    expect(blurCount).toBeGreaterThan(0);

    // COLOR BY test: change to Author then back to Topic
    const colorBySelect = facilitator.locator('select').first();
    await colorBySelect.selectOption('author');
    await waitForSync(500);
    await colorBySelect.selectOption('topic');
    await waitForSync(500);

    // Re-reveal cards for subsequent phases
    await revealCheckbox.check();
    await waitForSync();

    // Move to Group phase
    await facilitator.getByRole('button', { name: 'Next Phase' }).click();

    // ================================================================
    // STEP 7: Group Phase - Group tickets and verify sync
    // ================================================================
    await expect(facilitator.locator('span.font-bold').filter({ hasText: 'Group Ideas' })).toBeVisible({ timeout: 5_000 });
    await expect(participant.locator('span.font-bold').filter({ hasText: 'Group Ideas' })).toBeVisible({ timeout: 5_000 });

    // All tickets should be visible to both in GROUP phase
    await expect(facilitator.getByText('Keep doing daily standups')).toBeVisible({ timeout: 5_000 });
    await expect(facilitator.getByText('Start code reviews')).toBeVisible({ timeout: 5_000 });

    // Group tickets using drag and drop: drag "Start code reviews" onto "Keep doing daily standups"
    const sourceCard = facilitator.getByText('Start code reviews');
    const targetCard = facilitator.getByText('Keep doing daily standups');
    await sourceCard.dragTo(targetCard);
    await waitForSync();

    // A group should now exist - verify "Name this group..." placeholder appears
    const groupNameInput = facilitator.locator('input[placeholder="Name this group..."]').first();
    await expect(groupNameInput).toBeVisible({ timeout: 5_000 });

    // Name the group (type character by character to trigger onChange syncing)
    await groupNameInput.click();
    await groupNameInput.fill('Good Practices');
    await facilitator.keyboard.press('Enter');
    await waitForSync(3000);

    // Verify participant sees the group and its name
    // In GROUP mode, the title is in an <input> element
    await expect(participant.locator('input[value="Good Practices"]')).toBeVisible({ timeout: 10_000 });

    // Verify both tickets are visible in the group on participant side
    await expect(participant.getByText('Keep doing daily standups')).toBeVisible();
    await expect(participant.getByText('Start code reviews')).toBeVisible();

    // Move to Vote phase
    await facilitator.getByRole('button', { name: 'Next Phase' }).click();

    // ================================================================
    // STEP 8: Vote Phase - Test voting and 1-vote-per-item
    // ================================================================
    await expect(facilitator.locator('span.font-bold').filter({ hasText: 'Vote' })).toBeVisible({ timeout: 5_000 });
    await expect(participant.getByText('votes remaining')).toBeVisible({ timeout: 5_000 });

    // Ensure both sides are voting on the same content
    await expect(facilitator.getByText('Good Practices')).toBeVisible({ timeout: 5_000 });
    await expect(participant.getByText('Good Practices')).toBeVisible({ timeout: 5_000 });
    await expect(participant.getByText('Stop long meetings')).toBeVisible({ timeout: 5_000 });

    // Enable "1 vote/item" checkbox
    const oneVoteLabel = facilitator.locator('label').filter({ hasText: '1 vote/item' });
    await oneVoteLabel.locator('input[type="checkbox"]').check();
    await waitForSync();

    // Vote on the group "Good Practices" as facilitator
    // The group container has border-dashed class; find the add (vote+) button inside it
    const facilitatorGroupContainer = facilitator.locator('.border-dashed').filter({ hasText: 'Good Practices' }).first();
    const facilitatorGroupAddBtn = facilitatorGroupContainer.locator('button:has(span:text("add"))').last();
    await facilitatorGroupAddBtn.click();
    await waitForSync(800);

    // With 1-vote-per-item, the add button should now be disabled for this group
    await expect(facilitatorGroupAddBtn).toBeDisabled();

    // Participant votes on "Stop long meetings" (ungrouped ticket)
    const stopMeetingsText = participant.getByText('Stop long meetings');
    const stopMeetingsCard = stopMeetingsText.locator('xpath=ancestor::div[contains(@class, "shadow-sm")]').first();
    const participantTicketAdd = stopMeetingsCard.locator('button:has(span:text("add"))');
    await participantTicketAdd.click();
    await waitForSync(800);

    // Remaining vote counters should reflect each user's own votes
    await expect(facilitator.getByText('4 votes remaining')).toBeVisible({ timeout: 5_000 });
    await expect(participant.getByText('4 votes remaining')).toBeVisible({ timeout: 5_000 });

    // Participant also votes on "Continue pair programming"
    const pairProgText = participant.getByText('Continue pair programming');
    const pairProgCard = pairProgText.locator('xpath=ancestor::div[contains(@class, "shadow-sm")]').first();
    const pairProgAdd = pairProgCard.locator('button:has(span:text("add"))');
    await pairProgAdd.click();
    await waitForSync();
    await expect(participant.getByText('3 votes remaining')).toBeVisible({ timeout: 5_000 });

    // Move to Discuss phase
    await facilitator.getByRole('button', { name: 'Next Phase' }).click();

    // ================================================================
    // STEP 9: Discuss Phase - Propose action, vote, accept
    // ================================================================
    await expect(facilitator.getByText('Discuss & Propose Actions')).toBeVisible({ timeout: 5_000 });
    await expect(participant.getByText('Discuss & Propose Actions')).toBeVisible({ timeout: 5_000 });

    // The first topic is auto-expanded when entering the Discuss phase (sorted by votes)
    // No need to click — "Stop long meetings" is already expanded

    // Propose an action
    const proposalInput = facilitator.locator('input[placeholder="Propose an action..."]').first();
    await expect(proposalInput).toBeVisible({ timeout: 10_000 });
    await proposalInput.fill('Schedule weekly code reviews');
    await facilitator.locator('button').filter({ hasText: 'Propose' }).first().click();
    await waitForSync();

    // Verify the proposal is visible on both sides
    await expect(facilitator.getByText('Schedule weekly code reviews')).toBeVisible({ timeout: 5_000 });
    await expect(participant.getByText('Schedule weekly code reviews')).toBeVisible({ timeout: 5_000 });

    // Participant votes thumb_up on the proposal
    // Find the proposal vote container (bg-slate-100 rounded-lg) near the proposal text
    const participantThumbUp = participant.locator('button').filter({ has: participant.locator('span.material-symbols-outlined:text("thumb_up")') }).first();
    await participantThumbUp.click();
    await waitForSync(800);

    // Facilitator also votes thumb_up on the proposal
    const facilitatorThumbUp = facilitator.locator('.bg-slate-100.rounded-lg').locator('button').filter({ has: facilitator.locator('span:text("thumb_up")') }).first();
    await facilitatorThumbUp.click();
    await waitForSync();

    // Keep proposal visible on both sides after voting
    await expect(facilitator.getByText('Schedule weekly code reviews')).toBeVisible({ timeout: 5_000 });
    await expect(participant.getByText('Schedule weekly code reviews')).toBeVisible({ timeout: 5_000 });

    // Facilitator accepts the proposal
    await facilitator.getByRole('button', { name: 'Accept' }).first().click();
    await waitForSync();

    // Verify the accepted action is shown with "Accepted:" prefix on both clients
    await expect(facilitator.getByText('Accepted:')).toBeVisible({ timeout: 5_000 });
    await expect(participant.getByText('Accepted:')).toBeVisible({ timeout: 5_000 });

    // Move to Review phase
    await facilitator.getByRole('button', { name: 'Next Phase' }).click();

    // ================================================================
    // STEP 10: Review Phase - Verify action and assign
    // ================================================================
    await expect(facilitator.getByText('Review Actions')).toBeVisible({ timeout: 5_000 });
    await expect(participant.getByText('Review Actions')).toBeVisible({ timeout: 5_000 });

    // Verify the accepted action is listed (as an input value in Review phase)
    await expect(facilitator.locator('input[value="Schedule weekly code reviews"]')).toBeVisible({ timeout: 5_000 });

    // Assign the action to the participant
    const assigneeSelect = facilitator.locator('select').filter({ hasText: 'Unassigned' }).first();
    await assigneeSelect.selectOption({ label: PARTICIPANT_NAME });
    await waitForSync();

    // Participant should see assignment synced in their own Review view
    await expect(participant.locator('select').first()).toHaveValue(await assigneeSelect.inputValue());

    // Move to Close phase
    await facilitator.getByRole('button', { name: 'Next: Close Retro' }).click();

    // ================================================================
    // STEP 11: Close Phase - Both vote ROTI, reveal results
    // ================================================================
    await expect(facilitator.getByText('Session Closed')).toBeVisible({ timeout: 5_000 });
    await expect(participant.getByText('Session Closed')).toBeVisible({ timeout: 5_000 });

    // Both should see ROTI section
    await expect(facilitator.getByText('ROTI (Return on Time Invested)')).toBeVisible();
    await expect(participant.getByText('ROTI (Return on Time Invested)')).toBeVisible();

    // Facilitator votes ROTI score 4
    // ROTI buttons are .w-10.h-10.rounded-full containing the score number
    await facilitator.locator('button.rounded-full').filter({ hasText: /^4$/ }).click();
    await waitForSync(800);

    // Participant votes ROTI score 5
    await participant.locator('button.rounded-full').filter({ hasText: /^5$/ }).click();
    await waitForSync();

    // Verify vote count shows both voted
    await expect(facilitator.getByText('2 / 2 members have voted')).toBeVisible({ timeout: 5_000 });

    // Facilitator reveals ROTI results
    await facilitator.getByText('Reveal Results').click();
    await waitForSync();

    // Both should see the average score (4 and 5 => 4.5 / 5)
    await expect(facilitator.getByText('4.5 / 5')).toBeVisible({ timeout: 5_000 });
    await expect(participant.getByText('4.5 / 5')).toBeVisible({ timeout: 5_000 });

    // Facilitator can return to dashboard
    await expect(facilitator.getByRole('button', { name: 'Return to Dashboard' })).toBeVisible();
    // Participant can leave
    await expect(participant.getByRole('button', { name: 'Leave Retrospective' })).toBeVisible();
  });
});
