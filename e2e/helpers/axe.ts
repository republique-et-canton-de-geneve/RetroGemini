import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

/**
 * The axe-core audit every e2e spec runs a screen through (audit H42), and the
 * per-screen cap it asserts. Shared since the Jira release: the screens that
 * feature added are reached only by `e2e/jira.spec.ts`, which needs a Jira and
 * a second browser, so they are audited there rather than in
 * `accessibility-audit.spec.ts` — and one cap per screen, kept here, is what
 * stops either spec from quietly measuring against a different rule.
 *
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
 * change pass — that is the one move both ratchets exist to prevent. A screen
 * joins the audit at zero: the Jira screens did.
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
export const BASELINE: Record<string, number> = {
  // e2e/accessibility-audit.spec.ts
  login: 0,
  'create-team': 0,
  dashboard: 0,
  'retro-icebreaker': 0,
  'retro-open-actions': 0,
  'retro-brainstorm': 0,
  'retro-group': 0,
  'retro-close': 0,
  'healthcheck-survey': 0,
  'healthcheck-close': 0,
  // e2e/jira.spec.ts
  'jira-console-card': 0,
  'jira-settings-card': 0,
  'jira-review-step': 0,
  'jira-batch-dialog': 0,
  'jira-dashboard-actions': 0,
  // One parent issue per session (41.0): the card with both type lists, and
  // the dialog with its parent field and its parent issues.
  'jira-settings-card-session-parent': 0,
  'jira-batch-dialog-session-parent': 0,
  // e2e/admin-team-restore.spec.ts
  'admin-backup-import-card': 0,
};

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

interface AuditOptions {
  /**
   * Audit only this part of the page. For a card added to a screen the audit
   * has never walked (the super-admin console, the Dashboard's Settings tab):
   * the cap then measures the card, and a finding elsewhere on that screen is
   * neither blamed on it nor allowed to hide behind it. A screen that *is*
   * audited whole stays whole — scoping it would drop what it already gates.
   */
  scope?: Locator;
}

const SCOPE_ATTRIBUTE = 'data-axe-scope';

export const audit = async (page: Page, testInfo: TestInfo, screen: string, { scope }: AuditOptions = {}) => {
  // A screen with no cap would be compared with `undefined` and fail with a
  // message that names nothing useful: say what is missing instead.
  if (!Object.prototype.hasOwnProperty.call(BASELINE, screen)) {
    throw new Error(`axe audit: "${screen}" has no entry in BASELINE (e2e/helpers/axe.ts); add it at 0.`);
  }

  const builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (scope) {
    // axe takes CSS selectors, not Playwright locators: mark the element for
    // the run, and take the mark off afterwards.
    await scope.evaluate((element, [name, value]) => element.setAttribute(name, value), [SCOPE_ATTRIBUTE, screen] as const);
    builder.include(`[${SCOPE_ATTRIBUTE}="${screen}"]`);
  }
  const results = await builder.analyze().finally(async () => {
    if (scope) await scope.evaluate((element, name) => element.removeAttribute(name), SCOPE_ATTRIBUTE).catch(() => undefined);
  });

  const bySeverity = (impact: string) =>
    results.violations.filter((violation) => violation.impact === impact);

  const summary = {
    screen,
    scoped: !!scope,
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

  // `soft`, so one screen over budget does not abort the walk: the value of an
  // audit is the *complete* baseline, and a hard assertion on screen one would
  // leave the others unmeasured — which is how a measurement quietly becomes a
  // spot check.
  expect.soft(
    blockingViolations.length,
    `${screen}: ${blockingViolations.length} serious/critical WCAG rules broken `
      + `(baseline ${BASELINE[screen]}, ${blockingNodes} offending nodes). `
      + `Rules: ${blockingViolations.map((v) => `${v.id}×${v.nodes.length}`).join(', ') || 'none'}. `
      + 'If this dropped, lower the baseline in the same change — the number may only go down.',
  ).toBeLessThanOrEqual(BASELINE[screen]);

  return summary;
};
