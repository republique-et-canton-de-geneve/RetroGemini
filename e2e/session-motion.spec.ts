import { test, expect, Page, BrowserContext, Browser, Locator } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from './helpers/announcements';

/**
 * The board's motion, in a real browser with motion on (the "motion" project of
 * playwright.config.ts; every other spec emulates reduced motion). Every effect
 * is decoration: it plays once for something that just happened, takes its
 * class off when it ends, never moves a box a test measures or a click aims
 * at, and plays nothing at all for a reader who asked for less motion.
 *
 * Each page records every `fx-*` class put on an element, and every element
 * added with one (the vote's `.fx-layer`), from the first line of the page on:
 * an effect that ran and went is still in the record.
 */

const TEAM_PASSWORD = 'testpass123456';
const PARTICIPANT_NAME = 'Alice Participant';

type Effect = { cls: string; key: string; text: string; at: number };

const recordEffects = async (context: BrowserContext) => {
  await context.addInitScript(() => {
    const record: Effect[] = [];
    (window as unknown as { __fx: Effect[] }).__fx = record;
    const note = (el: Element, cls: string) => record.push({
      cls,
      key: el.getAttribute('data-ticket-id') ?? el.getAttribute('data-group-id') ?? el.getAttribute('data-testid') ?? el.tagName.toLowerCase(),
      text: (el.textContent ?? '').slice(0, 80),
      at: performance.now(),
    });
    // What each element was last seen carrying: one class put on is one
    // record, however many mutations report the same attribute.
    const seen = new WeakMap<Element, Set<string>>();
    const look = (el: Element) => {
      const now = new Set([...el.classList].filter((c) => c.startsWith('fx-')));
      const before = seen.get(el) ?? new Set<string>();
      for (const cls of now) if (!before.has(cls)) note(el, cls);
      seen.set(el, now);
    };
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes') look(m.target as Element);
        else {
          for (const node of m.addedNodes) {
            if (node.nodeType !== 1) continue;
            const el = node as Element;
            for (const one of [el, ...el.querySelectorAll('[class*="fx-"]')]) look(one);
          }
        }
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  });
};

/**
 * The effects of the board, its bar and its panel, played by what happens in
 * a session. Dialogs and the "who is writing" pencil carry their classes as
 * they are drawn, inert under reduced motion (index.css declares every effect
 * under `no-preference`), so they are not in this list.
 */
const BOARD_EFFECTS = new Set(['fx-card-in', 'fx-ring', 'fx-pop', 'fx-bump', 'fx-press', 'fx-nope', 'fx-title-in', 'fx-person-in', 'fx-halo', 'fx-reveal', 'fx-layer', 'fx-token']);

const effectsSince = (page: Page, since: number) =>
  page.evaluate((t) => (window as unknown as { __fx: Effect[] }).__fx.filter((e) => e.at >= t), since);
const now = (page: Page) => page.evaluate(() => performance.now());

/** The `fx-*` classes still on the page, and the finite animations still running. */
const leftovers = (page: Page) => page.evaluate(() => ({
  classes: [...document.querySelectorAll('[class*="fx-"]')]
    .flatMap((el) => [...el.classList].filter((c) => c.startsWith('fx-'))),
  running: document.getAnimations()
    .filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity)
    .map((a) => (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? 'script'),
  layers: document.querySelectorAll('.fx-layer').length,
}));

const expectNothingLeft = async (page: Page) => {
  await page.mouse.move(0, 0);
  await expect.poll(() => leftovers(page), { timeout: 5_000 }).toEqual({ classes: [], running: [], layers: 0 });
};

const columns = (page: Page) => page.locator('[data-column-id]');
const card = (page: Page, text: string) => page.locator('[data-ticket-id]').filter({ hasText: text });
const goPhase = async (page: Page, label: string) => {
  await page.locator('.phase-nav-btn', { hasText: label }).click();
};

const addIdea = async (page: Page, column: number, text: string) => {
  const field = columns(page).nth(column).getByPlaceholder('Add an idea...');
  await field.click();
  await field.fill(text);
  await page.keyboard.press('Enter');
  await expect(columns(page).nth(column).locator('[data-ticket-id]').filter({ hasText: text })).toHaveCount(1);
};

/** A team, a guided retrospective at its Icebreaker, and a participant who joined through the invite link. */
const startRetro = async (browser: Browser, teamName: string) => {
  const facilitatorContext = await browser.newContext();
  const participantContext = await browser.newContext();
  await recordEffects(facilitatorContext);
  await recordEffects(participantContext);
  const facilitator = await facilitatorContext.newPage();
  const participant = await participantContext.newPage();

  await facilitator.goto('/');
  await facilitator.waitForLoadState('networkidle');
  await facilitator.getByRole('button', { name: '+ New Team' }).click();
  await facilitator.getByPlaceholder('e.g. Design Team').fill(teamName);
  await facilitator.locator('input[type="password"]').fill(TEAM_PASSWORD);
  await facilitator.getByLabel('Recovery Email').fill('facilitator@example.com');
  await facilitator.getByRole('button', { name: 'Create & Join' }).click();
  await expect(facilitator.getByText(`${teamName} Dashboard`)).toBeVisible({ timeout: 15_000 });
  await dismissAnnouncementsIfPresent(facilitator);
  await facilitator.getByRole('button', { name: 'New Retrospective' }).click();
  await facilitator.locator('text=Start, Stop, Continue').first().click();
  await expect(facilitator.getByRole('heading', { name: 'Icebreaker' })).toBeVisible({ timeout: 15_000 });

  await facilitator.locator('button[title="Invite / Join"]').click();
  await facilitator.getByRole('button', { name: 'CODE & LINK' }).click();
  const link = facilitator.locator('code').first();
  await expect(link).toContainText('?join=', { timeout: 15_000 });
  const inviteUrl = (await link.textContent()) ?? '';
  await facilitator.getByRole('button', { name: 'Done' }).click();

  const join = async () => {
    await participant.goto(inviteUrl);
    const joinHeading = participant.getByText(`Join ${teamName}`);
    const icebreaker = participant.getByRole('heading', { name: 'Icebreaker' });
    const entry = await Promise.race([
      joinHeading.waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'JOIN' as const),
      icebreaker.waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'AUTO_JOIN' as const),
    ]);
    if (entry === 'JOIN') {
      const notInList = participant.getByRole('button', { name: "I'm not in the list" });
      if (await notInList.isVisible({ timeout: 2_000 }).catch(() => false)) await notInList.click();
      await participant.getByPlaceholder('e.g. John Doe').fill(PARTICIPANT_NAME);
      await participant.getByRole('button', { name: 'Join Retrospective' }).click();
    }
    await expect(icebreaker).toBeVisible({ timeout: 20_000 });
  };
  const close = async () => {
    await facilitatorContext.close();
    await participantContext.close();
  };
  return { facilitator, participant, join, close };
};

const plusOf = (item: Locator) => item.getByRole('button', { name: /^Add a vote to this/ });

test.describe('the board’s motion', () => {
  test('plays once for what happened, leaves nothing behind and moves no measured box', async ({ browser }) => {
    const { facilitator, participant, join, close } = await startRetro(browser, `E2E-Motion-${Date.now()}`);
    try {
      // ---- (c) A guest who joins lights their row once; no row moves ----
      const panel = facilitator.getByTestId('participants-panel');
      const ownRow = panel.getByTestId('participant-row').first();
      await expect(ownRow).toBeVisible();
      const ownBefore = (await ownRow.boundingBox())!;
      // Past the quiet seconds that follow the facilitator's own connection.
      await facilitator.waitForTimeout(3_200);
      const beforeJoin = await now(facilitator);
      await join();
      const guestRow = panel.getByTestId('participant-row').filter({ hasText: PARTICIPANT_NAME });
      await expect(guestRow).toBeVisible({ timeout: 15_000 });
      // Sampled through the arrival (its wash lasts 1.6s): the guest's row
      // slides sideways only, and the facilitator's row stays where it was.
      const guestBoxes: Array<{ y: number; height: number }> = [];
      for (let i = 0; i < 8; i += 1) {
        guestBoxes.push((await guestRow.boundingBox())!);
        const own = (await ownRow.boundingBox())!;
        expect(Math.abs(own.y - ownBefore.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(own.height - ownBefore.height)).toBeLessThanOrEqual(1);
        await facilitator.waitForTimeout(200);
      }
      for (const box of guestBoxes) {
        expect(Math.abs(box.y - guestBoxes.at(-1)!.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(box.height - guestBoxes.at(-1)!.height)).toBeLessThanOrEqual(1);
      }
      const arrivals = (await effectsSince(facilitator, beforeJoin))
        .filter((e) => e.cls === 'fx-person-in' && e.text.includes(PARTICIPANT_NAME));
      expect(arrivals).toHaveLength(1);
      await expectNothingLeft(facilitator);

      // ---- (a) A phase change slides its title in and nothing else; a reload plays nothing ----
      const beforePhase = await now(facilitator);
      await goPhase(facilitator, 'Brainstorm');
      await expect(facilitator.getByRole('heading', { level: 2, name: 'Brainstorm' })).toBeVisible();
      await expect(participant.getByRole('heading', { level: 2, name: 'Brainstorm' })).toBeVisible({ timeout: 10_000 });
      const phaseEffects = (await effectsSince(facilitator, beforePhase)).map((e) => e.cls);
      expect(phaseEffects.filter((cls) => cls !== 'fx-title-in')).toEqual([]);
      await expectNothingLeft(facilitator);

      await facilitator.reload();
      await expect(facilitator.getByRole('heading', { level: 2, name: 'Brainstorm' })).toBeVisible({ timeout: 15_000 });
      await facilitator.waitForTimeout(1_500);
      expect((await effectsSince(facilitator, 0)).map((e) => e.cls)).toEqual([]);
      await expectNothingLeft(facilitator);

      // ---- (b) A teammate's card rises in with a ring, once, and its box stays put ----
      await facilitator.waitForTimeout(2_000);
      const beforeCard = await now(facilitator);
      await addIdea(participant, 0, 'Pairing made the release calm');
      const arrived = facilitator.locator('[data-ticket-id]').last();
      await expect(facilitator.locator('[data-ticket-id]')).toHaveCount(1, { timeout: 10_000 });
      await facilitator.waitForTimeout(700);
      const settled = (await arrived.boundingBox())!;
      const arrivedId = await arrived.getAttribute('data-ticket-id');
      const cardEffects = (await effectsSince(facilitator, beforeCard)).filter((e) => e.key === arrivedId);
      expect(cardEffects.filter((e) => e.cls === 'fx-card-in')).toHaveLength(1);
      expect(cardEffects.filter((e) => e.cls === 'fx-ring')).toHaveLength(1);
      await facilitator.waitForTimeout(1_300);
      await expectNothingLeft(facilitator);
      const later = (await arrived.boundingBox())!;
      expect(Math.abs(later.y - settled.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(later.x - settled.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(later.height - settled.height)).toBeLessThanOrEqual(1);

      // ---- (f) A dialog opened with motion on comes to rest with no transform ----
      // The card was hidden from the facilitator; shown, its words unblur.
      await facilitator.getByRole('checkbox', { name: 'Reveal cards' }).check();
      await expect(card(facilitator, 'Pairing made the release calm')).toHaveCount(1, { timeout: 10_000 });
      await expectNothingLeft(facilitator);
      await card(facilitator, 'Pairing made the release calm').hover();
      await card(facilitator, 'Pairing made the release calm').getByTestId('ticket-comment-btn').click();
      const dialog = facilitator.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await facilitator.waitForTimeout(600);
      const rest = await dialog.evaluate((panel) => {
        // A transform left on the panel or an ancestor would make it the box
        // its fixed children are placed in.
        const transforms: string[] = [];
        for (let el: Element | null = panel; el; el = el.parentElement) {
          const value = getComputedStyle(el).transform;
          if (value && value !== 'none') transforms.push(`${el.tagName}:${value}`);
        }
        const box = panel.getBoundingClientRect();
        return { transforms, inside: box.top >= 0 && box.left >= 0 && box.bottom <= innerHeight + 1 && box.right <= innerWidth + 1 };
      });
      expect(rest).toEqual({ transforms: [], inside: true });
      await expectNothingLeft(facilitator);
      await facilitator.keyboard.press('Escape');
      await expect(dialog).toBeHidden();

      // ---- (d) A vote sends one token, which goes; the focus stays on the plus ----
      await goPhase(facilitator, 'Vote');
      await expect(facilitator.getByText('5 votes remaining')).toBeVisible({ timeout: 10_000 });
      await facilitator.waitForTimeout(600);
      const voted = card(facilitator, 'Pairing made the release calm');
      const plus = plusOf(voted);
      const beforeVote = await now(facilitator);
      await plus.click();
      const flight = await facilitator.evaluate(() => ({
        layers: document.querySelectorAll('.fx-layer').length,
        tokens: document.querySelectorAll('.fx-layer .fx-token').length,
      }));
      expect(flight).toEqual({ layers: 1, tokens: 1 });
      await expect(facilitator.getByText('4 votes remaining')).toBeVisible();
      await expectNothingLeft(facilitator);
      await expect(plus).toBeFocused();
      const voteEffects = await effectsSince(facilitator, beforeVote);
      expect(voteEffects.filter((e) => e.cls === 'fx-layer')).toHaveLength(1);
      expect(voteEffects.filter((e) => e.cls === 'fx-ring')).toHaveLength(1);

      // ---- (d) An empty budget shakes, and nothing flies ----
      for (let left = 4; left > 0; left -= 1) {
        await plus.click();
        await expect(facilitator.getByText(`${left - 1} ${left - 1 === 1 ? 'vote' : 'votes'} remaining`)).toBeVisible();
      }
      await expectNothingLeft(facilitator);
      await expect(plus).toHaveAttribute('aria-disabled', 'true');
      const beforeRefused = await now(facilitator);
      // The keyboard's click: the plus is aria-disabled, which a pointer click
      // in Playwright waits on, and the keyboard is where the focus is.
      await plus.focus();
      await facilitator.keyboard.press('Enter');
      await facilitator.waitForTimeout(600);
      const refused = await effectsSince(facilitator, beforeRefused);
      expect(refused.filter((e) => e.cls === 'fx-nope')).toHaveLength(1);
      expect(refused.filter((e) => e.cls === 'fx-layer' || e.cls === 'fx-token')).toEqual([]);
      await expect(plus).toBeFocused();
      await expect(facilitator.getByText('0 votes remaining')).toBeVisible();
      await expectNothingLeft(facilitator);
    } finally {
      await close();
    }
  });

  test.describe('with reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('nothing at all moves: no effect class, no flying token', async ({ browser }) => {
      const { facilitator, participant, join, close } = await startRetro(browser, `E2E-Still-${Date.now()}`);
      try {
        await facilitator.waitForTimeout(3_200);
        await join();
        await expect(facilitator.getByTestId('participant-row').filter({ hasText: PARTICIPANT_NAME })).toBeVisible({ timeout: 15_000 });
        await goPhase(facilitator, 'Brainstorm');
        await expect(participant.getByRole('heading', { level: 2, name: 'Brainstorm' })).toBeVisible({ timeout: 10_000 });
        await addIdea(participant, 0, 'Pairing made the release calm');
        await expect(facilitator.locator('[data-ticket-id]')).toHaveCount(1, { timeout: 10_000 });
        await goPhase(facilitator, 'Vote');
        const plus = plusOf(card(facilitator, 'Pairing made the release calm'));
        // Five votes, then one refused (the keyboard's click: the plus is aria-disabled by then).
        await plus.focus();
        for (let i = 0; i < 6; i += 1) {
          await facilitator.keyboard.press('Enter');
          await facilitator.waitForTimeout(250);
        }
        await expect(facilitator.getByText('0 votes remaining')).toBeVisible();
        await facilitator.waitForTimeout(800);
        const board = async (page: Page) => (await effectsSince(page, 0)).filter((e) => BOARD_EFFECTS.has(e.cls));
        expect(await board(facilitator)).toEqual([]);
        expect(await board(participant)).toEqual([]);
        const still = await leftovers(facilitator);
        expect(still.layers).toBe(0);
        expect(still.running).toEqual([]);
      } finally {
        await close();
      }
    });
  });
});
