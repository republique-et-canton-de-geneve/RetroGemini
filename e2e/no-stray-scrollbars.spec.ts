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
 *    with the default question (by 102px at 414px, 215px at 320px). On a short
 *    phone it still did once that was fixed: the card kept a fixed 600px and
 *    shrank into the screen, so the field cut off the French default question
 *    at 360 × 640 (36px), at 375 × 667 under the avatar band (9px) and at
 *    320 × 568 (78px). Below `sm` the field is now as tall as the tallest
 *    built-in question of the retro's language (as its own words when they are
 *    taller), so that "Random" never moves under the finger, and the screen
 *    scrolls instead, its top never cut off; a participant's question, shown as
 *    text, fits the same way.
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

const inviteLink = async (page: Page) => {
  await page.locator('button[title="Invite / Join"]').click();
  await page.getByRole('button', { name: 'CODE & LINK' }).click();
  const code = page.locator('code').first();
  await expect(code).toContainText('?join=', { timeout: 10_000 });
  const url = (await code.textContent()) ?? '';
  await page.getByRole('button', { name: 'Done' }).click();
  return url;
};

/** Joins from an invite link as a new member, in a French browser. */
const joinInFrench = async (page: Page, url: string, name: string) => {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  await page.getByText(/^Rejoindre /).first().waitFor({ state: 'visible', timeout: 15_000 });
  const notInList = page.getByRole('button', { name: '+ Je ne suis pas dans la liste' });
  if (await notInList.isVisible().catch(() => false)) await notInList.click();
  await page.getByPlaceholder('p. ex. Jean Dupont').fill(name);
  await page.getByRole('button', { name: 'Rejoindre la rétrospective' }).click();
  await expect(page.locator('header [data-viewer-avatar]')).toBeVisible({ timeout: 15_000 });
};

/** The one-time avatar band (AGENTS.md, *Avatars*), named by its French title. */
const AVATAR_BAND_FR = 'Nouveau\u00a0: choisissez votre avatar';

/** A built-in French question, found by its first words so a reordered list cannot hide it. */
const frenchQuestion = (start: string) => {
  const found = ICEBREAKER_QUESTIONS.fr.find((question) => question.startsWith(start));
  if (!found) throw new Error(`no built-in French question starts with "${start}"`);
  return found;
};

/** The two default questions, and the three longest French ones. */
const QUESTIONS: ReadonlyArray<readonly [string, string]> = [
  ['the French default question', ICEBREAKER_QUESTIONS.fr[0]],
  ['the English default question', ICEBREAKER_QUESTIONS.en[0]],
  ['the French skill question', frenchQuestion('Si vous pouviez maîtriser')],
  ['the French historical figure question', frenchQuestion('Si vous pouviez rencontrer')],
  ['the French pets question', frenchQuestion('Avez-vous des animaux')],
];

/** Phones short and tall: an iPhone SE (320 × 568, 375 × 667), a small Android, and two common ones. */
const PHONES = [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 414, height: 896 },
];

/**
 * How the Icebreaker sits on the screen: how far its question scrolls inside
 * itself (the facilitator's field) or reaches past its box (a participant's
 * text), whether anything of the card reaches past the card, and whether the
 * screen around it shows all of it, scrolled: its top never cut off, its bottom
 * within reach, nothing sideways.
 */
const icebreakerFit = (page: Page) =>
  page.evaluate(async () => {
    await document.fonts.ready;
    const field = document.querySelector<HTMLTextAreaElement>('[data-testid="icebreaker-question-input"]');
    const text = document.querySelector<HTMLElement>('[data-testid="icebreaker-question-display"]');
    const question = field ?? text;
    if (!question) throw new Error('no Icebreaker question on this screen');
    // The card: the panel that holds the phase's title and the question.
    const card = [...document.querySelectorAll('h2')].map((title) => title.parentElement).find((panel) => panel?.contains(question));
    if (!card) throw new Error('no Icebreaker card');
    // The screen: the nearest box around the card that scrolls vertically.
    let screen = card.parentElement;
    while (screen && !['auto', 'scroll'].includes(getComputedStyle(screen).overflowY)) screen = screen.parentElement;
    if (!screen) throw new Error('no scrolling box around the Icebreaker');
    screen.scrollTop = 0;
    const edges = screen.getBoundingClientRect();
    const panel = card.getBoundingClientRect();
    // How far a box reaches past the box around it, on any side.
    const past = (inner: DOMRect, outer: { top: number; bottom: number; left: number; right: number }) =>
      Math.max(outer.top - inner.top, inner.bottom - outer.bottom, outer.left - inner.left, inner.right - outer.right);
    let spills = 0;
    if (text) {
      // A participant's question inside the padding of its box.
      const box = text.parentElement!;
      const style = getComputedStyle(box);
      const b = box.getBoundingClientRect();
      spills = past(text.getBoundingClientRect(), {
        top: b.top + parseFloat(style.paddingTop),
        bottom: b.bottom - parseFloat(style.paddingBottom),
        left: b.left + parseFloat(style.paddingLeft),
        right: b.right - parseFloat(style.paddingRight),
      });
    }
    // What reaches furthest past the card, named for the failure message.
    let outOfCard = 0;
    let furthest = '';
    for (const element of card.querySelectorAll('*')) {
      if (element.getClientRects().length === 0) continue;
      const by = past(element.getBoundingClientRect(), panel);
      if (by > outOfCard) {
        outOfCard = by;
        furthest = `<${element.tagName.toLowerCase()}> ${(element.textContent ?? '').trim().slice(0, 40)}`;
      }
    }
    const band = document.querySelector('[data-avatar-hint]');
    // The facilitator's "Random", found by its icon: where it sits in what the screen scrolls.
    const random = [...card.querySelectorAll('button')].find((button) => button.textContent?.includes('shuffle'));
    return {
      band: !!band && band.getBoundingClientRect().height > 0,
      randomAt: random ? random.getBoundingClientRect().top - edges.top + screen.scrollTop : null,
      inField: field ? field.scrollHeight - field.clientHeight : 0,
      spills: Math.max(0, spills),
      outOfCard,
      furthest,
      topCutOff: edges.top - panel.top,
      bottomOutOfReach: panel.bottom - edges.top - screen.scrollHeight,
      sideways: screen.scrollWidth - screen.clientWidth,
    };
  });

/**
 * Every question of `QUESTIONS`, put on the screen by `show`, measured on every
 * phone of `PHONES`, with the avatar band drawn where `bandAt` says. Where the
 * facilitator's "Random" is drawn, it stays where it was from one question to
 * the next (none is taller than the French retro's tallest built-in one):
 * pressed again, it must still be under the finger.
 */
const expectEveryQuestionToFit = async (
  page: Page,
  who: string,
  show: (question: string) => Promise<void>,
  bandAt: (width: number) => boolean
) => {
  const randomAt = new Map<number, { at: number; what: string }>();
  for (const [what, question] of QUESTIONS) {
    await show(question);
    for (const phone of PHONES) {
      await page.setViewportSize(phone);
      const fit = await icebreakerFit(page);
      const band = bandAt(phone.width);
      const where = `${who}, ${what}, ${band ? 'under' : 'without'} the avatar band, at ${phone.width} × ${phone.height}`;
      expect(fit.band, `the avatar band drawn, ${where}`).toBe(band);
      if (fit.randomAt !== null) {
        const first = randomAt.get(phone.width);
        if (!first) randomAt.set(phone.width, { at: fit.randomAt, what });
        else expect(Math.abs(fit.randomAt - first.at), `"Random" moved from where ${first.what} put it, ${where}`).toBeLessThanOrEqual(0.5);
      }
      expect(fit.inField, `the question field scrolls inside itself, ${where}`).toBeLessThanOrEqual(0);
      expect(fit.spills, `the question reaches past its box, ${where}`).toBeLessThanOrEqual(0.5);
      expect(fit.outOfCard, `${fit.furthest} reaches past the Icebreaker's card, ${where}`).toBeLessThanOrEqual(0.5);
      expect(fit.topCutOff, `the top of the Icebreaker is cut off, ${where}`).toBeLessThanOrEqual(0.5);
      expect(fit.bottomOutOfReach, `the bottom of the Icebreaker is out of reach, ${where}`).toBeLessThanOrEqual(0.5);
      expect(fit.sideways, `the screen scrolls sideways, ${where}`).toBeLessThanOrEqual(0);
    }
  }
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

  test('the Icebreaker shows every built-in question whole, on short phones too, and the five moods fit the screen', async ({ page }) => {
    await createTeam(page, `E2E-Phone-${Date.now()}`);
    await page.getByRole('button', { name: 'New Retrospective' }).click();
    await page.getByTestId('template-language-fr').click();
    await page.getByTestId('retro-template-start_stop_continue').click();
    const question = page.getByTestId('icebreaker-question-input');
    await expect(question).toHaveValue(ICEBREAKER_QUESTIONS.fr[0], { timeout: 10_000 });
    // The screen in French too: its longer buttons wrap, and leave the field less room.
    await switchToFrench(page);

    const type = async (text: string) => {
      if ((await question.inputValue()) !== text) await question.fill(text);
    };
    // Under the one-time avatar band first (a facilitator's is drawn from
    // 360px, with their avatar), then once it is put away.
    await expectEveryQuestionToFit(page, 'the facilitator', type, (width) => width >= 360);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('note', { name: AVATAR_BAND_FR }).getByRole('button', { name: 'Compris', exact: true }).click();
    await expect(page.locator('[data-avatar-hint]')).toHaveCount(0);
    await expectEveryQuestionToFit(page, 'the facilitator', type, () => false);

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

  test('a participant’s Icebreaker shows every built-in question whole, on short phones too', async ({ page, browser }) => {
    await createTeam(page, `E2E-Phone-Guest-${Date.now()}`);
    await page.getByRole('button', { name: 'New Retrospective' }).click();
    await page.getByTestId('template-language-fr').click();
    await page.getByTestId('retro-template-start_stop_continue').click();
    const question = page.getByTestId('icebreaker-question-input');
    await expect(question).toHaveValue(ICEBREAKER_QUESTIONS.fr[0], { timeout: 10_000 });
    const url = await inviteLink(page);

    const guestContext = await browser.newContext({ viewport: PHONES[3], locale: 'fr-CH', reducedMotion: 'reduce' });
    try {
      const guest = await guestContext.newPage();
      await joinInFrench(guest, url, 'Lea Telephone');
      const shown = guest.getByTestId('icebreaker-question-display');
      // The facilitator writes it, and the participant reads it as text.
      const write = async (text: string) => {
        if ((await question.inputValue()) !== text) await question.fill(text);
        await expect(shown).toHaveText(text, { timeout: 10_000 });
      };
      // A participant's band is drawn at every width, with their avatar.
      await expectEveryQuestionToFit(guest, 'a participant', write, () => true);
      await guest.setViewportSize(PHONES[3]);
      await guest.getByRole('note', { name: AVATAR_BAND_FR }).getByRole('button', { name: 'Compris', exact: true }).click();
      await expect(guest.locator('[data-avatar-hint]')).toHaveCount(0);
      await expectEveryQuestionToFit(guest, 'a participant', write, () => false);
    } finally {
      await guestContext.close();
    }
  });
});
