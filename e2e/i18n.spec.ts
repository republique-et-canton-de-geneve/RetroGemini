import { test, expect, type Page } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from './helpers/announcements';
import { ICEBREAKER_QUESTIONS } from '../i18n/content/icebreakers';

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
    // The French default question, as the content module writes it (with the
    // no-break space French typography puts before "?").
    await expect(page.getByTestId('icebreaker-question-input')).toHaveValue(ICEBREAKER_QUESTIONS.fr[0]);
    await expect(page.getByTestId('icebreaker-question-input')).toHaveAttribute('lang', 'fr');

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

/**
 * French labels run about a quarter longer than English ones, and the language
 * switcher added a control to three crowded headers. Measured once in review:
 * the dashboard header pushed Logout off a 360px phone and the retro header
 * clipped its invite button at 1024px in French. This keeps every header
 * control inside the viewport, in both languages, from 320px up.
 */
test.describe('headers fit in both languages', () => {
  const WIDTHS = [320, 390, 1024, 1180];

  const assertFits = async (page: Page, controls: string[]) => {
    for (const language of ['en', 'fr'] as const) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.getByTestId(`language-option-${language}`).first().click();
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        const overflow = await page.evaluate(() => {
          const header = document.querySelector('header');
          return header ? header.scrollWidth - header.clientWidth : -1;
        });
        expect(overflow, `header overflow at ${width}px (${language})`).toBe(0);
        for (const selector of controls) {
          const box = await page.locator(selector).first().boundingBox();
          expect(box, `${selector} rendered at ${width}px (${language})`).not.toBeNull();
          expect(box!.x + box!.width, `${selector} inside ${width}px (${language})`).toBeLessThanOrEqual(width + 0.5);
        }
      }
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByTestId('language-option-en').first().click();
  };

  test('dashboard and retro headers keep every control on screen', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await createTeam(page, `E2E-I18n-Fit-${Date.now()}`);

    await assertFits(page, ['[data-testid="language-switcher"]', 'header button:has(span:text-is("logout"))']);

    await page.getByRole('button', { name: 'New Retrospective' }).click();
    await page.getByTestId('retro-template-start_stop_continue').click();
    await expect(page.getByTestId('icebreaker-question-input')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Start Session' }).click();

    await assertFits(page, [
      '[data-testid="language-switcher"]',
      'header button:has(span:text-is("qr_code_2"))',
      'header button:has(span:text-is("arrow_back"))',
    ]);
  });
});
