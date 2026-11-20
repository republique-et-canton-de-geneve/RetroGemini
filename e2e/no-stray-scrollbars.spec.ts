import { test, expect, type Page } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from './helpers/announcements';
import { ICEBREAKER_QUESTIONS } from '../i18n/content/icebreakers';

/**
 * No scrollbar where there is nothing to scroll (45.3).
 *
 * Windows, a Linux desktop and a Mac with a mouse draw a classic scrollbar for
 * a single pixel of overflow, and a box that scrolls on one axis scrolls on
 * the other too: `overflow-x: auto` turns `overflow-y` into `auto`. Three
 * places drew one with nothing behind it:
 *  - the tab strips of the dashboard and of the console, at every width: each
 *    tab carried `-mb-px`, so the strip came out a pixel shorter than its
 *    tabs. A scrolling box clips at its padding box, so that pixel also cut the
 *    current tab's underline to one pixel and the bottom edge of the focus
 *    ring, which is now drawn inside the tab, as the phase bar's is;
 *  - the Welcome phase below 414px, whose five moods were wider than the
 *    screen: it scrolled sideways, and at 320px the first mood was cut off
 *    where no scroll reaches;
 *  - the Icebreaker's question field on a phone, which scrolled inside itself
 *    with the default question (by 102px at 414px, 215px at 320px).
 *
 * Playwright's Chromium hides scrollbars, so the overflow itself is measured:
 * scrollHeight against clientHeight, scrollWidth against clientWidth. In
 * French, whose labels are the longer ones, once the page's fonts are in.
 */

const TEAM_PASSWORD = 'no-scrollbar-e2e-password';

const createTeam = async (page: Page, teamName: string) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '+ New Team' }).click();
  await page.getByPlaceholder('e.g. Design Team').fill(teamName);
  await page.locator('input[type="password"]').fill(TEAM_PASSWORD);
  await page.getByLabel('Recovery Email').fill('facilitator@example.com');
  await page.getByRole('button', { name: 'Create & Join' }).click();
  await expect(page.getByText(`${teamName} Dashboard`)).toBeVisible({ timeout: 10_000 });
  await dismissAnnouncementsIfPresent(page);
};

const switchToFrench = async (page: Page) => {
  await page.getByTestId('language-option-fr').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
};

test.describe('the tab strips', () => {
  const WIDTHS = [390, 1024, 1280, 1920];

  /** The strip that holds the `.dash-tab` buttons: how far it scrolls on each axis. */
  const stripOverflow = (page: Page) =>
    page.evaluate(async () => {
      await document.fonts.ready;
      const strip = document.querySelector('.dash-tab')?.parentElement;
      if (!strip) throw new Error('no tab strip on this screen');
      return { x: strip.scrollWidth - strip.clientWidth, y: strip.scrollHeight - strip.clientHeight };
    });

  /**
   * Every tab chosen in turn, the strip measured at every width: it never
   * scrolls vertically, and from `fitsFrom`, where all its tabs fit, it does
   * not scroll sideways either. On a phone it does, which is what it is for.
   */
  const expectStripScrollsOnlyWhereItMust = async (page: Page, screen: string, tabCount: number, fitsFrom: number) => {
    const tabs = page.locator('.dash-tab');
    await expect(tabs).toHaveCount(tabCount);
    for (let index = 0; index < tabCount; index += 1) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await tabs.nth(index).click();
      await expect(tabs.nth(index)).toHaveClass(/(^|\s)active(\s|$)/);
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        const overflow = await stripOverflow(page);
        const where = `${screen}, tab ${index + 1} of ${tabCount} chosen, at ${width}px`;
        expect(overflow.y, `the tab strip scrolls vertically, ${where}`).toBeLessThanOrEqual(0);
        if (width >= fitsFrom) expect(overflow.x, `the tab strip scrolls sideways, ${where}`).toBeLessThanOrEqual(0);
      }
    }
    await page.setViewportSize({ width: 1280, height: 900 });
  };

  /**
   * A tab reached with the keyboard draws the phase bar's ring, inside its own
   * box: a ring drawn outside it is clipped by the strip, which scrolls.
   */
  const expectRingInsideTheTab = async (page: Page) => {
    await page.locator('.dash-tab').first().click();
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => {
      const focused = document.activeElement;
      if (!(focused instanceof HTMLElement)) return null;
      const style = getComputedStyle(focused);
      return {
        onATab: focused.classList.contains('dash-tab'),
        shown: focused.matches(':focus-visible'),
        outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineOffset}`,
      };
    });
    expect(ring).toEqual({ onATab: true, shown: true, outline: 'solid 2px -2px' });
  };

  test('the dashboard’s tabs scroll sideways only where they do not fit, and never vertically', async ({ page }) => {
    await createTeam(page, `E2E-Scrollbars-${Date.now()}`);
    await switchToFrench(page);
    // Its six French labels take about 880px, in a strip 960px or more wide from 1024.
    await expectStripScrollsOnlyWhereItMust(page, 'dashboard', 6, 1024);
    await expectRingInsideTheTab(page);
  });

  test('the console’s tabs scroll sideways only where they do not fit, and never vertically', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Super Admin Access' }).click();
    await page.getByLabel('Super Admin Password').fill('e2e-super-admin-password');
    await page.getByRole('button', { name: 'Access Admin Panel' }).click();
    await expect(page.getByRole('heading', { name: /Super Admin Dashboard/ })).toBeVisible({ timeout: 10_000 });
    await switchToFrench(page);
    // Sideways from 1280 only: these tabs carry counts that grow with the
    // server (its teams, unread feedback, live sessions, errors in its log,
    // backups), and in French they leave about 35px of the strip at 1024,
    // which a count of errors takes. Where they do not fit, the strip scrolls.
    await expectStripScrollsOnlyWhereItMust(page, 'console', 5, 1280);
    await expectRingInsideTheTab(page);
  });
});

test.describe('a retrospective’s first phases on a phone', () => {
  const PHONE_WIDTHS = [320, 360, 390, 414];

  test('the Icebreaker shows its default question whole, and the five moods fit the screen', async ({ page }) => {
    await createTeam(page, `E2E-Phone-${Date.now()}`);
    await page.getByRole('button', { name: 'New Retrospective' }).click();
    await page.getByTestId('template-language-fr').click();
    await page.getByTestId('retro-template-start_stop_continue').click();
    const question = page.getByTestId('icebreaker-question-input');
    await expect(question).toHaveValue(ICEBREAKER_QUESTIONS.fr[0], { timeout: 10_000 });
    // The screen in French too: its longer buttons wrap, and leave the field less room.
    await switchToFrench(page);

    // The French retro's own default question, then an English retro's.
    for (const [language, text] of [['French', ICEBREAKER_QUESTIONS.fr[0]], ['English', ICEBREAKER_QUESTIONS.en[0]]]) {
      if ((await question.inputValue()) !== text) await question.fill(text);
      for (const width of PHONE_WIDTHS) {
        await page.setViewportSize({ width, height: 844 });
        const scrolls = await question.evaluate(async (field) => {
          await document.fonts.ready;
          return field.scrollHeight - field.clientHeight;
        });
        expect(scrolls, `the question field scrolls, ${language} default question at ${width}px`).toBeLessThanOrEqual(0);
      }
    }

    await page.getByRole('button', { name: 'Démarrer la session' }).click();
    await expect(page.getByRole('heading', { name: "Météo de l'humeur" })).toBeVisible({ timeout: 10_000 });
    // The e2e flow finds the five moods by this class (retro-full-flow.spec.ts).
    const moods = page.locator('button.text-6xl');
    await expect(moods).toHaveCount(5);
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 844 });
      const fit = await moods.first().evaluate(async (firstMood) => {
        await document.fonts.ready;
        // The Welcome screen is the nearest box around the moods that scrolls.
        let screen = firstMood.parentElement;
        while (screen && getComputedStyle(screen).overflowY === 'visible') screen = screen.parentElement;
        if (!screen) throw new Error('no scrolling box around the moods');
        const edges = screen.getBoundingClientRect();
        const row = [...(firstMood.parentElement?.children ?? [])].map((mood) => mood.getBoundingClientRect());
        return {
          sideways: screen.scrollWidth - screen.clientWidth,
          cutOff: row.filter((mood) => mood.left < edges.left - 0.5 || mood.right > edges.right + 0.5).length,
        };
      });
      const where = `the Welcome phase at ${width}px`;
      expect(fit.sideways, `scrolls sideways, ${where}`).toBeLessThanOrEqual(0);
      expect(fit.cutOff, `moods past the screen's edge, ${where}`).toBe(0);
    }
  });
});
