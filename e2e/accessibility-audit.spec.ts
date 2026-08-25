import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from './helpers/announcements';

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

/**
 * Distinct serious/critical WCAG **rules** broken per screen. Measured
 * 2026-08-24 at 1-2 per screen; **remediated to zero on 2026-08-25**. Node
 * counts are printed and attached on every run, but they are not what the gate
 * asserts — see why below.
 *
 * What the two defects were, kept because the shape of the fix is the reusable
 * part:
 *  - `color-contrast` (serious) on every screen — the muted `text-slate-400`
 *    and `text-[10px]` labels, most of them the phase-navigation bar. It was
 *    never six problems: it was four colour tokens used everywhere. The muted
 *    grey went one step darker, and `--color-retro-primary` went from indigo
 *    500 to 600 because white text on the 500 measured 4.46:1 against a 4.5:1
 *    floor — every primary button in the product failed by four hundredths.
 *    Column titles are painted in a colour the *facilitator* picks, so those
 *    could not be fixed by choosing better defaults: `readableTextColor` keeps
 *    the chosen hue and darkens it only as far as the floor requires.
 *  - `select-name` (critical) on the dashboard and in the session header — an
 *    unlabelled `<select>`, which a screen reader announces as nothing at all.
 *    Every `<select>` in the product now has a name, not only the two axe
 *    happened to walk past.
 *
 * **A zero baseline is a real gate, and that is the point of getting here.**
 * Any new serious or critical rule on these screens now fails the pull request
 * rather than being absorbed by an allowance. Do not raise a number to make a
 * change pass — that is the one move both ratchets exist to prevent.
 *
 * **Rules and not nodes, and the reason is worth keeping.** Node counts were
 * measured first, because they react when a new offending element joins a rule
 * that is already broken, which is how most regressions would arrive here. They
 * had to be abandoned: the login screen lists every team on the server, so its
 * count grew from 2 to 3 between two runs of this very spec — the metric was
 * measuring how much data the environment happened to hold, and a gate that
 * fails on that gets disabled within a week. A rule count is stable against data
 * volume. The cost is real and should be stated rather than discovered later: a
 * new element breaking an *already-broken* rule on the same screen will not trip
 * this. The printed node counts are the compensating signal — read them in the
 * run output when reviewing a change to shared UI.
 *
 * Impact is axe's own severity. Minor and moderate findings are counted and
 * attached but not capped: capping four severities at once turns one fix into
 * four failing assertions and teaches people to raise numbers rather than lower
 * them.
 */
const BASELINE: Record<string, number> = {
  login: 0,
  'create-team': 0,
  dashboard: 0,
  'retro-icebreaker': 0,
  'retro-brainstorm': 0,
  'retro-group': 0,
  'retro-close': 0,
  'healthcheck-survey': 0,
  'healthcheck-close': 0,
};

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const audit = async (page: Page, testInfo: TestInfo, screen: string) => {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

  const bySeverity = (impact: string) =>
    results.violations.filter((violation) => violation.impact === impact);

  const summary = {
    screen,
    critical: bySeverity('critical').length,
    serious: bySeverity('serious').length,
    moderate: bySeverity('moderate').length,
    minor: bySeverity('minor').length,
    violations: results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.length,
      firstTarget: violation.nodes[0]?.target?.join(' '),
    })),
  };

  // Attached rather than only asserted: the *report* is the deliverable a
  // commission asks for, and a passing assertion carries no evidence.
  await testInfo.attach(`axe-${screen}.json`, {
    body: JSON.stringify(summary, null, 2),
    contentType: 'application/json',
  });
  console.info(
    `[axe] ${screen}: ${summary.critical} critical, ${summary.serious} serious, `
      + `${summary.moderate} moderate, ${summary.minor} minor`,
  );
  for (const violation of summary.violations) {
    console.info(`[axe]   ${screen} · ${violation.impact} · ${violation.id} · ${violation.nodes} node(s) · ${violation.firstTarget}`);
  }

  const blockingViolations = results.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious',
  );
  const blockingNodes = blockingViolations.reduce((total, v) => total + v.nodes.length, 0);

  // `soft`, so one screen over budget does not abort the walk: the value of this
  // spec is the *complete* baseline, and a hard assertion on screen one would
  // leave the other five unmeasured — which is how a measurement quietly becomes
  // a spot check.
  expect.soft(
    blockingViolations.length,
    `${screen}: ${blockingViolations.length} serious/critical WCAG rules broken `
      + `(baseline ${BASELINE[screen]}, ${blockingNodes} offending nodes). `
      + `Rules: ${blockingViolations.map((v) => `${v.id}×${v.nodes.length}`).join(', ') || 'none'}. `
      + 'If this dropped, lower the baseline in the same change — the number may only go down.',
  ).toBeLessThanOrEqual(BASELINE[screen]);

  return summary;
};

const TEAM_NAME = `A11y-Team-${Date.now()}`;
const TEAM_PASSWORD = 'a11ypass123456';

test.describe('Accessibility baseline (audit H42)', () => {
  test('audits the four main flows with axe-core', async ({ page }, testInfo) => {
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
    await page.getByRole('button', { name: 'Create & Join' }).click();
    await expect(page.getByText(`${TEAM_NAME} Dashboard`)).toBeVisible({ timeout: 15_000 });
    await dismissAnnouncementsIfPresent(page);
    await audit(page, testInfo, 'dashboard');

    // ---- Flow 3: a retrospective ---------------------------------------
    await page.getByRole('button', { name: 'New Retrospective' }).click();
    await expect(page.getByRole('heading', { name: 'Start New Retrospective' })).toBeVisible();
    await page.locator('text=Start, Stop, Continue').first().click();
    await expect(page.getByRole('heading', { name: 'Icebreaker' })).toBeVisible({ timeout: 15_000 });
    await audit(page, testInfo, 'retro-icebreaker');

    // Straight to Brainstorm — the ticket board, i.e. the densest screen in the
    // product — through the phase bar in the header. The in-phase "Next Phase"
    // control is not on every phase; the header always is.
    await page.getByRole('button', { name: 'BRAINSTORM', exact: true }).click();
    // Waited on by its ticket input rather than by a heading: the phase title is
    // rendered as plain text, not a heading — itself part of what this audit is
    // recording (a screen reader gets no document outline from these phases).
    await expect(page.getByRole('textbox', { name: 'Add an idea...' }).first())
      .toBeVisible({ timeout: 15_000 });
    await audit(page, testInfo, 'retro-brainstorm');

    // The Group phase, with a card on the board. Added after the keyboard work:
    // it was the screen this audit did not walk, and it was the screen where the
    // first shape of that fix broke `nested-interactive` — a card turned into a
    // `role="button"` around its own reaction buttons. A screen with a new
    // interaction belongs in the audit, or the audit measures the old product.
    await page.getByRole('textbox', { name: 'Add an idea...' }).first().fill('Deploys are scary');
    await page.getByRole('textbox', { name: 'Add an idea...' }).first().press('Enter');
    await page.getByRole('button', { name: 'GROUP', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Group Ideas' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /Pick up the ticket/ }).first()).toBeVisible();
    await audit(page, testInfo, 'retro-group');

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
  });
});
