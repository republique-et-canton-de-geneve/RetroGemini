import { test, expect } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from './helpers/announcements';

/**
 * Open Actions phase E2E flow (nominal case):
 * 1. Create team
 * 2. Seed three open team actions from the dashboard Actions tab
 * 3. Start a retro and advance to the OPEN_ACTIONS phase
 * 4. Verify the three open actions are listed
 * 5. Mark the first action as done
 * 6. Verify the action is struck through AND the other actions stay visible
 *    (regression: they used to disappear after the sync round-trip)
 */

const TEAM_NAME = `E2E-OpenActions-${Date.now()}`;
const TEAM_PASSWORD = 'testpass123456';

const ACTION_TEXTS = [
  'Prepare the sprint demo checklist',
  'Document the release process',
  'Set up the team knowledge base'
];

// Helper: wait for WebSocket sync round-trips (write, CAS heal, re-send) to settle
const waitForSync = (ms = 2000) => new Promise(r => setTimeout(r, ms));

test.describe('Open Actions phase', () => {
  test('marking the first action done keeps the other actions visible', async ({ page }) => {
    // ================================================================
    // STEP 1: Create Team
    // ================================================================
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: '+ New Team' }).click();
    await expect(page.getByRole('heading', { name: 'Create New Team' })).toBeVisible();

    await page.getByPlaceholder('e.g. Design Team').fill(TEAM_NAME);
    await page.locator('input[type="password"]').fill(TEAM_PASSWORD);
    await page.getByRole('button', { name: 'Create & Join' }).click();

    await expect(page.getByText(`${TEAM_NAME} Dashboard`)).toBeVisible({ timeout: 10_000 });
    await dismissAnnouncementsIfPresent(page);

    // ================================================================
    // STEP 2: Seed three open team actions (dashboard Actions tab)
    // ================================================================
    const newActionInput = page.getByPlaceholder('What needs to be done?');
    await expect(newActionInput).toBeVisible({ timeout: 5_000 });

    for (const text of ACTION_TEXTS) {
      await newActionInput.fill(text);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      // Dashboard renders each action's text as an input value
      await expect(page.locator(`input[value="${text}"]`)).toBeVisible({ timeout: 5_000 });
    }

    // ================================================================
    // STEP 3: Start a retro and advance to OPEN_ACTIONS
    // ================================================================
    await page.getByRole('button', { name: 'New Retrospective' }).click();
    await expect(page.getByRole('heading', { name: 'Start New Retrospective' })).toBeVisible();
    await page.locator('text=Start, Stop, Continue').first().click();

    await expect(page.getByRole('heading', { name: 'Icebreaker' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Start Session' }).click();

    await expect(page.getByText('Happiness Check')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Next Phase' }).click();

    await expect(page.getByText('Review Open Actions')).toBeVisible({ timeout: 5_000 });

    // ================================================================
    // STEP 4: All three seeded actions are listed
    // ================================================================
    const actionRows = page.getByTestId('open-action-row');
    await expect(actionRows).toHaveCount(3, { timeout: 5_000 });
    for (const text of ACTION_TEXTS) {
      await expect(page.getByText(text)).toBeVisible({ timeout: 5_000 });
    }

    // Let the phase-entry snapshot sync settle (this is where a lost write
    // race used to leave the session without its open-actions snapshot).
    await waitForSync();

    // ================================================================
    // STEP 5: Mark the first listed action as done
    // ================================================================
    const firstRow = actionRows.first();
    const firstRowText = await firstRow.locator('span.font-medium').textContent();
    expect(firstRowText).not.toBeNull();

    await firstRow.getByTestId('toggle-open-action-done').click();

    // The toggled action is struck through and shows the done icon
    await expect(firstRow.locator('span.line-through')).toBeVisible({ timeout: 5_000 });
    await expect(firstRow.getByText('check_circle')).toBeVisible({ timeout: 5_000 });

    // ================================================================
    // STEP 6: The other actions must stay visible — immediately...
    // ================================================================
    await expect(actionRows).toHaveCount(3);
    for (const text of ACTION_TEXTS) {
      await expect(page.getByText(text)).toBeVisible();
    }

    // ...and after the sync round-trips settle (regression: the healed
    // server state used to shrink the snapshot to only the toggled action,
    // making the other actions disappear).
    await waitForSync(2500);
    await expect(actionRows).toHaveCount(3);
    for (const text of ACTION_TEXTS) {
      await expect(page.getByText(text)).toBeVisible();
    }
    // The done state also survived the round-trip
    await expect(firstRow.locator('span.line-through')).toHaveText(firstRowText as string);

    // ================================================================
    // STEP 7: The facilitator can still advance to the next phase
    // ================================================================
    await page.getByRole('button', { name: 'Next Phase' }).click();
    await expect(page.getByRole('heading', { name: 'Brainstorm' })).toBeVisible({ timeout: 5_000 });
  });
});
