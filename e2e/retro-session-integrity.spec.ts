import { test, expect, Page, Browser, BrowserContext } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from './helpers/announcements';

/**
 * Two field reports of the same failure (team ISS, 2026-10-12): every card a
 * participant wrote stayed on their own screen for a minute, never reached
 * anyone else, then vanished. Both paths were reproduced in a browser before
 * the fix and fail here without it:
 *
 * 1. The facilitator renames the retro on the Dashboard after the invitations
 *    went out. The participant's client kept the old title and the server
 *    refused every one of their writes over that facilitator-only field.
 * 2. A second facilitator tab, left on a stale Dashboard, deletes an older
 *    retro. It sent its whole cached list of retros back, which erased the
 *    live one from the team record; the participant who joined next got a
 *    placeholder with another title, and the same refusals followed.
 *
 * The assertion that matters is the facilitator seeing the participant's card:
 * before the fix it never arrived, however long the test waited.
 */

const TEAM_PASSWORD = 'testpass123456';
const PARTICIPANT_NAME = 'Anabella';
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

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

const startRetro = async (page: Page) => {
  await page.getByRole('button', { name: 'New Retrospective' }).click();
  await page.locator('text=Start, Stop, Continue').first().click();
  await expect(page.getByRole('heading', { name: 'Icebreaker' })).toBeVisible({ timeout: 10_000 });
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

const joinThroughInvite = async (page: Page, teamName: string, inviteUrl: string, expectedHeading: string) => {
  await page.goto(inviteUrl);
  const joinHeading = page.getByText(`Join ${teamName}`);
  const phaseHeading = page.getByRole('heading', { name: expectedHeading });
  const mode = await Promise.race([
    joinHeading.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'JOIN' as const),
    phaseHeading.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'AUTO' as const),
  ]);
  if (mode === 'JOIN') {
    const notInList = page.getByRole('button', { name: "I'm not in the list" });
    if (await notInList.isVisible({ timeout: 2_000 }).catch(() => false)) await notInList.click();
    await page.getByPlaceholder('e.g. John Doe').fill(PARTICIPANT_NAME);
    await page.getByRole('button', { name: 'Join Retrospective' }).click();
  }
  await expect(phaseHeading).toBeVisible({ timeout: 15_000 });
};

const writeCard = async (page: Page, columnIndex: number, text: string) => {
  const area = page.locator('textarea[placeholder="Add an idea..."]').nth(columnIndex);
  await area.click();
  await area.fill(text);
  await page.keyboard.press('Enter');
};

test.describe('A participant\'s cards always reach the board', () => {
  let contexts: BrowserContext[] = [];

  const newContext = async (browser: Browser) => {
    const context = await browser.newContext();
    contexts.push(context);
    return context;
  };

  test.afterEach(async () => {
    await Promise.all(contexts.map(c => c.close()));
    contexts = [];
  });

  test('after the facilitator renames the retro while the participant is in it', async ({ browser }) => {
    const teamName = `E2E-Rename-${Date.now()}`;
    const facilitator = await (await newContext(browser)).newPage();
    const participant = await (await newContext(browser)).newPage();

    await createTeam(facilitator, teamName);
    await startRetro(facilitator);
    const inviteUrl = await readInviteLink(facilitator);
    await joinThroughInvite(participant, teamName, inviteUrl, 'Icebreaker');
    await wait(1_000);

    // The rename happens on the Dashboard, after the invitations went out.
    await facilitator.getByRole('button', { name: 'Leave the retrospective' }).click();
    await expect(facilitator.getByText(`${teamName} Dashboard`)).toBeVisible({ timeout: 10_000 });
    await facilitator.getByRole('button', { name: 'Retrospectives' }).first().click();
    await facilitator.getByRole('button', { name: 'Rename retrospective' }).first().click();
    await facilitator.keyboard.press('ControlOrMeta+a');
    await facilitator.keyboard.type('Sprint 42 retro');
    await facilitator.keyboard.press('Enter');
    await expect(facilitator.getByText('Sprint 42 retro')).toBeVisible({ timeout: 10_000 });

    await facilitator.getByRole('button', { name: 'Resume' }).first().click();
    await facilitator.locator('.phase-nav-btn', { hasText: 'BRAINSTORM' }).click();
    await expect(participant.getByRole('heading', { name: 'Brainstorm' })).toBeVisible({ timeout: 10_000 });

    await writeCard(participant, 0, 'Card written after the rename');
    await expect(facilitator.getByText('Card written after the rename')).toBeVisible({ timeout: 15_000 });
    await expect(participant.getByText('Your changes are not being saved.')).toHaveCount(0);
  });

  test('after a stale facilitator tab deletes another retro', async ({ browser }) => {
    const teamName = `E2E-StaleTab-${Date.now()}`;
    const facilitatorContext = await newContext(browser);
    const liveTab = await facilitatorContext.newPage();
    const participant = await (await newContext(browser)).newPage();

    // An older retro, so the stale tab has something to delete.
    await createTeam(liveTab, teamName);
    await startRetro(liveTab);
    await liveTab.getByRole('button', { name: 'Leave the retrospective' }).click();
    await expect(liveTab.getByText(`${teamName} Dashboard`)).toBeVisible({ timeout: 10_000 });

    // Second tab of the same browser, left on the Dashboard: its list of
    // retros is loaded now and never refreshed.
    const staleTab = await facilitatorContext.newPage();
    await staleTab.goto('/');
    await expect(staleTab.getByText(`${teamName} Dashboard`)).toBeVisible({ timeout: 15_000 });
    await dismissAnnouncementsIfPresent(staleTab);

    // The retro actually run today, created after the stale tab loaded.
    await startRetro(liveTab);
    await liveTab.locator('.phase-nav-btn', { hasText: 'BRAINSTORM' }).click();
    await expect(liveTab.getByRole('heading', { name: 'Brainstorm' })).toBeVisible({ timeout: 10_000 });
    const inviteUrl = await readInviteLink(liveTab);

    await staleTab.getByRole('button', { name: 'Retrospectives' }).first().click();
    await staleTab.getByRole('button', { name: 'Delete retrospective' }).first().click();
    await staleTab.getByRole('button', { name: 'Delete retro', exact: true }).click();
    await wait(1_500);

    await joinThroughInvite(participant, teamName, inviteUrl, 'Brainstorm');
    await writeCard(participant, 0, 'Card written after the delete');
    await expect(liveTab.getByText('Card written after the delete')).toBeVisible({ timeout: 15_000 });

    // The live retro survived in the team record: a fresh load still lists it.
    await staleTab.reload();
    await expect(staleTab.getByText(`${teamName} Dashboard`)).toBeVisible({ timeout: 15_000 });
    await staleTab.getByRole('button', { name: 'Retrospectives' }).first().click();
    await expect(staleTab.getByRole('button', { name: 'Resume' })).toHaveCount(1);
  });
});
