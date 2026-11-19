import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
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
      await guest.waitForTimeout(1_000);
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
