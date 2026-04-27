import { test, expect, Page } from '@playwright/test';

/**
 * E2E coverage for the release-level retrospective analysis feature.
 *
 * The /api/team/create endpoint is rate-limited to 5 requests per 15 minutes
 * per IP, so this spec deliberately creates a single team and verifies the
 * AI-enabled happy path: the modal opens, the user can manually select retros,
 * the keyword is forwarded to the AI endpoint, and the synthesis is rendered.
 *
 * The AI endpoints are stubbed so this test does not depend on a real LLM.
 * The "Analyze release button stays hidden when AI is disabled" branch is
 * covered by the Dashboard component unit test.
 */

const dismissAnnouncementsIfPresent = async (page: Page, timeout = 5000) => {
  const announcementHeading = page.getByRole('heading', { name: "What's New" });
  if (!(await announcementHeading.isVisible({ timeout }).catch(() => false))) {
    return;
  }
  await page.getByRole('button', { name: 'Got it!' }).click();
  await expect(announcementHeading).toHaveCount(0);
};

const createTeam = async (page: Page, teamName: string, password: string) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '+ New Team' }).click();
  await expect(page.getByRole('heading', { name: 'Create New Team' })).toBeVisible();
  await page.getByPlaceholder('e.g. Design Team').fill(teamName);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Create & Join' }).click();
  await expect(page.getByText(`${teamName} Dashboard`)).toBeVisible({ timeout: 10_000 });
  await dismissAnnouncementsIfPresent(page);
};

const createRetroAndReturnToDashboard = async (page: Page, teamName: string) => {
  await page.getByRole('button', { name: 'New Retrospective' }).click();
  await expect(page.getByRole('heading', { name: 'Start New Retrospective' })).toBeVisible();
  await page.locator('text=Start, Stop, Continue').first().click();
  await expect(page.getByRole('heading', { name: 'Icebreaker' })).toBeVisible({ timeout: 10_000 });
  // Back-arrow on the session header returns to the dashboard.
  await page.locator('header button').first().click();
  await expect(page.getByText(`${teamName} Dashboard`)).toBeVisible({ timeout: 10_000 });
};

test.describe('Release retrospective analysis', () => {
  test('Allows AI release analysis with keyword and manual selection', async ({ page }) => {
    await page.route('**/api/ai-status', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ enabled: true })
      });
    });

    let capturedBody: {
      releaseLabel?: string;
      retrospectives?: { id: string; name: string }[];
      mode?: string;
      additionalInstructions?: string;
      customPrompt?: string;
    } = {};
    await page.route('**/api/ai/generate-release-analysis', async (route, request) => {
      capturedBody = JSON.parse(request.postData() || '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          analysis:
            'Drivers (what propels the team forward)\n- Pair programming\n\n' +
            'Anchors (what slows the team down or holds it back)\n- Slow CI pipeline\n\n' +
            'Practice changes\n- Adopted faster CI runners\n\n' +
            'New tools and experiments\n- Switched to a new build cache'
        })
      });
    });

    const teamName = `Release-${Date.now()}`;
    await createTeam(page, teamName, 'testpass123');
    await createRetroAndReturnToDashboard(page, teamName);
    await createRetroAndReturnToDashboard(page, teamName);

    await page.getByRole('button', { name: /Retrospectives/ }).first().click();

    const analyzeButton = page.getByTestId('open-release-analysis');
    await expect(analyzeButton).toBeVisible();
    await analyzeButton.click();

    const modal = page.getByTestId('release-analysis-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByText('0 selected')).toBeVisible();

    // Manually select all retros via their checkboxes.
    const checkboxes = modal.locator('input[type="checkbox"]');
    const count = await checkboxes.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await checkboxes.nth(i).check();
    }
    await expect(modal.getByText(`${count} selected`)).toBeVisible();

    // Provide a release keyword to verify it is forwarded to the AI endpoint.
    await modal.getByTestId('release-analysis-keyword').fill('2606');

    // Add some additional facilitator instructions on top of the default prompt.
    await modal.getByTestId('release-analysis-additional').fill('Highlight cross-team dependencies.');

    await page.getByTestId('release-analysis-generate').click();

    const result = page.getByTestId('release-analysis-result');
    await expect(result).toBeVisible({ timeout: 10_000 });
    await expect(result).toContainText('Drivers');
    await expect(result).toContainText('Anchors');
    await expect(result).toContainText('Practice changes');
    await expect(result).toContainText('New tools');

    expect(capturedBody.releaseLabel).toBe('2606');
    expect(capturedBody.mode).toBe('default');
    expect(capturedBody.additionalInstructions).toBe('Highlight cross-team dependencies.');
    expect(capturedBody.customPrompt).toBeUndefined();
    expect(Array.isArray(capturedBody.retrospectives)).toBe(true);
    expect(capturedBody.retrospectives?.length).toBeGreaterThanOrEqual(1);

    // Copy button must be visible alongside the result without scrolling.
    const footerCopy = page.getByTestId('release-analysis-copy-footer');
    await expect(footerCopy).toBeVisible();

    // Switch to custom prompt mode and verify the body changes accordingly.
    await modal.getByTestId('release-analysis-mode-custom').click();
    await modal.getByTestId('release-analysis-custom-prompt').fill('Only list the top 3 risks.');
    await page.getByTestId('release-analysis-generate').click();
    await expect(result).toBeVisible({ timeout: 10_000 });

    expect(capturedBody.mode).toBe('custom');
    expect(capturedBody.customPrompt).toBe('Only list the top 3 risks.');
    expect(capturedBody.additionalInstructions).toBeUndefined();
  });
});
