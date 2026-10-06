import { test, expect, type Page } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from './helpers/announcements';

/**
 * The two language choices, end to end:
 *  1. the **interface** language is detected from the browser and can be
 *     overridden with the switcher, and the override survives a reload;
 *  2. the **template** language of a retro is chosen when it starts and is
 *     independent of the interface language — an English screen can run a
 *     French retro (French columns and icebreaker, English chrome).
 *
 * Unit tests cover each piece; this spec is the one place the browser's own
 * locale, localStorage and the live session are exercised together.
 */

const TEAM_PASSWORD = 'testpass123456';

const createTeam = async (page: Page, teamName: string) => {
  await page.getByRole('button', { name: '+ New Team' }).click();
  await expect(page.getByRole('heading', { name: 'Create New Team' })).toBeVisible();
  await page.getByPlaceholder('e.g. Design Team').fill(teamName);
  await page.locator('input[type="password"]').fill(TEAM_PASSWORD);
  await page.getByRole('button', { name: 'Create & Join' }).click();
  await expect(page.getByText(`${teamName} Dashboard`)).toBeVisible({ timeout: 10_000 });
  await dismissAnnouncementsIfPresent(page);
};

test.describe('interface language', () => {
  test.describe('on a French browser', () => {
    test.use({ locale: 'fr-CH' });

    test('opens in French, and the switcher brings English back for good', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
      const switcher = page.getByRole('group', { name: 'Langue' }).first();
      await expect(switcher.getByRole('button', { name: 'Français' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: '+ New Team' })).toHaveCount(0);

      await switcher.getByRole('button', { name: 'English' }).click();

      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByRole('button', { name: '+ New Team' })).toBeVisible();

      // The explicit choice outranks the browser on the next visit.
      await page.reload();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByRole('button', { name: '+ New Team' })).toBeVisible();
    });
  });
});

test.describe('template language', () => {
  test('starts a French retro from an English screen', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await createTeam(page, `E2E-I18n-${Date.now()}`);

    await page.getByRole('button', { name: 'New Retrospective' }).click();
    await expect(page.getByRole('heading', { name: 'Start New Retrospective' })).toBeVisible();

    await page.getByTestId('template-language-fr').click();
    await expect(page.getByTestId('template-language-fr')).toHaveAttribute('aria-pressed', 'true');
    const template = page.getByTestId('retro-template-start_stop_continue');
    await expect(template).toContainText('Commencer, Arrêter, Continuer');
    // The dialog itself stays in the interface language.
    await expect(page.getByRole('heading', { name: 'Start New Retrospective' })).toBeVisible();

    await template.click();

    await expect(page.getByRole('heading', { name: 'Icebreaker' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('icebreaker-question-input')).toHaveValue(
      'Quel a été le meilleur moment de votre semaine ?'
    );

    await page.getByRole('button', { name: 'Start Session' }).click();
    await page.getByRole('button', { name: 'BRAINSTORM', exact: true }).click();

    // Column headers render the icon ligature next to the title, so match the
    // title as a substring of the header rather than as an exact name.
    for (const title of ['Commencer', 'Arrêter', 'Continuer']) {
      await expect(page.getByText(title).first()).toBeVisible({ timeout: 10_000 });
    }
    await expect(page.getByRole('button', { name: 'Next Phase' })).toBeVisible();
  });
});
