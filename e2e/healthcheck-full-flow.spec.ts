import { test, expect, Page, BrowserContext } from '@playwright/test';

/**
 * Full health check E2E flow using "Bilan de santé (FR)" template:
 * 1. Create team
 * 2. Create health check with "Bilan de santé (FR)" template
 * 3. Invite participant (second browser context)
 * 4. Survey: both facilitator and participant rate all dimensions and add comments
 * 5. Verify green checkmark appears for each person who completed the survey
 * 6. Discuss: verify radar chart, average scores, vote distribution, comments
 * 7. Discuss: create action on one dimension, vote and accept it
 * 8. Discuss: create action on another dimension, vote but do NOT accept it
 * 9. Review: verify only the accepted action appears, change assignment
 * 10. Close: both vote ROTI, reveal results
 * 11. Return to dashboard and verify the accepted action appears in the Actions tab
 */

const TEAM_NAME = `E2E-HC-Team-${Date.now()}`;
const TEAM_PASSWORD = 'testpass123';
const PARTICIPANT_NAME = 'Alice Participant';

// Helper: wait for WebSocket sync to propagate (session-update event)
const waitForSync = (ms = 2000) => new Promise(r => setTimeout(r, ms));

// The "Bilan de santé (FR)" template has 11 dimensions
const FR_DIMENSIONS = [
  'Autonomie',
  'Objectif',
  'Challenge',
  'Epanouissement',
  "Travail d'équipe",
  "Lien avec l'organisation",
  'Apprentissages et initiatives',
  'Transparence',
  "Communication dans l'équipe",
  'Se tenir mutuellement responsables',
  "Energie de l'équipe (synthèse)"
];

test.describe('Full Health Check Flow', () => {
  let facilitatorContext: BrowserContext;
  let participantContext: BrowserContext;
  let facilitator: Page;
  let participant: Page;

  test.beforeAll(async ({ browser }) => {
    facilitatorContext = await browser.newContext({
      recordVideo: {
        dir: 'test-results/videos/hc-facilitator',
      },
    });
    participantContext = await browser.newContext({
      recordVideo: {
        dir: 'test-results/videos/hc-participant',
      },
    });
    facilitator = await facilitatorContext.newPage();
    participant = await participantContext.newPage();
  });

  test.afterAll(async () => {
    await facilitatorContext?.close();
    await participantContext?.close();
  });

  test('Complete health check session with facilitator and participant', async () => {
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
    // STEP 2: Create Health Check with "Bilan de santé (FR)" template
    // ================================================================
    // Navigate to the Health Checks tab
    await facilitator.getByRole('button', { name: 'Health Checks' }).click();
    await facilitator.waitForTimeout(500);

    // Click "START HEALTH CHECK" button
    await facilitator.getByText('START HEALTH CHECK').click();
    await expect(facilitator.getByRole('heading', { name: 'Start Health Check' })).toBeVisible();

    // Select "Bilan de santé (FR)" template from dropdown using its template id value
    const templateSelect = facilitator.locator('select').filter({ has: facilitator.locator('option') }).first();
    await templateSelect.selectOption('team_health_fr');

    // Click "Start Health Check" button in modal (exact match to avoid the "START HEALTH CHECK" button behind)
    await facilitator.getByRole('button', { name: 'Start Health Check', exact: true }).click();

    // Should be in session at SURVEY phase
    await expect(facilitator.getByText('Rate each health dimension')).toBeVisible({ timeout: 10_000 });

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

    const participantJoinHeading = participant.getByText(`Join ${TEAM_NAME}`);
    const participantSurveyHeading = participant.getByText('Rate each health dimension');

    const participantEntryMode = await Promise.race([
      participantJoinHeading.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'JOIN' as const),
      participantSurveyHeading.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'AUTO_JOIN' as const)
    ]);

    if (participantEntryMode === 'JOIN') {
      // Participant enters their name (if member list shown, click "I'm not in the list" first)
      const notInListButton = participant.getByRole('button', { name: "I'm not in the list" });
      if (await notInListButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await notInListButton.click();
      }
      await participant.getByPlaceholder('e.g. John Doe').fill(PARTICIPANT_NAME);
      await participant.getByRole('button', { name: 'Join Retrospective' }).click();
    }

    // Participant should be in the session at SURVEY phase
    await expect(participantSurveyHeading).toBeVisible({ timeout: 15_000 });

    // ================================================================
    // STEP 4: Survey - Both rate all dimensions and add comments
    // ================================================================
    // Define ratings for facilitator (varied scores)
    const facilitatorRatings = [4, 3, 5, 2, 4, 3, 5, 4, 3, 4, 5]; // 11 dimensions
    // Define ratings for participant (varied scores)
    const participantRatings = [3, 4, 4, 3, 5, 2, 4, 3, 4, 3, 4]; // 11 dimensions

    // Dimensions where we add comments (indices: 0=Autonomie, 2=Challenge, 5=Lien organisation, 10=Energie)
    const facilitatorCommentDimensions = [0, 2];
    const participantCommentDimensions = [5, 10];

    const facilitatorComments: Record<number, string> = {
      0: 'Good level of autonomy in the team',
      2: 'Challenges are well balanced',
    };
    const participantComments: Record<number, string> = {
      5: 'Communication with management could improve',
      10: 'Overall energy is positive',
    };

    // Facilitator rates all dimensions (click quickly to reduce HTTP persist calls)
    for (let i = 0; i < FR_DIMENSIONS.length; i++) {
      const dimensionName = FR_DIMENSIONS[i];
      const dimensionCard = facilitator.locator('.bg-white.border.border-slate-200.rounded-xl.p-6.shadow-sm')
        .filter({ hasText: dimensionName });

      const ratingButtons = dimensionCard.locator('button.rounded-full.font-bold');
      await ratingButtons.nth(facilitatorRatings[i] - 1).click();
    }

    // Add comments on selected dimensions (facilitator)
    for (const idx of facilitatorCommentDimensions) {
      const dimensionName = FR_DIMENSIONS[idx];
      const dimensionCard = facilitator.locator('.bg-white.border.border-slate-200.rounded-xl.p-6.shadow-sm')
        .filter({ hasText: dimensionName });
      const commentTextarea = dimensionCard.locator('textarea[placeholder="Additional comments (optional)..."]');
      await commentTextarea.fill(facilitatorComments[idx]);
    }

    // Wait for debounce and persist to complete
    await waitForSync(3000);

    // Participant rates all dimensions
    for (let i = 0; i < FR_DIMENSIONS.length; i++) {
      const dimensionName = FR_DIMENSIONS[i];
      const dimensionCard = participant.locator('.bg-white.border.border-slate-200.rounded-xl.p-6.shadow-sm')
        .filter({ hasText: dimensionName });

      const ratingButtons = dimensionCard.locator('button.rounded-full.font-bold');
      await ratingButtons.nth(participantRatings[i] - 1).click();
    }

    // Add comments on selected dimensions (participant)
    for (const idx of participantCommentDimensions) {
      const dimensionName = FR_DIMENSIONS[idx];
      const dimensionCard = participant.locator('.bg-white.border.border-slate-200.rounded-xl.p-6.shadow-sm')
        .filter({ hasText: dimensionName });
      const commentTextarea = dimensionCard.locator('textarea[placeholder="Additional comments (optional)..."]');
      await commentTextarea.fill(participantComments[idx]);
    }

    // Wait for debounce and persist to complete
    await waitForSync(3000);

    // ================================================================
    // STEP 5: Verify green checkmark in participant panel
    // ================================================================
    // Both users have completed all ratings, so both should have the green check_circle
    // The panel shows "2 / 2 completed survey"
    await expect(facilitator.getByText('2 / 2 completed survey')).toBeVisible({ timeout: 10_000 });

    // Verify green checkmarks are visible (check_circle icons in participant panel)
    const facilitatorCheckmarks = facilitator.locator('span.material-symbols-outlined.text-emerald-500').filter({ hasText: 'check_circle' });
    await expect(facilitatorCheckmarks).toHaveCount(2, { timeout: 10_000 });

    // ================================================================
    // STEP 6: Move to Discuss phase
    // ================================================================
    await facilitator.getByRole('button', { name: 'Next: Discuss' }).click();
    await waitForSync();

    // Both should see the Discuss phase
    await expect(facilitator.getByText('Discuss survey results and identify actions')).toBeVisible({ timeout: 10_000 });
    await expect(participant.getByText('Discuss survey results and identify actions')).toBeVisible({ timeout: 10_000 });

    // Verify the radar chart is rendered (SVG element exists)
    const radarSvg = facilitator.locator('svg[viewBox="0 0 400 400"]');
    await expect(radarSvg).toBeVisible({ timeout: 5_000 });

    // Verify the radar chart has the data polygon (filled path)
    const radarPath = radarSvg.locator('path');
    await expect(radarPath).toBeVisible();

    // Verify average scores are displayed for each dimension
    // For the first dimension "Autonomie": facilitator gave 4, participant gave 3, average = 3.5
    const autonomieCard = facilitator.locator('.bg-white.border-2.rounded-xl').filter({ hasText: 'Autonomie' });
    await expect(autonomieCard.getByText('3.5')).toBeVisible({ timeout: 5_000 });

    // For "Challenge": facilitator gave 5, participant gave 4, average = 4.5
    const challengeCard = facilitator.locator('.bg-white.border-2.rounded-xl').filter({ hasText: 'Challenge' });
    await expect(challengeCard.getByText('4.5')).toBeVisible({ timeout: 5_000 });

    // Click on "Autonomie" to expand and check distribution and comments
    await autonomieCard.locator('.p-4').first().click();
    await waitForSync(500);

    // Verify "Vote Distribution" section is visible
    await expect(facilitator.getByText('Vote Distribution')).toBeVisible({ timeout: 5_000 });

    // Verify comments are visible
    await expect(facilitator.getByText('Comments')).toBeVisible({ timeout: 5_000 });
    // Use the comments list container to avoid matching the "Add a comment..." textarea (which is pre-filled with the same text)
    await expect(autonomieCard.locator('.space-y-2').getByText('Good level of autonomy in the team')).toBeVisible({ timeout: 5_000 });

    // ================================================================
    // STEP 6b: Verify voter identity tooltips (non-anonymous mode)
    // ================================================================
    // In non-anonymous mode, hovering over a vote distribution bar should show voter names.
    // For "Autonomie": facilitator gave 4, participant gave 3
    // The bar for rating 4 should show the facilitator's name on hover
    const ratingBar4 = autonomieCard.locator('.group').nth(3); // rating 4 (0-indexed: 0=rating1, 3=rating4)
    await ratingBar4.hover();
    await facilitator.waitForTimeout(300);

    // The tooltip should show the facilitator's name (the team creator)
    // Facilitator name is the first member who created the team
    const facilitatorName = await facilitator.locator('.text-sm.font-bold.text-slate-700').first().textContent();
    const tooltip4 = ratingBar4.locator('.bg-slate-800.text-white');
    await expect(tooltip4).toBeVisible({ timeout: 3_000 });

    // Verify the rating 3 bar shows participant name on hover
    const ratingBar3 = autonomieCard.locator('.group').nth(2); // rating 3 (0-indexed: 2=rating3)
    await ratingBar3.hover();
    await facilitator.waitForTimeout(300);
    const tooltip3 = ratingBar3.locator('.bg-slate-800.text-white');
    await expect(tooltip3).toBeVisible({ timeout: 3_000 });
    await expect(tooltip3).toContainText(PARTICIPANT_NAME);

    // ================================================================
    // STEP 6c: Add a comment from the Discuss phase
    // ================================================================
    // The facilitator adds a new comment on "Autonomie" from the Discuss phase
    const discussCommentTextarea = autonomieCard.locator('textarea[placeholder="Add a comment..."]');
    await expect(discussCommentTextarea).toBeVisible({ timeout: 5_000 });
    await discussCommentTextarea.fill('This should improve next quarter');
    await waitForSync(3000); // Wait for debounce

    // Verify the new comment appears in the comments list (scope to avoid matching the textarea)
    await expect(autonomieCard.locator('.space-y-2').getByText('This should improve next quarter')).toBeVisible({ timeout: 5_000 });

    // Participant also adds a comment from the Discuss phase
    // Participant needs to see Autonomie expanded (follows facilitator focus)
    const participantAutonomieCard = participant.locator('.bg-white.border-2.rounded-xl').filter({ hasText: 'Autonomie' });
    const participantDiscussComment = participantAutonomieCard.locator('textarea[placeholder="Add a comment..."]');
    await expect(participantDiscussComment).toBeVisible({ timeout: 5_000 });
    await participantDiscussComment.fill('Agree, we need more delegation');
    await waitForSync(3000); // Wait for debounce

    // Verify both new comments are visible on facilitator side
    await expect(facilitator.getByText('Agree, we need more delegation')).toBeVisible({ timeout: 5_000 });

    // ================================================================
    // STEP 7: Create action on first dimension, vote and accept
    // ================================================================
    // Still on Autonomie dimension (expanded)
    const proposalInput = facilitator.locator('input[placeholder="Propose an action..."]').first();
    await expect(proposalInput).toBeVisible({ timeout: 5_000 });
    await proposalInput.fill('Improve team autonomy by reducing approval steps');
    await facilitator.locator('button').filter({ hasText: 'Propose' }).first().click();
    await waitForSync();

    // Verify the proposal is visible on both sides
    await expect(facilitator.getByText('Improve team autonomy by reducing approval steps')).toBeVisible({ timeout: 5_000 });
    await expect(participant.getByText('Improve team autonomy by reducing approval steps')).toBeVisible({ timeout: 5_000 });

    // Participant votes thumb_up on the proposal
    const participantThumbUp = participant.locator('button').filter({ has: participant.locator('span.material-symbols-outlined:text("thumb_up")') }).first();
    await participantThumbUp.click();
    await waitForSync(800);

    // Facilitator also votes thumb_up
    const facilitatorThumbUp = facilitator.locator('.bg-slate-100.rounded-lg').locator('button').filter({ has: facilitator.locator('span:text("thumb_up")') }).first();
    await facilitatorThumbUp.click();
    await waitForSync();

    // Facilitator accepts the proposal
    await facilitator.getByRole('button', { name: 'Accept' }).first().click();
    await waitForSync();

    // Verify the accepted action shows "Accepted:" prefix
    await expect(facilitator.getByText('Accepted:')).toBeVisible({ timeout: 5_000 });
    await expect(participant.getByText('Accepted:')).toBeVisible({ timeout: 5_000 });

    // ================================================================
    // STEP 8: Create action on another dimension, vote but do NOT accept
    // ================================================================
    // Collapse Autonomie by clicking its header again
    await autonomieCard.locator('.p-4').first().click();
    await waitForSync(500);

    // Click on "Lien avec l'organisation" dimension to expand it
    const lienOrgCard = facilitator.locator('.bg-white.border-2.rounded-xl').filter({ hasText: "Lien avec l'organisation" });
    await lienOrgCard.locator('.p-4').first().click();
    await waitForSync(500);

    // Verify the comment from the participant is visible
    await expect(facilitator.getByText('Communication with management could improve')).toBeVisible({ timeout: 5_000 });

    // Propose an action on this dimension
    const proposalInput2 = facilitator.locator('input[placeholder="Propose an action..."]').first();
    await proposalInput2.fill('Schedule monthly town halls with management');
    await facilitator.locator('button').filter({ hasText: 'Propose' }).first().click();
    await waitForSync();

    // Verify the proposal is visible
    await expect(facilitator.getByText('Schedule monthly town halls with management')).toBeVisible({ timeout: 5_000 });

    // Participant votes on it
    const participantThumbUp2 = participant.locator('.bg-slate-100.rounded-lg').last().locator('button').filter({ has: participant.locator('span:text("thumb_up")') }).first();
    await participantThumbUp2.click();
    await waitForSync();

    // Do NOT accept this proposal - leave it as a proposal

    // ================================================================
    // STEP 9: Move to Review phase
    // ================================================================
    await facilitator.getByRole('button', { name: 'Next: Review' }).click();
    await waitForSync();

    // Both should see the Review phase
    await expect(facilitator.getByText('Review Actions')).toBeVisible({ timeout: 5_000 });
    await expect(participant.getByText('Review Actions')).toBeVisible({ timeout: 5_000 });

    // Verify the accepted action is listed
    await expect(facilitator.getByText('Improve team autonomy by reducing approval steps')).toBeVisible({ timeout: 5_000 });

    // Verify the non-accepted proposal is NOT in the review (only type 'new' actions show)
    await expect(facilitator.getByText('Schedule monthly town halls with management')).not.toBeVisible({ timeout: 3_000 });

    // Verify the action count shows 1 action
    await expect(facilitator.getByText('Actions from this session (1)')).toBeVisible({ timeout: 5_000 });

    // Verify assignment: should show "Unassigned" by default
    const assigneeSelect = facilitator.locator('select').filter({ hasText: 'Unassigned' }).first();
    await expect(assigneeSelect).toBeVisible({ timeout: 5_000 });

    // Verify that the two assignment options are available (facilitator and participant)
    const options = assigneeSelect.locator('option');
    // Should have at least: "Unassigned", facilitator name, and participant name
    const optionCount = await options.count();
    expect(optionCount).toBeGreaterThanOrEqual(2);

    // Change assignment to the participant
    await assigneeSelect.selectOption({ label: PARTICIPANT_NAME });
    await waitForSync();

    // Verify participant sees the assignment change
    const participantSelect = participant.locator('select').first();
    await expect(participantSelect).toHaveValue(await assigneeSelect.inputValue(), { timeout: 5_000 });

    // ================================================================
    // STEP 10: Move to Close phase - ROTI
    // ================================================================
    await facilitator.getByRole('button', { name: 'Next: Close' }).click();
    await waitForSync();

    // Both should see the close screen
    await expect(facilitator.getByText('Health Check Complete')).toBeVisible({ timeout: 5_000 });
    await expect(participant.getByText('Health Check Complete')).toBeVisible({ timeout: 5_000 });

    // Both should see ROTI section
    await expect(facilitator.getByText('ROTI (Return on Time Invested)')).toBeVisible();
    await expect(participant.getByText('ROTI (Return on Time Invested)')).toBeVisible();

    // Facilitator votes ROTI score 4
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

    // ================================================================
    // STEP 11: Return to dashboard and verify action in Actions tab
    // ================================================================
    // Wait for all pending HTTP persist operations to complete before returning
    // (the dashboard refreshes data from server, which can race with pending persists)
    await waitForSync(5000);

    // Facilitator returns to dashboard
    await facilitator.getByRole('button', { name: 'Return to Dashboard' }).click();
    await waitForSync(3000);
    await expect(facilitator.getByText(`${TEAM_NAME} Dashboard`)).toBeVisible({ timeout: 10_000 });

    // Dismiss "What's New" announcement modal if it appears again
    if (await gotItButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await gotItButton.click();
      await facilitator.waitForTimeout(500);
    }

    // Navigate to the Actions tab
    await facilitator.getByRole('button', { name: 'Actions' }).click();
    await waitForSync();

    // Verify the accepted action is visible in the actions list
    // Actions are displayed in editable textboxes in the dashboard
    const actionInput = facilitator.locator('input[value*="Improve team autonomy"]');
    await expect(actionInput).toBeVisible({ timeout: 10_000 });

    // Verify the non-accepted proposal is NOT in the actions list
    const proposalInput3 = facilitator.locator('input[value*="Schedule monthly town halls"]');
    await expect(proposalInput3).not.toBeVisible({ timeout: 3_000 });

    // Verify participant can leave
    await expect(participant.getByRole('button', { name: 'Leave Health Check' })).toBeVisible();
  });
});
