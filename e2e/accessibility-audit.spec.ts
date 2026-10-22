import { test, expect, type Page } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from './helpers/announcements';
import { PARTICIPANT_PALETTE } from '../utils/participantColors';
// The audit and the per-screen cap (`BASELINE`, at zero for every screen) live
// in the helper, shared with `e2e/jira.spec.ts`; the history of the numbers is
// written there.
import { audit } from './helpers/axe';

/**
 * Audit H42 — the accessibility baseline.
 *
 * For a Geneva public-sector deployment WCAG 2.1 AA (eCH-0059) is a conformance
 * obligation, and 15 000 lines of React had never been checked by anything. This
 * spec is the *measurement* half of the finding: it walks the four flows a
 * commission would ask about and records what axe-core reports on each.
 *
 * **Two things it deliberately does not do.**
 *
 * It did not gate on zero violations on the day it landed. A gate that fails
 * the build the day it arrives is a gate someone disables by the end of the
 * week, so the assertion is a per-screen cap: the number can hold or fall,
 * never rise. The remediation has since brought every screen to zero, so the
 * cap now *is* zero — which is where a ratchet is supposed to end up. Lower
 * `BASELINE` in the same change that fixes something (decision D6's rule).
 *
 * And it cannot replace a human. Axe inspects the markup that exists; it cannot
 * report an operation with **no** keyboard path, because there is no bad markup
 * to find. The Group-phase drag was exactly that — a well-formed `div` with
 * `draggable` and no `onKeyDown`, invisible to every automated tool in this
 * repository, found by the manual pass and fixed in
 * `components/session/groupingKeyboard.ts`. Do not read a green run here as
 * "the app is accessible": zero axe violations is a floor, not a conformance
 * statement. `ACCESSIBILITY.md` records what is claimed and what is not.
 */

const TEAM_NAME = `A11y-Team-${Date.now()}`;
const TEAM_PASSWORD = 'a11ypass123456';

/**
 * One member per participant colour, plus one the palette does not know
 * (`bg-sky-500`, rendered neutral). The audited screens used to show one
 * person, the facilitator, whose indigo is the one colour where white initials
 * pass — so ten screens at zero said nothing about the other seven colours.
 * Named after their hue, so a failing node names its colour.
 */
const hueName = (color: string) => {
  const hue = color.replace(/^bg-/, '').replace(/-\d+$/, '');
  return hue.charAt(0).toUpperCase() + hue.slice(1);
};
const SEEDED_MEMBERS = [
  ...PARTICIPANT_PALETTE.filter((color) => color !== 'bg-indigo-500').map((color) => ({
    id: `a11y-${hueName(color).toLowerCase()}`,
    name: hueName(color),
    color,
    role: 'participant' as const,
  })),
  { id: 'a11y-unknown', name: 'Sky', color: 'bg-sky-500', role: 'participant' as const },
];
// The participant who joins the retro: lime, the palette's worst case for
// white initials (1.96:1).
const PARTICIPANT = 'Lime';

/** Adds the seeded members to the team the page is signed in to, through the API. */
const seedMembers = async (page: Page) => {
  const saved = await page.evaluate(() => localStorage.getItem('retro-open-session'));
  const { teamId, sessionToken } = JSON.parse(saved ?? '{}') as { teamId?: string; sessionToken?: string };
  expect(teamId && sessionToken, 'the dashboard saved its session').toBeTruthy();
  const current = await page.request.post(`/api/team/${teamId}`, { data: { sessionToken } });
  expect(current.ok()).toBe(true);
  const { team } = (await current.json()) as { team: { members: unknown[] } };
  // The route replaces the roster, so the current members go first.
  const savedMembers = await page.request.post(`/api/team/${teamId}/members`, {
    data: { sessionToken, members: [...team.members, ...SEEDED_MEMBERS] },
  });
  expect(savedMembers.ok()).toBe(true);
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

test.describe('Accessibility baseline (audit H42)', () => {
  test('audits the four main flows with axe-core', async ({ page, browser }, testInfo) => {
    const participantContext = await browser.newContext();
    try {
      // ---- Flow 1: login ------------------------------------------------
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('button', { name: '+ New Team' })).toBeVisible();
      await audit(page, testInfo, 'login');

      await page.getByRole('button', { name: '+ New Team' }).click();
      await expect(page.getByRole('heading', { name: 'Create New Team' })).toBeVisible();
      await audit(page, testInfo, 'create-team');

      // ---- Flow 2: dashboard --------------------------------------------
      await page.getByPlaceholder('e.g. Design Team').fill(TEAM_NAME);
      await page.locator('input[type="password"]').fill(TEAM_PASSWORD);
      await page.getByLabel('Recovery Email').fill('facilitator@example.com');
      await page.getByRole('button', { name: 'Create & Join' }).click();
      await expect(page.getByText(`${TEAM_NAME} Dashboard`)).toBeVisible({ timeout: 15_000 });
      await dismissAnnouncementsIfPresent(page);
      await audit(page, testInfo, 'dashboard');

      // The Members tab with one member per participant colour. Seeded through
      // the API and reloaded *before* the seed action below: a persist still
      // queued when the page reloads would be lost, and the Open Actions round
      // depends on that action.
      await seedMembers(page);
      await page.reload();
      await expect(page.getByText(`${TEAM_NAME} Dashboard`)).toBeVisible({ timeout: 15_000 });
      await dismissAnnouncementsIfPresent(page);
      await page.locator('.dash-tab', { hasText: 'Members' }).click();
      await expect(page.getByText(PARTICIPANT, { exact: true })).toBeVisible({ timeout: 10_000 });
      await audit(page, testInfo, 'dashboard-members');
      await page.locator('.dash-tab', { hasText: 'Actions' }).click();

      // A closed action, so the Open Actions phase below has a rating round to
      // audit rather than an empty block. Closing it from the dashboard is what
      // stamps `closedAt`, which is what the round selects on.
      const seedAction = page.getByPlaceholder('What needs to be done?');
      await seedAction.fill('Automate the release notes');
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(page.locator('input[value="Automate the release notes"]')).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: 'Mark action as done' }).first().click();

      // ---- Flow 3: a retrospective ---------------------------------------
      // Focus returned by a dialog, measured before we walk on. Opening with the
      // mouse and closing with Escape used to leave the browser's default outline
      // on the opener — a black rectangle on a button the user only clicked
      // (H51). The focus must come back; the ring must not.
      const retroOpener = page.getByRole('button', { name: 'New Retrospective' });
      await retroOpener.click();
      await expect(page.getByRole('heading', { name: 'Start New Retrospective' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('heading', { name: 'Start New Retrospective' })).toBeHidden();
      const restored = await retroOpener.evaluate((el) => ({
        focused: document.activeElement === el,
        outline: getComputedStyle(el).outlineStyle,
      }));
      expect(restored.focused, 'focus must come back to the opener').toBe(true);
      expect(restored.outline, 'a pointer-opened dialog must not leave a ring').toBe('none');

      await retroOpener.click();
      await expect(page.getByRole('heading', { name: 'Start New Retrospective' })).toBeVisible();
      await page.locator('text=Start, Stop, Continue').first().click();
      await expect(page.getByRole('heading', { name: 'Icebreaker' })).toBeVisible({ timeout: 15_000 });

      // A second person joins through the invite link, as the lime member: the
      // member picker shows every seeded colour, and from here on every retro
      // screen audits the panel with an indigo and a lime avatar.
      const inviteUrl = await readInviteLink(page);
      const participant = await participantContext.newPage();
      await participant.goto(inviteUrl);
      await expect(participant.getByText(`Join ${TEAM_NAME}`)).toBeVisible({ timeout: 15_000 });
      await participant.getByRole('button', { name: new RegExp(PARTICIPANT) }).click();
      await audit(participant, testInfo, 'join-member-picker');
      await participant.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(participant.getByRole('heading', { name: 'Icebreaker' })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('Participants (2)')).toBeVisible({ timeout: 15_000 });
      await audit(page, testInfo, 'retro-icebreaker');

      // The Open Actions phase, carrying the impact rating round: a group of vote
      // controls, a dismissible notice and a reveal toggle, none of which any
      // other audited screen exercises.
      await page.getByRole('button', { name: 'OPEN ACTIONS', exact: true }).click();
      await expect(page.getByText('Review Open Actions')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('closed-actions-rating')).toBeVisible({ timeout: 15_000 });
      await audit(page, testInfo, 'retro-open-actions');

      // Straight to Brainstorm — the ticket board, i.e. the densest screen in the
      // product — through the phase bar in the header. The in-phase "Next Phase"
      // control is not on every phase; the header always is.
      await page.getByRole('button', { name: 'BRAINSTORM', exact: true }).click();
      // Waited on by its ticket input rather than by a heading: the phase title is
      // rendered as plain text, not a heading — itself part of what this audit is
      // recording (a screen reader gets no document outline from these phases).
      await expect(page.getByRole('textbox', { name: 'Add an idea...' }).first())
        .toBeVisible({ timeout: 15_000 });
      // The card is written *before* this screen is audited, not after: an empty
      // board has no card controls on it, so the audit would walk a Brainstorm
      // phase nobody ever sees. It also carries this phase's own move control,
      // which is `sr-only` until focused, like the Group phase's.
      await page.getByRole('textbox', { name: 'Add an idea...' }).first().fill('Deploys are scary');
      await page.getByRole('textbox', { name: 'Add an idea...' }).first().press('Enter');
      await expect(page.getByRole('button', { name: /Move the card Deploys are scary/ })).toBeAttached();
      // Audited before the participant writes anything, so their row shows
      // "no tickets" — a label that used to be near-white.
      await audit(page, testInfo, 'retro-brainstorm');

      // The participant's card, so the Group phase shows a lime author avatar.
      // The participant is not audited here: with "Reveal cards" off, the
      // facilitator's card is on their board as blurred text, which axe measures
      // at about 1.2:1 (ACCESSIBILITY.md, gap 7) — a finding about hidden cards,
      // not about avatars, and auditing it here would leave only bad ways to pass.
      const participantIdea = participant.getByRole('textbox', { name: 'Add an idea...' }).first();
      await expect(participantIdea).toBeVisible({ timeout: 15_000 });
      await participantIdea.fill('Lime idea');
      await participantIdea.press('Enter');
      await expect(page.getByText('Lime idea')).toBeAttached({ timeout: 15_000 });

      // The Group phase, with a card on the board. Added after the keyboard work:
      // it was the screen this audit did not walk, and it was the screen where the
      // first shape of that fix broke `nested-interactive` — a card turned into a
      // `role="button"` around its own reaction buttons. A screen with a new
      // interaction belongs in the audit, or the audit measures the old product.
      await page.getByRole('button', { name: 'GROUP', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Group Ideas' })).toBeVisible({ timeout: 15_000 });
      // The keyboard control is `sr-only` until focused — the board must look
      // unchanged for everyone else — so wait on it being *present*, and prove the
      // reveal separately below.
      const pickUp = page.getByRole('button', { name: /Pick up the ticket/ }).first();
      await expect(pickUp).toBeAttached();

      // The board is unchanged at rest, and the control appears when tabbed to.
      // Measured in a real browser: jsdom has no layout, so a unit test cannot
      // tell a hidden control from a visible one.
      const restWidth = (await pickUp.boundingBox())?.width ?? 0;
      expect(restWidth, 'the grouping control must not be on screen at rest').toBeLessThan(4);
      await pickUp.focus();
      const focusedWidth = (await pickUp.boundingBox())?.width ?? 0;
      expect(focusedWidth, 'focusing the control must reveal it').toBeGreaterThan(40);
      await pickUp.blur();
      await audit(page, testInfo, 'retro-group');

      // The participant's own Group screen: their header avatar (lime), both
      // cards with nothing hidden, and the panel collapsed, as it is for
      // participants by default.
      await expect(participant.getByRole('heading', { name: 'Group Ideas' })).toBeVisible({ timeout: 15_000 });
      await expect(participant.getByText('Lime idea')).toBeVisible();
      await audit(participant, testInfo, 'retro-group-participant');

      // The facilitator marks the participant as departed: their avatar turns
      // neutral grey instead of fading to 50%, which put the initials below the
      // floor on every colour.
      const participantRow = page.getByTestId('participant-row').filter({ hasText: PARTICIPANT });
      await participantRow.hover();
      await participantRow.getByTestId('toggle-left-btn').click();
      await expect(participantRow.getByText('Left the session')).toBeVisible({ timeout: 10_000 });
      // The pointer would still be on the row, and axe would measure its hover colours.
      await page.mouse.move(0, 0);
      await audit(page, testInfo, 'retro-group-participant-left');
      await participantRow.hover();
      await participantRow.getByTestId('toggle-left-btn').click();
      await expect(page.getByText('Participants (2)')).toBeVisible({ timeout: 10_000 });
      await page.mouse.move(0, 0);

      // The close screen, which is **dark**. Added after a light-screen contrast
      // sweep darkened its text tokens too: on `bg-slate-900` the muted grey went
      // from 6.78:1 to 3.74:1 and the reveal link from 5.70:1 to 2.76:1. Six
      // screens on a white background could not see that, so the audit walks a
      // dark one now (Codex, PR #436).
      await page.getByRole('button', { name: 'CLOSE', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Session Closed' })).toBeVisible({ timeout: 15_000 });
      await audit(page, testInfo, 'retro-close');

      // ---- Flow 4: a health check ----------------------------------------
      // Named by its `aria-label`: this button used to announce itself as
      // "arrow_back", the icon font's ligature leaking out as the accessible name.
      await page.getByRole('button', { name: 'Leave the retrospective' }).click();
      await expect(page.getByText(`${TEAM_NAME} Dashboard`)).toBeVisible({ timeout: 15_000 });
      await dismissAnnouncementsIfPresent(page);
      await page.getByRole('button', { name: 'Health Checks' }).click();
      await page.getByText('START HEALTH CHECK').click();
      await expect(page.getByRole('heading', { name: 'Start Health Check' })).toBeVisible();
      await page.getByRole('button', { name: 'Start Health Check', exact: true }).click();
      await expect(page.getByText('Rate each health dimension')).toBeVisible({ timeout: 15_000 });
      await audit(page, testInfo, 'healthcheck-survey');

      // The health check's own dark close screen — the same component shape, and
      // it carried the same regression.
      await page.getByRole('button', { name: 'CLOSE', exact: true }).click();
      await expect(page.getByText('Thank you for your contribution!')).toBeVisible({ timeout: 15_000 });
      await audit(page, testInfo, 'healthcheck-close');
    } finally {
      await participantContext.close();
    }
  });
});
