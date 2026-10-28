import { test, expect, Page, BrowserContext, Locator } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from './helpers/announcements';
import { audit } from './helpers/axe';

/**
 * The open board (utils/openBoard.ts): a retrospective with every card
 * activity on one screen and no phases, kept open — the Lean Coffee request.
 *
 * What only a real browser and two of them can show: a participant joining
 * through the invite link lands on the board; the facilitator's panel lists
 * the people connected right now and loses them when they leave; a vote cast
 * in one browser shows in the other, and survives a grouping; a group moves
 * whole to another column; and a round trip through the guided retrospective
 * keeps every card, group and vote. The board is audited with axe on the way.
 *
 * Grouping and moving are driven through the keyboard controls: an HTML5 drag
 * is not deterministic in a headless browser, and `sessionOpenBoard.test.tsx`
 * pins the pointer path.
 */

const TEAM_NAME = `E2E-Board-${Date.now()}`;
const TEAM_PASSWORD = 'openboard123456';
const PARTICIPANT_NAME = 'Lea Participant';

const columns = (page: Page) => page.locator('[data-group-columns-scroller] > [data-column-id]');
const card = (scope: Page | Locator, text: string) => scope.locator('div.group', { hasText: text });
const boardHeading = (page: Page) => page.getByRole('heading', { level: 2, name: 'Open board' });

const addIdea = async (page: Page, columnIndex: number, text: string) => {
  const column = columns(page).nth(columnIndex);
  const field = column.getByPlaceholder('Add an idea...');
  await field.click();
  await field.fill(text);
  await page.keyboard.press('Enter');
  await expect(column).toContainText(text);
};

const readInviteLink = async (page: Page) => {
  await page.locator('button[title="Invite / Join"]').click();
  await page.getByRole('button', { name: 'CODE & LINK' }).click();
  const link = page.locator('code').first();
  await expect(link).toContainText('?join=', { timeout: 10_000 });
  const url = (await link.textContent()) ?? '';
  await page.getByRole('button', { name: 'Done' }).click();
  return url;
};

/** A keyboard control is `sr-only` until focused: focus it, then press it. */
const press = async (page: Page, name: RegExp) => {
  await page.getByRole('button', { name }).focus();
  await page.keyboard.press('Enter');
};

test.describe('Open board', () => {
  let facilitatorContext: BrowserContext;
  let participantContext: BrowserContext;
  let facilitator: Page;
  let participant: Page;

  test.beforeAll(async ({ browser }) => {
    facilitatorContext = await browser.newContext();
    participantContext = await browser.newContext();
    facilitator = await facilitatorContext.newPage();
    participant = await participantContext.newPage();
  });

  test.afterAll(async () => {
    await facilitatorContext?.close();
    await participantContext?.close();
  });

  test('writes, votes, groups and moves on one screen, and survives a round trip through the guided retro', async () => {
    // ---- A team and an open board, from the new retrospective dialog ----
    await facilitator.goto('/');
    await facilitator.waitForLoadState('networkidle');
    await facilitator.getByRole('button', { name: '+ New Team' }).click();
    await facilitator.getByPlaceholder('e.g. Design Team').fill(TEAM_NAME);
    await facilitator.locator('input[type="password"]').fill(TEAM_PASSWORD);
    await facilitator.getByLabel('Recovery Email').fill('facilitator@example.com');
    await facilitator.getByRole('button', { name: 'Create & Join' }).click();
    await expect(facilitator.getByText(`${TEAM_NAME} Dashboard`)).toBeVisible({ timeout: 10_000 });
    await dismissAnnouncementsIfPresent(facilitator);

    await facilitator.getByRole('button', { name: 'New Retrospective' }).click();
    const dialog = facilitator.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Open board', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Open board', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await dialog.getByTestId('retro-template-lean_coffee').click();

    // One screen: no phase bar, no "next phase".
    await expect(boardHeading(facilitator)).toBeVisible({ timeout: 15_000 });
    await expect(facilitator.locator('.phase-nav-btn')).toHaveCount(0);
    await expect(facilitator.getByRole('button', { name: 'Next Phase' })).toHaveCount(0);
    // Created anonymous, as the board type proposes.
    await expect(facilitator.getByRole('checkbox', { name: 'Anonymous' })).toBeChecked();

    await addIdea(facilitator, 0, 'Flaky deploys');
    await addIdea(facilitator, 0, 'Slow rollbacks');
    await addIdea(facilitator, 0, 'Too many meetings');

    // ---- A participant joins through the invite link and lands on the board ----
    const inviteUrl = await readInviteLink(facilitator);
    await participant.goto(inviteUrl);
    const joinHeading = participant.getByText(`Join ${TEAM_NAME}`);
    const entry = await Promise.race([
      joinHeading.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'JOIN' as const),
      boardHeading(participant).waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'AUTO_JOIN' as const)
    ]);
    if (entry === 'JOIN') {
      const notInList = participant.getByRole('button', { name: "I'm not in the list" });
      if (await notInList.isVisible({ timeout: 2_000 }).catch(() => false)) await notInList.click();
      await participant.getByPlaceholder('e.g. John Doe').fill(PARTICIPANT_NAME);
      await participant.getByRole('button', { name: 'Join Retrospective' }).click();
    }
    await expect(boardHeading(participant)).toBeVisible({ timeout: 15_000 });
    await expect(columns(participant).nth(0)).toContainText('Slow rollbacks', { timeout: 10_000 });

    // The panel lists the people connected right now, and keeps no waiting list.
    await expect(facilitator.getByText('Connected now (2)')).toBeVisible({ timeout: 15_000 });
    await expect(facilitator.getByTestId('invited-section')).toHaveCount(0);
    await expect(facilitator.getByTestId('toggle-left-btn')).toHaveCount(0);

    // ---- A vote in one browser shows in the other ----
    await card(participant, 'Flaky deploys').getByRole('button', { name: 'Add a vote to this ticket' }).click();
    await expect(card(facilitator, 'Flaky deploys').getByTestId('vote-total')).toContainText('1', { timeout: 10_000 });

    // The author votes on their own card: a real click, which fails if any
    // control (an invisible delete button) lies over the vote button.
    await card(facilitator, 'Too many meetings').getByRole('button', { name: 'Add a vote to this ticket' }).click();
    await expect(card(facilitator, 'Too many meetings').getByTestId('vote-total')).toContainText('1');
    await expect(card(participant, 'Too many meetings').getByTestId('vote-total')).toContainText('1', { timeout: 10_000 });

    await audit(facilitator, test.info(), 'retro-open-board');

    // ---- Grouping keeps the vote ----
    await press(facilitator, /Pick up the ticket Flaky deploys/);
    await press(facilitator, /group the selected ticket with Slow rollbacks/);
    const group = facilitator.locator('.group-container');
    await expect(group).toHaveCount(1, { timeout: 10_000 });
    await expect(group).toContainText('Flaky deploys');
    await expect(group).toContainText('Slow rollbacks');
    await group.getByPlaceholder('Name this group...').fill('Delivery');
    await group.getByPlaceholder('Name this group...').press('Enter');
    await expect(group.getByTestId('vote-total').last()).toContainText('1');

    // ---- The whole group moves to "Discussing" ----
    await press(facilitator, /Move the group Delivery to another column/);
    await facilitator.getByRole('button', { name: /move the selected group to Discussing/ }).click();
    await expect(columns(facilitator).nth(1)).toContainText('Flaky deploys', { timeout: 10_000 });
    await expect(columns(facilitator).nth(1)).toContainText('Slow rollbacks');
    await expect(columns(facilitator).nth(0)).toContainText('Too many meetings');
    await expect(columns(participant).nth(1)).toContainText('Slow rollbacks', { timeout: 10_000 });

    // ---- The participant leaves, and leaves the panel ----
    await participant.close();
    await expect(facilitator.getByText('Connected now (1)')).toBeVisible({ timeout: 20_000 });

    // ---- A round trip through the guided retrospective keeps everything ----
    await facilitator.getByRole('button', { name: 'Switch to a guided retrospective' }).click();
    // A board created open starts the guided retro at the beginning.
    await expect(facilitator.getByRole('heading', { name: 'Icebreaker' })).toBeVisible({ timeout: 15_000 });
    await facilitator.locator('.phase-nav-btn', { hasText: 'VOTE' }).click();
    await expect(facilitator.getByRole('heading', { name: 'Vote', exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(columns(facilitator).nth(1)).toContainText('Delivery');
    await expect(columns(facilitator).nth(0)).toContainText('Too many meetings');

    await facilitator.getByRole('button', { name: 'Switch to an open board' }).click();
    await expect(boardHeading(facilitator)).toBeVisible({ timeout: 15_000 });
    await expect(columns(facilitator).nth(1)).toContainText('Flaky deploys');
    await expect(facilitator.locator('.group-container').getByTestId('vote-total').last()).toContainText('1');

    // ---- Back on the Dashboard, the list names the board ----
    await facilitator.getByRole('button', { name: 'Leave the retrospective' }).click();
    await expect(facilitator.getByText('OPEN BOARD')).toBeVisible({ timeout: 10_000 });
  });
});
