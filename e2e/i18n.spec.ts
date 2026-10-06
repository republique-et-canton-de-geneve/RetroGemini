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
 * switcher added a control to three crowded headers. What this guards, and how
 * the first version of it missed both:
 *  - every header control stays inside the viewport, and the back arrow is the
 *    element a tap actually lands on (it once sat under the timer, so "back"
 *    paused everyone's timer instead);
 *  - the session header renders some controls from `window.innerWidth` at
 *    render time, so each width is measured after a **re-render** — resizing a
 *    page rendered at 1280px never shows the phone layout. Switching the
 *    language re-renders every header without a request. A reload per width
 *    did too, but it spent about 80 of the 120 `/api/team/*` reads one IP may
 *    make per minute, and the invite specs that run next were refused their
 *    invite link;
 *  - the phase bar is the part that gives way: from 1280px it shows every phase
 *    in both languages, and below that the current phase stays in view, also
 *    after a resize or a language switch.
 *
 * The app asks for Inter, which a developer machine may have and CI does not:
 * CI fell back to a wider font and overflowed by a pixel where this machine
 * had 19 to spare. The test therefore renders in DejaVu Sans, the wide font
 * Linux falls back to, so it measures the same thing everywhere and a header
 * that fits it has room for the narrower fonts phones and laptops use.
 */
test.describe('headers fit in both languages', () => {
  const WIDTHS = [320, 390, 768, 1024, 1280];

  const measure = (page: Page) =>
    page.evaluate(() => {
      const header = document.querySelector('header')!;
      const width = window.innerWidth;
      const inView = (el: Element | null | undefined) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.left >= 0 && r.right <= width + 0.5;
      };
      const button = (icon: string) =>
        [...header.querySelectorAll('button')].find(b => b.textContent?.includes(icon));
      const back = button('arrow_back');
      let backTappable: boolean | null = null;
      if (back) {
        const r = back.getBoundingClientRect();
        backTappable = back.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      }
      const bar = header.querySelector('.phase-nav-btn')?.parentElement ?? null;
      const barShown = !!bar && bar.getBoundingClientRect().width > 0;
      const active = bar?.querySelector('.phase-nav-btn.active') ?? null;
      let activeInView: boolean | null = null;
      if (barShown && active) {
        const a = active.getBoundingClientRect();
        const b = bar!.getBoundingClientRect();
        activeInView = a.left >= b.left - 0.5 && a.right <= b.right + 0.5;
      }
      return {
        overflow: header.scrollWidth - header.clientWidth,
        switcher: inView(header.querySelector('[data-testid="language-switcher"]')),
        logout: back ? null : inView(button('logout')),
        invite: back ? inView(button('qr_code_2')) : null,
        backTappable,
        barHidden: barShown ? bar!.scrollWidth - bar!.clientWidth : null,
        activeInView,
      };
    });

  const assertEveryWidth = async (page: Page, screen: 'dashboard' | 'retro' | 'health check') => {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      // French first: the page is in English, so each click is a real switch
      // and re-renders the header at this width.
      for (const language of ['fr', 'en'] as const) {
        await page.getByTestId(`language-option-${language}`).click();
        await expect(page.locator('html')).toHaveAttribute('lang', language);
        const m = await measure(page);
        const where = `${screen} at ${width}px (${language})`;
        expect(m.overflow, `header overflow, ${where}`).toBe(0);
        expect(m.switcher, `language switcher in view, ${where}`).toBe(true);
        if (screen === 'dashboard') {
          expect(m.logout, `logout in view, ${where}`).toBe(true);
        } else {
          expect(m.invite, `invite in view, ${where}`).toBe(true);
          expect(m.backTappable, `back arrow is what a tap hits, ${where}`).toBe(true);
          if (m.barHidden !== null) {
            expect(m.activeInView, `current phase visible in the phase bar, ${where}`).toBe(true);
            if (width >= 1280) expect(m.barHidden, `whole phase bar visible, ${where}`).toBe(0);
          }
        }
      }
    }
    await page.setViewportSize({ width: 1280, height: 900 });
  };

  test('dashboard and session headers keep every control on screen', async ({ page }) => {
    // Icons keep their own font: only the inherited text font is replaced.
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = "body { font-family: 'DejaVu Sans', sans-serif !important; }";
        document.head.appendChild(style);
      });
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await createTeam(page, `E2E-I18n-Fit-${Date.now()}`);

    await assertEveryWidth(page, 'dashboard');
    await dismissAnnouncementsIfPresent(page);

    await page.getByRole('button', { name: 'New Retrospective' }).click();
    await page.getByTestId('retro-template-start_stop_continue').click();
    await expect(page.getByTestId('icebreaker-question-input')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Start Session' }).click();
    // A late phase: an active phase the bar leaves off-screen would show here.
    await page.getByRole('button', { name: 'REVIEW', exact: true }).click();
    await expect(page.locator('.phase-nav-btn.active')).toHaveText(/REVIEW/);

    await assertEveryWidth(page, 'retro');

    await page.getByRole('button', { name: 'Leave the retrospective' }).click();
    await page.getByRole('button', { name: 'Health Checks' }).click();
    await page.getByText('START HEALTH CHECK').click();
    await page.getByRole('button', { name: 'Start Health Check', exact: true }).click();
    await expect(page.getByText('Rate each health dimension')).toBeVisible({ timeout: 10_000 });

    await assertEveryWidth(page, 'health check');
  });
});
