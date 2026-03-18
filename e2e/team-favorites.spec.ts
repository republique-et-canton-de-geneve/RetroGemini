import { test, expect, Page } from '@playwright/test';

/**
 * E2E tests for the team favorites feature.
 * Tests that users can star/unstar teams and that favorites
 * appear at the top of the team list, persisted via localStorage.
 */

const TEAM_PREFIX = `Fav-E2E-${Date.now()}`;
const TEAM_PASSWORD = 'testpass123';

test.describe('Team Favorites', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();

    // Create 3 teams so we have something to favorite
    for (let i = 1; i <= 3; i++) {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: '+ New Team' }).click();
      await expect(page.getByRole('heading', { name: 'Create New Team' })).toBeVisible();
      await page.getByPlaceholder('e.g. Design Team').fill(`${TEAM_PREFIX}-${i}`);
      await page.locator('input[type="password"]').fill(TEAM_PASSWORD);
      await page.getByRole('button', { name: 'Create & Join' }).click();
      await expect(page.getByText(`${TEAM_PREFIX}-${i} Dashboard`)).toBeVisible({ timeout: 10_000 });

      // Dismiss announcement modal if present
      const gotItButton = page.getByRole('button', { name: 'Got it!' });
      if (await gotItButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await gotItButton.click();
        await page.waitForTimeout(300);
      }

      // Go back to team list by logging out
      await page.getByRole('button', { name: 'Logout' }).click();
      await expect(page.getByRole('heading', { name: 'Your Teams' })).toBeVisible({ timeout: 10_000 });
    }
  });

  test.afterAll(async () => {
    await page.context().close();
  });

  test('Can favorite a team and see it in Favorites section', async () => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(`${TEAM_PREFIX}-1`)).toBeVisible({ timeout: 10_000 });

    // Initially no Favorites section
    await expect(page.getByText('Favorites')).not.toBeVisible();

    // Click the star for team 2
    const starButton = page.getByLabel(`Add ${TEAM_PREFIX}-2 to favorites`);
    await starButton.click();

    // Favorites section should now appear
    await expect(page.getByText('Favorites')).toBeVisible();
    await expect(page.getByText('All Teams')).toBeVisible();

    // The starred team's toggle should be checked
    const starChecked = page.getByLabel(`Remove ${TEAM_PREFIX}-2 from favorites`);
    await expect(starChecked).toHaveAttribute('aria-checked', 'true');
  });

  test('Favorites persist after page reload', async () => {
    // The previous test favorited team 2 — reload and verify
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(`${TEAM_PREFIX}-1`)).toBeVisible({ timeout: 10_000 });

    // Favorites section should still be visible
    await expect(page.getByText('Favorites')).toBeVisible();

    // Team 2 should still be favorited
    const starChecked = page.getByLabel(`Remove ${TEAM_PREFIX}-2 from favorites`);
    await expect(starChecked).toHaveAttribute('aria-checked', 'true');
  });

  test('Can unfavorite a team', async () => {
    await expect(page.getByText('Favorites')).toBeVisible();

    // Click to remove favorite
    const starChecked = page.getByLabel(`Remove ${TEAM_PREFIX}-2 from favorites`);
    await starChecked.click();

    // Favorites section should disappear (no favorites left)
    await expect(page.getByText('Favorites')).not.toBeVisible();

    // Star should be unchecked
    const starUnchecked = page.getByLabel(`Add ${TEAM_PREFIX}-2 to favorites`);
    await expect(starUnchecked).toHaveAttribute('aria-checked', 'false');
  });

  test('Clicking star does not navigate to login', async () => {
    // Click star — should stay on list view
    const starButton = page.getByLabel(`Add ${TEAM_PREFIX}-1 to favorites`);
    await starButton.click();

    // Should still see the teams list, not the login form
    await expect(page.getByRole('heading', { name: 'Your Teams' })).toBeVisible();
    await expect(page.getByText('Enter the team password to continue.')).not.toBeVisible();

    // Clean up: unfavorite
    const starChecked = page.getByLabel(`Remove ${TEAM_PREFIX}-1 from favorites`);
    await starChecked.click();
  });

  test('Favorite team appears before non-favorite teams', async () => {
    // Favorite team 3
    const starButton = page.getByLabel(`Add ${TEAM_PREFIX}-3 to favorites`);
    await starButton.click();

    await expect(page.getByText('Favorites')).toBeVisible();

    // Get all team card buttons
    const teamButtons = page.locator('button').filter({ hasText: new RegExp(`${TEAM_PREFIX}-\\d`) });
    const allTexts = await teamButtons.allInnerTexts();

    // The first occurrence of team-3 text should be before team-1 and team-2
    const firstTeam3Idx = allTexts.findIndex(t => t.includes(`${TEAM_PREFIX}-3`));
    const firstTeam1Idx = allTexts.findIndex(t => t.includes(`${TEAM_PREFIX}-1`));
    const firstTeam2Idx = allTexts.findIndex(t => t.includes(`${TEAM_PREFIX}-2`));

    expect(firstTeam3Idx).toBeLessThan(firstTeam1Idx);
    expect(firstTeam3Idx).toBeLessThan(firstTeam2Idx);
  });
});
