import { test, expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from './helpers/announcements';
import { audit } from './helpers/axe';

/**
 * Avatars (45.0), with two browsers: what jsdom cannot hold. A pick made in
 * one browser reaches the other's participants panel and card through the
 * server (the team's map, and the live session's entry the route stamps), it
 * survives a reload of both, it shows on the dashboard's Members tab, clearing
 * it brings the initials back, an anonymous retrospective shows no picture
 * anywhere, and a save the server refuses keeps its error on screen and
 * changes nothing.
 */

const TEAM_PASSWORD = 'avatar-e2e-password';
const GUEST = 'Bea Avatar';

const createTeam = async (page: Page, teamName: string) => {
  await page.goto('./');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '+ New Team' }).click();
  await page.getByPlaceholder('e.g. Design Team').fill(teamName);
  await page.locator('input[type="password"]').fill(TEAM_PASSWORD);
  await page.getByLabel('Recovery Email').fill('facilitator@example.com');
  await page.getByRole('button', { name: 'Create & Join' }).click();
  await expect(page.getByText(`${teamName} Dashboard`)).toBeVisible({ timeout: 10_000 });
  await dismissAnnouncementsIfPresent(page);
};

const startRetro = async (page: Page, { anonymous = false } = {}) => {
  await page.getByRole('button', { name: 'New Retrospective' }).click();
  const dialog = page.getByRole('dialog');
  if (anonymous) await dialog.getByRole('button', { name: /anonymous/i }).first().click();
  await dialog.getByTestId('retro-template-start_stop_continue').click();
  await expect(page.getByTestId('icebreaker-question-input')).toBeVisible({ timeout: 10_000 });
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

const join = async (page: Page, url: string) => {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  const joinHeading = page.getByText(/^Join /).first();
  const inSession = page.locator('header [data-viewer-avatar]');
  const entry = await Promise.race([
    joinHeading.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'JOIN' as const),
    inSession.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'IN' as const),
  ]);
  if (entry === 'JOIN') {
    const member = page.getByRole('button', { name: new RegExp(GUEST) });
    if (await member.count()) {
      await member.first().click();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
    } else {
      const notInList = page.getByRole('button', { name: "I'm not in the list" });
      if (await notInList.isVisible({ timeout: 2_000 }).catch(() => false)) await notInList.click();
      await page.getByPlaceholder('e.g. John Doe').fill(GUEST);
      await page.getByRole('button', { name: 'Join Retrospective' }).click();
    }
  }
  await expect(inSession).toBeVisible({ timeout: 15_000 });
};

const openPicker = async (page: Page) => {
  await page.locator('header [data-viewer-avatar]').click();
  const picker = page.getByRole('dialog', { name: 'Choose my avatar' });
  await expect(picker).toBeVisible();
  return picker;
};

/** Picks `name` in `family` (or "My initials" for null) and closes the picker once saved. */
const pick = async (page: Page, family: string, name: string | null) => {
  const picker = await openPicker(page);
  if (name) {
    await picker.getByRole('tab', { name: family }).click();
    await picker.getByRole('button', { name, exact: true }).click();
  } else {
    await picker.getByRole('button', { name: /, My initials$/ }).click();
  }
  await expect(picker.getByText('Avatar saved.')).toBeVisible({ timeout: 10_000 });
  await picker.getByRole('button', { name: 'Done' }).click();
  await expect(picker).toHaveCount(0);
};

const panelRow = (page: Page, name: string) => page.getByTestId('participant-row').filter({ hasText: name });
const card = (page: Page, text: string) => page.locator('[data-ticket-id]').filter({ hasText: text }).first();

const addCard = async (page: Page, text: string) => {
  const field = page.getByPlaceholder('Add an idea...').first();
  await field.fill(text);
  await field.press('Enter');
  await expect(page.getByText(text).first()).toBeVisible();
};

test.describe('avatars', () => {
  test.describe.configure({ mode: 'serial' });

  let facilitatorContext: BrowserContext;
  let guestContext: BrowserContext;
  let facilitator: Page;
  let guest: Page;
  const teamName = `E2E-Avatars-${Date.now()}`;
  const CARD = 'Pairing helped a lot';

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    facilitatorContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    guestContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    facilitator = await facilitatorContext.newPage();
    guest = await guestContext.newPage();
  });

  test.afterAll(async () => {
    await facilitatorContext?.close();
    await guestContext?.close();
  });

  test('a pick reaches the other browser, survives a reload, shows on the Members tab, and clears', async () => {
    await createTeam(facilitator, teamName);
    await startRetro(facilitator);
    await join(guest, await inviteLink(facilitator));

    await facilitator.getByRole('button', { name: 'Start Session' }).click();
    await facilitator.getByRole('button', { name: 'BRAINSTORM', exact: true }).click();
    await expect(guest.getByPlaceholder('Add an idea...').first()).toBeVisible({ timeout: 10_000 });
    await addCard(guest, CARD);
    await facilitator.getByLabel('Reveal cards').check();
    await expect(card(facilitator, CARD)).toBeVisible();

    // Before any pick: initials everywhere.
    await expect(panelRow(facilitator, GUEST).locator('[data-avatar-art]')).toHaveCount(0);

    await pick(guest, 'Animals', 'Fox');
    // The guest's own header, the facilitator's panel row and the card.
    await expect(guest.locator('header [data-viewer-avatar] [data-avatar-art="fox"]')).toBeVisible();
    await expect(panelRow(facilitator, GUEST).locator('[data-avatar-art="fox"]')).toBeVisible({ timeout: 10_000 });
    await expect(card(facilitator, CARD).locator('[data-avatar-art="fox"]')).toBeVisible();

    // Both reload: the choice is stored, not only on screen.
    await Promise.all([facilitator.reload(), guest.reload()]);
    await expect(panelRow(facilitator, GUEST).locator('[data-avatar-art="fox"]')).toBeVisible({ timeout: 15_000 });
    await expect(card(facilitator, CARD).locator('[data-avatar-art="fox"]')).toBeVisible();
    await expect(guest.locator('header [data-viewer-avatar] [data-avatar-art="fox"]')).toBeVisible({ timeout: 15_000 });

    // Clearing brings the initials back for the other browser too.
    await pick(guest, 'Animals', null);
    await expect(panelRow(facilitator, GUEST).locator('[data-avatar-art]')).toHaveCount(0, { timeout: 10_000 });
    await expect(panelRow(facilitator, GUEST).getByText('BE', { exact: true })).toBeVisible();
    await expect(card(facilitator, CARD).locator('[data-avatar-art]')).toHaveCount(0);

    // Picked again, and read on the dashboard's Members tab, outside any session.
    await pick(guest, 'Animals', 'Owl');
    await expect(panelRow(facilitator, GUEST).locator('[data-avatar-art="owl"]')).toBeVisible({ timeout: 10_000 });
    // The facilitator chooses one too, from the dashboard's top bar this time.
    await facilitator.getByRole('button', { name: 'Leave the retrospective' }).click();
    await pick(facilitator, 'Animals', 'Cat');
    await expect(facilitator.locator('header [data-viewer-avatar] [data-avatar-art="cat"]')).toBeVisible();
    await facilitator.locator('.dash-tab', { hasText: 'Members' }).click();
    await expect(facilitator.getByText(GUEST, { exact: true })).toBeVisible({ timeout: 10_000 });
    // Only the guest chose Owl and only the facilitator Cat: each picture is theirs.
    await expect(facilitator.locator('[data-avatar-art="owl"]')).toHaveCount(1);
    await expect(facilitator.locator('[data-avatar-art="cat"]')).toHaveCount(2);
  });

  test('a save the server refuses keeps its error on screen and changes nothing', async () => {
    await guest.route('**/member/avatar', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"failed"}' }));
    try {
      const picker = await openPicker(guest);
      await picker.getByRole('tab', { name: 'Animals' }).click();
      await picker.getByRole('button', { name: 'Bee', exact: true }).click();
      await expect(picker.getByRole('alert')).toContainText('The avatar could not be saved.', { timeout: 15_000 });
      // Still the stored choice: Owl stays selected, and the alert stays.
      await expect(picker.getByRole('button', { name: 'Owl', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(picker.getByRole('button', { name: 'Bee', exact: true })).toHaveAttribute('aria-pressed', 'false');
      await guest.waitForTimeout(1_000); // gstack-timing-ok: a negative window: an alert that went away by itself would be gone within it
      await expect(picker.getByRole('alert')).toContainText('The avatar could not be saved.');
      await picker.getByRole('button', { name: 'Done' }).click();
      await expect(guest.locator('header [data-viewer-avatar] [data-avatar-art="owl"]')).toBeVisible();
    } finally {
      await guest.unroute('**/member/avatar');
    }
  });

  test('the picker over a session passes the audit', async () => {
    const picker = await openPicker(guest);
    await audit(guest, test.info(), 'avatar-picker', { scope: picker });
    await guest.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
  });

  test('an anonymous retrospective shows no picture anywhere', async () => {
    // The facilitator is on the dashboard since the first test.
    await startRetro(facilitator, { anonymous: true });
    await join(guest, await inviteLink(facilitator));
    await facilitator.getByRole('button', { name: 'Start Session' }).click();
    await facilitator.getByRole('button', { name: 'BRAINSTORM', exact: true }).click();
    await expect(guest.getByPlaceholder('Add an idea...').first()).toBeVisible({ timeout: 10_000 });
    await addCard(guest, 'An anonymous thought');
    await facilitator.getByLabel('Reveal cards').check();
    await expect(card(facilitator, 'An anonymous thought')).toBeVisible();
    await expect(facilitator.getByTestId('participant-row')).toHaveCount(2, { timeout: 10_000 });
    // Both chose a picture; neither screen draws one, the viewer's own header included.
    await expect(facilitator.locator('[data-avatar-art]')).toHaveCount(0);
    await expect(guest.locator('[data-avatar-art]')).toHaveCount(0);
  });
});

/**
 * The one-time hint that the avatar can be changed (AGENTS.md, *Avatars*): a
 * band right under the header and a dot on the opener, for someone who never
 * chose one, where a picture would be drawn. Each person sees it until they
 * put it away or open the picker, in this browser; an anonymous retrospective
 * shows neither. Its own team, and fresh guests: everyone here starts with no
 * choice.
 */
test.describe('the avatar hint', () => {
  test.describe.configure({ mode: 'serial' });

  const HINT_EN = 'New: choose your avatar';
  const HINT_FR = 'Nouveau\u00a0: choisissez votre avatar';
  const PHONE = { width: 390, height: 844 };

  let facilitatorContext: BrowserContext;
  let facilitator: Page;
  const teamName = `E2E-Avatar-Hint-${Date.now()}`;

  const band = (page: Page) => page.locator('[data-avatar-hint]');
  const dot = (page: Page) => page.locator('header [data-viewer-avatar] [data-avatar-hint-dot]');

  /** The band starts where the header ends, and nothing of it, or of the page, overflows. */
  const expectRightUnderTheHeader = async (page: Page, note: Locator) => {
    const header = await page.locator('header').first().boundingBox();
    const box = await note.boundingBox();
    expect(header, 'the header is drawn').not.toBeNull();
    expect(box, 'the hint is drawn').not.toBeNull();
    expect(Math.abs(box!.y - (header!.y + header!.height)), 'the hint starts where the header ends').toBeLessThanOrEqual(1);
    const width = page.viewportSize()!.width;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5);
    for (const button of await note.getByRole('button').all()) {
      const r = (await button.boundingBox())!;
      expect(r.x, 'a button of the hint in view').toBeGreaterThanOrEqual(0);
      expect(r.x + r.width, 'a button of the hint in view').toBeLessThanOrEqual(width + 0.5);
      // A target of 24px at least (WCAG 2.5.8).
      expect(r.height).toBeGreaterThanOrEqual(24);
    }
    expect(await note.evaluate((element) => element.scrollWidth - element.clientWidth), 'hint overflow').toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'page overflow').toBeLessThanOrEqual(0);
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

  const newGuest = (browser: Browser) =>
    browser.newContext({ viewport: PHONE, locale: 'fr-CH', reducedMotion: 'reduce' });

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    facilitatorContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US', reducedMotion: 'reduce' });
    facilitator = await facilitatorContext.newPage();
  });

  test.afterAll(async () => {
    await facilitatorContext?.close();
  });

  test('the facilitator\'s dashboard shows it under the top bar, and "Got it" puts it away for good', async () => {
    await createTeam(facilitator, teamName);
    const note = facilitator.getByRole('note', { name: HINT_EN });
    await expect(note).toBeVisible();
    await expect(dot(facilitator)).toBeVisible();
    await expectRightUnderTheHeader(facilitator, note);
    await audit(facilitator, test.info(), 'avatar-hint-dashboard', { scope: note });

    await note.getByRole('button', { name: 'Got it', exact: true }).click();
    await expect(band(facilitator)).toHaveCount(0);
    await expect(dot(facilitator)).toHaveCount(0);

    await facilitator.reload();
    await expect(facilitator.getByText(`${teamName} Dashboard`)).toBeVisible({ timeout: 15_000 });
    await expect(facilitator.locator('header [data-viewer-avatar]')).toBeVisible();
    await expect(band(facilitator)).toHaveCount(0);
    await expect(dot(facilitator)).toHaveCount(0);
  });

  test('a guest on a French phone sees it under the header of a named retrospective, and opens the picker from it', async ({ browser }) => {
    await startRetro(facilitator);
    // Put away on the dashboard: this browser does not show it in the retrospective either.
    await expect(band(facilitator)).toHaveCount(0);
    const url = await inviteLink(facilitator);

    const guestContext = await newGuest(browser);
    try {
      const guest = await guestContext.newPage();
      await joinInFrench(guest, url, 'Bea Indice');
      const note = guest.getByRole('note', { name: HINT_FR });
      await expect(note).toBeVisible();
      await expect(dot(guest)).toBeVisible();
      await expectRightUnderTheHeader(guest, note);
      await audit(guest, test.info(), 'avatar-hint', { scope: note });

      await note.getByRole('button', { name: 'Choisir mon avatar', exact: true }).click();
      const picker = guest.getByRole('dialog', { name: 'Choisir mon avatar' });
      await expect(picker).toBeVisible();
      await expect(band(guest)).toHaveCount(0);
      await guest.keyboard.press('Escape');
      await expect(picker).toHaveCount(0);
      // The picker gives the focus back to the avatar it opens from.
      await expect(guest.locator('header [data-viewer-avatar]')).toBeFocused();
      await expect(dot(guest)).toHaveCount(0);

      // Opened once, it is remembered in this browser.
      await guest.reload();
      await expect(guest.locator('header [data-viewer-avatar]')).toBeVisible({ timeout: 15_000 });
      await expect(band(guest)).toHaveCount(0);
      await expect(dot(guest)).toHaveCount(0);
    } finally {
      await guestContext.close();
    }
  });

  test('a guest in an anonymous retrospective sees no hint and no dot', async ({ browser }) => {
    await facilitator.getByRole('button', { name: 'Leave the retrospective' }).click();
    await startRetro(facilitator, { anonymous: true });
    const url = await inviteLink(facilitator);

    const guestContext = await newGuest(browser);
    try {
      const guest = await guestContext.newPage();
      await joinInFrench(guest, url, 'Cy Anonyme');
      // The session screen is drawn: its header shows the guest's own avatar.
      await expect(guest.locator('header [data-viewer-avatar]')).toHaveAccessibleName(/, choisir mon avatar$/);
      await expect(band(guest)).toHaveCount(0);
      await expect(dot(guest)).toHaveCount(0);
    } finally {
      await guestContext.close();
    }
  });
});

/**
 * The band's own height (45.3). From `sm` it put its three pictures, its
 * sentence and its two buttons on one row that cannot wrap, which left the
 * sentence about 250px: the band was 43px tall at 639px and 117px (French) or
 * 97px (English) at 640px, and a landscape phone (667 × 375) kept 194px of
 * session under the header and the band. The pictures and the sentence now
 * show from `lg`, where they fit beside the buttons; below it the band keeps
 * its title and its two buttons, and its sentence is read, not shown, as on a
 * phone. Measured on the dashboard, whose top bar draws the opener, and so the
 * band, at every width.
 */
test.describe('the avatar hint’s band from a phone to a desktop', () => {
  // Below `lg`: a phone, the first `sm` width, a landscape phone, a tablet and the last width before `lg`.
  const COMPACT = [390, 640, 667, 768, 1023];
  const FULL = [1024, 1280];

  const bandLayout = (page: Page) =>
    page.evaluate(async () => {
      await document.fonts.ready;
      const band = document.querySelector<HTMLElement>('[data-avatar-hint]');
      if (!band) throw new Error('no avatar band on this screen');
      const title = document.getElementById(band.getAttribute('aria-labelledby') ?? '');
      if (!title) throw new Error('the band names no title');
      const column = title.parentElement!;
      const sentence = title.nextElementSibling as HTMLElement;
      const pictures = band.querySelector('[data-avatar-art]')?.closest('[aria-hidden="true"]');
      const buttons = [...band.querySelectorAll('button')].map((button) => button.getBoundingClientRect());
      const style = getComputedStyle(band);
      // The band's padding and its borders: what it adds around its row.
      const frame = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
        + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      const top = Math.min(...buttons.map((button) => button.top));
      const bottom = Math.max(...buttons.map((button) => button.bottom));
      const c = column.getBoundingClientRect();
      const s = sentence.getBoundingClientRect();
      const lineOf = (element: Element) => parseFloat(getComputedStyle(element).lineHeight);
      const sentenceShown = getComputedStyle(sentence).position !== 'absolute' && s.height > 1;
      const p = pictures?.getBoundingClientRect();
      return {
        height: band.getBoundingClientRect().height,
        frame,
        rowGap: parseFloat(getComputedStyle(band.firstElementChild!).rowGap) || 0,
        buttons: bottom - top,
        column: c.height,
        titleLine: lineOf(title),
        titleLines: Math.round(title.getBoundingClientRect().height / lineOf(title)),
        // The words beside the buttons, on one row.
        oneRow: c.top < bottom && top < c.bottom,
        pictures: p && p.width > 0 ? p.height : 0,
        sentenceShown,
        sentenceLines: sentenceShown ? Math.round(s.height / lineOf(sentence)) : 0,
        sentence: (sentence.textContent ?? '').trim(),
      };
    });

  test('keeps to its title and its buttons below lg, and shows its pictures and its sentence on two lines at most from lg', async ({ page }) => {
    await createTeam(page, `E2E-Avatar-Band-${Date.now()}`);
    await expect(page.getByRole('note', { name: 'New: choose your avatar' })).toBeVisible();
    for (const language of ['en', 'fr'] as const) {
      await page.getByTestId(`language-option-${language}`).click();
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      for (const width of [...COMPACT, ...FULL]) {
        await page.setViewportSize({ width, height: 900 });
        const m = await bandLayout(page);
        const where = `at ${width}px (${language}): ${JSON.stringify(m)}`;
        expect(m.titleLines, `the band's title on one line, ${where}`).toBe(1);
        // Still read where it is not shown: the note says what it offers.
        expect(m.sentence, `the band's sentence in the page, ${where}`).not.toBe('');
        if (width < 1024) {
          expect(m.pictures, `pictures shown below lg, ${where}`).toBe(0);
          expect(m.sentenceShown, `the sentence shown below lg, ${where}`).toBe(false);
          if (width >= 640) {
            // One row: no taller than its title's line or its buttons, whichever is taller, and its frame.
            expect(m.oneRow, `the title beside the buttons, ${where}`).toBe(true);
            expect(m.height, `the band's height, ${where}`).toBeLessThanOrEqual(Math.max(m.titleLine, m.buttons) + m.frame + 0.5);
          } else {
            // A phone: the title, with the buttons beside it or under it when they do not fit, and nothing else.
            const bound = m.oneRow ? Math.max(m.titleLine, m.buttons) : m.titleLine + m.rowGap + m.buttons;
            expect(m.height, `the band's height, ${where}`).toBeLessThanOrEqual(bound + m.frame + 0.5);
          }
        } else {
          expect(m.pictures, `pictures shown from lg, ${where}`).toBeGreaterThan(0);
          expect(m.sentenceShown, `the sentence shown from lg, ${where}`).toBe(true);
          expect(m.sentenceLines, `the sentence on two lines at most, ${where}`).toBeLessThanOrEqual(2);
          expect(m.oneRow, `the words beside the buttons, ${where}`).toBe(true);
          expect(m.height, `the band's height, ${where}`).toBeLessThanOrEqual(Math.max(m.column, m.pictures, m.buttons) + m.frame + 0.5);
        }
      }
    }
  });
});
